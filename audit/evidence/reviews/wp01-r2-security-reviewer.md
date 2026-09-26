REVIEWER: security-reviewer (OWASP Top 10 / ASVS L2 / INSA Phase 3 secure-coding)
WP: R6 WP-01 (range bae3bfd..ffe8242, HEAD ffe8242)
VERDICT: PASS

I found no blockers and no majors. There are 4 minor findings and 5 info findings.

FINDINGS

SEC-WP01-1 | minor | supabase/migrations/20260925000002_r6_calendar_numerals.sql:14-26
- Evidence: I ran the migration on a scratch PG16 against edge-case rows.
  - `{"calendar":"x"}` and `{"calendar":null}` both abort it with `ERROR: cannot delete from scalar`. The WHERE clause matches them because `not (settings->'calendar' ? 'numerals')` is true for a scalar, and then `jsonb - 'geezNumerals'` fails on it.
  - `{"calendar":["geezNumerals"]}` is not aborted. It is silently rewritten to `{"calendar":[{"numerals":"latn","showHijri":false}]}`.
  - A `showHijri` value that is not a valid boolean literal (for example "maybe") would abort the `::boolean` cast. ("yes" is accepted as true.)
  - A school admin can write `settings` wholesale through the PostgREST upsert, so production may hold such rows. An abort rolls back the deploy transaction, so this fails safe, but it blocks the deploy. The production data was not checked (not verifiable here).
- Reference: plan §0 (migrations validated against real data); ASVS V5.1.
- Fix:
  - Add `and jsonb_typeof(settings->'calendar') = 'object'` to the WHERE, or normalise a non-object calendar to `'{}'`.
  - Use `case when settings #>> '{calendar,showHijri}' in ('true','false') ...` instead of the cast.
  - Add a pre-apply count query to the deploy note: `select count(*) from tenant_configs where settings ? 'calendar' and jsonb_typeof(settings->'calendar') <> 'object'`.

SEC-WP01-2 | minor | supabase/migrations/20260925000002_r6_calendar_numerals.sql:28-33; audit/FIXES_VERIFIED_R6.md:466; supabase/functions/onboard-tenant/index.ts:86
- Evidence: the new CHECK rejects any row whose calendar contains the `geezNumerals` key, even `false`. Two writers currently in production (da6055e) write that key:
  - the old `onboard-tenant` writes `calendar:{secondaryVisible:true, geezNumerals:false}`;
  - the old CalendarPreferencesPage writes `{secondaryVisible, geezNumerals}`.
  - `onboard-tenant` does not check the error from its `tenant_configs` insert (a pre-existing gap). If the migration lands before that function is redeployed, a newly onboarded tenant silently gets no `tenant_configs` row. Stale SPA tabs will also get 23514 on settings saves.
  - The deploy note says only that these "ship with the next production deploy" and gives no order.
- Reference: ASVS V1.14 (secure deployment); fix plan deploy-order convention (SR-1/SR-2 precedent).
- Fix: document the order. First deploy `onboard-tenant` and the frontend, which are safe before the migration, then apply `20260925000002`. Separately, make `onboard-tenant` check the insert `error`.

SEC-WP01-3 | minor | src/features/fees/InvoicesPage.tsx:137-140, 256 (touched line)
- Evidence: `csvCell` only quotes `"`, `,` and newlines. It does not neutralise a leading `=`, `+`, `-`, `@`, tab or CR. The diff adds `middle_name` to the exported name cell via `fullName()`. `fullName` drops empty parts, so if `first_name` is blank, `middle_name` starts the cell. The same helper exists in `src/features/hr/PayrollRunDetailPage.tsx:15`. This is a pre-existing weakness that the diff widens slightly.
- Reference: OWASP CSV Injection; CWE-1236.
- Fix: prefix `'` when a cell matches `/^[=+\-@\t\r]/`, in both `csvCell` copies (or in one shared helper).

SEC-WP01-4 | minor | .semgrep/timhirt-security.yml:17-27
- Evidence: `timhirt-no-html-string-sink` covers `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write`. It does not cover:
  - `document.execCommand("insertHTML", …)` (the editor already routes arbitrary commands through `execCommand`, `RichTextEditor.tsx:67-70`);
  - `Range.createContextualFragment`;
  - `setHTMLUnsafe` / `parseHTMLUnsafe`;
  - `iframe srcdoc`.
- The registry packs are not pinned: `p/owasp-top-ten`, `p/typescript` and `p/react` are fetched live, so their rule content can change without review. The file header still points to `semgrep --test .semgrep` and `.semgrep/timhirt-security.tsx`, but the real runner is `scripts/ci/semgrep-rule-test.py` with `.semgrep/fixtures/`.
- Reference: ASVS V14.2, V5.3.3.
- Fix: add the missing sink patterns, with `ruleid:` fixtures for each. Correct the header comment. Consider vendoring or pinning the registry rules.

