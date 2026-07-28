// Confirms every answer in evaluation.xml is reachable through the tools alone.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const t = new StdioClientTransport({ command: "node", args: ["dist/index.js"],
  env: { ...process.env, MEMORY_STORE_PATH: "/tmp/eval-memories.jsonl" } });
const c = new Client({ name: "ev", version: "1.0.0" }); await c.connect(t);
const call = async (n,a) => (await c.callTool({name:n,arguments:a})).structuredContent;
let ok=0, bad=0;
const eq = (q,got,want) => { const p = String(got)===String(want);
  console.log(`  ${p?"ok  ":"FAIL"} Q${q}: got ${got}, want ${want}`); p?ok++:bad++; };

// Q1 — follow the supersede link
const sup = await call("memory_search", { query:"turned down abandoned approach throttling", include_superseded:true, kind:"rejected", response_format:"json" });
const replId = sup.items[0].superseded_by;
const repl = await call("memory_get", { id: replId, response_format:"json" });
eq(1, /(\d+) simultaneous callers/.exec(repl.memory.body)?.[1], 60);

// Q2 — file across three kinds
const all = await call("memory_list", { limit:100, include_superseded:true, response_format:"json" });
const byFile = new Map();
for (const m of all.items) for (const f of m.files) { (byFile.get(f) ?? byFile.set(f,new Set()).get(f)).add(m.kind); }
const three = [...byFile.entries()].filter(([,k])=>k.size>=3);
eq(2, three.length===1 ? three[0][0] : `${three.length} matches`, "scripts/check-locales.mjs");

// Q3 — refusals
const fn = await call("memory_search", { query:"addresses split traffic ceiling", response_format:"json" });
eq(3, /40 successes and (\d+) refusals/.exec(fn.items[0].body)?.[1], 20);

// Q4 — migration path
const guard = await call("memory_search", { query:"array element guard never refused", response_format:"json" });
eq(4, guard.items[0].files[0], "supabase/migrations/20260728000001_assignments_and_grading_scales.sql");

// Q5 — other projects
const st = await call("memory_stats", { response_format:"json" });
eq(5, Object.entries(st.by_project).filter(([p])=>p!=="timhirt-school-saas").reduce((n,[,v])=>n+v,0), 2);

// Q6 — incident count
eq(6, st.by_kind.incident, 8);

// Q7 — date component file
const dates = await call("memory_search", { query:"component rendering dates broke route", response_format:"json" });
eq(7, dates.items[0].files[0], "src/components/EthDate.tsx");

// Q8 — wrapper file
const fld = await call("memory_search", { query:"wrapper control activated another grouped", response_format:"json" });
eq(8, fld.items[0].files[0], "src/components/ui/Field.tsx");

// Q9 — handler named by both
const pay = await call("memory_search", { query:"outside provider guidance not followed weaker check", response_format:"json" });
eq(9, pay.items[0].files[0], "supabase/functions/chapa-webhook/index.ts");

// Q10 — excluding superseded
const live = await call("memory_list", { limit:100, response_format:"json" });
eq(10, live.total, 19);

await c.close();
console.log(`\n${ok} answers verified, ${bad} failed`);
process.exit(bad?1:0);
