// ============================================================================
// SSRF-safe server-side verification of a bank-hosted "payment verification"
// PDF URL. Used from both the public admission flow
// (verify-admission-bank-url) and ordinary fee payments (record-fee-payment),
// per an explicit requirement that this not be admission-only.
//
// Defenses, in order -- each is a hard reject, no partial credit:
//   1. HTTPS only.
//   2. Exact-hostname allow-list (bank_verification_domains). No
//      wildcard/suffix matching -- an admin adds each real subdomain
//      explicitly. Zero rows configured for a payment_method = fail closed.
//   3. fetch() with redirect:"manual" -- any 3xx is a hard reject. This is
//      the key defense against "an allow-listed domain 302s to an internal
//      host"; closing it costs one fetch option, not custom DNS-resolution
//      logic.
//   4. Size cap while streaming (~10MB) -- never buffer an unbounded
//      response.
//   5. PDF magic-byte sniff ("%PDF-" at byte 0) rather than trusting
//      Content-Type alone -- same rigor issue-id-card already applies to
//      font sfnt magic bytes.
//
// Residual/accepted risk: a DNS-rebinding attack against an allow-listed
// domain between the allow-list check and the fetch is not defended against
// (no custom DNS pinning) -- accepted given the allow-list only ever
// contains a handful of well-known public bank hostnames an admin adds
// manually, not attacker-influenced input.
//
// Known reachability gap, confirmed against production (2026-08-07): CBE's
// apps.cbe.com.et:100 and Telebirr's transactioninfo.ethiotelecom.et were
// allow-listed and tested with real transaction URLs through the live
// verify-admission-bank-url function. Both failed with reason "fetch_failed";
// the function's own logs show the cause is FETCH_TIMEOUT_MS (10s) expiring
// -- "Signal timed out." -- not a code defect. A from-sandbox curl probe to
// the same two URLs independently reset/timed out the same way, so this
// isn't proxy-specific either. Most likely these banks geo/IP-restrict to
// Ethiopian networks and simply never respond to cloud egress IPs (Supabase's
// edge network included). No fix identified from outside an Ethiopian IP;
// until one is, a registrant/accountant using either domain should expect
// "Failed" here and fall back to the manual receipt-image upload, which
// remains available alongside the URL option by design.
//
// Two Telebirr paths now deliberately coexist, and that's not redundancy:
// this file covers a parent/applicant who transferred money directly via the
// Telebirr app OUTSIDE any checkout flow (e.g. paying a registrar in person,
// or the public admission flow, which has no session to run a checkout in)
// and needs the payment verified after the fact by pasting a receipt URL.
// The Telebirr H5 C2B gateway (_shared/telebirr.ts, process-fee-payment) is
// a separate, real payment-initiation API for parents paying an existing fee
// invoice online — it supersedes Chapa (now canceled) for that flow, but
// does not replace this manual-transfer-verification path, which still has
// no substitute for any transfer that happens outside checkout.
// ============================================================================
import type { AuthContext } from "./security.ts";
import { readBodyWithCap } from "./stream-read.ts";

type AdminClient = AuthContext["adminClient"];

const MAX_BYTES = 10 * 1024 * 1024; // 10MB, matches the bank-verifications bucket limit
const FETCH_TIMEOUT_MS = 10_000;
const PDF_MAGIC = new TextEncoder().encode("%PDF-");

export interface VerifyBankUrlInput {
  tenantId: string;
  pathPrefix: string; // admission_application_id or payment_id
  paymentMethod: string;
  verificationUrl: string;
}

export type VerifyBankUrlResult =
  | { status: "verified"; pdfPath: string }
  | { status: "failed"; failureReason: string };

function bytesStartWith(bytes: Uint8Array, magic: Uint8Array): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false;
  return true;
}

export async function verifyBankUrl(admin: AdminClient, input: VerifyBankUrlInput): Promise<VerifyBankUrlResult> {
  let url: URL;
  try {
    url = new URL(input.verificationUrl);
  } catch {
    return { status: "failed", failureReason: "invalid_url" };
  }

  if (url.protocol !== "https:") {
    return { status: "failed", failureReason: "https_required" };
  }

  const { data: domains } = await admin.from("bank_verification_domains")
    .select("hostname").eq("payment_method", input.paymentMethod);
  const allowed = new Set((domains ?? []).map((d: { hostname: string }) => d.hostname.toLowerCase()));
  if (allowed.size === 0) {
    return { status: "failed", failureReason: "no_domains_configured" };
  }
  if (!allowed.has(url.hostname.toLowerCase())) {
    return { status: "failed", failureReason: "domain_not_allowed" };
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/pdf" },
    });
  } catch (err) {
    console.error("verifyBankUrl: fetch failed", { message: (err as Error).message });
    return { status: "failed", failureReason: "fetch_failed" };
  }

  if (res.status >= 300 && res.status < 400) {
    return { status: "failed", failureReason: "redirect_blocked" };
  }
  if (!res.ok) {
    return { status: "failed", failureReason: `http_${res.status}` };
  }
  const read = await readBodyWithCap(res, MAX_BYTES);
  if (!read.ok) {
    if (read.reason === "read_failed") {
      console.error("verifyBankUrl: stream read failed");
    }
    return { status: "failed", failureReason: read.reason === "read_failed" ? "fetch_failed" : read.reason };
  }
  const bytes = read.bytes;

  if (!bytesStartWith(bytes, PDF_MAGIC)) {
    return { status: "failed", failureReason: "not_a_pdf" };
  }

  const path = `${input.tenantId}/${input.pathPrefix}/${crypto.randomUUID()}.pdf`;
  const { error: upErr } = await admin.storage.from("bank-verifications").upload(path, bytes, { contentType: "application/pdf" });
  if (upErr) {
    console.error("verifyBankUrl: upload failed", { message: upErr.message });
    return { status: "failed", failureReason: "storage_failed" };
  }

  return { status: "verified", pdfPath: path };
}