SEC-WP01-5 | info | src/components/ui/RichTextEditor.tsx:52-57
- Evidence: the load path is now safe. `sanitizeRichTextNodes` parses with an inert DOMParser document and rebuilds nodes with `createElement`/`setAttribute` using the allow-listed attributes only. Nothing is re-parsed, so there is no mXSS path. The `onChange(el.innerHTML)` hand-back cannot loop, because the next effect sees `innerHTML === value`. Two side effects:
  - Opening any notice whose stored HTML is not canonical (for example `<b>`, which becomes `<strong>`) fires `onChange` on mount, so the form may look dirty without an edit.
  - Pasted HTML still enters the `contentEditable` unsanitised (there is no `onPaste` handler). This is only self-XSS, and the render path (`RichText`) re-sanitises it.
- Fix: optional. Add an `onPaste` handler that inserts through `sanitizeRichTextNodes`.

SEC-WP01-6 | info | src/components/ui/RichText.tsx:18,27-31
- Evidence: the allow-list accepts any `https:` image `src`. A notice author can embed a beacon that shows each viewer's IP address and read time to a third-party host. This policy was not introduced by this diff; the new editor path copies it.
- Fix: consider restricting images to the tenant's Storage origin, or proxying them.

SEC-WP01-7 | info | vite.config.ts:11-19; package.json deploy script
- Evidence: the exact commit SHA is stamped into public `index.html` as `<meta name="app-commit">`. The env value is regex-validated (`^[0-9a-f]{7,40}$`), and `execSync` uses a fixed command, so there is no injection. Publishing the commit SHA is a small fingerprinting disclosure, and it was chosen on purpose (GK-F4).
- Fix: none needed. Record it as accepted in the INSA pending-changes list.

SEC-WP01-8 | info | .github/workflows/ci.yml:53
- Evidence: `npm audit --omit=dev --audit-level=high` excludes the build toolchain (vite, happy-dom, eslint plugins) from the audit gate. Dependabot partly covers this.
- Fix: optionally add a non-blocking or `critical`-level full audit.

SEC-WP01-9 | info | src/features/settings/useCalendarPrefs.ts:7, 407
- Evidence:
  - The comment says the flag was "removed by migration 20260925000001", but the migration is `20260925000002` (`20260925000001` is `verification_url_https`).
  - The new hook repeats `.eq("tenant_id", …)`, against the CLAUDE.md convention of leaving tenant scoping to RLS. RLS still enforces isolation, so this is not a security issue.
- Fix: correct the migration number in the comment.

CHECKED
- The full diff `bae3bfd..ffe8242`: CI workflow, `dependabot.yml`, `.gitleaksignore`, the semgrep rules and runner, and `scripts/ci/{conventions.py, deno-check.sh, pinned-actions.sh, semgrep-rule-test.py}`.
- CI supply chain:
  - Top-level `permissions: contents: read` is present. There is no `pull_request_target`.
  - `${{ github.event.pull_request.base.sha }}` in `run:` is a SHA, not attacker-controlled text.
  - All 7 `uses:` are SHA-pinned; I ran `pinned-actions.sh` and it returned ok.
  - gitleaks is installed with `go install` against the checksum DB and runs `--redact` over the full history. The 7 ignores are exact commit:file:rule:line fingerprints, not paths.
  - semgrep is installed with `--require-hashes`. The rule self-test requires a JSON report, so a crashed semgrep cannot pass.
- `conventions.py --self-test` passes. The full `conventions.py` scan finds 0 findings.
- `npx tsc --noEmit` passes with no errors. `npx vitest run` passes: 10 files, 66 tests, including the RichText sanitiser and editor load-path tests.
- RichText sanitiser, `toDom` and `safeAttrs`:
  - `javascript:`, leading-whitespace and `data:` non-image URLs are dropped. Event handlers and `<script>`/`<svg>` are dropped.
  - Links get `target=_blank` and `rel=noopener noreferrer`.
  - The editor's link and image prompts validate their scheme.
- Edge Functions (`activate-sso-user`, `process-export-job`, `process-import-job`):
  - The broken `.catch()` on PostgREST builders is replaced with try/await plus an `error` check.
  - Logs contain `error.message` only, with no PII or stack traces.
  - Clients still get the generic `errors.internal()`.
- Name helper: `src/lib/names.ts` and `_shared/names.ts` concatenate only; I saw no injection path.
- `middle_name` selects:
  - `students.middle_name` is granted SELECT to authenticated in `20260718000001:24`, so the parent-portal embed works under the column grants.
  - The Edge Function selects use `adminClient`, keyed by an already-authorised id. `issue-fee-document` uses `userClient`, so RLS applies.
  - I found no PostgREST filter-string interpolation in the changed queries.
- Calendar settings:
  - `parseCalendarPrefs` normalises untrusted jsonb into a closed set.
  - Hijri output comes from `Intl`, with month names from the locales, and React escapes it.
  - The preview uses `today()`, not `new Date()`.
  - The CHECK permits NULL settings, and the r6 pgTAP suite covers the migration.
- The migration was executed on a scratch PG16 (since removed) against scalar, null, array, numeric and string-boolean `calendar` values. Results are in SEC-WP01-1.
- I did not re-run the full `supabase/tests/run.sh` harness, `deno-check.sh` or the semgrep/gitleaks scans, because deno, semgrep and gitleaks are not installed here. I also could not see production `tenant_configs` data, so the SEC-WP01-1 impact on production is unverified.
