#!/usr/bin/env bash
# 2026-08-26 — Resume OpenWiki v0.4 page-job runs, then one Claims update.
# Usage (parent git workspace with sibling clones):
#   bash /Users/manik/Github/openwiki/static/overviews/multi-repo-climb.sh
# Env: MAX_ROUNDS (default 12), WIKI_DIR (default openwiki), BRIEF (INSTRUCTIONS template)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BRIEF="${BRIEF:-$ROOT/INSTRUCTIONS.multi-repo.md}"
MAX_ROUNDS="${MAX_ROUNDS:-12}"
WIKI_DIR="${WIKI_DIR:-openwiki}"
RUN_STATE="$WIKI_DIR/.run.json"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "cwd must be a git repository (OpenWiki fingerprints HEAD and repo:// Claims)." >&2
  exit 1
fi

mkdir -p "$WIKI_DIR"
if [[ ! -f "$WIKI_DIR/INSTRUCTIONS.md" ]]; then
  if [[ ! -f "$BRIEF" ]]; then
    echo "missing INSTRUCTIONS template: $BRIEF" >&2
    exit 1
  fi
  cp "$BRIEF" "$WIKI_DIR/INSTRUCTIONS.md"
  echo "wrote $WIKI_DIR/INSTRUCTIONS.md from template; edit it before a serious run"
fi

run_mode_from_checkpoint() {
  if [[ ! -f "$RUN_STATE" ]]; then
    echo ""
    return
  fi
  node -e "const s=require('node:fs').readFileSync(process.argv[1],'utf8'); process.stdout.write(JSON.parse(s).mode === 'update' ? 'update' : 'init')" "$RUN_STATE"
}

next_command() {
  local checkpoint_mode
  checkpoint_mode="$(run_mode_from_checkpoint)"
  if [[ -n "$checkpoint_mode" ]]; then
    echo "$checkpoint_mode"
    return
  fi
  if [[ ! -f "$WIKI_DIR/quickstart.md" ]]; then
    echo "init"
    return
  fi
  echo "update"
}

finished_without_checkpoint=0
cmd="$(next_command)"

for ((round = 1; round <= MAX_ROUNDS; round++)); do
  echo "round $round: openwiki --$cmd --print"
  openwiki --"$cmd" --print

  if [[ -f "$RUN_STATE" ]]; then
    cmd="$(run_mode_from_checkpoint)"
    finished_without_checkpoint=0
    continue
  fi

  if [[ "$cmd" == "init" ]]; then
    cmd="update"
    finished_without_checkpoint=0
    continue
  fi

  finished_without_checkpoint=1
  echo "climb finished after round $round (update completed, no $RUN_STATE)"
  exit 0
done

if [[ "$finished_without_checkpoint" -eq 1 ]]; then
  exit 0
fi

echo "max rounds reached; inspect $RUN_STATE" >&2
exit 2
