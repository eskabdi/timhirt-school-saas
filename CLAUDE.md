# Working in this repo

Timhirt — multi-tenant Ethiopian school management SaaS. React + Vite +
TanStack Query on Supabase (Postgres + RLS + Edge Functions + Storage), no
custom API server.

> **Deployed state (verified 2026-10-18):** production runs frontend `61836e2`
> (served `<meta name="app-commit">` on www.edux.et and the vercel.app domain:
> the Academic Calendar Engine slice 1 page `/academic-calendar` plus the
> invite fixes) and all 116 of the repo's migrations (the calendar engine
> `20261008000001` and the invite state `20261017000001` applied 2026-10-18,
> staging dry run first). 28/28 Edge Functions match the repo (names and
> `verify_jwt`); `invite-tenant-admin`, `onboard-tenant`, `invite-staff` and
> `provision-portal-accounts` run the `61836e2` code. Evidence:
> `audit/evidence/cal1-predeploy-*.txt`, `cal1-deploy-staging-*.txt`,
> `cal1-deploy-2*.txt`. The
> staging project (`timhirt-saas-staging`, ref `ekebibapffrhzibidbnr`,
> sign-up disabled) has the same 116 migrations, no data and no Edge
> Functions; it is the dry run for every production migration. Both projects
> are on the Free plan, which **pauses a project after ~7 days without
> database activity** (both were paused 2026-10-08 and restored by the owner
> 2026-10-09; staging again by 2026-10-17). Production has **PITR off and no backups**. Public sign-up is
> **disabled** (invite-only). The Edge Function secret `APP_URL` is
> `https://www.edux.et` (invite redirects, document and ID-card verify links;
> since 2026-10-17, was the vercel.app domain), and both domains are in the
> auth redirect allow-list. Vercel (Hobby)
> refuses to build a commit authored by Claude: deploy from a `git archive` of
> the reviewed commit with `--build-env VITE_COMMIT_SHA=<sha>`. The R6 fix plan
> is `docs/audits/timhirt-production-fix-plan.md`; progress is in
> `audit/FIXES_VERIFIED_R6.md`.

The architecture blueprint is [`docs/school-saas-architecture-blueprint.md`](docs/school-saas-architecture-blueprint.md).
Code comments cite it by section (§6.2 route guards, §17.2 canonical date
storage, §10.4 injection/XSS). It ends at §20 — a few comments cite §21.9 for
INSA reasoning, and that section is not in the document.

---

## Traps that have already cost real time

Each of these was a live bug, not a hypothetical.

### Deploying

**Never pass `--prebuilt`. Use `npm run deploy`.**
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are baked in at build time and
live in the *Vercel project settings*. A local `vercel build` cannot see them,
so a locally built artifact ships with `undefined` for both and the app dies on
load with `supabaseUrl is required` — a blank page. Only a server-side build
gets the env injected.

`--prebuilt=false` does not mean what it looks like: the flag is boolean, the
`=false` is discarded, and you get `--prebuilt`. That shipped a stale July 18
artifact on every deploy for eight days, blanking the app and reverting the
super-admin console to a pre-redesign layout.

`.vercel/output` is gitignored but persists in a working copy. `npm run deploy`
clears it first. Full runbook in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

**A `READY` deployment is not a shipped deployment.** Grep the served bundle
for something only the new code contains before saying it worked.

### Postgres

**Use `cardinality()`, not `array_length()`, in a CHECK on an array.**
`array_length('{}', 1)` is `NULL`, and a CHECK only rejects on `FALSE` — so
`array_length(x, 1) >= 1` silently accepts the empty array it was written to
forbid. `cardinality('{}')` is `0`.

**`ALTER TYPE … ADD VALUE` works inside the deploy wrapper's transaction**,
provided the new labels are not *used* in that same transaction.

**Gregorian is canonical storage; EC is presentation-only (§17.2).** Every
rendered date goes through `<EthDate/>` or `formatEth`. Raw `toLocaleDateString`
is banned by lint.

