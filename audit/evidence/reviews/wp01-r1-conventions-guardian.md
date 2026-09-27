REVIEWER: conventions-guardian
WP: R6 WP-01 (conventions gate scaffold; diff bae3bfd..744f1d4, HEAD 744f1d4)
VERDICT: PASS

The gate does what the plan asks of WP-01: a script that is "filled in WP-14". I found no blocker or major issue. The minor findings all feed WP-14. The biggest one is that the name check misses 15 real name concatenations, so the backlog undercounts the work WP-14 has to do.

FINDINGS:
  - id: CG-1
    severity: minor
    location: scripts/ci/conventions.py:22
    evidence: The name check only matches `${a.first_name} ${a.last_name}` inside template strings. It misses the JSX form `{s.first_name} {s.last_name}`, which appears in 15 places: AttendanceMarkingPage.tsx:149, ClinicPage.tsx:74,97, DisciplineIncidentsPage.tsx:67,90, InvoiceDetailPage.tsx:182, InvoicesPage.tsx:384, ExamsPage.tsx:131, GradebookPage.tsx:65 and others. So there are at least 28 name concatenations that drop the middle name, not 13. The backlog entry also leaves out `enroll-finalize-billing/index.ts:65`, even though the script itself reports it.
    reference: Plan §0 Rule 8 (First + Middle + Last), M-12, WP-14
    fix: Add a JSX pattern `(first_name|firstName)\}\s*\{[^}]*(last_name|lastName)\}` and a `+`/`.join` form. Correct the audit/backlog.md line to the real count and list all three Edge Functions.
  - id: CG-2
    severity: minor
    location: scripts/ci/conventions.py:21
    evidence: I tested the currency regex on sample strings. It misses `` `$${amount}` ``, `"$" + n`, `<span>$</span>{amount}`, `currency: "EUR"` and lowercase `"usd"`. It wrongly flags regex back-references such as `.replace(/a/, "$1")`. The file's own docstring says "A non-ETB currency", but the check only covers USD and `$`.
    reference: Rule 8 (ETB only); WP-01 item 3 "no $/USD currency"
    fix: In WP-14, flag `currency:\s*["'](?!ETB)[A-Za-z]{3}`, a bare `"$"`/`'$'` literal, `$${` and `\b(USD|EUR|GBP)\b` (case-insensitive). Allow `"$<digit>"` only as the second argument of `.replace(`. Or change the docstring to say "$/USD" only.
  - id: CG-3
    severity: minor
    location: scripts/ci/conventions.py:12-13; .github/workflows/ci.yml ("Project conventions (report-only)")
    evidence: With no flag the script exits 0 even though it has 21 findings; with `--strict` it exits 1 (I ran both). Running report-only while the 21 known findings exist is reasonable. But it has no baseline, so a new Ge'ez digit, `$` or name concatenation can land between now and WP-14 without CI noticing. The repo already handles this problem with ratchets elsewhere (catalog_*_known.sql, deno_check_known.txt).
    reference: CLAUDE.md "Known gaps are ... ratchets"; plan §0A.4 (missing control)
    fix: Add a baseline file (`supabase/security/conventions_known.txt`), fail CI on anything not in it, and fail when a listed entry has been fixed but not removed.
  - id: CG-4
    severity: minor
    location: scripts/ci/conventions.py:17-18
    evidence: The script only reads `.ts`, `.tsx` and `.json` files under `src/` and `supabase/functions/`. Document/PDF templates seeded in SQL migrations (supabase/migrations/20260903000001_document_templates.sql, …_id_card_template_buckets.sql), `.css`, `.html`, `.mjs` and `index.html` are never scanned. WP-14 item 1 wants every character U+1369–U+137C checked "in … PDF templates". Today a repo-wide scan finds no Ge'ez digits outside the covered scope, so this is a gap in coverage, not a hidden violation. The check also cannot see digits built at runtime, which WP-14 plans to cover with a runtime test.
    reference: Plan WP-01 item 3, WP-14 item 1, RV-11/G-02
    fix: Add `.sql`, `.css`, `.html`, `.js` and `.mjs` to the file types, include `supabase/migrations` and `index.html`, or scan `git ls-files` minus docs/ and audit/.
  - id: CG-5
    severity: minor
    location: scripts/ci/conventions.py (file name); plan lines 321 and 1269
    evidence: The plan and the WP-14 acceptance text both name `scripts/ci/conventions.sh`, which does not exist. The script was written as `conventions.py`, and CI calls the `.py` file. The reviewer brief says to run `conventions.sh`, which fails.
    reference: §0A.4 doc/control mismatch
    fix: Either update the plan text (lines 321 and 1269) to `conventions.py`, or add a one-line `conventions.sh` wrapper.
  - id: CG-6
    severity: minor
    location: scripts/ci/conventions.py (no test)
    evidence: Nothing in the repo proves the gate fails on planted violations. This is unlike `semgrep-rule-test.py`, which checks its rules against fixtures. My manual `--strict` exit 1 is the only evidence.
    reference: CLAUDE.md "Prove a gate fails before trusting that it passed"
    fix: Add fixtures with one positive and one negative case per check, plus a self-test step in CI.
  - id: CG-7
    severity: info
    location: scripts/ci/conventions.py:20
    evidence: The regex `"[፩-፼]"` is written with the Ge'ez characters themselves (I confirmed the range is 0x1369–0x137c). The script itself therefore breaks the "no U+1369–U+137C in code" rule, and it would flag itself if the scan is ever widened to cover scripts/.
    reference: Rule 8
    fix: Write it as `"[\u1369-\u137C]"`.
  - id: CG-8
    severity: info
    location: src/features/settings/CalendarPreferencesPage.tsx:45-48; src/components/EthDate.tsx:40,48; src/components/EthDatePicker.tsx:141-200; src/lib/ethiopian-date.ts:70-95
    evidence: Any tenant admin can turn on "Use Ge'ez numerals", and every `<EthDate/>` for that tenant would then render Ge'ez digits. Deferring this to WP-14 matches the plan (M-11 is assigned to WP-14). The claim that 0 of 3 production tenants have it enabled cannot be verified from here: I have no access to production. Also, line 47 is hardcoded English plus Ethiopic text, yet `check:i18n` reports 0. The i18n audit misses this string. It is pre-existing, not part of this diff.
    reference: Rule 8 (Arabic numerals only), M-11, G-02
    fix: In WP-14, remove the toggle, `toGeez`, the `geez` props and `useGeezNumerals`. Add a migration that deletes `settings.calendar.geezNumerals` from tenant configs, and delete the `toGeez` tests. Separately, check why the i18n audit misses text containing an apostrophe or Ethiopic characters.

