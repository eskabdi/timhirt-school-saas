# Working in this repo

Timhirt — multi-tenant Ethiopian school management SaaS. React + Vite +
TanStack Query on Supabase (Postgres + RLS + Edge Functions + Storage), no
custom API server.

> **Deployed state (verified 2026-09-25):** production runs commit `da6055e`
> (R6 WP-00 and its closeout, PR #8). 108 of the repo's 110 migrations are applied
> (`20260925000002` and `20260925000003`, R6 WP-01, are pending their deploy), and 28/28
> Edge Functions match the repo (names and `verify_jwt`). The frontend is built
> on Vercel from `da6055e`. See `audit/prod-drift-2026-09-24.md` §5 and
> `audit/evidence/wp00-closeout-deploy-20260925T072419Z.txt`. There is **no staging project** yet (R6 WP-17), and **PITR is off with
> no backups**. Public sign-up is **disabled** (invite-only, DR-1 closed
> 2026-09-25). The R6 fix plan is `docs/audits/timhirt-production-fix-plan.md`;
> progress is in `audit/FIXES_VERIFIED_R6.md`.

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
PGHOST=… ./supabase/tests/run.sh    # 110 migrations + 63 pgTAP suites
bash scripts/ci/deno-check.sh       # Edge Function types (ratchet)
python3 scripts/ci/semgrep-rule-test.py   # needs semgrep 1.95.0
```

`eslint scripts/` reports `no-undef` on node globals — `scripts/` is outside the
configured lint scope. `npx eslint src` is the project's command.

**Verification means running the thing.** Every real bug this repo has produced
was found by driving the app in a browser or hitting the endpoint, not by
reading the diff. Twice a "green" result turned out to be a runner that was
measuring nothing. Prove a gate fails before trusting that it passed.

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
- Deploy tokens: never commit, never echo, shred after use.
