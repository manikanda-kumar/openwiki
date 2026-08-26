# Multi-repo OpenWiki — hill-climb documentation run

Interactive `openwiki code --init` now **stays open** for follow-up (use `--print` for one-shot). The system prompt defaults to 3–4 read-only subagents in successive waves when you ask for a hill-climb. Subagents still **cannot write files** — only the main agent writes `openwiki/`.

You still want two layers for a long run:

1. **Inner meta-agent** (this brief): orchestrator + parallel research subagents + a critic, looping until the wiki survives audit. Stay in the TTY and send follow-ups (“continue the climb”).
2. **Outer harness** (the script): repeat `openwiki code --update --print` so a non-interactive / CI run reads `climb-log.md` / `gaps.md` and keeps going across process restarts.

Subagents in OpenWiki **cannot write files**. Only the main agent writes `openwiki/`. Treat subagents as scouts and critics, never as authors.

## Run from the parent of the sibling clones

```
parent-workspace/          ← cd here
  payments-api/.git
  checkout-ui/.git
  shared-proto/.git
  openwiki/                ← generated
```

```sh
cd /path/to/parent-workspace

# First map
openwiki code --init --print "$(sed -n '/^## Inner brief/,$p' /Users/manik/Github/openwiki/static/overviews/multi-repo-code-init-prompt.md)"

# Then climb until the ledger says pass (or max rounds)
bash /Users/manik/Github/openwiki/static/overviews/multi-repo-climb.sh
```

`--print` is required in the **scripted** loop so each round is one-shot and the next round can start. For an interactive climb, omit `--print` and keep sending follow-ups in the same session.

---

## Inner brief

(paste as the `--init` / `--update` user message from this heading down)

You are the **orchestrator** for a multi-repo documentation climb. Sibling Git repositories live under the current working directory. Your job is a wiki that a future coding agent can use instead of rediscovering the tree.

OpenWiki will urge a short first pass and 1–2 subagents. **That default is overridden.** This user message asks for deeper research, multiple waves, and a critic. Do not stop after the first write.

### Definitions

- **Sibling**: a directory under cwd that contains its own `.git`, excluding `node_modules`, `dist`, `vendor`, `.venv`, `target`.
- **Workspace**: cwd, the parent of those siblings. If cwd is itself one sibling, stop and say so.
- **Claim**: a sentence in the wiki about behavior, structure, owners, or dependencies.
- **Evidence**: a path, `git -C <sibling>` output, or a Bitbucket CLI transcript from this session. READMEs alone are not evidence for internals.
- **Gap**: something a future agent would need that is not locally verified. Lives in `/openwiki/gaps.md`.
- **Stub page**: a page that is mostly headings, source maps, or README paraphrase. Forbidden as a final page.
- **Invented**: a service, API, owner, or file not observed this session.

### Task (success predicate)

The run may return only when **all** of the following are true of the files under `/openwiki/`:

1. Every sibling is listed in `/openwiki/quickstart.md` with folder, remote, role, and a link to its page (or a one-line justification that it was merged into another page).
2. Every cloned sibling has a non-stub `/openwiki/repos/<id>.md` (or a documented merge) covering: what/why, how to run, API/data surface, deps on other siblings, tests, watch-outs, entry-file source map.
3. `/openwiki/contracts.md` states how siblings talk (HTTP/gRPC/queues/shared libs/auth/data ownership), **or** each unknown edge is an Active gap with evidence.
4. `/openwiki/operations.md` covers build/CI/deploy/local-run as observed.
5. `/openwiki/best-practices.md` is used-in-these-repos only, with evidence paths.
6. `/openwiki/gaps.md` exists, is grouped (not cloned / partial clone / CLI failed / unverified), and contains no claim that was actually verified this session.
7. `/openwiki/climb-log.md` records each inner wave: what was scouted, what was written, critic defects, score 0–10, next targets.
8. Every non-trivial claim has inline evidence. No invented names.

Assume a complete, evidence-backed wiki of this workspace is possible from local clones plus read-only Bitbucket CLI.

### Does not count

These are not success. Do not return if this is all you have:

