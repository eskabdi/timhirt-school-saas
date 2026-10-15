# Working in this repo

Timhirt — multi-tenant Ethiopian school management SaaS. React + Vite +
TanStack Query on Supabase (Postgres + RLS + Edge Functions + Storage), no
custom API server.

> **Not deployed to live yet (as of 2026-09-21):** this branch
> (`claude/project-deployment-w0brxd`) has Round 5 (tiered document
> customization) and the EC "today" UTC fix merged in (commit `15acb4f`),
> but neither has been pushed to production — no migration applied, no Edge
> Function redeployed, no `npm run deploy`. Production is still running
> whatever shipped at the end of Round 4. Remove this note once an actual
> deploy has been verified live (see "A `READY` deployment is not a shipped
> deployment" below).

The architecture blueprint is [`docs/school-saas-architecture-blueprint.md`](docs/school-saas-architecture-blueprint.md).
Code comments cite it by section (§6.2 route guards, §17.2 canonical date
storage, §10.4 injection/XSS). It ends at §20 — a few comments cite §21.9 for
INSA reasoning, and that section is not in the document.

There is no backend service to run: the browser talks to Supabase directly with
the anon key, and RLS + Edge Functions + SECURITY DEFINER RPCs are the whole
server. "Deploy" means three separate things — migrations, Edge Functions, and
the Vercel frontend (see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)).

---

## Layout

```
src/
  app/            App.tsx, providers.tsx (single QueryClient), router.tsx (~95
                  routes over Admin / Teacher / Student / Parent / Public /
                  Platform surfaces)
  features/<domain>/   feature-sliced (24 domains: students, attendance,
                  gradebook, fees, hr, admissions, portal, platform, settings,
                  …). A folder holds its *Page.tsx views plus, as needed,
                  api.ts / *Api.ts (Supabase data access) and schemas.ts (zod).
                  Data is fetched with TanStack useQuery/useMutation inline in
                  the page, keyed by qk() — never a hand-written key array.
  components/     cross-feature: EthDate, EthDatePicker, LanguageSwitcher
    ui/           design-system primitives — Button, Card, Field/FieldGroup,
                  Modal, RichText, Stepper, Toggle, SegmentedControl, …
    layout/       DashboardShell (tenant app), PlatformShell/PlatformNav (super-
                  admin console)
    charts/       Bars, Pie (hand-rolled SVG, no chart lib)
  lib/            supabase.ts (the one client), queryKeys.ts (qk), i18n.ts,
                  ethiopian-date.ts, brand-theme.ts, ethnic-groups.ts, image.ts,
                  utils.ts, database.types.ts (generated — `npm run gen:types`)
  locales/{en,am,om}/   common / apply / calendar namespaces, at full parity
  __tests__/      vitest unit tests (Ethiopian-date math, EC parity, payroll)

supabase/
  migrations/     106 timestamped SQL files, applied in filename order
  functions/      32 Deno Edge Functions + _shared/ (security.ts, dates)
  tests/          run.sh + rls/ pgTAP suites (55)

scripts/          check-locales.mjs, i18n-audit.mjs, i18n-review-export.mjs,
                  e2e-live.mjs (live end-to-end harness — see "Live end-to-end test")
docs/             architecture blueprint, DEPLOYMENT.md
.claude/          agents/ (5 subagents) + skills/ (verify, deploy) — see "Subagents"
```

Auth is three composable guards in `src/features/auth/`: `RequireAuth`
(session), `RequireRole` (role gate), `RequireModule` (tenant module toggle) —
all UX-only; RLS is what actually enforces access.

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

**A `SECURITY DEFINER` function is a hole in RLS until it re-checks the caller
itself.** It runs as the owner, so no policy applies inside it. The 20260719
batch granted 13 of them to `authenticated` while trusting a caller-supplied
`p_tenant_id` and addressing rows by bare `id` — a *student* could create rows
in another tenant, rewrite another tenant's `data_jobs.storage_path`, and read
another tenant's `system_config`, all while `select` on those tables correctly
returned zero rows. Every such function must derive the tenant from
`get_tenant_id_for_user(auth.uid())`, gate on the same role its table's policy
names, pin `set search_path = public, pg_temp`, and `revoke … from public, anon`
before granting. Regression: `supabase/tests/rls/rpc_authorization.sql`.
Remember Postgres grants `EXECUTE` to `PUBLIC` by default — writing no `grant`
is not the same as granting nothing.

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

**psql pads its output.** An anchored `grep '^not ok'` over raw `psql` output
matches nothing, so a pgTAP runner can report green while every assertion
fails. `supabase/tests/run.sh` uses `-qtA` and counts assertions against each
suite's declared plan.

---

## Before you say it works

Run the gates — CI runs all of them, so a miss here is a red build later:

```bash
npx tsc --noEmit
npx eslint src                      # must be clean: 0 errors, 0 warnings
npx vitest run
npm run check:i18n                  # must be 0
npm run check:locales               # parity + no wholesale reformat
npm run build
PGHOST=… ./supabase/tests/run.sh    # 106 migrations + 55 pgTAP suites
```

`eslint scripts/` reports `no-undef` on node globals — `scripts/` is outside the
configured lint scope. `npx eslint src` is the project's command.

