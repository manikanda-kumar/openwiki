#!/usr/bin/env bash
# 2026-08-26 — Outer hill-climb loop for OpenWiki multi-repo docs.
# Usage (from the parent workspace that contains sibling clones):
#   bash /Users/manik/Github/openwiki/static/overviews/multi-repo-climb.sh
# Requires: openwiki on PATH, this prompt markdown beside the script or in BRIEF.

set -euo pipefail

BRIEF="${BRIEF:-$(cd "$(dirname "$0")" && pwd)/multi-repo-code-init-prompt.md}"
MAX_ROUNDS="${MAX_ROUNDS:-8}"
WIKI_DIR="${WIKI_DIR:-openwiki}"

if [[ ! -f "$BRIEF" ]]; then
  echo "missing brief: $BRIEF" >&2
  exit 1
fi

# Inner brief is everything from the agent-facing heading down.
extract_brief() {
  sed -n '/^## Inner brief/,$p' "$BRIEF"
}

round_status() {
  local log="$WIKI_DIR/climb-log.md"
  if [[ ! -f "$log" ]]; then
    echo "missing"
    return
  fi
  if grep -q '^RETURN: pass' "$log"; then
    echo "pass"
    return
  fi
  echo "continue"
}

if [[ ! -f "$WIKI_DIR/quickstart.md" ]]; then
  echo "round 0: init"
  openwiki code --init --print "$(extract_brief)"
fi

for ((round = 1; round <= MAX_ROUNDS; round++)); do
  status="$(round_status)"
  if [[ "$status" == "pass" ]]; then
    echo "climb passed at round $((round - 1))"
    exit 0
  fi
  echo "round $round: update ($status)"
  openwiki code --update --print "$(extract_brief)

This is outer harness round $round of $MAX_ROUNDS. Read /openwiki/climb-log.md and /openwiki/gaps.md first. Continue the climb; do not restart from scratch. If the critic is clean and the success predicate holds, write RETURN: pass. Otherwise RETURN: continue with the next three targets."
done

echo "max rounds reached; see $WIKI_DIR/climb-log.md" >&2
exit 2
