# memory-mcp-server

Durable, searchable memory across sessions — for the things a repository cannot
hold.

An assistant starts every session cold. Anything not written down is
rediscovered, and the most expensive things to rediscover are the ones that
leave no trace in the code: an approach that was tried and abandoned, why a
decision went the way it did, what broke in production and how it was found.

## What belongs here, and what does not

| | |
|---|---|
| **`CLAUDE.md` in the repo** | How the code behaves now. Versioned beside the code it describes, so a note saying "this component does X" stops existing the day it stops doing X. |
| **This server** | What was tried and rejected. Why a call was made. What broke, and how it was diagnosed. None of it has a file to live next to. |

Recording repository invariants here is a mistake: nothing will ever tell the
store the code changed, and it will keep asserting something false.

## Install

```bash
npm install && npm run build
```

Register it with an MCP client. For Claude Code:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/absolute/path/to/tools/memory-mcp-server/dist/index.js"]
    }
  }
}
```

Storage is a JSONL file at `~/.local/share/memory-mcp-server/memories.jsonl`
(or `$XDG_DATA_HOME`). Override with `MEMORY_STORE_PATH`. One store per machine
by default, on purpose — "we already tried that" has to survive leaving the
directory.

## Tools

| Tool | Does | Read-only |
|---|---|---|
| `memory_write` | Store a memory; optionally supersede an existing one | no |
| `memory_search` | Rank by words in title, tags, file paths, body | yes |
| `memory_list` | Newest-first listing with filters | yes |
| `memory_get` | One memory, full body | yes |
| `memory_update` | Revise fields in place | no |
| `memory_delete` | Remove permanently | no (destructive) |
| `memory_stats` | Counts by project and kind | yes |

Every tool takes `response_format` (`markdown` for reading, `json` for
processing) and declares an output schema, so structured results come back as
`structuredContent` rather than needing to be parsed out of prose.

### Kinds

`decision` · `rejected` · `incident` · `fact` · `preference`

`rejected` earns its own kind because it is the most valuable and the most
reliably lost: nothing in a repository records what is *absent* because someone
already found out it does not work.

### Superseding vs updating

`memory_update` revises wording. When the *conclusion* changes, write a new
memory with `supersedes` — the old one drops out of search but stays readable,
because "we changed our mind, and here is what we thought before" is usually
the interesting part.

## Design notes

**JSONL, not SQLite.** Memories accumulate at the speed of thought, not of
traffic; a few thousand entries is a large store and fits in memory. In return
the file stays greppable, diffable and trivially backed up, and the server
installs anywhere Node runs with no build toolchain. Writes go through a temp
file and a rename, so an interrupted write cannot truncate the store. The seam
is `MemoryStore` alone if this ever needs to change.

**Search is field-weighted, not fuzzy.** A title match counts for far more than
a body match, and covering more of the query beats matching one word
repeatedly. The tokeniser is Unicode-aware: an ASCII-only pattern silently
discards Ethiopic, Cyrillic and CJK text, which made every Amharic memory
unfindable until it was fixed.

**Concurrency is last-writer-wins.** Two clients writing at the same instant
will not corrupt the file, but one snapshot can overwrite the other. Acceptable
for a single person's assistant; not acceptable for a shared service, which
would want the HTTP transport and a real database.

## Tests

```bash
npm run build
node test/drive.mjs        # 39 checks over real stdio, via the MCP SDK client
node test/robustness.mjs   # 12 checks: restart, corruption, unicode, concurrency
```

`drive.mjs` speaks the actual protocol through the actual binary — it is not a
unit test of the store. `robustness.mjs` covers the failure modes that lose
data: a missing directory, a process restart, a corrupt line, five concurrent
writers, and non-Latin text.

## Evaluations

`test/evaluation.xml` holds ten questions answerable only by using the tools —
following a supersede link, cross-referencing file lists across categories,
filtering by scope, counting by kind. Their wording avoids the vocabulary the
memories use, so a single keyword search will not answer them.

```bash
node test/fixture.mjs /tmp/eval-memories.jsonl   # 20-entry fixture store
```

Then point a model at the server with `MEMORY_STORE_PATH=/tmp/eval-memories.jsonl`
and only these tools.

## Limits

- One store, no access control. Anything written is readable by any client
  configured to use it. Do not put secrets in it.
- No embeddings — search is lexical. A memory phrased in entirely different
  words than the query will not be found, which is the argument for writing the
  conclusion into the title.
- `memory_delete` is permanent and has no undo.
