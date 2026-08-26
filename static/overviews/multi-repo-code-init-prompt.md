# Multi-repo OpenWiki (v0.4 page jobs)

OpenWiki 0.4 already hill-climbs. Do not paste a meta-agent / subagent brief into `--init`.

Native code generation is:

`begin → submit_plan → next_page → submit_page → … → finish`

- Planner: explore, then `submit_plan` only (no wiki writes, no `task` tool).
- Page worker: one fresh process per page, writes only that file, `submit_page` with a complete Claim set, then dies.
- State: `openwiki/.run.json`. Crash? Rerun the **same** command (`--init` or `--update`).
- Init **replaces** generated pages; it **keeps** `openwiki/INSTRUCTIONS.md`.
- Update is surgical, plus mandatory jobs for stale Claims. Clean git + zero grounding issues → no-op.
- Claim evidence must be `repo://path` (optional `#L40-L82`). Not Bitbucket CLI text.

The durable brief is **`openwiki/INSTRUCTIONS.md`**. The planner sees it as `wikiGoal`. Put sibling + Bitbucket rules there, not in a one-shot user message.

## Layout

Parent must be a Git repository (fingerprint + Claims URIs). Sibling clones can keep their own `.git`.

```
parent-workspace/     ← git init here; cd here
  .git/
  payments-api/.git
  checkout-ui/.git
  shared-proto/.git
  openwiki/
    INSTRUCTIONS.md   ← you own this
    .run.json         ← resume checkpoint (do not hand-edit)
```

## Run

```sh
cd /path/to/parent-workspace
git rev-parse --is-inside-work-tree  # must be true

mkdir -p openwiki
cp /path/to/openwiki/static/overviews/INSTRUCTIONS.multi-repo.md \
  openwiki/INSTRUCTIONS.md
# edit INSTRUCTIONS.md: Bitbucket workspace, sibling names you care about

openwiki --init --print
```

Interrupted? Same command again (resume). After init finishes (no `.run.json`):

```sh
openwiki --update --print
```

That second pass is the real critic: Claims preflight forces pages whose evidence moved or is unresolved.

Unattended resume + one update:

```sh
bash /path/to/openwiki/static/overviews/multi-repo-climb.sh
```

Interactive: omit `--print`. Generation still uses the page-job runner, not chat. Chat after success can deepen a page if you ask; repository chat cannot write outside `openwiki/`.

## Optional: coding-agent host

If you want a stronger investigator than the native planner/page workers:

```sh
openwiki integrations install claude   # or codex / opencode
```

Then in that agent, in the parent repo:

```text
Initialize this repository's OpenWiki from the current source and tests.
Follow openwiki/INSTRUCTIONS.md. Treat nested Git directories as sibling systems.
```

The host does research and authoring; OpenWiki still owns the queue, Claim durability, and finish.

## Why the old climb prompt is wrong now

| Old (pre-0.4) | Now |
|---|---|
| One DeepAgent + `task` subagents | `task` stripped on code workers |
| User message overrides “first pass” | Planner/page prompts are bounded tools |
| `climb-log.md` score loop | `.run.json` + Claims grounding issues |
| Repeat `--update` with the same essay | Resume same mode; then Claims-driven update |
| Bitbucket as evidence | Bitbucket = discovery; Claims = `repo://` |

## Bitbucket CI

Copy `examples/openwiki-update.bitbucket-pipelines.yml` and schedule `openwiki-update`. Use **full clone depth**. That keeps the wiki current; it is not a substitute for `INSTRUCTIONS.md` on first init.
