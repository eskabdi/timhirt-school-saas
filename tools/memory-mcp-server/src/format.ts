import type { Memory, Page, ScoredMemory } from "./types.js";

/**
 * Markdown renderers.
 *
 * Listings stay deliberately thin — title, kind, when, tags — because the point
 * of a search result is to let the caller decide what to open, and pouring
 * whole bodies into a result set spends the context the memories are meant to
 * save. memory_get returns the full text.
 */

const ago = (iso: string): string => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return iso;
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

const meta = (m: Memory): string => {
  const bits = [`\`${m.kind}\``, m.project, ago(m.updated_at)];
  if (m.tags.length) bits.push(m.tags.map((t) => `#${t}`).join(" "));
  if (m.superseded_by) bits.push("**superseded**");
  return bits.join(" · ");
};

export function renderList(page: Page<Memory>, heading: string): string {
  if (!page.total) {
    return `${heading}\n\nNo memories matched. Try dropping a filter, or memory_list with no filters to see what is stored.`;
  }
  const lines = [heading, "", `${page.total} total, showing ${page.count}`, ""];
  for (const m of page.items) {
    lines.push(`### ${m.title}`);
    lines.push(meta(m));
    lines.push(`\`${m.id}\``);
    if (m.files.length) lines.push(`files: ${m.files.join(", ")}`);
    lines.push("");
  }
  if (page.has_more) lines.push(`_More available — call again with offset=${page.next_offset}._`);
  return lines.join("\n");
}

export function renderSearch(page: Page<ScoredMemory>, query: string): string {
  if (!page.total) {
    return `No memories matched "${query}".\n\n`
      + `Search covers titles, tags, file paths and bodies. Try fewer or broader words, `
      + `drop the project/kind filters, or set include_superseded=true if the answer may have been replaced.`;
  }
  const lines = [`# Memories matching "${query}"`, "", `${page.total} total, showing ${page.count}`, ""];
  for (const m of page.items) {
    lines.push(`### ${m.title}`);
    lines.push(meta(m));
    lines.push(`\`${m.id}\` · score ${m.score}`);
    if (m.snippet) lines.push(`> ${m.snippet.replace(/\n+/g, " ")}`);
    lines.push("");
  }
  if (page.has_more) lines.push(`_More available — call again with offset=${page.next_offset}._`);
  return lines.join("\n");
}

export function renderOne(m: Memory): string {
  const lines = [`# ${m.title}`, "", meta(m), "", m.body, ""];
  if (m.files.length) lines.push(`**Files:** ${m.files.join(", ")}`);
  lines.push(`**Id:** \`${m.id}\``);
  lines.push(`**Created:** ${m.created_at}`);
  if (m.superseded_by) lines.push(`**Superseded by:** \`${m.superseded_by}\``);
  return lines.join("\n");
}

export function renderStats(s: {
  total: number; by_project: Record<string, number>;
  by_kind: Record<string, number>; superseded: number;
}, path: string): string {
  const rows = (rec: Record<string, number>) =>
    Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- (none)";
  return [
    "# Memory store",
    "",
    `**Total:** ${s.total}  (${s.superseded} superseded)`,
    `**File:** \`${path}\``,
    "",
    "## By project",
    rows(s.by_project),
    "",
    "## By kind",
    rows(s.by_kind),
  ].join("\n");
}
