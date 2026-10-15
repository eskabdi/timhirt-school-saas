---
name: verify
description: Run and drive this app to confirm a change works — a real Postgres for migrations and RLS, and a headless-browser harness for pages. Use when verifying a migration, an RLS policy, or any UI change in this repo.
---

# Verifying a change in this repo

There is no `supabase start` here — it hangs on image pulls, and it boots
GoTrue, Storage, Realtime, Kong and Studio to run four SQL files. Everything
worth checking is reachable more cheaply.

Every real bug this repo has produced was found by running something. Reading
the diff found none of them.

## Database, migrations, RLS

`supabase/tests/run.sh` resets the schema, installs `supabase/tests/shim.sql`
(stand-ins for the Supabase-managed `auth` / `storage` / `vault` objects),
applies every migration, then runs the pgTAP suites and checks each one's
assertion count against its declared plan.

```bash
apt-get install -y postgresql-16 postgresql-16-pgtap    # pgTAP is server-side
pg_ctlcluster 16 main start
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres \
  ./supabase/tests/run.sh
```

In this container Postgres already lives at `/tmp/pgval` on port 5433 as user
`pgtest`:

```bash
su pgtest -c '/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgval \
  -o "-k /tmp/pgsock -p 5433 -h \"\"" -l /tmp/pgval.log start'
chmod -R a+rX supabase        # pgtest must be able to read the tree
rm -f /tmp/mm.sql             # a root-owned leftover breaks the next run
su pgtest -c "PGHOST=/tmp/pgsock PGPORT=5433 PGUSER=postgres bash supabase/tests/run.sh"
```

**Test constraints by trying to violate them.** Writing a CHECK is not the same
as having one — `array_length(x, 1) >= 1` looked correct and accepted the empty
array it forbade, because `array_length('{}', 1)` is NULL and a CHECK only
rejects on FALSE. Wrap probes in `do $$ … exception when check_violation then
raise notice 'ok' … $$` inside a transaction and `rollback`.

**Test RLS by setting the role and the claim**, both inside one transaction —
`SET LOCAL` outside a transaction silently no-ops and the test then runs as
superuser and passes vacuously:

```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = '<user uuid>';
-- assert the cross-tenant read returns zero rows
rollback;
```

Fixture columns that have bitten before: `tenants.name` needs ≥2 chars;
`classes` needs `academic_year_id`; `academic_years` is
`(ec_year, label_i18n, starts_on, ends_on)`; `assignments` requires
`subject_id` and `created_by`; UUID literals must be hex (`ab…`, not `ay…`).

## Pages

Vercel's env is not available locally and most pages need a session, so stand up
a throwaway Vite harness that aliases `@/lib/supabase` and
`@/features/auth/useSession` to mocks and renders the real component.

```ts
// vite.config.ts in a scratch dir outside the repo
resolve: { alias: [
  { find: /^@\/lib\/supabase$/,                 replacement: "/tmp/h/mocks/supabase.ts" },
  { find: /^@\/features\/auth\/useSession$/,    replacement: "/tmp/h/mocks/useSession.ts" },
  { find: /^@\//,                               replacement: REPO + "/src/" },
]},
define: {
  "import.meta.env.VITE_SUPABASE_URL":      JSON.stringify("https://stub.supabase.co"),
  "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("stub"),
},
```

The supabase mock needs a Proxy whose `then` resolves the query, and it must
distinguish `.single()`/`.maybeSingle()` (returns `null`) from a list (returns
`[]`) — returning `[]` for a `.single()` gives components an object where they
expect null and produces confusing crashes. It also needs `auth.getUser`.

Copy `tailwind.config.ts` into the scratch dir and rewrite its `content` globs
to absolute repo paths, or every class comes out unstyled.

Drive it with Chromium at `/opt/pw-browsers/chromium`; resolve playwright with
`ln -sfn /opt/node22/lib/node_modules/playwright <scratch>/node_modules/playwright`.

**Always capture `page.on("pageerror")`.** A page that renders 80% of its
content while throwing is the normal failure mode here, not a blank screen.

### Driving gotchas

- Inputs written without a `type` attribute are **not** matched by
  `input[type="text"]`, though the DOM property reads `"text"`. Use
  `input:not([readonly]):not([type=checkbox])` or filter on another attribute.
- `innerText` does not include input *values*. Read them with
  `locator.inputValue()` or `evaluateAll`.
- Modals have `role="dialog"`; the overlay is `.fixed.inset-0.z-50`.
- Checkbox counts include `Toggle`, which is a real checkbox under a styled
  span — expect one more than the visible checkbox list.

## Live site

Outbound browsing is proxied and Chromium cannot reach the internet here, so
mirror the deployed bytes and serve them locally rather than pointing the
browser at production:

```bash
curl -s https://timhirt-school-saas.vercel.app/ -o index.html
# fetch each assets/*.js it references, then:
npx http-server -p 5191 -s
```

Same bytes, real browser. Never disable TLS verification or unset `HTTPS_PROXY`
to work around the proxy.

## Don't trust a green you haven't tested

Two runners in this repo have reported success while measuring nothing: the
pgTAP runner (psql pads its output, so `grep '^not ok'` matched nothing) and a
rate-limit smoke test (requests split across proxy egress IPs, so no key ever
hit its limit). **Before believing a passing check, make it fail on purpose.**
