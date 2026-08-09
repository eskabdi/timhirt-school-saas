# pgTAP RLS test fixtures — how to run

These tests require a **local Supabase stack** (`supabase start`) with the
pgTAP extension, run via:

```bash
supabase test db
```

They are **not executed by this codebase's own CI/build pipeline in isolation**
— `pg_prove`/`supabase test db` needs a live Postgres instance with all 10
migrations applied, which this sandboxed authoring environment does not have.
Each file is self-contained (creates its own fixtures, wraps in a transaction,
rolls back at the end) and was written to standard pgTAP conventions
(`plan()`, `ok()`, `is()`, `throws_ok()`, `finish()`), but **run them once in
a real environment before trusting them in CI** — in particular, verify the
minimal `auth.users` insert columns against the exact GoTrue/Postgres version
your Supabase project uses; that table's schema has changed across versions.
