-- ============================================================================
-- Durable rate limiting.
--
-- The Edge Function limiter was a per-isolate `Map`: Supabase can run several
-- warm isolates concurrently, so a caller got up to N× the intended limit, and
-- every cold start reset the count to zero. That is not a control you can point
-- at for the public surfaces it guards — /submit-admission (5/hour/IP),
-- /verify-id (20/min/IP), /check-admission-status.
--
-- A Postgres table is the right store here rather than Redis: the endpoints
-- being limited already touch the database on every request, so the limiter
-- adds a round trip to a connection that has to happen anyway, and it brings no
-- new infrastructure to provision, secure, or pay for.
-- ============================================================================

create table if not exists public.rate_limits (
  key          text        primary key,
  window_start timestamptz not null default now(),
  count        integer     not null default 0
);

comment on table public.rate_limits is
  'Token buckets for Edge Function rate limiting. Keys are opaque strings '
  '(e.g. "verify:<ip>", "payroll:<user_id>"). Written only by service_role '
  'through consume_rate_limit(); no tenant scoping because limits apply to '
  'anonymous IPs as well as authenticated users.';

-- Sweeping expired buckets is a range scan over this, not a seq scan.
create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

-- Fail closed for everyone. Edge Functions reach this through a service_role
-- client, which bypasses RLS; no authenticated or anonymous role has any
-- business reading or writing another caller's bucket, and a table with RLS on
-- and zero policies denies exactly that.
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;

revoke all on public.rate_limits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic consume: one statement, one row lock.
--
-- The whole decision lives in a single INSERT .. ON CONFLICT DO UPDATE so two
-- concurrent requests for the same key cannot both read a stale count and both
-- decide they are under the limit. The conflicting writer blocks on the row
-- lock, then applies its CASE against the value the first writer committed.
--
-- Returns true when the request is allowed.
-- ---------------------------------------------------------------------------
create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count  integer;
  v_window interval := make_interval(secs => p_window_ms / 1000.0);
begin
  if p_key is null or p_limit is null or p_limit < 1 or p_window_ms is null or p_window_ms < 1 then
    raise exception 'consume_rate_limit: invalid arguments';
  end if;

  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when r.window_start + v_window <= now() then 1 else r.count + 1 end,
        window_start = case when r.window_start + v_window <= now() then now() else r.window_start end
  returning r.count into v_count;

  -- Opportunistic sweep. Buckets are abandoned as soon as their window passes
  -- (an IP that never comes back leaves a row behind), so something has to
  -- collect them. Doing it here on roughly one call in a thousand keeps the
  -- table bounded without a cron dependency, and the cost lands on a caller
  -- that is already paying for a write.
  if random() < 0.001 then
    delete from public.rate_limits where window_start < now() - interval '24 hours';
  end if;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

comment on function public.consume_rate_limit(text, integer, integer) is
  'Atomically consumes one token for p_key. Returns true when the caller is '
  'within p_limit requests per p_window_ms. service_role only.';
