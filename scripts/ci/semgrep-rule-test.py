#!/usr/bin/env python3
"""Prove the repo-owned semgrep rules fire (R6 WP-01).

Each `// ruleid: <id>` comment in .semgrep/fixtures/** marks a line the NEXT line
of which must be reported by <id>; each `// ok: <id>` marks one that must not.
Any missing or extra finding fails. This replaces `semgrep --test`, which
crashes on this repo layout, and it is what makes the SAST gate trustworthy:
a rule that silently stops matching turns this red.
"""
import json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
TESTS = ROOT / ".semgrep" / "fixtures"
RULES = ROOT / ".semgrep" / "timhirt-security.yml"

expected, forbidden = set(), set()
for f in TESTS.rglob("*"):
    if not f.is_file():
        continue
    lines = f.read_text().splitlines()
    for i, line in enumerate(lines):
        m = re.search(r"//\s*(ruleid|ok):\s*([\w-]+)", line)
        if m:
            key = (str(f.relative_to(ROOT)), i + 2, m.group(2))  # annotated line is the next one (1-based)
            (expected if m.group(1) == "ruleid" else forbidden).add(key)

out = subprocess.run(
    ["semgrep", "scan", "--config", str(RULES), "--metrics=off", "--json", "-q", "--no-git-ignore", str(TESTS.relative_to(ROOT))],
    cwd=ROOT, capture_output=True, text=True,
)
# Exit 1 is also what a Python crash gives (CI #176: an import error inside
# semgrep), so a return code alone proves nothing: require a JSON report.
try:
    report = json.loads(out.stdout)
except json.JSONDecodeError:
    report = None
if out.returncode not in (0, 1) or not isinstance(report, dict) or "results" not in report:
    sys.exit(f"semgrep did not produce a report (exit {out.returncode}):\n{out.stderr[-3000:]}")
found = {(r["path"], r["start"]["line"], r["check_id"].split(".")[-1]) for r in report["results"]}

missing = sorted(expected - found)
unexpected = sorted((found - expected) | (found & forbidden))
for p, l, r in missing:
    print(f"MISSING  {r} did not match {p}:{l}")
for p, l, r in unexpected:
    print(f"UNEXPECTED {r} matched {p}:{l}")
if not expected:
    sys.exit("no `ruleid:` annotations found: the fixture proves nothing")
print(f"semgrep rule test: {len(expected)} expected matches, {len(missing)} missing, {len(unexpected)} unexpected")
sys.exit(1 if missing or unexpected else 0)
