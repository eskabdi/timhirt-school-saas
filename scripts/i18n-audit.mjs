#!/usr/bin/env node
// Flags user-facing English text that isn't going through i18n.
// Run: node scripts/i18n-audit.mjs [--list]
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOTS = ["src/features", "src/components", "src/app"];
// Primitives and guards render no copy of their own.
const SKIP = [
  "src/components/ui/", "src/features/auth/Require", "src/app/router.tsx",
  "src/features/reports/ReportComponents.tsx",
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

// Two or more letters, at least one space or a capitalized word — i.e. prose,
// not a css class fragment or an identifier.
const looksLikeCopy = (s) => {
  const t = s.trim();
  if (t.length < 2) return false;
  if (!/[A-Za-z]{2}/.test(t)) return false;              // needs letters
  if (/^[a-z0-9_.\-/[\]#{}()*:,%\s]+$/.test(t) && !/\s[A-Z]/.test(t)) return false; // css-ish / keys
  if (/^(px|rem|em|vh|vw|auto|none|flex|grid|block|hidden|true|false)$/i.test(t)) return false;
  // Format samples shown as placeholders (EMP-001, ADM-2018-001, +251911223344)
  // are identifier shapes, not prose — translating them would be wrong.
  if (/^[A-Z]{2,}[-/][A-Z0-9-]+$/.test(t)) return false;
  return /[A-Z]/.test(t) || /\s/.test(t);
};

const findings = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (SKIP.some((s) => file.startsWith(s) || file.includes(s))) continue;
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      const n = i + 1;
      const bare = line.trim();
      if (bare.startsWith("//") || bare.startsWith("*") || bare.startsWith("/*")) return;

      // TypeScript generics (`Record<string, string>`, `Map<a, b>`) and arrow
      // return types look like JSX text to the pattern below; skip declaration
      // lines outright.
      const isTypeLine = /^(export\s+)?(interface|type)\s/.test(bare)
        || /[?]?:\s*\(?[^=]*=>/.test(bare)
        || /^\w+\??:\s/.test(bare);

      // 1. JSX text nodes:  >Some Text<
      if (!isTypeLine) {
        for (const m of line.matchAll(/>([^<>{}\n]+)</g)) {
          const txt = m[1];
          // `=> Foo<` is an arrow returning a generic, not markup.
          if (line[m.index - 1] === "=") continue;
          // `a >= b && c <= d` — a comparison pair, not a JSX text node.
          if (txt.startsWith("=")) continue;
          if (looksLikeCopy(txt) && !/^\s*[{}]/.test(txt)) findings.push({ file, n, kind: "jsx-text", txt: txt.trim() });
        }
      }
      // 2. User-facing string attributes
      for (const m of line.matchAll(/\b(placeholder|title|label|aria-label|alt)=["']([^"'{}]+)["']/g)) {
        if (looksLikeCopy(m[2])) findings.push({ file, n, kind: `attr:${m[1]}`, txt: m[2] });
      }
      // 3. Literal strings passed to obvious copy props
      for (const m of line.matchAll(/\b(?:label|title|heading|emptyText|confirmText)[:=]\s*["']([^"']{3,})["']/g)) {
        if (looksLikeCopy(m[1])) findings.push({ file, n, kind: "prop", txt: m[1] });
      }
      // 4. Prose wrapped across several lines inside JSX (the single-line `>x<`
      //    pattern above cannot see it). A bare line of words with no JSX or JS
      //    punctuation is copy that never reached i18n.
      if (!isTypeLine
        && /^[A-Za-z][A-Za-z0-9 ,.'’&()/%:-]{14,}$/.test(bare)
        && bare.split(/\s+/).length >= 4
        && !/[={};]/.test(bare)
        // A wrapped destructuring / import list is identifiers and commas, not prose.
        && !/^(type\s+)?[A-Za-z_$][\w$]*(\s+as\s+[A-Za-z_$][\w$]*)?(\s*,\s*(type\s+)?[A-Za-z_$][\w$]*(\s+as\s+[A-Za-z_$][\w$]*)?)+\s*,?$/.test(bare)
        && !/^(import|export|const|let|var|return|function|type|interface)\b/.test(bare)) {
        findings.push({ file, n, kind: "jsx-prose", txt: bare });
      }
    });
  }
}

// The attr and prop patterns both match `label="…"`; count each string once.
const seen = new Set();
const unique = findings.filter((f) => {
  const k = `${f.file}:${f.n}:${f.txt}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
findings.length = 0;
findings.push(...unique);

const byFile = new Map();
for (const f of findings) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1]);

if (process.argv.includes("--list")) {
  const only = process.argv[process.argv.indexOf("--list") + 1];
  for (const f of findings) if (!only || f.file.includes(only)) console.log(`${f.file}:${f.n}  [${f.kind}]  ${f.txt}`);
} else {
  for (const [file, count] of sorted) console.log(String(count).padStart(4), file);
}
console.log(`\nTOTAL ${findings.length} hardcoded strings across ${byFile.size} files`);
process.exit(findings.length ? 1 : 0);
