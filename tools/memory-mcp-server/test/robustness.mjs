#!/usr/bin/env node
/**
 * The failure modes that actually lose a memory store: a process restart, a
 * half-written file, concurrent writers, and non-Latin text.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
};

const scratch = mkdtempSync(join(tmpdir(), "memrobust-"));
const storePath = join(scratch, "nested", "deeper", "memories.jsonl");

async function session(fn) {
  const transport = new StdioClientTransport({
    command: "node", args: ["dist/index.js"],
    env: { ...process.env, MEMORY_STORE_PATH: storePath },
  });
  const client = new Client({ name: "robust", version: "1.0.0" });
  await client.connect(transport);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, text: r.content?.[0]?.text ?? "", data: r.structuredContent };
  };
  try { return await fn(call); } finally { await client.close(); }
}

try {
  // ---- 1. the directory does not exist yet --------------------------------
  const first = await session(async (call) => call("memory_write", {
    project: "p", kind: "fact", title: "Store is created on first write",
    body: "The parent directories did not exist before this call.",
  }));
  check("creates missing parent directories", !first.isError && existsSync(storePath));
  const firstId = first.data?.memory?.id;

  // ---- 2. survives a full process restart ---------------------------------
  const afterRestart = await session(async (call) =>
    call("memory_get", { id: firstId, response_format: "json" }));
  check("memory survives a process restart", afterRestart.data?.memory?.id === firstId);

  // ---- 3. non-Latin text round-trips --------------------------------------
  const am = await session(async (call) => call("memory_write", {
    project: "p", kind: "fact",
    title: "የውጤት መለኪያ ነባሪ እሴቶች — Amharic round-trip",
    body: "በጣም ከፍተኛ (Excellent) · ከፍተኛ (Superior) · ውድቀት (Fail). Afaan Oromoo: Safartuu Qabxii.",
    tags: ["i18n"],
  }));
  const amBack = await session(async (call) =>
    call("memory_get", { id: am.data.memory.id, response_format: "json" }));
  check("Amharic survives write + restart", amBack.data?.memory?.body.includes("በጣም ከፍተኛ"));
  const amFound = await session(async (call) =>
    call("memory_search", { query: "ውድቀት", response_format: "json" }));
  check("Amharic is searchable", amFound.data?.total >= 1, JSON.stringify(amFound.data?.total));

  // ---- 4. a corrupt line must not cost the store --------------------------
  appendFileSync(storePath, "{ this is not json at all\n");
  const afterCorrupt = await session(async (call) => call("memory_list", { response_format: "json" }));
  check("survives a corrupt line", !afterCorrupt.isError && afterCorrupt.data?.total >= 2,
    JSON.stringify(afterCorrupt.data?.total));
  // The next write rewrites the file, dropping the bad line rather than keeping it forever.
  await session(async (call) => call("memory_write", { project: "p", kind: "fact", title: "Rewrite after corruption", body: "x" }));
  const cleaned = readFileSync(storePath, "utf8").trim().split("\n");
  check("corrupt line dropped on next write", cleaned.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));

  // ---- 5. concurrent writers ----------------------------------------------
  // Separate processes, each writing at once. The last writer's full snapshot
  // wins, so this documents the real behaviour rather than pretending there is
  // locking: no torn file, valid JSON throughout.
  await Promise.all([...Array(5)].map((_, i) =>
    session(async (call) => call("memory_write", {
      project: "concurrent", kind: "fact", title: `Concurrent writer ${i}`, body: `body ${i}`,
    }))));
  const raw = readFileSync(storePath, "utf8").trim().split("\n");
  check("file still valid JSON after concurrent writes",
    raw.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));
  const conc = await session(async (call) =>
    call("memory_list", { project: "concurrent", response_format: "json" }));
  check("at least one concurrent write survived", (conc.data?.total ?? 0) >= 1,
    `${conc.data?.total} of 5 — last-writer-wins is expected`);

  // ---- 6. a large body -----------------------------------------------------
  const big = "x".repeat(19_000);
  const bigW = await session(async (call) => call("memory_write", {
    project: "p", kind: "fact", title: "Large body near the limit", body: big,
  }));
  check("19k body accepted", !bigW.isError);
  const tooBig = await session(async (call) => call("memory_write", {
    project: "p", kind: "fact", title: "Body over the limit", body: "x".repeat(20_001),
  }));
  check("over-limit body rejected", tooBig.isError);

  // ---- 7. an empty store answers cleanly ----------------------------------
  const emptyPath = join(scratch, "empty.jsonl");
  writeFileSync(emptyPath, "");
  const transport = new StdioClientTransport({
    command: "node", args: ["dist/index.js"],
    env: { ...process.env, MEMORY_STORE_PATH: emptyPath },
  });
  const c = new Client({ name: "empty", version: "1.0.0" });
  await c.connect(transport);
  const r = await c.callTool({ name: "memory_list", arguments: {} });
  check("empty store returns guidance, not an error",
    !r.isError && /No memories matched/.test(r.content?.[0]?.text ?? ""));
  const st = await c.callTool({ name: "memory_stats", arguments: { response_format: "json" } });
  check("stats on an empty store reports zero", st.structuredContent?.total === 0);
  await c.close();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