CHECKED:
  - Plan §0 Rule 8, §0A.4, §0A.5, WP-01 (lines 306–325), and WP-14 item 1 (line 1269).
  - `git diff bae3bfd..744f1d4`: all 41 changed files listed. I read the full diffs of conventions.py, ci.yml, backlog.md, package.json, CLAUDE.md, src/ and supabase/functions/.
  - `python3 scripts/ci/conventions.py`: 8 Ge'ez-digit, 0 currency and 13 name-concat findings, exit 0. With `--strict`: exit 1.
  - The regex character range is exactly U+1369–U+137C.
  - Scanned every tracked file (excluding docs/ and audit/) for U+1369–U+137C: the only hit outside the gate's scope is conventions.py itself.
  - Searched for escaped or computed Ge'ez digits (`\u1369`, `0x1369`, etc.): none. Traced every use of the Ge'ez option.
  - Tested the currency regex on 11 sample strings (results above). Grepped src and functions for non-ETB currency: only `currency: "ETB"` is present (DashboardPage.tsx:250, i18n.ts:53).
  - Name concatenation: the regex hits plus a search for forms it misses (15 JSX hits). Confirmed the migrations use `middle_name` and `father_name` columns.
  - No new user-facing strings or locale changes in the diff. The Edge Function changes only add console logs. The RichText and vite.config changes add no visible text.
  - `npm run check:i18n`: 0 hardcoded strings. `npm run check:locales -- bae3bfd`: parity ok (common 2175, apply 135, calendar 18) and no wholesale reformat.
  - CI runs the gate report-only, with a comment tying `--strict` to WP-14.
  - Not in scope for this brief (other reviewers cover them): Tayitu/Jiret fonts, the Ethiopian clock, formatEth and address hierarchy. This WP touches none of them.

I did not write a /tmp review file.
