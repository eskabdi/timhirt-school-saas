---
description: Run one Work Package through the full subagent verification pipeline.
argument-hint: WP-xx
---
Execute $ARGUMENTS from docs/audits/timhirt-production-fix-plan.md following §0 and §0A exactly:
1. If the WP adds a feature or data flow, run the threat-modeler subagent and add its tests to the plan of work.
2. Run the repo-cartographer subagent; show its "Plan adjustments needed" and continue only with verified names.
3. Implement: failing tests first, then code, migrations and docs.
4. Run the gate commands (§0 Rule 5).
5. Determine triggered reviewers from the diff paths (§0A.3) and the §0A.6 map; run all core and
   triggered reviewer subagents in parallel, giving each only the WP id and the instruction to read
   the plan and the diff themselves.
6. Fix every blocker and major; re-run the failed reviewers plus test-verifier and regression-guardian.
   Stop after 3 rounds and escalate with the open findings.
7. Run release-gatekeeper. Report its summary and stop. Do not start another WP until the human says "next".
