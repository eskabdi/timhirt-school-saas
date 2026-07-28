import { z } from "zod";
import { MEMORY_KINDS } from "./types.js";

export const ResponseFormat = z.enum(["markdown", "json"])
  .default("markdown")
  .describe("Output format: 'markdown' for reading, 'json' for machine processing");

const project = z.string().trim().min(1).max(120)
  .describe("Scope for the memory — normally the repo name, or 'global' for anything that applies everywhere");

const kind = z.enum(MEMORY_KINDS)
  .describe("Why the memory exists: 'decision' (a choice and its reasoning), 'rejected' (something tried that did not work), 'incident' (a production failure and its diagnosis), 'fact' (a durable statement about the world), 'preference' (how this person likes to work)");

const tags = z.array(z.string().trim().min(1).max(40)).max(20).default([])
  .describe("Lowercase keywords for filtering, e.g. ['vercel','deploy']");

const files = z.array(z.string().trim().min(1).max(300)).max(50).default([])
  .describe("Repo-relative paths this memory concerns, so it can be found from a file path");

export const limit = z.number().int().min(1).max(100).default(20)
  .describe("Maximum results to return (1-100)");

export const offset = z.number().int().min(0).default(0)
  .describe("Results to skip, for pagination");

export const includeSuperseded = z.boolean().default(false)
  .describe("Include memories replaced by a newer one. Off by default so superseded reasoning does not compete with current reasoning");

export const WriteInput = {
  project,
  kind,
  title: z.string().trim().min(3).max(200)
    .describe("One line stating the point. This is what search matches hardest on — write the conclusion, not the topic"),
  body: z.string().trim().min(1).max(20000)
    .describe("The detail worth keeping: reasoning, reproduction steps, actual numbers, what was ruled out"),
  tags,
  files,
  supersedes: z.string().uuid().optional()
    .describe("Id of a memory this replaces. The old one stays readable but drops out of default search"),
};

export const SearchInput = {
  query: z.string().trim().min(2).max(400)
    .describe("Words to match against title, tags, file paths and body"),
  project: project.optional(),
  kind: kind.optional(),
  tags: z.array(z.string()).max(20).optional().describe("Only memories carrying all of these tags"),
  file: z.string().trim().min(1).max(300).optional()
    .describe("Only memories whose file list contains this substring, e.g. 'src/components'"),
  since: z.string().datetime().optional()
    .describe("Only memories updated at or after this ISO-8601 timestamp"),
  include_superseded: includeSuperseded,
  limit,
  offset,
  response_format: ResponseFormat,
};

export const ListInput = {
  project: project.optional(),
  kind: kind.optional(),
  tags: z.array(z.string()).max(20).optional().describe("Only memories carrying all of these tags"),
  file: z.string().trim().min(1).max(300).optional().describe("Only memories whose file list contains this substring"),
  since: z.string().datetime().optional().describe("Only memories updated at or after this ISO-8601 timestamp"),
  include_superseded: includeSuperseded,
  limit,
  offset,
  response_format: ResponseFormat,
};

export const GetInput = {
  id: z.string().uuid().describe("Memory id, as returned by memory_write or memory_search"),
  response_format: ResponseFormat,
};

export const UpdateInput = {
  id: z.string().uuid().describe("Memory id to revise"),
  project: project.optional(),
  kind: kind.optional(),
  title: z.string().trim().min(3).max(200).optional().describe("Replacement title"),
  body: z.string().trim().min(1).max(20000).optional().describe("Replacement body"),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().describe("Replacement tag list (replaces, does not merge)"),
  files: z.array(z.string().trim().min(1).max(300)).max(50).optional().describe("Replacement file list (replaces, does not merge)"),
  response_format: ResponseFormat,
};

export const DeleteInput = {
  id: z.string().uuid().describe("Memory id to delete permanently"),
};

export const StatsInput = {
  response_format: ResponseFormat,
};

/** Shape of a memory in every tool's structured output. */
export const MemoryShape = {
  id: z.string(),
  project: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  files: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
  superseded_by: z.string().optional(),
};

export const MemoryObject = z.object(MemoryShape);
export const ScoredMemoryObject = MemoryObject.extend({
  score: z.number(),
  snippet: z.string(),
});

export const pageOf = <T extends z.ZodTypeAny>(item: T) => ({
  total: z.number().describe("Total matches before pagination"),
  count: z.number().describe("Number returned in this response"),
  offset: z.number().describe("Offset this page starts at"),
  items: z.array(item),
  has_more: z.boolean().describe("Whether further results exist"),
  next_offset: z.number().optional().describe("Offset to pass for the next page"),
});