**"Today" means `today()`/`todayAddis()`, never a bare `new Date()`.**
`toEthiopian`/`formatEth`/`<EthDate/>` read a Date's *UTC* fields by design
(§17.2), but `new Date()` is the current instant, and Ethiopia is UTC+3 with
no DST — for the three hours after local midnight (21:00–24:00 UTC) the UTC
calendar day is still yesterday. `toEthiopian(new Date())` silently returned
yesterday's EC date in that window, which corrupted every "today" derived
from it: dashboard/calendar today-highlighting, EC-year defaults, and the
issuance date stamped on every generated document. Browser code calls
`today()` (`src/lib/ethiopian-date.ts`, pins UTC midnight from the local
Y/M/D); Edge Functions call `todayAddis()`
(`supabase/functions/_shared/ethiopian-date.ts`, fixed +3h offset, since Deno
runs in UTC regardless of the caller's timezone) — never `new Date()` when
what you mean is "today."

### React / UI

**`Field` renders a `<label>`.** A `<label>` with no `htmlFor` forwards clicks
to its first labelable descendant. Putting several controls inside one meant
pressing "+ Add Section" also pressed the first chip's ✕ and dropped a section,
and a dropzone opened the file picker twice. **Composite controls use
`FieldGroup`** (`src/components/ui/Field.tsx`), which is a `div`.

**`<EthDate value={…}/>` accepts a bare date, a full ISO instant, a `Date`, or
nothing.** It used to blindly append `T00:00:00Z`, so any `*_at` timestamptz
produced an Invalid Date and a `RangeError` that React Router turned into a
full-page error screen. Don't reintroduce a caller-side `.slice(0, 10)` — the
component handles it.

**`react/no-danger` is an error.** Stored HTML renders through
`components/ui/RichText.tsx`, an allow-list DOMParser walk. Never
`dangerouslySetInnerHTML`.

**Tailwind colour tokens are CSS variables holding space-separated RGB
channels**, so `rgb(var(--x) / <alpha-value>)` keeps opacity modifiers like
`border-navy/40` working. Don't put hex in them.

### Testing / tooling gotchas

**Inputs written without a `type` attribute are not matched by
`input[type="text"]`** even though the DOM property reads `"text"`. Cost three
debugging rounds. Select them by another attribute.

**Never re-serialise a locale file.** `json.dump(…, indent=2)` /
`JSON.stringify(…, null, 2)` produces a 1500-line diff that changes no keys.
Insert into the existing line. `npm run check:locales` fails the build on this.

**The harness grants what Supabase grants.** `supabase/tests/shim.sql` mirrors
Supabase's default privileges (USAGE on `public` and per-role grants on every new
table, sequence and function for `anon`, `authenticated`, `service_role`); that
is what production has, and `audit/evidence/wp01-acl-parity-*.txt` shows the
harness and production agree on EXECUTE for every public function and
SELECT/INSERT on every public table and view (191 = 191); schema USAGE and
`auth.users` access match `audit/evidence/wp01-prod-calendar-and-schema-grants-*.txt`.
UPDATE/DELETE, sequences and schema CREATE are not compared yet. Before R6 WP-01 anon
could not reach `public` at all, so every "anon cannot call X" probe passed
vacuously and H-01 hid behind a green run. Don't add a grant to the shim that
Supabase doesn't make.

**SECURITY DEFINER functions are closed by default (R6 WP-02).** Every one in
`public` is EXECUTE-able only by service_role unless it is listed, with a
reason, in `supabase/security/definer_allowlist.sql`;
`catalog_definer_security.sql` fails CI on any drift in either direction. A
migration that adds a definer function must `revoke execute … from public,
anon, authenticated`, pin `set search_path = public, pg_temp`, and re-grant
only what the allow-list says. Helpers that take a user or tenant id must
answer only for the caller unless `current_setting('role')` is one of the
trusted contexts (`none`, `service_role`, `postgres`, `supabase_admin`) — an
allow-list, so an unexpected role is treated as an end user (see
`20260926000001_r6_definer_lockdown.sql`).

**Every new function starts closed (R6 WP-02).** postgres's default
privileges no longer grant EXECUTE to PUBLIC, anon or authenticated in
`public`, so a function a migration creates — definer or invoker — is callable
only by service_role until the migration grants it. An RPC the app calls
needs `grant execute … to authenticated`; `scripts/ci/app-rpc-grants.py`
fails CI when an app `supabase.rpc()` target is not executable by
authenticated. A pgTAP helper created in `pg_temp` and called while acting as
a user needs a grant too. So does an invoker helper that only a policy or
view calls (`catalog_definer_security.sql` #8 fails CI if a policy, view,
default or CHECK calls a function its role cannot execute), and an extension
created outside the `extensions` schema starts closed as well (`storage`
functions: service_role only).

**Known gaps are TAP TODOs, not skipped tests.** A `todo('WP-xx: …')` assertion
that fails is reported and tolerated; one that passes fails the suite, so
whoever closes the gap must flip it to a hard assertion. The catalog guards
(`catalog_*.sql`) are ratchets against `supabase/security/*_known.sql`: a new
offender fails, and a fixed one must be deleted from the baseline.

**psql pads its output.** An anchored `grep '^not ok'` over raw `psql` output
matches nothing, so a pgTAP runner can report green while every assertion
fails. `supabase/tests/run.sh` uses `-qtA` and counts assertions against each
suite's declared plan.

---

## Before you say it works

Run the gates — CI runs all of them, so a miss here is a red build later:

```bash
npx tsc --noEmit
npx eslint src                      # 0 errors, 0 warnings
npx vitest run
npm run check:i18n                  # must be 0
npm run check:locales               # parity + no wholesale reformat
npm run build
PGHOST=… ./supabase/tests/run.sh    # 116 migrations + 68 pgTAP suites
python3 scripts/ci/app-rpc-grants.py      # after run.sh, same PG* env
bash scripts/ci/deno-check.sh       # Edge Function types (ratchet)
python3 scripts/ci/semgrep-rule-test.py   # needs semgrep 1.95.0
```

