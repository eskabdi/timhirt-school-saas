/**
 * What a memory is.
 *
 * This server exists for the things a repo cannot hold: what was tried and
 * rejected, why a decision went the way it did, what broke in production and
 * how it was found. Project invariants belong in CLAUDE.md, versioned beside
 * the code they describe — a note asserting "Field renders a label" should stop
 * existing the day Field changes, and a memory store has no way to know that.
 */

/** Why the memory exists. Drives how much weight recall should give it. */
export const MEMORY_KINDS = [
  /** A choice made and the reasoning behind it. */
  "decision",
  /** Something tried that did not work — the most valuable kind, and the one
   *  most reliably lost between sessions. */
  "rejected",
  /** A production failure: what broke, how it was diagnosed, what fixed it. */
  "incident",
  /** A durable statement about how the world is (accounts, environments). */
  "fact",
  /** How this person likes to work. */
  "preference",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export interface Memory {
  id: string;
  /** Scope. Usually a repo name; "global" for anything cross-project. */
  project: string;
  kind: MemoryKind;
  /** One line. This is what search matches hardest on and what listings show. */
  title: string;
  /** The detail: reasoning, reproduction, the actual numbers. */
  body: string;
  tags: string[];
  /** Repo-relative paths this touches, so a memory can be found from a file. */
  files: string[];
  created_at: string;
  updated_at: string;
  /** Set when a later memory replaces this one. Superseded entries stay
   *  readable — "we changed our mind, and here is what we thought before" is
   *  usually the interesting part — but drop out of search by default. */
  superseded_by?: string;
}

/** A search hit: the memory plus why it matched. */
export interface ScoredMemory extends Memory {
  score: number;
  /** The span of body text around the strongest match. */
  snippet: string;
}

export interface Page<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  has_more: boolean;
  next_offset?: number;
}
