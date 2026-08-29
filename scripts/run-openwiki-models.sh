#!/usr/bin/env bash
# 2026-08-29 — Background OpenWiki --init/--update across models on any git repo.
# Isolates each model in a git worktree + OPENWIKI_CONFIG_DIR so the live tree
# and ~/.openwiki/.env are never overwritten.
#
# Usage:
#   scripts/run-openwiki-models.sh launch --repo /path/to/repo
#   scripts/run-openwiki-models.sh --models qwen3.8-flash,glm-5.3-flash status
#   scripts/run-openwiki-models.sh kill --repo ~/src/app
#
# Env (secrets never taken as flags):
#   OPENCODE_GO_API_KEY | OPENCODE_API_KEY | OPENAI_COMPATIBLE_API_KEY
#   OPENAI_COMPATIBLE_BASE_URL   default https://opencode.ai/zen/go/v1
#   OPENWIKI_CLI                 path to cli.js or openwiki binary
#   OPENWIKI_MAX_OUTPUT_TOKENS   default 4096
#   OPENWIKI_PROVIDER_RETRY_ATTEMPTS  default 2
#   NO_STREAM_MODELS             comma list; default glm-5.3-flash
#   MODEL_TIMEOUT_SECONDS        default 1200
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION="launch"
SOURCE_REPO=""
if [[ -n "${MODELS:-}" ]]; then
  MODELS_CSV="$MODELS"
  MODELS_EXPLICIT=1
else
  MODELS_CSV="qwen3.8-flash,glm-5.3-flash,deepseek-v4-flash"
  MODELS_EXPLICIT=0
fi
OUT_ROOT=""
CLI="${OPENWIKI_CLI:-}"
MODEL_TIMEOUT_SECONDS="${MODEL_TIMEOUT_SECONDS:-1200}"
PARALLEL="${PARALLEL:-1}"
TMUX_PREFIX=""
DRY_RUN=0
RESUME=0
OW_COMMAND="init"
DEBUG="${OPENWIKI_DEBUG:-1}"
MAX_OUTPUT_TOKENS="${OPENWIKI_MAX_OUTPUT_TOKENS:-4096}"
RETRY_ATTEMPTS="${OPENWIKI_PROVIDER_RETRY_ATTEMPTS:-2}"
PROVIDER="${OPENWIKI_PROVIDER:-openai-compatible}"
BASE_URL="${OPENAI_COMPATIBLE_BASE_URL:-https://opencode.ai/zen/go/v1}"
NO_STREAM_MODELS="${NO_STREAM_MODELS:-glm-5.3-flash}"
API_KEY="${OPENCODE_GO_API_KEY:-${OPENCODE_API_KEY:-${OPENAI_COMPATIBLE_API_KEY:-}}}"

