import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Memory, MemoryKind, Page, ScoredMemory } from "./types.js";

/**
 * A JSONL file, loaded once and kept in memory.
 *
 * No SQLite, no native module. A person accumulates memories at the speed of
 * thought, not of traffic — a few thousand entries is a large store and fits in
 * memory with room to spare. In exchange the file stays greppable, diffable,
 * and trivially backed up, and the server installs anywhere Node runs without a
 * build toolchain. If this ever outgrows that, the seam is this class alone.
 *
 * Writes go through a temp file and a rename, so an interrupted write cannot
 * truncate the store.
 */
export class MemoryStore {
  private memories = new Map<string, Memory>();
  private loaded = false;

  constructor(private readonly path: string = defaultStorePath()) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;

    const raw = readFileSync(this.path, "utf8");
    let lineNo = 0;
    for (const line of raw.split("\n")) {
      lineNo++;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const m = JSON.parse(trimmed) as Memory;
        // Last write for an id wins, which is what makes the file append-safe.
        if (m && typeof m.id === "string") this.memories.set(m.id, m);
      } catch {
        // One corrupt line must not cost the whole store. Report and continue —
        // stderr, because stdout is the MCP transport.
        process.stderr.write(`memory-mcp-server: skipping unparseable line ${lineNo} of ${this.path}\n`);
      }
    }
  }

  private persist(): void {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true });
    const body = [...this.memories.values()]
      .map((m) => JSON.stringify(m))
      .join("\n");
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, body ? `${body}\n` : "", "utf8");
    renameSync(tmp, this.path); // atomic on the same filesystem
  }

  storePath(): string {
    return this.path;
  }

  create(input: {
    project: string; kind: MemoryKind; title: string; body: string;
    tags?: string[]; files?: string[]; supersedes?: string;
  }): Memory {
    this.load();
    const now = new Date().toISOString();
    const memory: Memory = {
      id: randomUUID(),
      project: input.project,
      kind: input.kind,
      title: input.title,
      body: input.body,
      tags: normaliseTags(input.tags),
      files: [...new Set(input.files ?? [])],
      created_at: now,
      updated_at: now,
    };
    this.memories.set(memory.id, memory);

    if (input.supersedes) {
      const old = this.memories.get(input.supersedes);
      if (old) this.memories.set(old.id, { ...old, superseded_by: memory.id, updated_at: now });
    }
    this.persist();
    return memory;
  }

  get(id: string): Memory | undefined {
    this.load();
    return this.memories.get(id);
  }

  update(id: string, patch: Partial<Pick<Memory, "project" | "kind" | "title" | "body" | "tags" | "files">>): Memory | undefined {
    this.load();
    const existing = this.memories.get(id);
    if (!existing) return undefined;
    const updated: Memory = {
      ...existing,
      ...patch,
      ...(patch.tags ? { tags: normaliseTags(patch.tags) } : {}),
      ...(patch.files ? { files: [...new Set(patch.files)] } : {}),
      updated_at: new Date().toISOString(),
    };
    this.memories.set(id, updated);
    this.persist();
    return updated;
  }

  delete(id: string): boolean {
    this.load();
    const had = this.memories.delete(id);
    if (had) this.persist();
    return had;
  }

  /** Newest first, filtered. */
  list(filter: Filter, limit: number, offset: number): Page<Memory> {
    this.load();
    const all = [...this.memories.values()]
      .filter((m) => matches(m, filter))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return paginate(all, limit, offset);
  }

  search(query: string, filter: Filter, limit: number, offset: number): Page<ScoredMemory> {
    this.load();
    const terms = tokenise(query);
    const scored: ScoredMemory[] = [];

    for (const m of this.memories.values()) {
      if (!matches(m, filter)) continue;
      const { score, snippet } = scoreMemory(m, terms);
      if (score > 0) scored.push({ ...m, score, snippet });
    }
    // Ties broken by recency so an unhelpful ancient exact match never buries a
    // fresh near-match.
    scored.sort((a, b) => b.score - a.score || b.updated_at.localeCompare(a.updated_at));
    return paginate(scored, limit, offset);
  }

  stats(): { total: number; by_project: Record<string, number>; by_kind: Record<string, number>; superseded: number } {
    this.load();
    const by_project: Record<string, number> = {};
    const by_kind: Record<string, number> = {};
    let superseded = 0;
    for (const m of this.memories.values()) {
      by_project[m.project] = (by_project[m.project] ?? 0) + 1;
      by_kind[m.kind] = (by_kind[m.kind] ?? 0) + 1;
      if (m.superseded_by) superseded++;
    }
    return { total: this.memories.size, by_project, by_kind, superseded };
  }
}

