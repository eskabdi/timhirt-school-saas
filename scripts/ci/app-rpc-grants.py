#!/usr/bin/env python3
"""Every RPC the browser app calls must be executable by `authenticated`
(R6 WP-02, review TV-3).

Since WP-02, SECURITY DEFINER functions are closed unless allow-listed, and
every new function postgres creates starts closed. The pgTAP suites only prove
a grant exists for the RPCs they happen to call, so a missing grant on, say,
create_import_job would pass CI and break the Import page. This check reads
every `supabase.rpc("<name>"` (and `rpc<T>("<name>"` through the dashboard
wrapper) in src/ and asserts, against the migrated
harness database, that a function of that name exists in public and that
`authenticated` can execute every overload of it.

Run after supabase/tests/run.sh (it leaves the migrated schema in place),
with the same PG* environment. Exit 1 on any finding.
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# `supabase.rpc("name"` and the dashboard's typed wrapper `rpc<T>("name"`.
RPC = re.compile(r"""\brpc(?:<[^>(]*>)?\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]""")


def app_rpcs():
    names = {}
    for dp, _, files in os.walk(os.path.join(ROOT, "src")):
        for f in files:
            if not f.endswith((".ts", ".tsx")) or ".test." in f:
                continue
            path = os.path.join(dp, f)
            with open(path, encoding="utf-8") as fh:
                for i, line in enumerate(fh, 1):
                    for m in RPC.finditer(line):
                        names.setdefault(m.group(1), f"{os.path.relpath(path, ROOT)}:{i}")
    return names


def main():
    names = app_rpcs()
    if not names:
        print("app-rpc-grants: found no supabase.rpc() calls in src/, the scan is broken")
        return 1
    values = ",".join(f"('{n}')" for n in sorted(names))
    sql = f"""
      select v.name,
             count(p.oid),
             count(p.oid) filter (where has_function_privilege('authenticated', p.oid, 'execute'))
      from (values {values}) v(name)
      left join pg_proc p on p.proname = v.name and p.pronamespace = 'public'::regnamespace
      group by v.name order by v.name"""
    out = subprocess.run(["psql", "-qtAX", "-F", "|", "-c", sql], capture_output=True, text=True)
    if out.returncode != 0:
        print(out.stderr.strip())
        return 1
    bad = 0
    for row in out.stdout.strip().splitlines():
        name, total, granted = row.split("|")
        if total == "0":
            print(f"  missing  {name}: called at {names[name]} but no public function has that name")
            bad += 1
        elif granted != total:
            print(f"  closed   {name}: called at {names[name]} but authenticated cannot execute it")
            bad += 1
    print(f"app-rpc-grants: {len(names)} app RPCs, {bad} finding(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
