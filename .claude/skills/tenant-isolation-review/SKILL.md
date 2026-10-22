---
name: tenant-isolation-review
description: Prove a change cannot read or write another school's data — RLS policies, SECURITY DEFINER/invoker functions, Edge Functions using the service key, storage paths and client query keys — by enumerating every new tenant surface, probing it as two tenants in real Postgres, and mutation-proving the tests. Required before any merge and any deploy (CLAUDE.md "Before merge"). Use for any diff touching supabase/migrations, supabase/functions, storage, or tenant-scoped queries.
---

# Tenant-isolation review

Timhirt is multi-tenant: one database, every school's rows side by side,
isolated only by RLS and by the server code that runs with the service key.
A leak here is the worst bug this product can have (minors' records, fees,
salaries). Reading policies is not enough — the calendar slice shipped
53 green assertions while the select policy on `school_calendar_entries`
could be replaced with `using (true)` and nothing failed (CAL-TV-01).

The output is a verdict (PASS/FAIL) with evidence, saved under
`audit/evidence/reviews/<wp>-tenant-isolation.md`.

## 1. Enumerate every tenant surface in the diff

```bash
git diff <base>..HEAD --stat
git diff <base>..HEAD -- supabase/migrations | grep -nE 'create (table|policy|function|view|trigger)|alter table|grant|security definer'
git diff <base>..HEAD -- supabase/functions | grep -nE 'adminClient|SERVICE_ROLE|tenant_id|\.from\(|\.rpc\('
git diff <base>..HEAD -- src | grep -nE 'queryKey|\.from\(|\.rpc\(|storage'
```

List each item in a table: table / policy / function / Edge Function action /
storage path / query key → who can reach it → how the tenant is decided.

## 2. Check each surface against the rules

**Tables** (tenant-scoped)
- `enable` **and** `force row level security`.
- SELECT/INSERT/UPDATE/DELETE policies all carry the tenant predicate
  (`tenant_id = get_tenant_id_for_user(auth.uid())` or an equivalent
  relationship); a missing command means "no access", which is fine, a
  `using (true)` is not.
- Restrictive module gate (`has_module`) or an allow-list reason in
  `supabase/security/module_gate_allowlist.sql`.
- Child rows: composite FK `(parent_id, tenant_id)` → parent `(id, tenant_id)`,
  so a row cannot point at another school's parent.
- A trigger that copies `tenant_id` from a parent must **refuse** a mismatch,
  never silently re-home it (CAL-TI-1).
- Visibility follows the parent: entries of a draft are hidden exactly when
  the draft is.

**Functions**
- SECURITY DEFINER: `revoke … from public, anon, authenticated`, pinned
  `search_path`, re-grant only what `definer_allowlist.sql` says; tenant comes
  from `auth.uid()`, never from an argument.
- Any function taking a tenant or user id answers only for the caller unless
  `current_setting('role')` is a trusted context (`none`, `service_role`,
  `postgres`, `supabase_admin`) — an allow-list.
- SECURITY INVOKER helpers still refuse a caller-supplied tenant id that is not
  the caller's (`42501 not_allowed`), even though RLS would also filter.
- A service-role-only definer that reads `auth.users` returns no address,
  hash or token unless the caller needs it, and refuses non-trusted roles even
  if a grant slips in.

**Edge Functions** (service key bypasses RLS)
- The tenant comes from `requireRole(...)` (`ctx.tenantId`), or — for a
  platform action — the target row is re-checked to belong to the tenant named
  in the body (`.eq("tenant_id", body.tenant_id)` on the profile lookup).
- Every service-client query that touches tenant data filters by that tenant.
- Responses never include another tenant's rows; logs carry ids, not PII.

**Storage**: object paths start with the tenant id and policies check both
the folder and a role/relationship (WP-05 ratchet:
`storage_tenant_only_known.sql`).

**Client**: TanStack Query keys for tenant data include the tenant and user
(`[…, tenant_id, user_id, …]`) so a session switch never serves another
school's cache (§6.3). No `.eq('tenant_id', …)` as the only guard.

## 3. Probe it as two tenants (real Postgres)

Use the harness from the `verify` skill (socket `/tmp/pgsock`, port 5433). In
one transaction, as tenant A's user and as tenant B's user:

```sql
begin;
-- fixtures for tenant A and B …
select set_config('request.jwt.claim.sub', '<user of B>', true);
set local role authenticated;
select count(*) from public.<new_table>;                       -- B sees 0 of A's rows
insert into public.<new_table> (tenant_id, …) values ('<A>', …); -- refused
update public.<new_table> set … where tenant_id = '<A>';        -- 0 rows / refused
select public.<rpc>(…, p_tenant => '<A>');                      -- 42501 not_allowed
reset role;
rollback;
```

`SET LOCAL` outside a transaction silently no-ops and the probe then runs as
superuser and passes vacuously. Also probe: a teacher/role without the
permission in the same school (drafts, sensitive columns), a school without the
module (module gate), and anon.

## 4. Turn each probe into a pgTAP assertion — and prove it

Every new tenant table needs, in its suite:
1. a non-vacuity check (the rows exist, seen as owner or as the right user);
2. tenant B reads 0 of A's rows;
3. B cannot insert/update/delete A's rows (and no client can write where the
   design says only an RPC writes);
4. a role without the permission does not see restricted rows (drafts);
5. a school without the module reads nothing;
6. every function taking a tenant id refuses another school's.

Then **mutation-prove** them: inside `begin; … \i suite.sql` replace the policy
with `using (true)` (and drop the module gate), remove the tenant check from the
function, remove the composite FK — each mutation must turn at least one
assertion red. A survivor is a FAIL, not a footnote. Record the mutation log
in `audit/evidence/`.

## 5. Run the guards

```bash
su pgtest -c "PGHOST=/tmp/pgsock PGPORT=5433 PGUSER=postgres PGDATABASE=<db> bash supabase/tests/run.sh"
PGHOST=/tmp/pgsock PGPORT=5433 PGUSER=postgres PGDATABASE=<db> python3 scripts/ci/app-rpc-grants.py
```

`cross_tenant_matrix.sql`, `catalog_rls_coverage.sql`,
`catalog_definer_security.sql`, `catalog_module_gate.sql` and
`catalog_storage_policies.sql` must pass; a new offender in a ratchet is a
FAIL.

## 6. Independent reviewers

Dispatch in parallel (background), on a read-only worktree of the commit:
- `tenant-isolation-auditor` — the whole diff;
- `rls-tenant-isolation-reviewer` — one per migration that adds or rewrites a
  policy.

Fix every confirmed Critical/High/Medium finding, re-run sections 3–5, and
re-dispatch (at most 3 rounds, then the release gatekeeper decides).

## Verdict

PASS only when: every surface in §1 has a rule check, a probe and a
mutation-proven assertion; the guards are green; and the reviewers report no
open Critical/High/Medium. Write the verdict file and cite it in
`audit/FIXES_VERIFIED_R6.md`.
