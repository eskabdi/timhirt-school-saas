// R6 WP-00 review TV3-1: both bank_payment_verifications writers go through
// checkAndStoreBankUrl. A non-https URL is never fetched and never stored; an
// https URL is verified and stored; a failed write is never reported verified.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { AuthContext } from "./security.ts";
import type { VerifyBankUrlInput, VerifyBankUrlResult } from "./bank-verify.ts";
import { checkAndStoreBankUrl } from "./bank-verification-record.ts";

type Call = { op: string; args: unknown[] };

function fakeDb(opts: { existingId?: string; writeError?: string } = {}) {
  const log: Call[][] = [];
  const resolve = (calls: Call[]) => {
    if (calls.some((c) => c.op === "insert" || c.op === "update")) {
      return { data: null, error: opts.writeError ? { message: opts.writeError } : null };
    }
    return { data: opts.existingId ? { id: opts.existingId } : null, error: null };
  };
  const chain = (calls: Call[]): unknown =>
    new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (r: (v: unknown) => void) => r(resolve(calls));
        return (...args: unknown[]) => {
          calls.push({ op: String(prop), args });
          return chain(calls);
        };
      },
    });
  const db = new Proxy({}, {
    get(_t, prop) {
      return (...args: unknown[]) => {
        const calls: Call[] = [{ op: String(prop), args }];
        log.push(calls);
        return chain(calls);
      };
    },
  }) as unknown as AuthContext["adminClient"];
  const writes = () => log.flat().filter((c) => c.op === "insert" || c.op === "update");
  return { db, writes };
}

function fakeVerify(result: VerifyBankUrlResult) {
  const seen: VerifyBankUrlInput[] = [];
  const verify = (_db: unknown, input: VerifyBankUrlInput) => {
    seen.push(input);
    return Promise.resolve(result);
  };
  return { verify, seen };
}

const base = { tenantId: "t1", paymentMethod: "cbe" };

for (const url of ["http://apps.cbe.com.et/?id=FT1", "javascript:alert(1)", " https://a.et/x"]) {
  for (const target of [{ payment_id: "p1" }, { admission_application_id: "a1" }]) {
    Deno.test(`non-https ${JSON.stringify(url)} (${Object.keys(target)[0]}): https_required, not fetched, not stored`, async () => {
      const { db, writes } = fakeDb();
      const { verify, seen } = fakeVerify({ status: "verified", pdfPath: "x.pdf" });
      const r = await checkAndStoreBankUrl({ db, verify }, { ...base, target, verificationUrl: url });
      assertEquals(r, { status: "failed", reason: "https_required" });
      assertEquals(seen.length, 0);
      assertEquals(writes().length, 0);
    });
  }
}

Deno.test("https URL for a fee payment: verified, fetched once, inserted with payment_id", async () => {
  const { db, writes } = fakeDb();
  const { verify, seen } = fakeVerify({ status: "verified", pdfPath: "p1/receipt.pdf" });
  const r = await checkAndStoreBankUrl({ db, verify }, {
    ...base, target: { payment_id: "p1" }, verificationUrl: "https://apps.cbe.com.et:100/?id=FT1",
  });
  assertEquals(r, { status: "verified" });
  assertEquals(seen.length, 1);
  assertEquals(seen[0].pathPrefix, "p1");
  const w = writes();
  assertEquals(w.length, 1);
  assertEquals(w[0].op, "insert");
  const row = w[0].args[0] as Record<string, unknown>;
  assertEquals(row.payment_id, "p1");
  assertEquals(row.verification_url, "https://apps.cbe.com.et:100/?id=FT1");
  assertEquals(row.status, "verified");
});

Deno.test("https URL for an admission with an existing row: updated, failure reason passed through", async () => {
  const { db, writes } = fakeDb({ existingId: "bv1" });
  const { verify } = fakeVerify({ status: "failed", failureReason: "domain_not_allowed" });
  const r = await checkAndStoreBankUrl({ db, verify }, {
    ...base, target: { admission_application_id: "a1" }, verificationUrl: "https://evil.example/x",
  });
  assertEquals(r, { status: "failed", reason: "domain_not_allowed" });
  const w = writes();
  assertEquals(w.length, 1);
  assertEquals(w[0].op, "update");
});

Deno.test("a failed write is thrown, never reported as verified (SR3-1)", async () => {
  const { db } = fakeDb({ writeError: "check constraint violated" });
  const { verify } = fakeVerify({ status: "verified", pdfPath: "x.pdf" });
  await assertRejects(() =>
    checkAndStoreBankUrl({ db, verify }, { ...base, target: { payment_id: "p1" }, verificationUrl: "https://a.et/x" })
  );
});
