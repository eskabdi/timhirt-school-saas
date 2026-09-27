#!/usr/bin/env bash
# R6 WP-02 (reviews DM-1, PERF-1): read-cost benchmark for the per-row RLS
# helpers, with two tenants so the module gate also runs on the other
# tenant's rows. Usage (a migrated harness database, never production):
#   BENCH_ON_HARNESS=1 PGHOST=… PGDATABASE=<db after run.sh> scripts/db/bench-rls-helpers.sh [helpers.sql]
# If helpers.sql is given, those function bodies replace the current ones
# first (to compare against older bodies in a copy of the database).
set -euo pipefail
# Refuse anything but a local harness (reviews SC-1, code-review): the script
# inserts users and 150k rows, and production has no backups. Only a Unix
# socket directory or localhost is accepted, case-insensitively, and a
# connection given any other way (PGHOSTADDR, PGSERVICE, a URI) is refused.
if [ -n "${PGHOSTADDR:-}" ] || [ -n "${PGSERVICE:-}" ] || [ -n "${DATABASE_URL:-}" ]; then
  echo "refusing: PGHOSTADDR/PGSERVICE/DATABASE_URL set; use PGHOST=<socket dir> or localhost" >&2; exit 2
fi
case "$(printf %s "${PGHOST:-}" | tr '[:upper:]' '[:lower:]')" in
  /*|localhost|127.0.0.1|::1) ;;
  *) echo "refusing: PGHOST must be a local socket directory or localhost" >&2; exit 2 ;;
esac
if [ "${BENCH_ON_HARNESS:-}" != "1" ]; then
  echo "refusing: set BENCH_ON_HARNESS=1 to confirm PG* points at a local harness database" >&2; exit 2
fi
psql -qX -v ON_ERROR_STOP=1 <<'SQL'
insert into public.tenants (id, name, slug) values
  ('00000000-0000-0000-0000-00000000a000', 'Bench A', 'bench-a'),
  ('00000000-0000-0000-0000-00000000b000', 'Bench B', 'bench-b');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'bench-a@example.test'),
  ('00000000-0000-0000-0000-00000000b001', 'bench-b@example.test');
insert into public.users (id, tenant_id, role, full_name, email) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a000', 'school_admin', 'Bench A', 'bench-a@example.test'),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b000', 'school_admin', 'Bench B', 'bench-b@example.test');
insert into public.academic_years (id, tenant_id, ec_year, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000a0a0', '00000000-0000-0000-0000-00000000a000', 2019, '2026-09-11', '2027-07-07'),
  ('00000000-0000-0000-0000-00000000b0a0', '00000000-0000-0000-0000-00000000b000', 2019, '2026-09-11', '2027-07-07');
insert into public.classes (id, tenant_id, academic_year_id, name) values
  ('00000000-0000-0000-0000-00000000a0c0', '00000000-0000-0000-0000-00000000a000', '00000000-0000-0000-0000-00000000a0a0', 'A5'),
  ('00000000-0000-0000-0000-00000000b0c0', '00000000-0000-0000-0000-00000000b000', '00000000-0000-0000-0000-00000000b0a0', 'B5');
insert into public.students (tenant_id, class_id, admission_no, first_name, middle_name, last_name, date_of_birth, gender)
select t, c, p || lpad(g::text, 6, '0'), 'F' || g, 'M' || g, 'L' || g, '2015-01-01', 'male'
from (values ('00000000-0000-0000-0000-00000000a000'::uuid, '00000000-0000-0000-0000-00000000a0c0'::uuid, 'A', 10000),
             ('00000000-0000-0000-0000-00000000b000'::uuid, '00000000-0000-0000-0000-00000000b0c0'::uuid, 'B', 5000)) v(t, c, p, n)
cross join lateral generate_series(1, n) g;
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000a001';
insert into public.attendance (tenant_id, student_id, class_id, attendance_date, status, recorded_by)
select s.tenant_id, s.id, s.class_id, d::date, 'present', '00000000-0000-0000-0000-00000000a001'
from public.students s cross join generate_series('2026-09-14'::date, '2026-09-23'::date, '1 day') d
where s.tenant_id in ('00000000-0000-0000-0000-00000000a000', '00000000-0000-0000-0000-00000000b000');
commit;
analyze;
SQL
[ -n "${1:-}" ] && psql -qX -v ON_ERROR_STOP=1 -f "$1"
for who in a b; do
  for q in "select count(*) from public.students" "select count(*) from public.attendance"; do
    ms=$(psql -qXtA <<SQL | awk '/Execution Time/ {print $3}' | sort -n | sed -n 2p
begin; set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000${who}001';
explain (analyze) $q; explain (analyze) $q; explain (analyze) $q;
rollback;
SQL
)
    echo "tenant ${who^^} admin | $q | median of 3: ${ms} ms"
  done
done
