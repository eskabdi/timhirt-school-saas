import { assertEquals } from "jsr:@std/assert@1";
import { claimJob, failJobQuietly, type ClaimJobClient, type FailJobClient } from "./jobs.ts";

const client = (impl: () => PromiseLike<{ error: { message: string } | null }>) =>
  ({ rpc: (_fn: string, _args: unknown) => impl() }) as unknown as FailJobClient;

Deno.test("failJobQuietly marks the job failed", async () => {
  const calls: unknown[] = [];
  const c = { rpc: (fn: string, args: unknown) => { calls.push([fn, args]); return Promise.resolve({ error: null }); } } as unknown as FailJobClient;
  assertEquals(await failJobQuietly(c, "job-1", "internal_error", "t"), true);
  assertEquals(calls, [["fail_job", { p_job_id: "job-1", p_error_message: "internal_error" }]]);
});

Deno.test("failJobQuietly never throws when the RPC returns an error", async () => {
  assertEquals(await failJobQuietly(client(() => Promise.resolve({ error: { message: "boom" } })), "j", "r", "t"), false);
});

Deno.test("failJobQuietly never throws when the RPC itself throws", async () => {
  assertEquals(await failJobQuietly(client(() => Promise.reject(new Error("network"))), "j", "r", "t"), false);
});

Deno.test("claimJob claims a queued job with one conditional update", async () => {
  const calls: unknown[] = [];
  const c = { from: (t: string) => ({ update: (v: unknown) => ({ eq: (a: string, x: string) => ({ eq: (b: string, y: string) => ({ select: (s: string) => { calls.push([t, v, a, x, b, y, s]); return Promise.resolve({ data: [{ id: x }], error: null }); } }) }) }) }) } as unknown as ClaimJobClient;
  assertEquals(await claimJob(c, "job-1", () => "T"), true);
  assertEquals(calls, [["data_jobs", { status: "processing", started_at: "T" }, "id", "job-1", "status", "queued", "id"]]);
});

Deno.test("claimJob returns false when another run already claimed the job", async () => {
  const c = { from: () => ({ update: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }) }) }) } as unknown as ClaimJobClient;
  assertEquals(await claimJob(c, "job-1"), false);
});

Deno.test("failJobQuietly never logs the job id", async () => {
  const logged: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    await failJobQuietly(client(() => Promise.resolve({ error: { message: "boom" } })), "job-secret-id", "r", "t");
  } finally { console.error = orig; }
  assertEquals(JSON.stringify(logged).includes("job-secret-id"), false);
});
