#!/usr/bin/env node
/**
 * Writes the fixture store the evaluations run against.
 *
 *   node test/fixture.mjs /tmp/eval-memories.jsonl
 *
 * The entries are drawn from real work on the timhirt-school-saas repo, so the
 * questions in evaluation.xml exercise the kind of recall the server exists
 * for rather than synthetic filler.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rmSync } from "node:fs";

const out = process.argv[2] ?? "/tmp/eval-memories.jsonl";
rmSync(out, { force: true });

const transport = new StdioClientTransport({
  command: "node", args: ["dist/index.js"],
  env: { ...process.env, MEMORY_STORE_PATH: out },
});
const client = new Client({ name: "fixture", version: "1.0.0" });
await client.connect(transport);

const write = async (m) => {
  const r = await client.callTool({ name: "memory_write", arguments: m });
  if (r.isError) throw new Error(`fixture write failed: ${r.content?.[0]?.text}`);
  return r.structuredContent.memory.id;
};

const SAAS = "timhirt-school-saas";

// --- deploy ---------------------------------------------------------------
await write({
  project: SAAS, kind: "incident",
  title: "Eight days of deploys shipped a frozen build artifact",
  body: "Every release between 18 and 26 July uploaded a directory that had been generated once and never refreshed. The command flag meant to disable that behaviour is a boolean, so writing it with an explicit false value still enabled it. The served bundle was missing three rounds of work and the super-admin console had reverted to a pre-redesign layout. Found by grepping the served bundle for strings only the new code contained.",
  tags: ["vercel", "release", "regression"],
  files: ["package.json", "docs/DEPLOYMENT.md"],
});

await write({
  project: SAAS, kind: "incident",
  title: "Locally built bundle had no database credentials and rendered nothing",
  body: "Building on a developer machine cannot read the hosting provider's project settings, so both client environment variables compiled to undefined and the application threw on load with a single line about a missing URL. The fix is to let the build run on the provider's own infrastructure. Detected because the project reference string was absent from the served JavaScript.",
  tags: ["vercel", "environment", "regression"],
  files: ["src/lib/supabase.ts", "docs/DEPLOYMENT.md"],
});

await write({
  project: SAAS, kind: "decision",
  title: "Release goes through a single npm script that clears the artifact directory first",
  body: "Two separate outages traced to the same stale directory, so clearing it became part of the command rather than something to remember. The script also stopped using the bare binary name after it failed on a clean checkout where the executable was not on the path.",
  tags: ["vercel", "release", "tooling"],
  files: ["package.json", "docs/DEPLOYMENT.md"],
});

// --- rate limiting: rejected, then superseded -----------------------------
const upstash = await write({
  project: SAAS, kind: "rejected",
  title: "Managed key-value service turned down for request throttling",
  body: "A hosted counter store was the obvious choice, but the endpoints being throttled already open a database connection on every request. Adding a second managed service meant another vendor, another credential to rotate, and another thing to be down. Rejected on that basis alone; the throughput was never in question.",
  tags: ["rate-limit", "infrastructure"],
  files: ["supabase/functions/_shared/security.ts"],
});

await write({
  project: SAAS, kind: "decision",
  title: "Throttling counters moved into the relational store and made to deny on failure",
  body: "Replaced the per-process counter, which reset on every cold start and let each warm instance enforce its own separate allowance. Correctness was demonstrated by firing 60 simultaneous callers at one key with an allowance of 10: exactly 10 were admitted and 50 refused. Chose to refuse rather than admit when the counter itself is unreachable, since every endpoint behind it needs that same store to do any useful work.",
  tags: ["rate-limit", "concurrency"],
  files: ["supabase/functions/_shared/security.ts", "supabase/migrations/20260726000002_rate_limits.sql"],
  supersedes: upstash,
});

// --- silent-pass class ----------------------------------------------------
await write({
  project: SAAS, kind: "incident",
  title: "Database suite reported success while measuring nothing at all",
  body: "The command line client pads result rows with a leading space, so a pattern anchored to the start of the line never matched a failure marker. The runner therefore reported a clean run no matter what the assertions did. Fixed by switching the client to unaligned tuple-only output and counting successful assertions against the number each file declares up front. Proven by deliberately breaking one file and confirming a non-zero exit.",
  tags: ["testing", "false-negative"],
  files: ["supabase/tests/run.sh"],
});

await write({
  project: SAAS, kind: "incident",
  title: "Throttling smoke test looked broken because traffic left from several addresses",
  body: "25 requests all returned success against an allowance of 20, which read as a failure of the limiter. The counter table showed the requests had been split across two outbound addresses, 13 and 12, so neither key ever reached its ceiling. Sending 60 produced 40 successes and 20 refusals. The lesson is the same as the suite that reported nothing: check the underlying state before believing a result.",
  tags: ["testing", "false-negative", "rate-limit"],
  files: ["supabase/functions/verify-id/index.ts"],
});

// --- constraint bug -------------------------------------------------------
await write({
  project: SAAS, kind: "fact",
  title: "A length check on an empty array yields no value, so the guard it was written for never fires",
  body: "Asking for the extent of a zero-element array returns nothing rather than zero, and a table guard only refuses a row when its condition is definitively false. The guard intended to require at least one entry therefore accepted the empty case it existed to forbid. The counting function returns zero for the same input and behaves correctly. Found by attempting to violate every guard rather than by reading them.",
  tags: ["postgres", "constraints"],
  files: ["supabase/migrations/20260728000001_assignments_and_grading_scales.sql"],
});

// --- label trap -----------------------------------------------------------
await write({
  project: SAAS, kind: "incident",
  title: "Wrapping several controls in one caption element made buttons press each other",
  body: "The shared field wrapper emits a caption element with no explicit target, which implicitly targets the first focusable thing inside it. A chip list plus an add button meant that pressing add also pressed the first chip's remove button and silently discarded a selection, and an upload area opened its file dialog twice. Composite groups now use a wrapper that emits a plain container with an accessible label association instead.",
  tags: ["react", "accessibility"],
  files: ["src/components/ui/Field.tsx", "src/features/assignments/AssignmentFormPage.tsx"],
});

await write({
  project: SAAS, kind: "incident",
  title: "Date component crashed the whole route when handed a timestamp",
  body: "It appended a fixed midnight suffix to every string it received, which is only correct for a bare calendar date. Any column carrying a time of day produced an unparseable value and a range error, which the router turned into a full-page failure screen. Most call sites had independently worked around it by truncating at the call site; three had not. It now accepts a bare date, a full instant, a date object, or nothing, and renders a dash when it cannot parse.",
  tags: ["react", "dates", "regression"],
  files: ["src/components/EthDate.tsx"],
});

// --- i18n -----------------------------------------------------------------
await write({
  project: SAAS, kind: "incident",
  title: "Translation files were re-serialised wholesale, twice",
  body: "Rewriting a translation file with an indenting serialiser produces a diff of roughly fifteen hundred lines that changes no keys and no values. It happened once, was corrected, and then happened again within the same working session by the same person who had corrected it. The second occurrence is the argument for a mechanical guard over a written note.",
  tags: ["i18n", "tooling"],
  files: ["src/locales/en/common.json", "scripts/check-locales.mjs"],
});

await write({
  project: SAAS, kind: "decision",
  title: "Guard rejects a change touching many lines while changing almost no keys",
  body: "The signature of an accidental reformat is precise, so the check does not need a line ceiling that would also block genuine bulk work. A real addition moves the line count and the key count together. Verified in both directions before being trusted.",
  tags: ["i18n", "tooling", "ci"],
  files: ["scripts/check-locales.mjs", ".github/workflows/ci.yml"],
});

await write({
  project: SAAS, kind: "preference",
  title: "Every user-visible string ships in all three supported languages before merge",
  body: "Parity is enforced automatically; whether the wording is right for a school registrar is not something any check can decide and still needs a native speaker with education-domain experience.",
  tags: ["i18n"],
  files: ["scripts/check-locales.mjs"],
});

// --- payments -------------------------------------------------------------
await write({
  project: SAAS, kind: "incident",
  title: "Payment callbacks were all refused because two headers were confused for each other",
  body: "The provider sends one header covering the message body and a second covering the shared secret by itself. The handler preferred the second while comparing it against a digest of the body, so no legitimate callback could ever match and no payment was ever settled. Corrected to verify the body-bound header, and to require it: the other is a constant, so anyone who observes a single delivery could otherwise replay it against a body of their choosing.",
  tags: ["payments", "security", "regression"],
  files: ["supabase/functions/chapa-webhook/index.ts"],
});

await write({
  project: SAAS, kind: "decision",
  title: "Documented guidance overridden where following it would weaken the money path",
  body: "The provider states that either of its two headers is sufficient. Honouring that would permit a downgrade in which an attacker omits the strong header and replays the weak one. Since both are sent on every delivery, requiring the strong one costs nothing and closes it.",
  tags: ["payments", "security"],
  files: ["supabase/functions/chapa-webhook/index.ts"],
});

// --- process --------------------------------------------------------------
await write({
  project: SAAS, kind: "fact",
  title: "One function existed in the repository for days without ever being published",
  body: "Comparing the published list against the source tree revealed a handler that had been written, reviewed and marked complete, but never uploaded. The interface calling it returned not-found the entire time. Nothing surfaced it until the two lists were placed side by side.",
  tags: ["deployment", "process"],
  files: ["supabase/functions/invite-staff/index.ts"],
});

await write({
  project: SAAS, kind: "preference",
  title: "A claim about production is not made until the running system has been observed",
  body: "An assertion that the site had been unreachable for over a week was drawn from two unrepresentative samples and was wrong. Screenshots of the working application disproved it. Sample the live system directly, and prefer several independent signals before generalising.",
  tags: ["process", "verification"],
});

await write({
  project: SAAS, kind: "decision",
  title: "Repository invariants live beside the code, episodic history lives in the memory store",
  body: "A note asserting how a component behaves should stop existing the day that component changes, which only version control can arrange. What was tried and abandoned, and what broke in production, has no such anchor and belongs somewhere durable and searchable instead.",
  tags: ["process", "documentation"],
  files: ["CLAUDE.md"],
});

// --- another project ------------------------------------------------------
await write({
  project: "global", kind: "preference",
  title: "Prove a check can fail before trusting that it passed",
  body: "Three separate green results in one week were measuring nothing. Breaking the thing under test on purpose is the cheapest way to find out whether the check is wired up.",
  tags: ["process", "verification", "testing"],
});

await write({
  project: "personal-site", kind: "decision",
  title: "Static generation chosen over server rendering for a five-page site",
  body: "Traffic is negligible and content changes monthly. Rendering per request would add a running process to maintain for no benefit.",
  tags: ["architecture"],
  files: ["astro.config.mjs"],
});

await client.close();
console.log(`fixture written to ${out}`);
