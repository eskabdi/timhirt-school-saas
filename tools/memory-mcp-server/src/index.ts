#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MemoryStore, type Filter } from "./store.js";
import { renderList, renderOne, renderSearch, renderStats } from "./format.js";
import {
  DeleteInput, GetInput, ListInput, MemoryObject, ScoredMemoryObject,
  SearchInput, StatsInput, UpdateInput, WriteInput, pageOf,
} from "./schemas.js";
import type { Memory, MemoryKind } from "./types.js";

const store = new MemoryStore();

const server = new McpServer({ name: "memory-mcp-server", version: "1.0.0" });

/** Uniform failure shape. Every message says what to do next. */
const fail = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

/** The SDK requires structuredContent to carry an index signature. */
type Structured = { [key: string]: unknown };

const ok = (text: string, structured: Structured) => ({
  content: [{ type: "text" as const, text }],
  structuredContent: structured,
});

/** structuredContent must be plain JSON — this also strips undefined optionals,
 *  which would otherwise fail the output schema. */
const plain = (v: unknown): Structured => JSON.parse(JSON.stringify(v)) as Structured;

const toFilter = (p: {
  project?: string; kind?: MemoryKind; tags?: string[];
  file?: string; since?: string; include_superseded: boolean;
}): Filter => ({
  project: p.project, kind: p.kind, tags: p.tags,
  file: p.file, since: p.since, include_superseded: p.include_superseded,
});