usage() {
  cat <<'EOF'
Usage: run-openwiki-models.sh [action] [options] [repo]

Background OpenWiki generation for one git repo across one or more models.
Each model gets its own git worktree and OPENWIKI_CONFIG_DIR under
  $TMPDIR/openwiki-runs/<repo-slug>/<model>
The live working tree is not modified.

Actions:
  launch     start tmux sessions and return (default)
  monitor    poll until sessions finish or timeout
  status     one-shot status lines
  kill       stop sessions and matching openwiki processes
  all        launch then monitor
  help       this message

Options:
  --repo PATH          git repo to document (default: cwd)
  --models LIST        comma-separated model ids
  --out DIR            parent directory for worktrees
  --cli PATH           openwiki cli.js or binary
  --timeout SEC        per-model timeout (default 1200)
  --prefix NAME        tmux session prefix (default ow-<repo-slug>)
  --init               openwiki --init (default)
  --update             openwiki --update
  --resume             keep existing openwiki/ in the worktree
  --sequential         run models one at a time (no tmux)
  --dry-run            print resolved plan; do not start anything
  -h, --help

Examples:
  run-openwiki-models.sh launch --repo ../background-agents
  run-openwiki-models.sh --models qwen3.8-flash launch ~/src/app
  PARALLEL=0 run-openwiki-models.sh all --repo .

Retry: missing key → export OPENCODE_GO_API_KEY=... (or OPENAI_COMPATIBLE_API_KEY)
       missing CLI → pnpm run build  or  export OPENWIKI_CLI=$(command -v openwiki)
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

is_action() {
  case "$1" in
    launch|monitor|status|kill|all|help) return 0 ;;
    *) return 1 ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --repo)
      [[ $# -ge 2 ]] || die "--repo requires PATH. Retry: --repo /path/to/repo"
      SOURCE_REPO="$2"
      shift 2
      ;;
    --repo=*) SOURCE_REPO="${1#--repo=}"; shift ;;
    --models)
      [[ $# -ge 2 ]] || die "--models requires a comma-separated list."
      MODELS_CSV="$2"
      MODELS_EXPLICIT=1
      shift 2
      ;;
    --models=*) MODELS_CSV="${1#--models=}"; MODELS_EXPLICIT=1; shift ;;
    --out)
      [[ $# -ge 2 ]] || die "--out requires DIR."
      OUT_ROOT="$2"
      shift 2
      ;;
    --out=*) OUT_ROOT="${1#--out=}"; shift ;;
    --cli)
      [[ $# -ge 2 ]] || die "--cli requires PATH."
      CLI="$2"
      shift 2
      ;;
    --cli=*) CLI="${1#--cli=}"; shift ;;
    --timeout)
      [[ $# -ge 2 ]] || die "--timeout requires SEC."
      MODEL_TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --timeout=*) MODEL_TIMEOUT_SECONDS="${1#--timeout=}"; shift ;;
    --prefix)
      [[ $# -ge 2 ]] || die "--prefix requires NAME."
      TMUX_PREFIX="$2"
      shift 2
      ;;
    --prefix=*) TMUX_PREFIX="${1#--prefix=}"; shift ;;
    --init) OW_COMMAND="init"; shift ;;
    --update) OW_COMMAND="update"; shift ;;
    --resume) RESUME=1; shift ;;
    --sequential) PARALLEL=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --debug) DEBUG=1; shift ;;
    --no-debug) DEBUG=0; shift ;;
    --) shift; break ;;
    -*) die "unknown option $1. Retry: run-openwiki-models.sh --help" ;;
    *)
      if is_action "$1"; then
        ACTION="$1"
      elif [[ -z "$SOURCE_REPO" ]]; then
        SOURCE_REPO="$1"
      else
        die "unexpected argument $1. Retry: run-openwiki-models.sh --help"
      fi
      shift
      ;;
  esac
done

if [[ "$ACTION" == "help" ]]; then
  usage
  exit 0
fi

