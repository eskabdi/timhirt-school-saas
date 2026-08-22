# Working in this repo

Timhirt — multi-tenant Ethiopian school management SaaS. React + Vite +
TanStack Query on Supabase (Postgres + RLS + Edge Functions + Storage), no
custom API server.

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
  app/            App.tsx, providers.tsx (single QueryClient), router.tsx (~50
                  routes over Admin / Teacher / Student / Parent / Public /
                  Platform surfaces)
  features/<domain>/   feature-sliced (~28 domains: students, attendance,
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
  migrations/     45 timestamped SQL files, applied in filename order
  functions/      14 Deno Edge Functions + _shared/ (security.ts, dates)
  tests/          run.sh + rls/ pgTAP suites (8)

scripts/          check-locales.mjs, i18n-audit.mjs, i18n-review-export.mjs
docs/             architecture blueprint, DEPLOYMENT.md
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
npx eslint src                      # 0 errors; ~41 pre-existing `any` warnings
npx vitest run
npm run check:i18n                  # must be 0
npm run check:locales               # parity + no wholesale reformat
npm run build
PGHOST=… ./supabase/tests/run.sh    # 45 migrations + 8 pgTAP suites
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
