#!/usr/bin/env python3
"""Project-convention gate (fix plan §0 Rule 8; R6 WP-01, strict since R6).

Checks tracked source (src/, supabase/functions/, supabase/migrations/,
index.html) for:
  geez-digit   Ge'ez numerals U+1369..U+137C. The owner's rule is Arabic
               numerals only (0-9, or the opt-in Eastern Arabic ٠-٩), EC dates
               included.
  currency     A non-ETB currency: USD/EUR/GBP, US$, `$<digit>`, `$${`, or an
               Intl `currency:` other than ETB.
  name-concat  A person name built from first + last without the middle name
               (Ethiopian names are First + Middle + Last): template
               `${a.first_name} ${a.last_name}`, JSX `{a.first_name} {a.last_name}`,
               `first_name + " " + last_name`, or `[first_name, last_name].join`.
               Use fullName() from src/lib/names.ts or _shared/names.ts.

Exit 1 on any finding. `--self-test` runs the checks against
scripts/ci/conventions_fixtures.txt, where every line starting `BAD` must be
flagged and every line starting `OK` must not.
"""
import os, re, sys

ROOTS = ["src", "supabase/functions", "supabase/migrations"]
FILES = ["index.html"]
EXTS = (".ts", ".tsx", ".js", ".mjs", ".json", ".sql", ".css", ".html")

NAME = r"(?:first_name|firstName)"
LAST = r"(?:last_name|lastName)"
CHECKS = {
    "geez-digit": re.compile("[\u1369-\u137C]"),
    "currency": re.compile(
        r"\b(?:USD|EUR|GBP)\b|US\$|\$\$\{|(?<![{$\w\\])\$\s?\d(?!\d*\s*\))|currency:\s*[\"'](?!ETB)[A-Za-z]{3}[\"']",
        re.I),
    "name-concat": re.compile(
        rf"{NAME}\}}?\s*\$\{{[^}}]*{LAST}"            # template literal
        rf"|{NAME}\}}\s*\{{[^}}]*{LAST}\}}"           # JSX
        rf"|{NAME}\s*\+\s*[\"'] [\"']\s*\+[^;\n]*{LAST}"  # string concat
        rf"|\[[^\]\n]*{NAME}[^\]\n]*{LAST}[^\]\n]*\]\s*\.(?:filter|join)"),
}
# `.replace(/x/, "$1")` back-references are not money.
REPLACE_BACKREF = re.compile(r"\.replace\(.*[\"']\$\d")


def scan_line(line):
    hits = []
    for name, rx in CHECKS.items():
        if not rx.search(line):
            continue
        if name == "currency" and REPLACE_BACKREF.search(line) and not re.search(r"\b(?:USD|EUR|GBP)\b|US\$|currency:", line, re.I):
            continue
        if name == "name-concat" and re.search(r"middle_name|middleName|father_name|fatherName", line):
            continue
        hits.append(name)
    return hits


def self_test(root):
    path = os.path.join(root, "scripts", "ci", "conventions_fixtures.txt")
    bad = 0
    for i, line in enumerate(open(path, encoding="utf-8"), 1):
        if not line.startswith(("BAD ", "OK ")):
            continue
        kind, text = line.split(" ", 1)
        hits = scan_line(text)
        if (kind == "BAD") != bool(hits):
            print(f"self-test line {i}: expected {kind}, got {hits or 'no finding'}: {text.strip()}")
            bad += 1
    print(f"conventions self-test: {'ok' if not bad else f'{bad} FAILED'}")
    return 1 if bad else 0


def main():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if "--self-test" in sys.argv:
        sys.exit(self_test(root))
    paths = [os.path.join(root, f) for f in FILES if os.path.exists(os.path.join(root, f))]
    for base in ROOTS:
        for dp, _, files in os.walk(os.path.join(root, base)):
            if "node_modules" in dp:
                continue
            paths += [os.path.join(dp, f) for f in files if f.endswith(EXTS)]
    findings = []
    for p in sorted(paths):
        rel = os.path.relpath(p, root)
        with open(p, encoding="utf-8") as fh:
            for i, line in enumerate(fh, 1):
                for name in scan_line(line):
                    findings.append((name, rel, i, line.strip()[:120]))
    for name in CHECKS:
        hits = [x for x in findings if x[0] == name]
        print(f"{name:12} {len(hits)}")
        for _, rel, i, text in hits:
            print(f"    {rel}:{i}: {text}")
    print(f"conventions: {len(findings)} finding(s)")
    sys.exit(1 if findings else 0)


if __name__ == "__main__":
    main()
