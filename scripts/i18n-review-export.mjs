#!/usr/bin/env node
// Exports every translated string as a side-by-side CSV for human review.
//
// Parity checks and the hardcoded-string audit prove that a key exists in all
// three locales and that no English leaked into the UI. Neither can tell you
// whether the Amharic for "provisionally accepted" is the word an Ethiopian
// registrar would use, or whether an Afaan Oromoo label reads as a command when
// it should read as a heading. That needs a person, and a person needs the
// strings in front of them in a form they can work through and annotate.
//
// Run:  node scripts/i18n-review-export.mjs [outfile.csv]
// Default output: i18n-review.csv (git-ignored; it is a work product, not source)
import { readFileSync, writeFileSync, existsSync } from "fs";

const LOCALES = ["en", "am", "om"];
const NAMESPACES = ["common", "apply", "calendar"];

const flatten = (obj, prefix = "", out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) v.forEach((item, i) => { out[`${key}[${i}]`] = String(item); });
    else if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
};

// Excel and Sheets both need CRLF plus quote-doubling to keep Ethiopic text and
// embedded commas intact.
const cell = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;

const rows = [["namespace", "key", "english", "amharic", "afaan_oromoo", "reviewer_note"]];
let total = 0;

for (const ns of NAMESPACES) {
  const loaded = {};
  for (const loc of LOCALES) {
    const path = `src/locales/${loc}/${ns}.json`;
    if (!existsSync(path)) { loaded[loc] = {}; continue; }
    loaded[loc] = flatten(JSON.parse(readFileSync(path, "utf8")));
  }
  for (const key of Object.keys(loaded.en).sort()) {
    rows.push([ns, key, loaded.en[key], loaded.am[key] ?? "", loaded.om[key] ?? "", ""]);
    total++;
  }
}

const outfile = process.argv[2] ?? "i18n-review.csv";
// BOM so Excel opens Ethiopic as UTF-8 rather than mojibake.
writeFileSync(outfile, "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), "utf8");

console.log(`Wrote ${total} strings across ${NAMESPACES.length} namespaces to ${outfile}`);
console.log("Give this to a native speaker with education-domain experience.");
console.log("Corrections go in the reviewer_note column; apply them to src/locales/<loc>/<ns>.json.");
