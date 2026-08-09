#!/usr/bin/env node
// Locale guards. Run: node scripts/check-locales.mjs [baseRef]
//
// Two checks:
//
// 1. PARITY — every key in en must exist in am and om, and neither may carry a
//    key en does not have. This was being run by hand before every commit,
//    which means it was one distraction away from not being run at all.
//
// 2. NO WHOLESALE REFORMAT — the locale files pack whole blocks onto single
//    lines. Rewriting one with a naive `json.dump(..., indent=2)` or
//    `JSON.stringify(..., null, 2)` produces a diff of well over a thousand
//    lines that changes no keys and no values. It is unreviewable, it buries
//    the real change, and it has happened twice.
//
//    The signature is precise: a large line delta with a near-zero key delta.
//    A genuine bulk addition moves both numbers together and passes.
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";

const LOCALES = ["en", "am", "om"];
const NAMESPACES = ["common", "apply", "calendar"];

const flatten = (obj, prefix = "", out = new Map()) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) v.forEach((item, i) => out.set(`${key}[${i}]`, String(item)));
    else if (v && typeof v === "object") flatten(v, key, out);
    else out.set(key, String(v));
  }
  return out;
};

const localePath = (loc, ns) => `src/locales/${loc}/${ns}.json`;
let failed = false;
const fail = (msg) => { console.error(`✗ ${msg}`); failed = true; };

// ---------- 1. Parity ----------
for (const ns of NAMESPACES) {
  const sets = {};
  for (const loc of LOCALES) {
    const p = localePath(loc, ns);
    if (!existsSync(p)) { fail(`${p} is missing`); continue; }
    try { sets[loc] = flatten(JSON.parse(readFileSync(p, "utf8"))); }
    catch (e) { fail(`${p} is not valid JSON: ${e.message}`); }
  }
  if (!sets.en) continue;

  for (const loc of ["am", "om"]) {
    if (!sets[loc]) continue;
    const missing = [...sets.en.keys()].filter((k) => !sets[loc].has(k));
    const extra = [...sets[loc].keys()].filter((k) => !sets.en.has(k));
    if (missing.length) fail(`${loc}/${ns}.json is missing ${missing.length} key(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""}`);
    if (extra.length) fail(`${loc}/${ns}.json has ${extra.length} key(s) not in en: ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? " …" : ""}`);
  }
  if (!failed) console.log(`  ok  ${ns}: ${sets.en.size} keys, parity across ${LOCALES.join("/")}`);
}

// ---------- 2. No wholesale reformat ----------
// Needs a base commit to diff against; skipped when there isn't one (a fresh
// clone with no history, say) rather than failing on something unknowable.
const base = process.argv[2] ?? process.env.LOCALE_DIFF_BASE ?? "HEAD";
const git = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

let numstat = "";
try { numstat = git(`git diff --numstat ${base} -- src/locales/`); }
catch { console.log("  --  reformat check skipped (no usable git base)"); }

const LINE_FLOOR = 40;   // below this, nobody is reformatting anything
const LINES_PER_KEY = 8; // a real change touches a handful of lines per key

for (const row of numstat.split("\n").filter(Boolean)) {
  const [addedRaw, deletedRaw, file] = row.split("\t");
  if (addedRaw === "-" || deletedRaw === "-") continue; // binary
  const lineDelta = Number(addedRaw) + Number(deletedRaw);
  if (lineDelta < LINE_FLOOR) continue;

  let before;
  try { before = flatten(JSON.parse(git(`git show ${base}:${file}`))); }
  catch { continue; } // new file — nothing to compare against
  const after = flatten(JSON.parse(readFileSync(file, "utf8")));

  let keyDelta = 0;
  for (const [k, v] of after) if (!before.has(k) || before.get(k) !== v) keyDelta++;
  for (const k of before.keys()) if (!after.has(k)) keyDelta++;

  if (lineDelta > LINES_PER_KEY * Math.max(keyDelta, 1)) {
    fail(
      `${file}: ${lineDelta} lines changed but only ${keyDelta} key(s) differ.\n`
      + `    That is a wholesale reformat, not an edit. These files keep whole\n`
      + `    blocks on one line — insert into the existing line instead of\n`
      + `    re-serialising the file (no json.dump / JSON.stringify(…, null, 2)).\n`
      + `    If the reformat is deliberate, run with a higher base or bypass this check.`,
    );
  } else {
    console.log(`  ok  ${file}: ${lineDelta} lines / ${keyDelta} keys changed`);
  }
}

if (failed) { console.error("\nlocale checks FAILED"); process.exit(1); }
console.log("locale checks passed");
