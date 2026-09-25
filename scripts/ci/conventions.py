#!/usr/bin/env python3
"""Project-convention gate (fix plan §0 Rule 8, R6 WP-01; enforced from WP-14).

Checks src/ and supabase/functions/ for:
  geez-digit   Ge'ez numerals U+1369..U+137C. The owner's rule is Arabic
               numerals only, EC dates included.
  currency     A non-ETB currency: `USD`, `US$`, or `$<digit>` in a string/JSX
               (template-literal `${` is not currency).
  name-concat  `first_name} ${...last_name` concatenation that skips the middle
               name (Ethiopian names are First + Middle + Last).

Default mode is REPORT-ONLY (exit 0, prints the counts). `--strict` exits 1 on
any finding; WP-14 turns --strict on in CI once the known findings are fixed.
"""
import os, re, sys

ROOTS = ["src", "supabase/functions"]
EXTS = (".ts", ".tsx", ".json")
CHECKS = {
    "geez-digit": re.compile("[፩-፼]"),
    "currency": re.compile(r"\bUSD\b|US\$|(?<![{$\w])\$\s?\d"),
    "name-concat": re.compile(r"first_name\}?\s*\$\{[^}]*last_name|firstName\}?\s*\$\{[^}]*lastName"),
}

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
findings = []
for base in ROOTS:
    for dp, _, files in os.walk(os.path.join(root, base)):
        if "node_modules" in dp:
            continue
        for f in files:
            if not f.endswith(EXTS):
                continue
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, root)
            with open(p, encoding="utf-8") as fh:
                for i, line in enumerate(fh, 1):
                    for name, rx in CHECKS.items():
                        if rx.search(line):
                            findings.append((name, rel, i, line.strip()[:120]))

for name in CHECKS:
    hits = [x for x in findings if x[0] == name]
    print(f"{name:12} {len(hits)}")
    for _, rel, i, text in hits:
        print(f"    {rel}:{i}: {text}")
strict = "--strict" in sys.argv
print(f"conventions: {len(findings)} finding(s), mode={'strict' if strict else 'report-only'}")
sys.exit(1 if strict and findings else 0)
