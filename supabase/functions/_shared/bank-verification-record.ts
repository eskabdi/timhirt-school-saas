// The check-and-store step shared by both writers of
// bank_payment_verifications (record-fee-payment, verify-admission-bank-url).
// One function, so the https rule (R6 FS-1) and the write-error rule (SR3-1)
// cannot drift between them, and so both are covered by one Deno test
// (bank-verification-record.test.ts, review TV3-1).
import type { AuthContext } from "./security.ts";
import { isHttpsUrl } from "./https-url.ts";
import type { VerifyBankUrlInput, VerifyBankUrlResult } from "./bank-verify.ts";

type AdminClient = AuthContext["adminClient"];

export type BankCheck = { status: "verified" } | { status: "failed"; reason: string };

export type BankTarget = { payment_id: string } | { admission_application_id: string };

export async function checkAndStoreBankUrl(
  deps: {
    db: AdminClient;
    verify: (db: AdminClient, input: VerifyBankUrlInput) => Promise<VerifyBankUrlResult>;
  },
  args: { tenantId: string; target: BankTarget; paymentMethod: string; verificationUrl: string },
): Promise<BankCheck> {
  // A non-https URL is neither fetched nor stored: it would be rendered as a
  // link (FS-1), and the DB CHECK refuses it anyway. The caller still gets
  // the specific https_required reason (review RG3-1/RG3-2).
  if (!isHttpsUrl(args.verificationUrl)) return { status: "failed", reason: "https_required" };

  const pathPrefix = "payment_id" in args.target ? args.target.payment_id : args.target.admission_application_id;
  const result = await deps.verify(deps.db, {
    tenantId: args.tenantId, pathPrefix,
    paymentMethod: args.paymentMethod, verificationUrl: args.verificationUrl,
  });

  const [key, value] = Object.entries(args.target)[0] as [string, string];
  const { data: existing, error: lookupError } = await deps.db.from("bank_payment_verifications")
    .select("id").eq(key, value).maybeSingle();
  if (lookupError) throw lookupError;

  const row: Record<string, unknown> = {
    tenant_id: args.tenantId, ...args.target,
    payment_method: args.paymentMethod, verification_url: args.verificationUrl,
    pdf_path: result.status === "verified" ? result.pdfPath : null,
    status: result.status, failure_reason: result.status === "failed" ? result.failureReason : null,
    checked_at: new Date().toISOString(),
  };
  // A failed write must never be reported as verified (review SR3-1).
  const { error: writeError } = existing
    ? await deps.db.from("bank_payment_verifications").update(row).eq("id", existing.id)
    : await deps.db.from("bank_payment_verifications").insert(row);
  if (writeError) throw writeError;

  return result.status === "verified" ? { status: "verified" } : { status: "failed", reason: result.failureReason };
}
