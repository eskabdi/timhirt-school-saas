#!/usr/bin/env node
/**
 * Drives the built server over real stdio with the MCP SDK client — the same
 * path Claude Code uses. Not a unit test: it spawns the binary, lists tools,
 * calls them, and checks what comes back.
 *
 * Runs against a scratch store so it never touches real memories.
 *
 *   node test/drive.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "memstore-"));
const storePath = join(scratch, "memories.jsonl");

let pass = 0, fail = 0;
const check = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
};

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, MEMORY_STORE_PATH: storePath },
});
const client = new Client({ name: "drive", version: "1.0.0" });
await client.connect(transport);

try {
  // ---- tools are discoverable and annotated -------------------------------
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check("7 tools exposed", tools.length === 7, names.join(", "));
  check("all prefixed memory_", names.every((n) => n.startsWith("memory_")), names.join(", "));
  check("all carry descriptions", tools.every((t) => (t.description ?? "").length > 100));
  check("all carry output schemas", tools.every((t) => t.outputSchema));
  const del = tools.find((t) => t.name === "memory_delete");
  check("memory_delete flagged destructive", del?.annotations?.destructiveHint === true);
  const search = tools.find((t) => t.name === "memory_search");
  check("memory_search flagged read-only", search?.annotations?.readOnlyHint === true);

  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, text: r.content?.[0]?.text ?? "", data: r.structuredContent };
  };

  // ---- write --------------------------------------------------------------
  const a = await call("memory_write", {
    project: "timhirt-school-saas", kind: "incident",
    title: "--prebuilt shipped a stale artifact for eight days",
    body: "vercel deploy --prebuilt=false parses as --prebuilt because the flag is boolean. It shipped a July 18 .vercel/output on every deploy, blanking the app because a local build cannot read the Vercel project env.",
    tags: ["Vercel", "deploy", "vercel"], files: ["package.json", "docs/DEPLOYMENT.md"],
  });
  check("write returns a memory", !a.isError && !!a.data?.memory?.id, a.text.slice(0, 80));
  check("tags normalised + deduped", JSON.stringify(a.data?.memory?.tags) === JSON.stringify(["vercel", "deploy"]),
    JSON.stringify(a.data?.memory?.tags));
  const idA = a.data?.memory?.id;

  const b = await call("memory_write", {
    project: "timhirt-school-saas", kind: "rejected",
    title: "Rejected Upstash Redis for rate limiting; Postgres needs no new dependency",
    body: "The endpoints already hit Postgres on every request, so a table-backed token bucket adds no infrastructure to run or pay for.",
    tags: ["rate-limit"], files: ["supabase/functions/_shared/security.ts"],
  });
  check("second write ok", !b.isError);

  await call("memory_write", {
    project: "other-repo", kind: "decision", title: "Unrelated decision in another project",
    body: "Kept so project filtering has something to exclude.", tags: ["misc"],
  });

  // ---- search -------------------------------------------------------------
  const s1 = await call("memory_search", { query: "prebuilt stale artifact", response_format: "json" });
  check("search finds the incident", s1.data?.items?.[0]?.id === idA, JSON.stringify(s1.data?.total));
  check("search returns a snippet", (s1.data?.items?.[0]?.snippet ?? "").length > 0);
  check("search scores > 0", (s1.data?.items?.[0]?.score ?? 0) > 0);

  const s2 = await call("memory_search", { query: "redis", response_format: "json" });
  check("finds a rejected approach by keyword", s2.data?.total === 1 && /Upstash/.test(s2.data.items[0].title));

  const s3 = await call("memory_search", { query: "deploy", project: "timhirt-school-saas", response_format: "json" });
  check("project filter excludes other repos", s3.data?.items?.every((m) => m.project === "timhirt-school-saas") === true);

  const s4 = await call("memory_search", { query: "anything", file: "security.ts", response_format: "json" });
  check("file filter matches on substring", s4.data?.total === 0 || s4.data.items.every((m) => m.files.some((f) => f.includes("security.ts"))));

  const s5 = await call("memory_search", { query: "zzzznotpresent", response_format: "json" });
  check("no matches returns empty page, not an error", !s5.isError && s5.data?.total === 0);
  const s5md = await call("memory_search", { query: "zzzznotpresent" });
  check("empty search suggests a next step", /include_superseded|broader|drop the/.test(s5md.text), s5md.text.slice(0, 90));

  // ---- title outranks body ------------------------------------------------
  await call("memory_write", {
    project: "rank-test", kind: "fact", title: "Pagination behaviour",
    body: "nothing relevant here at all",
  });
  await call("memory_write", {
    project: "rank-test", kind: "fact", title: "Something else entirely",
    body: "pagination pagination pagination mentioned repeatedly in the body only",
  });
  const rank = await call("memory_search", { query: "pagination", project: "rank-test", response_format: "json" });
  check("title match outranks repeated body match",
    rank.data?.items?.[0]?.title === "Pagination behaviour",
    rank.data?.items?.map((m) => `${m.title}=${m.score}`).join(" | "));

  // ---- pagination ---------------------------------------------------------
  const p1 = await call("memory_list", { limit: 2, offset: 0, response_format: "json" });
  check("limit respected", p1.data?.count === 2, String(p1.data?.count));
  check("has_more + next_offset present", p1.data?.has_more === true && p1.data?.next_offset === 2);
  const p2 = await call("memory_list", { limit: 2, offset: 2, response_format: "json" });
  check("offset returns different rows", p2.data?.items?.[0]?.id !== p1.data?.items?.[0]?.id);

  // ---- supersede ----------------------------------------------------------
  const sup = await call("memory_write", {
    project: "timhirt-school-saas", kind: "decision",
    title: "Rate limiting now Postgres-backed and fails closed",
    body: "Supersedes the earlier note. Verified with 60 concurrent callers at limit 10: exactly 10 allowed.",
    tags: ["rate-limit"], supersedes: b.data.memory.id,
  });
  check("supersede accepted", !sup.isError);
  const afterSup = await call("memory_search", { query: "upstash redis", response_format: "json" });
  check("superseded memory drops out of search", afterSup.data?.total === 0, JSON.stringify(afterSup.data?.total));
  const withSup = await call("memory_search", { query: "upstash redis", include_superseded: true, response_format: "json" });
  check("superseded still reachable on request", withSup.data?.total === 1);
  check("superseded_by points at the replacement",
    withSup.data?.items?.[0]?.superseded_by === sup.data.memory.id);

  const badSup = await call("memory_write", {
    project: "x", kind: "fact", title: "Bad supersede", body: "should fail",
    supersedes: "00000000-0000-0000-0000-000000000000",
  });
  check("superseding a missing id errors helpfully", badSup.isError && /memory_search/.test(badSup.text), badSup.text.slice(0, 80));

  // ---- get / update / delete ---------------------------------------------
  const g = await call("memory_get", { id: idA, response_format: "json" });
  check("get returns the full body", (g.data?.memory?.body ?? "").includes("boolean"));
  const gMissing = await call("memory_get", { id: "11111111-2222-3333-4444-555555555555" });
  check("get on a missing id errors helpfully", gMissing.isError && /memory_search|memory_list/.test(gMissing.text));

  const u = await call("memory_update", { id: idA, tags: ["vercel", "postmortem"], response_format: "json" });
  check("update replaces tags", JSON.stringify(u.data?.memory?.tags) === JSON.stringify(["vercel", "postmortem"]));
  check("update bumps updated_at", u.data?.memory?.updated_at >= u.data?.memory?.created_at);
  const uEmpty = await call("memory_update", { id: idA });
  check("update with no fields errors helpfully", uEmpty.isError && /at least one/.test(uEmpty.text));

  // ---- durability ---------------------------------------------------------
  check("store file written", existsSync(storePath));
  const lines = readFileSync(storePath, "utf8").trim().split("\n");
  check("one JSON object per line", lines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));

  const stats = await call("memory_stats", { response_format: "json" });
  check("stats counts every memory", stats.data?.total === lines.length, `${stats.data?.total} vs ${lines.length}`);
  check("stats groups by project", (stats.data?.by_project?.["timhirt-school-saas"] ?? 0) >= 2);

  const d = await call("memory_delete", { id: idA });
  check("delete succeeds", !d.isError && d.data?.deleted === true);
  const dAgain = await call("memory_delete", { id: idA });
  check("deleting twice errors helpfully", dAgain.isError && /already be deleted/.test(dAgain.text));

  // ---- input validation ---------------------------------------------------
  const badKind = await call("memory_write", { project: "x", kind: "nonsense", title: "abc", body: "x" });
  check("invalid kind rejected", badKind.isError);
  const shortTitle = await call("memory_write", { project: "x", kind: "fact", title: "ab", body: "x" });
  check("too-short title rejected", shortTitle.isError);
} finally {
  await client.close();
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