**Verification means running the thing.** Every real bug this repo has produced
was found by driving the app in a browser or hitting the endpoint, not by
reading the diff. Twice a "green" result turned out to be a runner that was
measuring nothing. Prove a gate fails before trusting that it passed.

These gates say nothing about production. **After a deploy**, run the
`deploy-checker` agent, then the `live-e2e-tester` agent (or at minimum
`node scripts/e2e-live.mjs --expect '<string only the new build contains>'`).
If you changed `scripts/e2e-live.mjs`, `node scripts/e2e-live.mjs --self-test`
must report every planted defect caught.

---

## Subagents

Defined in `.claude/agents/`; each reads this file first.

- **`code-reviewer`** — after any meaningful change, before calling it done;
  migrations, RLS, Edge Functions, money, dates and i18n especially.
- **`rls-tenant-isolation-reviewer`** — any migration that adds, drops or
  rewrites a `create policy`; run one per file, in parallel.
- **`plan-tester`** — stress-tests a written plan against the real code
  before a large or risky implementation starts.
- **`deploy-checker`** — right after a deploy: did each piece actually ship
  (bundle has the change and the env, functions deployed and gated).
- **`live-e2e-tester`** — after `deploy-checker`, before a release or an INSA
  test window, or when asked to "test the live site": the complete live
  end-to-end run below, then per-role critical journeys and root-cause triage
  of every failure. Tests and reports; never fixes.

Skills (`.claude/skills/`): `verify` (local Postgres + pgTAP, headless page
harness) and `deploy` (the production runbook).

---

## Live end-to-end test

`scripts/e2e-live.mjs` drives the **deployed** system — Vercel frontend and
Supabase PostgREST / Auth / Storage / Edge Functions — as a browser and as an
attacker holding the public anon key would. The `live-e2e-tester` agent runs
it, then goes further by hand. What the harness expects (functions and their
`verify_jwt`, tables/views, buckets, security headers) is derived from
`supabase/config.toml`, `supabase/migrations/` and `vercel.json` at run time,
so it can't drift from the code.

```bash
node scripts/e2e-live.mjs --self-test           # must catch every planted defect
node scripts/e2e-live.mjs --expect '<marker>'   # anonymous layers vs production
node scripts/e2e-live.mjs --creds ~/e2e-creds.json --out <scratch dir>
```

- **Layers**: `frontend` (env baked in, no `service_role` JWT, headers equal
  `vercel.json`, SPA rewrite, fonts are real TTFs), `functions` (every repo
  function deployed; verify_jwt=true → 401 bare and non-2xx for the anon key;
  verify_jwt=false → reachable), `rest` (zero anon-readable rows in every
  relation; anon RPC/grant surface), `storage` (private buckets unlistable),
  `public` (anonymous endpoints sane), `ui` (Chromium on public pages: page
  errors, CSP violations, Ge'ez numerals, en/am/om switching with an
  Ethiopic font loaded), `auth` (per role: real two-step login, profile role,
  token lifetime, crawl of every nav link, forbidden routes bounce, privilege
  probes, cross-tenant RLS + storage probes, logout revokes the refresh token).
- **Credentials**: a `chmod 600` JSON file outside the repo (the harness
  refuses a group/world-readable one) —
  `{"tenant_slug": "…", "accounts": {"school_admin": {"email": "…", "password": "…"}, …}}`.
  Keys: `super_admin`, `school_admin`, `school_admin_b` (a second tenant —
  enables the cross-tenant probes), `teacher`, `student`, `parent`,
  `hr_officer`, `accountant`, `registrar`, `librarian`. Without it the `auth`
  layer is reported **skipped** — not passed.
- **Production holds real schools.** The harness is non-mutating: it never
  POSTs to `submit-admission` (writes an applicant, 5/h per IP) or
  `telebirr-notify` (inbound signature is *not* verified — an unsigned
  `Completed` event settles a real invoice), and never calls a JWT-gated
  function. Writes happen only when a person explicitly authorizes them, and
  only in a dedicated QA tenant (prior audits: `qa-harar-model`, cleaned up by
  `audit/cleanup_qa_school.sql`).
- **One login per account.** `check-login-attempt` allows 5 attempts per
  email and 20 per IP per 15 min and fails closed; proxy egress IPs are
  shared. A locked-out or rejected account is reported, never retried.
- **Proxy**: Chromium ignores `HTTPS_PROXY`; launch it with
  `proxy: { server: process.env.HTTPS_PROXY }` and it reaches the live site.
  Node's `fetch` needs `NODE_USE_ENV_PROXY=1` (the harness re-execs itself with
  it). Realtime (WebSocket) cannot pass the proxy and is not covered live.
- **Hand-maintained lists** in the harness: `FORBIDDEN` mirrors the role
  constants in `src/app/router.tsx`; `NEVER_FOR_FAMILY` / `PLATFORM_ONLY` name
  relations outside a role. Update them with the router/policies, and give
  every new check a planted defect in `--self-test`.
- Output: a summary on stdout, `report.json` and per-page screenshots in
  `--out` (default under the OS temp dir). Screenshots can contain PII — never
  commit them. Exit code 1 on any FAIL.

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