export interface Filter {
  project?: string;
  kind?: MemoryKind;
  tags?: string[];
  file?: string;
  since?: string;
  include_superseded?: boolean;
}

function matches(m: Memory, f: Filter): boolean {
  if (!f.include_superseded && m.superseded_by) return false;
  if (f.project && m.project !== f.project) return false;
  if (f.kind && m.kind !== f.kind) return false;
  if (f.since && m.updated_at < f.since) return false;
  if (f.tags?.length) {
    const have = new Set(m.tags);
    if (!f.tags.every((t) => have.has(t.toLowerCase()))) return false;
  }
  // Substring, so "src/components" finds "src/components/ui/Field.tsx".
  if (f.file && !m.files.some((p) => p.includes(f.file!))) return false;
  return true;
}

function paginate<T>(all: T[], limit: number, offset: number): Page<T> {
  const items = all.slice(offset, offset + limit);
  const has_more = offset + items.length < all.length;
  return {
    total: all.length,
    count: items.length,
    offset,
    items,
    has_more,
    ...(has_more ? { next_offset: offset + items.length } : {}),
  };
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "was", "it", "that", "this", "we", "i", "did", "do", "does", "how", "what", "why",
]);

/**
 * Splits on anything that is not a letter, a digit, or one of `_ . -`.
 *
 * Unicode-aware on purpose: an ASCII-only class (`[^a-z0-9_.-]`) silently
 * discards every Ethiopic, Cyrillic or CJK character, so a query in Amharic
 * tokenises to nothing and matches nothing. `\p{L}` keeps letters in any
 * script. The retained punctuation lets `src/components/ui/Field.tsx` and
 * `--prebuilt` survive as single tokens.
 */
export function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}_.-]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Field-weighted term matching.
 *
 * A title hit counts far more than a body hit: memories are written with the
 * point in the title, so matching there is a strong signal. Every term that
 * appears anywhere adds a coverage bonus, which keeps a memory matching three
 * of the query's words ahead of one matching a single word three times.
 */
function scoreMemory(m: Memory, terms: string[]): { score: number; snippet: string } {
  if (!terms.length) return { score: 0, snippet: "" };

  const title = m.title.toLowerCase();
  const body = m.body.toLowerCase();
  const tags = m.tags.join(" ").toLowerCase();
  const files = m.files.join(" ").toLowerCase();

  let score = 0;
  let covered = 0;
  let bestIdx = -1;
  let bestTermLen = 0;

  for (const term of terms) {
    let hit = false;
    if (title.includes(term)) { score += 10; hit = true; }
    if (tags.includes(term)) { score += 6; hit = true; }
    if (files.includes(term)) { score += 4; hit = true; }
    const idx = body.indexOf(term);
    if (idx !== -1) {
      score += 2 + Math.min(countOccurrences(body, term) - 1, 3); // diminishing
      hit = true;
      if (term.length > bestTermLen) { bestIdx = idx; bestTermLen = term.length; }
    }
    if (hit) covered++;
  }
  if (!covered) return { score: 0, snippet: "" };
  score += (covered / terms.length) * 12;

  return { score: Math.round(score * 100) / 100, snippet: makeSnippet(m.body, bestIdx) };
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) { n++; i = haystack.indexOf(needle, i + needle.length); }
  return n;
}

function makeSnippet(body: string, idx: number): string {
  const WIDTH = 160;
  if (!body) return "";
  if (idx < 0) return body.length <= WIDTH ? body : `${body.slice(0, WIDTH).trimEnd()}…`;
  const start = Math.max(0, idx - WIDTH / 2);
  const end = Math.min(body.length, start + WIDTH);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
}

function normaliseTags(tags?: string[]): string[] {
  return [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Where the store lives. MEMORY_STORE_PATH wins, so a project can keep its own
 * file; otherwise it is one shared store per machine, which is the point —
 * "we already tried that" has to survive leaving the directory.
 */
export function defaultStorePath(): string {
  const override = process.env.MEMORY_STORE_PATH;
  if (override) return override;
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "memory-mcp-server", "memories.jsonl");
}