// ---------------------------------------------------------------- write -----
server.registerTool(
  "memory_write",
  {
    title: "Write a memory",
    description: `Store something worth remembering after this session ends.

Use this for what a repository cannot hold: a decision and its reasoning, an approach that was tried and did not work, a production incident and how it was diagnosed. Project invariants ("this component behaves like X") belong in CLAUDE.md instead, versioned beside the code they describe.

Write the conclusion in the title, not the topic — "Rejected Upstash for rate limiting; Postgres avoids a new dependency" recalls far better than "Rate limiting".

Args:
  - project (string): repo name, or 'global' for anything cross-project
  - kind ('decision'|'rejected'|'incident'|'fact'|'preference')
  - title (string): one line stating the point, 3-200 chars
  - body (string): reasoning, reproduction, numbers, what was ruled out
  - tags (string[]): lowercase keywords for filtering (optional)
  - files (string[]): repo-relative paths this concerns (optional)
  - supersedes (uuid): id of a memory this replaces (optional)

Returns: the stored memory, including its id.

Examples:
  - Use when: a deploy broke and you found the cause -> kind='incident'
  - Use when: you evaluated two libraries and picked one -> kind='decision'
  - Use when: an approach failed and someone will try it again -> kind='rejected'
  - Don't use when: recording how the code currently works — that is CLAUDE.md`,
    inputSchema: WriteInput,
    outputSchema: { memory: MemoryObject },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (p) => {
    try {
      if (p.supersedes && !store.get(p.supersedes)) {
        return fail(`No memory with id ${p.supersedes} to supersede. Use memory_search to find the right id, or omit 'supersedes' to store this as new.`);
      }
      const memory = store.create({
        project: p.project, kind: p.kind, title: p.title, body: p.body,
        tags: p.tags, files: p.files, supersedes: p.supersedes,
      });
      const out = plain({ memory });
      return ok(`Stored \`${memory.id}\`\n\n${renderOne(memory)}`, out);
    } catch (e) {
      return fail(`Could not write the memory: ${msg(e)}. The store is at ${store.storePath()} — check it is writable.`);
    }
  },
);

// --------------------------------------------------------------- search -----
server.registerTool(
  "memory_search",
  {
    title: "Search memories",
    description: `Find stored memories by words appearing in their title, tags, file paths or body.

Ranks title and tag matches above body matches, and rewards covering more of the query. Superseded memories are excluded unless you ask for them.

Search before concluding something is new — the highest-value memories are the ones recording an approach that already failed.

Args:
  - query (string): words to match, 2-400 chars
  - project, kind, tags, file, since: optional filters
  - include_superseded (boolean): include replaced memories (default false)
  - limit (number): 1-100 (default 20), offset (number): for pagination
  - response_format ('markdown'|'json'): default 'markdown'

Returns (json): { total, count, offset, items: [{ ...memory, score, snippet }], has_more, next_offset }

Examples:
  - Use when: "have we tried Redis here before?" -> query='redis rate limit'
  - Use when: reopening a file -> file='src/components/ui/Field.tsx'
  - Don't use when: you know the id (use memory_get for the full body)`,
    inputSchema: SearchInput,
    outputSchema: pageOf(ScoredMemoryObject),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (p) => {
    try {
      const page = store.search(p.query, toFilter(p), p.limit, p.offset);
      const out = plain(page);
      return ok(p.response_format === "json" ? JSON.stringify(out, null, 2) : renderSearch(page, p.query), out);
    } catch (e) {
      return fail(`Search failed: ${msg(e)}`);
    }
  },
);

// ----------------------------------------------------------------- list -----
server.registerTool(
  "memory_list",
  {
    title: "List memories",
    description: `List stored memories newest-first, without a text query.

Use to survey what exists for a project or kind — at the start of a session, or when you want everything tagged a certain way rather than the best textual match.

Args:
  - project, kind, tags, file, since: optional filters
  - include_superseded (boolean): default false
  - limit (number): 1-100 (default 20), offset (number): for pagination
  - response_format ('markdown'|'json'): default 'markdown'

Returns (json): { total, count, offset, items: [memory], has_more, next_offset }
Bodies are omitted from the markdown rendering — use memory_get for the full text.

Examples:
  - Use when: starting work on a repo -> project='timhirt-school-saas'
  - Use when: reviewing past failures -> kind='rejected'
  - Don't use when: you have search terms (memory_search ranks better)`,
    inputSchema: ListInput,
    outputSchema: pageOf(MemoryObject),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (p) => {
    try {
      const page = store.list(toFilter(p), p.limit, p.offset);
      const heading = `# Memories${p.project ? ` — ${p.project}` : ""}${p.kind ? ` (${p.kind})` : ""}`;
      const out = plain(page);
      return ok(p.response_format === "json" ? JSON.stringify(out, null, 2) : renderList(page, heading), out);
    } catch (e) {
      return fail(`List failed: ${msg(e)}`);
    }
  },
);

// ------------------------------------------------------------------ get -----
server.registerTool(
  "memory_get",
  {
    title: "Get one memory",
    description: `Fetch a single memory by id, including its full body.

Search and list return titles and snippets to keep results small; this returns everything.

Args:
  - id (uuid): as returned by memory_write, memory_search or memory_list
  - response_format ('markdown'|'json'): default 'markdown'

Returns: the complete memory.

Examples:
  - Use when: a search hit looks relevant and you need the detail
  - Use when: following a superseded_by pointer to the current version`,
    inputSchema: GetInput,
    outputSchema: { memory: MemoryObject },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (p) => {
    const memory = store.get(p.id);
    if (!memory) return fail(`No memory with id ${p.id}. Use memory_search or memory_list to find valid ids.`);
    const out = plain({ memory });
    return ok(p.response_format === "json" ? JSON.stringify(out, null, 2) : renderOne(memory), out);
  },
);

// --------------------------------------------------------------- update -----
server.registerTool(
  "memory_update",
  {
    title: "Update a memory",
    description: `Revise a memory in place. Only the fields you pass change; tags and files are replaced wholesale, not merged.

Use this to correct or sharpen an existing memory. If the *conclusion* changed, prefer memory_write with 'supersedes' — that keeps the earlier reasoning readable, which is usually the interesting part.

Args:
  - id (uuid): the memory to revise
  - project, kind, title, body, tags, files: any subset (optional)
  - response_format ('markdown'|'json'): default 'markdown'

Returns: the updated memory.

Examples:
  - Use when: fixing a typo or adding detail to an existing memory
  - Don't use when: you changed your mind — use memory_write with supersedes`,
    inputSchema: UpdateInput,
    outputSchema: { memory: MemoryObject },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (p) => {
    const { id, response_format, ...patch } = p;
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (!Object.keys(defined).length) {
      return fail("Nothing to update — pass at least one of project, kind, title, body, tags or files.");
    }
    const memory = store.update(id, defined as Partial<Memory>);
    if (!memory) return fail(`No memory with id ${id}. Use memory_search or memory_list to find valid ids.`);
    const out = plain({ memory });
    return ok(response_format === "json" ? JSON.stringify(out, null, 2) : renderOne(memory), out);
  },
);

// --------------------------------------------------------------- delete -----
server.registerTool(
  "memory_delete",
  {
    title: "Delete a memory",
    description: `Permanently remove a memory. This cannot be undone.

Prefer memory_write with 'supersedes' when a memory is merely out of date — superseded entries drop out of search but stay readable. Delete is for entries that were wrong to record at all, or that contain something which should not be retained.

Args:
  - id (uuid): the memory to delete

Returns: confirmation with the deleted id and title.`,
    inputSchema: DeleteInput,
    outputSchema: { deleted: z.boolean(), id: z.string(), title: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (p) => {
    const existing = store.get(p.id);
    if (!existing) return fail(`No memory with id ${p.id}. It may already be deleted — memory_list will show what remains.`);
    store.delete(p.id);
    const out = plain({ deleted: true, id: existing.id, title: existing.title });
    return ok(`Deleted \`${existing.id}\` — "${existing.title}"`, out);
  },
);

// ---------------------------------------------------------------- stats -----
server.registerTool(
  "memory_stats",
  {
    title: "Memory store statistics",
    description: `Counts of stored memories by project and kind, plus the store's file path.

Use to see whether a project has memories worth searching before spending calls on it.

Args:
  - response_format ('markdown'|'json'): default 'markdown'

Returns (json): { total, superseded, store_path, by_project, by_kind }`,
    inputSchema: StatsInput,
    outputSchema: {
      total: z.number(),
      superseded: z.number(),
      store_path: z.string(),
      by_project: z.record(z.number()),
      by_kind: z.record(z.number()),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (p) => {
    const s = store.stats();
    const out = plain({ total: s.total, superseded: s.superseded, store_path: store.storePath(), by_project: s.by_project, by_kind: s.by_kind });
    return ok(p.response_format === "json" ? JSON.stringify(out, null, 2) : renderStats(s, store.storePath()), out);
  },
);

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout is the transport — anything informational goes to stderr.
process.stderr.write(`memory-mcp-server ready (store: ${store.storePath()})\n`);
