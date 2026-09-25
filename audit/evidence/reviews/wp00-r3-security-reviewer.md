# WP-00 closeout, round 3: security-reviewer (verbatim verdict, HEAD 53b83e2, 2026-09-25)

VERDICT: PASS

- SR3-1 (minor): `isHttpsUrl` uses `new URL()`, which ignores leading whitespace and embedded tab/newline characters. Values like " https://a.et/x" and "https:\n//a.et" pass, get stored raw, and then violate the DB CHECK. verify-admission-bank-url never checks its insert/update result, so a caller could get `{ok:true,status:"verified"}` with no row saved. It fails closed (no XSS). Fix: trim before `.url()` or require a literal https:// prefix, and check `{ error }` on both writes. → **fixed after this verdict**: literal-prefix and no-whitespace rule, `.trim()` in both schemas, write errors checked in both functions, new test cases.
- SR3-2 (minor): the CHECK is added validated and relies on a 0-row count. Until the deploy, the live writers can still store non-https URLs, and one such row would abort the deploy transaction. Fix: NOT VALID then VALIDATE, or re-count immediately before applying. → **addressed**: a pre-apply re-count step is added to the deploy order in `audit/prod-drift-2026-09-24.md` §4.
- SR3-3 (info): pgTAP was not run locally; the result relies on CI rls-tests. The library suite is not vacuous (it grants, then applies via `\ir`).
- SR3-4 (info, owner): DR-4 (undeployed set, anon library write, FS-1 live in prod) and DR-1 (sign-up) are still open. 46/65 definer functions are anon-executable in prod (WP-02). G-09 is correctly re-opened.

CHECKED:
- The library migration signatures match, and the only caller is the service role.
- The https CHECK: every fixture URL is https, `~*` is case-insensitive, and the UPDATE path is covered.
- FS-1: two writers require https; two renderers go through `httpsHref`; links carry `rel="noopener noreferrer"`; no dangerouslySetInnerHTML.
- SSRF: `bank-verify.ts` is unchanged (https only, exact-host allow-list, `redirect:"manual"`).
- manage-integration-credentials: role and rate limit come first, then a strict payload with exact key sets, then the row check, all before any Vault write. No secret is echoed back and errors are generic. `keys.ts` has no imports.
- IntegrationsPage: the `config` column is no longer selected, raw server errors are no longer shown, and the new strings exist in en/am/om.
- Gates:
  - tsc: pass
  - Vitest: 56/56
  - eslint: 0
  - deno test: 0 failures
  - deno check on the three functions: pass
