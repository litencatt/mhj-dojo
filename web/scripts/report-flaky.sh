#!/bin/sh
# Prints a GitHub Actions warning for each test of Playwright's JSON report
# (default test-results/results.json, run from web/) that failed and then
# passed on a retry. Nothing is printed when the report is missing.
report="${1:-test-results/results.json}"
[ -f "$report" ] || exit 0
jq -r '.. | objects | select(has("tests") and has("file")) | . as $s | .tests[] | select(.status == "flaky") | "::warning file=web/e2e/\($s.file),line=\($s.line),title=Flaky E2E test::\($s.title) failed, then passed on retry"' "$report"