`eslint scripts/` reports `no-undef` on node globals — `scripts/` is outside the
configured lint scope. `npx eslint src` is the project's command.

**Verification means running the thing.** Every real bug this repo has produced
was found by driving the app in a browser or hitting the endpoint, not by
reading the diff. Twice a "green" result turned out to be a runner that was
measuring nothing. Prove a gate fails before trusting that it passed.

**A green suite is not a tested change: every acceptance criterion needs an
assertion that fails when the code it protects is broken.** The Academic
Calendar slice 1 suite had 53 passing assertions and the test verifier still
returned FAIL (CAL-TV, 2026-10-17): seven areas had no test at all. The select
policy and module gate on `school_calendar_entries` could be replaced with
`using (true)`, the authority locked/closed/override guards switched off, the
holiday-over-break precedence swapped, and the "tentative holidays are never
counted" test passed vacuously (its only date was outside the session). The
fix, now the rule for every WP:
- For each new table, policy, guard, RPC and UI behaviour, write the assertion
  that would catch its removal: cross-tenant reads/writes (tenant B sees 0
  rows), draft/permission visibility, the module gate, locked/closed guards,
  precedence, input limits, and the read-side defence as well as the write
  guard.
- Add a non-vacuity check next to each "sees 0 rows" probe (the rows exist),
  and pick fixture dates inside the range the behaviour applies to.
- Mutation-prove: inside `begin; <mutation>; \i suite.sql` (the suite rolls
  back) replace the policy with `using (true)`, turn the guard's `if` into
  `if false`, drop the predicate — each must turn an assertion red (an ERROR
  that aborts the suite counts). Keep the log in `audit/evidence/`.
- Time bombs: a fixture that depends on "the current EC year" must still pass
  when the year is faked forward (2020, 2021…); prefer dates no seeded session
  covers.
- UI: test what the user sees (badge, legend, inspector, marks, the error
  alert, query-key scope), and assert mock arguments (`p_action: "create"`), so
  a wrong call cannot pass.
- Keep parity between duplicated sources (a TS copy of a SQL seed) with a test,
  not a comment.

## Before merge and before deploy (mandatory)

**Before any merge** (to `main` or any shared branch), dispatch all four on
the commit being merged, fix every confirmed Critical/High/Medium finding, and
re-run them on the fixed commit:
1. `code-review` skill — correctness bugs in the diff;
2. `security-review` skill — exploitable vulnerabilities in the diff;
3. `tenant-isolation-review` skill (`.claude/skills/tenant-isolation-review`) —
   no cross-tenant read or write, probed and mutation-proven;
4. `verify` skill — run it: real Postgres for migrations/RLS, the browser
   harness for pages.

Their verdicts go in `audit/evidence/reviews/`. A change made after a skill ran
is not reviewed: re-run the skills on the new commit.

**Every deploy goes through the `deploy` skill** (`.claude/skills/deploy`):
staging dry run first, then production, then the `deploy-checker` agent and the
served-bundle grep. Never deploy by hand outside it, and never deploy a commit
the four pre-merge skills have not passed.

---

## Conventions

- **i18n**: en / am / om at full parity, ICU via react-i18next. Namespaces
  `common`, `apply`, `calendar`. `tField()` reads jsonb `{en,am,om}` columns.
  Every new string needs all three locales.
- **RLS is the authorization layer.** Route guards are UX only (§6.2). No
  `.eq('tenant_id', …)` in queries — RLS injects it.
- **Migrations** are validated locally against real Postgres before deploy;
  reading them is not enough. A backfill once joined on a column that did not
  exist and only the harness caught it.
- **Edge Functions** share `_shared/security.ts`. `rateLimit()` is async and
  Postgres-backed (`consume_rate_limit`); it fails closed.
- **Dual control (R6 WP-09).** Recording a manual payment above the school's
  threshold, voiding an invoice, changing a grade after results are published
  and transferring a student out go through `approval_requests`
  (`submit_approval` → `decide_approval`); the database refuses the direct
  write from a client. Two kinds of enforcement trigger. The SECURITY INVOKER ones
  (grades, students, invoice amounts and status, the payment write guard)
  trust only `current_user` in (`postgres`, `service_role`, `supabase_admin`),
  i.e. a definer RPC or the service key. The SECURITY DEFINER ones
  (`payments_reject_void_invoice`, `fee_invoices_header_open_check`) see
  `current_user = postgres` always, so they trust `current_setting('role')` in
  (`none`, `service_role`, `postgres`, `supabase_admin`) instead; a definer RPC
  called by a signed-in user is a client there. Every other role is a client. Invoice
  amounts and status are written only by payments and approved requests, and
  an approval re-checks the record it acts on (the state the checker saw)
  under the invoice-header lock: header first, then its lines by created_at. A new
  sensitive action is registered in `approval_actions` and wired the same way,
  never gated only in the UI.
- Deploy tokens: never commit, never echo, shred after use.