IFS=',' read -r -a MODELS <<<"$MODELS_CSV"
cleaned=()
for m in "${MODELS[@]}"; do
  m="${m#"${m%%[![:space:]]*}"}"
  m="${m%"${m##*[![:space:]]}"}"
  [[ -n "$m" ]] && cleaned+=("$m")
done
MODELS=("${cleaned[@]}")
[[ ${#MODELS[@]} -gt 0 ]] || die "no models. Retry: --models qwen3.8-flash"

SOURCE_REPO="${SOURCE_REPO:-.}"
if [[ ! -d "$SOURCE_REPO" ]]; then
  die "repo is not a directory: $SOURCE_REPO. Retry: --repo /path/to/git/repo"
fi
SOURCE_REPO="$(cd "$SOURCE_REPO" && pwd)"
git -C "$SOURCE_REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || die "cwd/repo must be a git repository (OpenWiki fingerprints HEAD). Retry: --repo /path/to/git/repo"
SOURCE_REPO="$(cd "$SOURCE_REPO" && git rev-parse --show-toplevel)"
REPO_SLUG="$(basename "$SOURCE_REPO")"

resolve_cli() {
  local candidate
  if [[ -n "$CLI" ]]; then
    candidate="$CLI"
  elif [[ -f "$SCRIPT_DIR/../dist/cli/cli.js" ]]; then
    candidate="$SCRIPT_DIR/../dist/cli/cli.js"
  elif command -v openwiki >/dev/null 2>&1; then
    candidate="$(command -v openwiki)"
  else
    die "OpenWiki CLI not found. Retry: pnpm run build, or export OPENWIKI_CLI=\$(command -v openwiki)"
  fi
  if [[ -d "$candidate" ]]; then
    die "OPENWIKI_CLI is a directory: $candidate"
  fi
  if [[ ! -e "$candidate" ]]; then
    die "OpenWiki CLI not found at $candidate"
  fi
  CLI="$candidate"
}

cli_invoke() {
  if [[ "$CLI" == *.js ]]; then
    printf 'node %q' "$CLI"
  else
    printf '%q' "$CLI"
  fi
}

streaming_for_model() {
  local model="$1"
  local item
  IFS=',' read -r -a off <<<"$NO_STREAM_MODELS"
  for item in "${off[@]}"; do
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    if [[ "$item" == "$model" ]]; then
      echo false
      return
    fi
  done
  echo true
}

path_safe() {
  printf '%s' "$1" | tr '/:' '--'
}

tmux_safe() {
  printf '%s' "$1" | tr '.:/' '---'
}

if [[ -z "$OUT_ROOT" ]]; then
  # Prefer /tmp over $TMPDIR so worktrees are easy to find on macOS.
  OUT_ROOT="/tmp/openwiki-runs/${REPO_SLUG}"
fi
OUT_ROOT="$(python3 -c 'import os,sys; print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$OUT_ROOT")"

if [[ -z "$TMUX_PREFIX" ]]; then
  TMUX_PREFIX="ow-$(tmux_safe "$REPO_SLUG")"
fi

work_dir_for() {
  echo "${OUT_ROOT}/$(path_safe "$1")"
}

session_name() {
  echo "${TMUX_PREFIX}-$(tmux_safe "$1")"
}

config_dir_for() {
  echo "$(work_dir_for "$1")/.openwiki-config"
}

log_dir_for() {
  echo "$(work_dir_for "$1")/logs"
}

same_git_repo() {
  local a b
  a="$(git -C "$1" rev-parse --git-common-dir 2>/dev/null)" || return 1
  b="$(git -C "$SOURCE_REPO" rev-parse --git-common-dir 2>/dev/null)" || return 1
  [[ "$(cd "$1" && python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$a")" == \
     "$(cd "$SOURCE_REPO" && python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$b")" ]]
}

ensure_worktree() {
  local model="$1"
  local work_dir
  work_dir="$(work_dir_for "$model")"
  mkdir -p "$(dirname "$work_dir")"
  if [[ -e "$work_dir" ]]; then
    if git -C "$work_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 && same_git_repo "$work_dir"; then
      mkdir -p "$(log_dir_for "$model")"
      return 0
    fi
    die "worktree path exists and is not this repo: $work_dir. Retry: --out DIR"
  fi
  git -C "$SOURCE_REPO" worktree add --detach "$work_dir" HEAD
  mkdir -p "$(log_dir_for "$model")"
}

strip_openwiki_markers() {
  local work_dir="$1"
  python3 - "$work_dir" <<'PY'
import sys
from pathlib import Path
root = Path(sys.argv[1])
start = "<!-- OPENWIKI:START -->"
end = "<!-- OPENWIKI:END -->"
for name in ("AGENTS.md", "CLAUDE.md"):
    path = root / name
    if path.is_symlink():
        target = path.readlink()
        path.unlink()
        src = (root / target) if not Path(str(target)).is_absolute() else Path(target)
        if src.exists():
            path.write_text(src.read_text())
        elif name == "CLAUDE.md" and (root / "AGENTS.md").exists():
            path.write_text((root / "AGENTS.md").read_text())
    if not path.exists():
        continue
    text = path.read_text()
    while start in text:
        before, _, rest = text.partition(start)
        _, sep, after = rest.partition(end)
        text = before.rstrip() + ("\n" + after.lstrip("\n") if sep else "\n" + rest)
    text = text.replace(end, "")
    path.write_text(text.rstrip() + "\n")
PY
}

env_quote() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
}

write_config() {
  local model="$1"
  local config_dir streaming
  config_dir="$(config_dir_for "$model")"
  streaming="$(streaming_for_model "$model")"
  mkdir -p "$config_dir"
  umask 077
  cat >"${config_dir}/.env" <<EOF
# Per-model OpenWiki state (do not reuse ~/.openwiki)
OPENWIKI_PROVIDER=$(env_quote "$PROVIDER")
OPENAI_COMPATIBLE_BASE_URL=$(env_quote "$BASE_URL")
OPENAI_COMPATIBLE_API_KEY=$(env_quote "$API_KEY")
OPENWIKI_MODEL_ID=$(env_quote "$model")
OPENWIKI_TELEMETRY_DISABLED="1"
OPENWIKI_OPENAI_COMPATIBLE_STREAMING=$(env_quote "$streaming")
OPENWIKI_MAX_OUTPUT_TOKENS=$(env_quote "$MAX_OUTPUT_TOKENS")
OPENWIKI_PROVIDER_RETRY_ATTEMPTS=$(env_quote "$RETRY_ATTEMPTS")
EOF
  chmod 600 "${config_dir}/.env"
}

write_manifest() {
  mkdir -p "$OUT_ROOT"
  cat >"${OUT_ROOT}/manifest" <<EOF
repo=${SOURCE_REPO}
slug=${REPO_SLUG}
models=${MODELS_CSV}
prefix=${TMUX_PREFIX}
cli=${CLI}
command=${OW_COMMAND}
base_url=${BASE_URL}
provider=${PROVIDER}
out=${OUT_ROOT}
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
}

load_manifest_models_if_needed() {
  local manifest="${OUT_ROOT}/manifest"
  [[ -f "$manifest" ]] || return 0
  local saved prefix_saved
  if [[ "$MODELS_EXPLICIT" -eq 0 ]]; then
    saved="$(awk -F= '/^models=/{print substr($0,8)}' "$manifest")"
    if [[ -n "$saved" ]]; then
      MODELS_CSV="$saved"
      IFS=',' read -r -a MODELS <<<"$MODELS_CSV"
    fi
  fi
  prefix_saved="$(awk -F= '/^prefix=/{print substr($0,8)}' "$manifest")"
  if [[ -n "$prefix_saved" ]]; then
    TMUX_PREFIX="$prefix_saved"
  fi
}

prepare_model_dir() {
  local model="$1"
  local work_dir
  work_dir="$(work_dir_for "$model")"
  ensure_worktree "$model"
  strip_openwiki_markers "$work_dir"
  if [[ "$RESUME" -eq 0 ]]; then
    rm -rf "${work_dir}/openwiki"
  fi
  write_config "$model"
  mkdir -p "$(log_dir_for "$model")"
  : >"$(log_dir_for "$model")/openwiki-init.log"
  : >"$(log_dir_for "$model")/heartbeat.log"
  rm -f "$(log_dir_for "$model")/status.txt"
}

kill_stale_for_model() {
  local model="$1"
  local session work_dir
  session="$(session_name "$model")"
  work_dir="$(work_dir_for "$model")"
  if tmux has-session -t "=${session}" 2>/dev/null; then
    tmux kill-session -t "=${session}" || true
  fi
  local pids pid cwd
  pids="$(pgrep -f "openwiki/dist/cli/cli.js|bin/openwiki" || true)"
  if [[ -n "$pids" ]]; then
    while read -r pid; do
      [[ -z "$pid" ]] && continue
      cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)"
      if [[ "$cwd" == "$work_dir" || "$cwd" == "/private${work_dir}" ]]; then
        kill "$pid" 2>/dev/null || true
        sleep 1
        kill -9 "$pid" 2>/dev/null || true
      fi
    done <<<"$pids"
  fi
}

write_status() {
  local model="$1"
  local exit_code="$2"
  local dir
  dir="$(log_dir_for "$model")"
  mkdir -p "$dir"
  {
    echo "model=${model}"
    echo "repo=${SOURCE_REPO}"
    echo "provider=${PROVIDER}"
    echo "base_url=${BASE_URL}"
    echo "command=${OW_COMMAND}"
    echo "exit_code=${exit_code}"
    echo "finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"${dir}/status.txt"
}

run_line() {
  local stdbuf_prefix=""
  if command -v stdbuf >/dev/null 2>&1; then
    stdbuf_prefix="stdbuf -oL -eL "
  fi
  local debug_flag=""
  if [[ "$DEBUG" == "1" ]]; then
    debug_flag=" --debug"
  fi
  echo "${stdbuf_prefix}$(cli_invoke) --${OW_COMMAND} --print${debug_flag}"
}

write_wrapper() {
  local model="$1"
  local work_dir config_dir log_file wrapper streaming
  work_dir="$(work_dir_for "$model")"
  config_dir="$(config_dir_for "$model")"
  log_file="$(log_dir_for "$model")/openwiki-init.log"
  wrapper="$(log_dir_for "$model")/tmux-run.sh"
  streaming="$(streaming_for_model "$model")"
  umask 077
  {
    echo '#!/usr/bin/env bash'
    echo 'set -uo pipefail'
    printf 'cd %q\n' "$work_dir"
    printf 'export OPENWIKI_CONFIG_DIR=%q\n' "$config_dir"
    printf 'export OPENWIKI_PROVIDER=%q\n' "$PROVIDER"
    printf 'export OPENAI_COMPATIBLE_API_KEY=%q\n' "$API_KEY"
    printf 'export OPENAI_COMPATIBLE_BASE_URL=%q\n' "$BASE_URL"
    printf 'export OPENWIKI_MODEL_ID=%q\n' "$model"
    echo 'export OPENWIKI_TELEMETRY_DISABLED=1'
    printf 'export OPENWIKI_OPENAI_COMPATIBLE_STREAMING=%q\n' "$streaming"
    printf 'export OPENWIKI_MAX_OUTPUT_TOKENS=%q\n' "$MAX_OUTPUT_TOKENS"
    printf 'export OPENWIKI_PROVIDER_RETRY_ATTEMPTS=%q\n' "$RETRY_ATTEMPTS"
    printf 'export OPENWIKI_DEBUG=%q\n' "$DEBUG"
    echo 'unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL OPENAI_API_KEY'
    printf ': > %q\n' "$log_file"
    printf 'exec > >(tee -a %q) 2>&1\n' "$log_file"
    printf 'echo "$$" > %q\n' "$(log_dir_for "$model")/pid.txt"
    echo 'echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"'
    printf 'echo "model=%q config=%q"\n' "$model" "$config_dir"
    run_line
    echo 'code=$?'
    printf '{\n'
    printf '  echo "model=%s"\n' "$model"
    printf '  echo "repo=%s"\n' "$SOURCE_REPO"
    printf '  echo "provider=%s"\n' "$PROVIDER"
    printf '  echo "base_url=%s"\n' "$BASE_URL"
    printf '  echo "command=%s"\n' "$OW_COMMAND"
    echo '  echo "exit_code=$code"'
    echo '  echo "finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"'
    printf '} | tee %q\n' "$(log_dir_for "$model")/status.txt"
    echo 'echo "EXIT:$code"'
    echo 'sleep 2'
    echo 'exit "$code"'
  } >"$wrapper"
  chmod 700 "$wrapper"
}

launch_tmux_model() {
  local model="$1"
  local session wrapper
  session="$(session_name "$model")"
  prepare_model_dir "$model"
  kill_stale_for_model "$model"
  write_wrapper "$model"
  wrapper="$(log_dir_for "$model")/tmux-run.sh"
  echo "==> Launching tmux session ${session} for ${model}"
  tmux new-session -d -s "$session" "bash $(printf %q "$wrapper")"
  tmux set-option -t "=${session}:" remain-on-exit on >/dev/null 2>&1 || true
  echo "    Worktree: $(work_dir_for "$model")"
  echo "    Log:      $(log_dir_for "$model")/openwiki-init.log"
  echo "    Session:  ${session}"
}

run_model_inline() {
  local model="$1"
  local work_dir config_dir log_file started_at pid exit_code now elapsed phase files
  work_dir="$(work_dir_for "$model")"
  config_dir="$(config_dir_for "$model")"
  log_file="$(log_dir_for "$model")/openwiki-init.log"
  started_at="$(date +%s)"
  echo "==> Running openwiki --${OW_COMMAND} with ${model}"
  echo "    Worktree: ${work_dir}"
  echo "    Config:   ${config_dir}"
  echo "    Timeout:  ${MODEL_TIMEOUT_SECONDS}s"
  (
    cd "$work_dir"
    export OPENWIKI_CONFIG_DIR="$config_dir"
    export OPENWIKI_PROVIDER="$PROVIDER"
    export OPENAI_COMPATIBLE_API_KEY="$API_KEY"
    export OPENAI_COMPATIBLE_BASE_URL="$BASE_URL"
    export OPENWIKI_MODEL_ID="$model"
    export OPENWIKI_TELEMETRY_DISABLED=1
    export OPENWIKI_OPENAI_COMPATIBLE_STREAMING
    OPENWIKI_OPENAI_COMPATIBLE_STREAMING="$(streaming_for_model "$model")"
    export OPENWIKI_MAX_OUTPUT_TOKENS="$MAX_OUTPUT_TOKENS"
    export OPENWIKI_PROVIDER_RETRY_ATTEMPTS="$RETRY_ATTEMPTS"
    export OPENWIKI_DEBUG="$DEBUG"
    unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL OPENAI_API_KEY
    # shellcheck disable=SC2094,SC2086
    eval "$(run_line)"
  ) >"$log_file" 2>&1 &
  pid=$!
  echo "    pid=${pid}"
  echo "$pid" >"$(log_dir_for "$model")/pid.txt"
  exit_code=0
  while kill -0 "$pid" 2>/dev/null; do
    now="$(date +%s)"
    elapsed=$((now - started_at))
    phase="$(model_phase "$model")"
    files="$(model_files "$model")"
    printf '[%s] %s elapsed=%ss phase=%s files=%s\n' "$(date +%H:%M:%S)" "$model" "$elapsed" "$phase" "$files" \
      | tee -a "$(log_dir_for "$model")/heartbeat.log"
    if (( elapsed >= MODEL_TIMEOUT_SECONDS )); then
      echo "TIMEOUT ${model} after ${elapsed}s; killing pid ${pid}" | tee -a "$(log_dir_for "$model")/heartbeat.log"
      kill "$pid" 2>/dev/null || true
      sleep 2
      kill -9 "$pid" 2>/dev/null || true
      exit_code=124
      break
    fi
    sleep 20
  done
  if [[ "$exit_code" -eq 0 ]]; then
    wait "$pid" || exit_code=$?
  fi
  write_status "$model" "$exit_code"
  echo "==> Finished ${model} (exit ${exit_code})"
  return "$exit_code"
}

model_phase() {
  local run_json
  run_json="$(work_dir_for "$1")/openwiki/.run.json"
  if [[ -f "$run_json" ]]; then
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("phase","?"))' "$run_json" 2>/dev/null || echo '?'
  else
    echo '-'
  fi
}

model_files() {
  find "$(work_dir_for "$1")/openwiki" -type f 2>/dev/null | wc -l | tr -d ' '
}

print_status_line() {
  local model="$1"
  local session phase files status exit_code dead
  session="$(session_name "$model")"
  phase="$(model_phase "$model")"
  files="$(model_files "$model")"
  status="stopped"
  exit_code="-"
  if tmux has-session -t "=${session}" 2>/dev/null; then
    dead="$(tmux display-message -p -t "=${session}:" '#{pane_dead}' 2>/dev/null || echo 1)"
    if [[ "$dead" == "1" ]]; then
      status="exited"
    else
      status="running"
    fi
  fi
  if [[ -f "$(log_dir_for "$model")/status.txt" ]]; then
    exit_code="$(awk -F= '/^exit_code=/{print $2}' "$(log_dir_for "$model")/status.txt")"
  fi
  printf '%-22s %-10s phase=%-12s files=%-4s exit=%s session=%s\n' \
    "$model" "$status" "$phase" "$files" "$exit_code" "$session"
}

print_plan() {
  echo "repo=     $SOURCE_REPO"
  echo "cli=      $CLI"
  echo "action=   $ACTION"
  echo "command=  openwiki --${OW_COMMAND} --print"
  echo "models=   ${MODELS[*]}"
  echo "out=      $OUT_ROOT"
  echo "prefix=   $TMUX_PREFIX"
  echo "provider= $PROVIDER"
  echo "base_url= $BASE_URL"
  echo "key=      $([[ -n "$API_KEY" ]] && echo SET || echo unset)"
  echo "stream_off=$NO_STREAM_MODELS"
  echo "timeout=  ${MODEL_TIMEOUT_SECONDS}s"
  echo "parallel= $PARALLEL"
  echo "resume=   $RESUME"
  echo "debug=    $DEBUG"
  echo
  local model
  for model in "${MODELS[@]}"; do
    echo "  $model"
    echo "    worktree $(work_dir_for "$model")"
    echo "    session  $(session_name "$model")"
    echo "    stream   $(streaming_for_model "$model")"
  done
}

preflight() {
  case "$ACTION" in
    status|monitor|kill)
      CLI="${CLI:-${OPENWIKI_CLI:-openwiki}}"
      return 0
      ;;
  esac
  resolve_cli
  if [[ -z "$API_KEY" ]]; then
    die "missing API key. Retry: export OPENCODE_GO_API_KEY=...  (or OPENAI_COMPATIBLE_API_KEY)"
  fi
  if [[ "$PROVIDER" != "openai-compatible" ]]; then
    die "this runner currently sets openai-compatible env. Retry: OPENWIKI_PROVIDER=openai-compatible"
  fi
  if [[ "$PARALLEL" == "1" ]]; then
    command -v tmux >/dev/null 2>&1 || die "tmux is required for parallel launch. Retry: --sequential  or  brew install tmux"
  fi
}