- A “good first pass” or “we can refine later”
- Covering only the two largest siblings
- Paraphrasing READMEs without opening entrypoints, manifests, or API/schema files
- Empty or heading-only `contracts.md`
- Stopping because the conversation is long, the first wave failed, or OpenWiki’s default page budget is 8
- A plan instead of the wiki pages
- Bitbucket marketing copy treated as architecture
- Cloning a missing repo (unless the user explicitly asked)
- Status prose (“on track”, “mostly done”) without file paths from this session

### Orchestration

You are the meta-agent. Use the `task` tool. Subagents inspect and summarize only. You write every wiki file.

Each spawn must include: **objective**, **output format**, **tools/sources**, **boundaries** (no writes; no secrets; one sibling or one theme).

Waves (repeat until the return condition):

1. **Inventory (you).** `find` all `.git`. Record path, remotes, HEAD, dirty, clone-vs-stub. Write `/openwiki/climb-log.md` and a sibling index into `/openwiki/_plan.md`.
2. **Scout wave.** Spawn subagents in parallel, one sibling or one theme each (architecture, API/data, CI/ops, tests). Cap a wave at 3–4 subagents. If there are more siblings, do multiple scout waves. Keep scouts **blind to each other’s notes**. They return: files read, hard facts with paths, unknowns, possible cross-repo edges.
3. **Synthesize (you).** Write/update the wiki pages. Prefer replacing a wrong sentence over adding a paragraph.
4. **Critic wave.** Spawn a **fresh** critic subagent that did not write the pages. Give it the audit list below. It returns defects only: invented names, missing siblings, stub pages, claims without paths, contracts that ignore an observed API. Agreement with you is not corroboration.
5. **Climb.** Fix defects. Pick the lowest-score pages. Next scout wave targets those, plus any sibling not yet scouted. Log the wave in `climb-log.md` with score.

Hill-climb rule: a wave that does not shrink Active gaps **and** does not add evidence paths is a failed wave. Change target (different sibling, Bitbucket for an uncloned repo, a contract edge), do not re-try the same README.

Bitbucket: discover `bb` / `acli` / `bitbucket`. Read-only. Use only when local is missing, thin, or contradicted. Never print tokens. If CLI fails, record the exact command in `gaps.md`.

### Verification (critic checklist)

Hunt for:

- Sibling `.git` present locally but absent from quickstart
- Page that restates README and never cites `cmd/`, `src/`, proto, OpenAPI, routes, or CI
- Cross-repo call observed in code/config but missing from `contracts.md` and `gaps.md`
- Env/secret **values** documented (names are fine)
- Stub directory with one thin file
- `best-practices.md` restating public language lore
- Invented service/API/owner
- Critic and author using the same unread files as “evidence”
- Score ≥ 8 while Active gaps still include cloned repos with no page

Claims in the final user reply must point at files you wrote this session.

### Return condition

Return only when the success predicate holds **and** a critic wave found no remaining defects on the checklist.

Do not return because you feel done. If the **outer** run budget is exhausted (the update process is ending), leave `climb-log.md` with `RETURN: continue`, score, and the next three targets, then stop. That is the only allowed incomplete exit.

Inner effort floor: **at least 3 scout→write→critic waves in this process** before you may write `RETURN: continue`. More if defects remain.

### Page set

Override the 8-page habit:

- `/openwiki/quickstart.md`
- `/openwiki/best-practices.md`
- `/openwiki/repos/<id>.md` per sibling
- `/openwiki/contracts.md`
- `/openwiki/operations.md`
- `/openwiki/gaps.md`
- `/openwiki/climb-log.md`

Merge stubs. Delete `/openwiki/_plan.md` before you return. Keep `climb-log.md`.

`climb-log.md` format:

```md
# Climb log

## Wave N
- Scouts: …
- Wrote: …
- Critic defects: …
- Score: N/10
- Next: …

RETURN: continue | pass
```

`RETURN: pass` only after the critic is clean and the predicate holds.

---

## Outer climb (harness)

`static/overviews/multi-repo-climb.sh` re-invokes `--update --print` with the inner brief until `climb-log.md` contains `RETURN: pass` or `MAX_ROUNDS` is hit. That is the actual long run. Prompt-only persistence dies when OpenWiki exits.
