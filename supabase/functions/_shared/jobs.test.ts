import { assertEquals } from "jsr:@std/assert@1";
import { failJobQuietly, type FailJobClient } from "./jobs.ts";

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