launch_all() {
  write_manifest
  local runner_log="${OUT_ROOT}/runner.log"
  mkdir -p "$OUT_ROOT"
  : >"$runner_log"
  if [[ "$PARALLEL" == "1" ]]; then
    local model
    for model in "${MODELS[@]}"; do
      launch_tmux_model "$model" | tee -a "$runner_log"
    done
    echo "Launched sessions:" | tee -a "$runner_log"
    tmux ls 2>/dev/null | grep "^${TMUX_PREFIX}-" | tee -a "$runner_log" || true
    echo "Watch: $0 status --repo $(printf %q "$SOURCE_REPO") --out $(printf %q "$OUT_ROOT")"
    echo "Logs:  tail -f ${OUT_ROOT}/*/logs/openwiki-init.log"
  else
    local overall=0 model code
    for model in "${MODELS[@]}"; do
      prepare_model_dir "$model"
      kill_stale_for_model "$model"
      if run_model_inline "$model" | tee -a "$runner_log"; then
        echo "OK ${model}" | tee -a "$runner_log"
      else
        code=$?
        echo "FAIL ${model} exit=${code}" | tee -a "$runner_log"
        overall=1
      fi
    done
    return "$overall"
  fi
}

monitor_parallel() {
  local start_ts now elapsed any_running model session dead code overall
  start_ts="$(date +%s)"
  echo "==== monitoring $(printf '%s ' "${MODELS[@]}") (timeout ${MODEL_TIMEOUT_SECONDS}s) ===="
  while true; do
    now="$(date +%s)"
    elapsed=$((now - start_ts))
    echo
    printf '[%s] elapsed=%ss\n' "$(date +%H:%M:%S)" "$elapsed"
    any_running=0
    for model in "${MODELS[@]}"; do
      print_status_line "$model" | tee -a "$(log_dir_for "$model")/heartbeat.log"
      session="$(session_name "$model")"
      if tmux has-session -t "=${session}" 2>/dev/null; then
        dead="$(tmux display-message -p -t "=${session}:" '#{pane_dead}' 2>/dev/null || echo 1)"
        if [[ "$dead" != "1" ]]; then
          any_running=1
          if (( elapsed >= MODEL_TIMEOUT_SECONDS )); then
            echo "TIMEOUT ${model}; killing session ${session}" | tee -a "$(log_dir_for "$model")/heartbeat.log"
            tmux kill-session -t "=${session}" || true
            write_status "$model" 124
          fi
        fi
      fi
    done
    if [[ "$any_running" -eq 0 ]]; then
      echo "==== all sessions finished ===="
      break
    fi
    sleep 20
  done

  echo
  echo "==== summaries ===="
  overall=0
  for model in "${MODELS[@]}"; do
    echo "--- ${model} ---"
    print_status_line "$model"
    cat "$(log_dir_for "$model")/status.txt" 2>/dev/null || echo "no status.txt"
    if [[ -d "$(work_dir_for "$model")/openwiki" ]]; then
      echo "wiki files: $(model_files "$model")"
      find "$(work_dir_for "$model")/openwiki" -type f | sed 's|^|  |'
    fi
    echo "tail log:"
    tail -n 30 "$(log_dir_for "$model")/openwiki-init.log" 2>/dev/null || true
    echo
    if [[ -f "$(log_dir_for "$model")/status.txt" ]]; then
      code="$(awk -F= '/^exit_code=/{print $2}' "$(log_dir_for "$model")/status.txt")"
      [[ "$code" == "0" ]] || overall=1
    else
      overall=1
    fi
  done
  return "$overall"
}

kill_all() {
  local model
  for model in "${MODELS[@]}"; do
    echo "killing ${model} ($(session_name "$model"))"
    kill_stale_for_model "$model"
  done
}

# --- dispatch ---
preflight

if [[ "$DRY_RUN" -eq 1 ]]; then
  print_plan
  exit 0
fi

case "$ACTION" in
  launch)
    launch_all
    ;;
  monitor)
    load_manifest_models_if_needed
    monitor_parallel
    ;;
  status)
    load_manifest_models_if_needed
    print_plan | sed -n '1,12p'
    echo
    for model in "${MODELS[@]}"; do
      print_status_line "$model"
    done
    ;;
  kill)
    load_manifest_models_if_needed
    kill_all
    ;;
  all)
    launch_all
    if [[ "$PARALLEL" == "1" ]]; then
      monitor_parallel
    fi
    ;;
  *)
    die "unknown action $ACTION. Retry: run-openwiki-models.sh --help"
    ;;
esac
