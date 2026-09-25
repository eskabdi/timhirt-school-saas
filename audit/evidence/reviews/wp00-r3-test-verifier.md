# WP-00 closeout, round 3: test-verifier (verbatim verdict, reviewed 53b83e2 → 5c98d4b, 2026-09-25)

VERDICT: FAIL

- TV3-1 (major): nothing tests the https guard inside record-fee-payment / verify-admission-bank-url. Deleting `.refine(isHttpsUrl)` at 53b83e2 left all 13 Deno tests passing. 5c98d4b changed the behaviour (https_required instead of 400) with no writer test. Fix: make the bank-verification step injectable and test that non-https returns https_required with no insert and no fetch, that the payment is still recorded, and that https is stored; show each test fails without the branch. → **fixed after this verdict**: `_shared/bank-verification-record.ts` (`checkAndStoreBankUrl`) is used by both writers and covered by `bank-verification-record.test.ts` (10 tests). Removing the https branch fails 6; removing the write-error check fails 1.
- TV3-2 (minor): no component test proves the pages use `httpsHref`. The DB CHECK is validated, and `httpsHref` itself is tested. → backlog.
- TV3-3 (info): the plan cites `npm run typecheck`, but no such script existed. → **added**.
- TV3-4 (info): HEAD moved during the review. Freeze the branch during review rounds.

CHECKED (all mutations were run in scratch copies):
- handler.test.ts: moving the row check after the Vault writes fails 1 test; removing validation fails 2; removing the config-key check fails 1.
- schema.test.ts: removing `.strict()` fails its test; removing `.min(1)` fails the empty-config test.
- Branded type: removing the brand gives TS2578; a hand-built page body gives TS2345.
- https-url.test.ts and safeUrl.test.ts: weakened rules fail (http, javascript:, leading space).
- verification_url_https.sql on a private DB: 108/56 all pass; without the migration, assertions 2–5 fail. Re-runnable, and `convalidated=t`.
- Full gate at 53b83e2: tsc 0, eslint 0, Vitest 56, check:i18n 0, locales OK, build OK, Deno 13/13, deno check OK.
- No `.only`/`.skip`. The closeout claims in FIXES_VERIFIED match the measurements.
