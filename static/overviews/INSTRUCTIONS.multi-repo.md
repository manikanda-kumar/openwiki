---
type: Repository guide
title: Multi-repo workspace wiki
description: Document every sibling Git repository under this parent checkout, plus how they talk, with Claims grounded in repo:// evidence.
---

This checkout is a **parent workspace of sibling Git repositories**, not a single app. Every first-level (and obvious nested) directory that contains its own `.git` is a sibling system, excluding `node_modules`, `dist`, `vendor`, `.venv`, and `target`.

If the process cwd is inside one sibling instead of the parent, stop planning and say so.

## Inventory before you plan

1. Map siblings with `find . -name .git -type d`. Use `git -C <path>` for remotes, HEAD, and recent history.
2. Treat a sibling with almost no files, no lockfile, and no README as a partial clone.
3. Discover the Bitbucket CLI (`command -v bb acli atlas bitbucket`). Use it **read-only** only when local evidence is missing, thin, or contradicted. Infer workspace/project from `git remote -v`. Never print tokens. Never clone unless the user explicitly asked.

## Pages to plan

Organize by systems, not a file dump. Include:

- `/openwiki/quickstart.md` — table of siblings (folder, remote, role, link)
- `/openwiki/repos/<id>.md` — one substantial page per cloned sibling (merge thin ones)
- `/openwiki/contracts.md` — HTTP/gRPC/queues/shared libs/auth/data ownership
- `/openwiki/operations.md` — build, CI (including Bitbucket Pipelines), local run, deploy
- `/openwiki/gaps.md` — not cloned, partial clone, CLI failed, unverified rumor

Copy only the relevant constraints below into each job's `instructions`. Put sibling paths in that job's `seedPaths` (the sibling root plus manifests, entrypoints, API/schema, CI). `seedPaths` are starting points, not research boundaries.

## Research bar

Do not stop at directory names or README paraphrase. For each sibling, follow entrypoints, public API/schema, config **names** (never `.env` values), tests, and recent `git -C` history until responsibilities and cross-repo edges are evidenced.

## Claims

Every material fact on a generated page needs a Claim with evidence `repo://…` (optionally `#Lstart-Lend`). Bare paths are invalid. Bitbucket CLI output is **not** Claim evidence. If a fact exists only remotely, put it on `/openwiki/gaps.md` without a fake `repo://` URI, or fetch the file into this tree first.

Do not invent services, APIs, owners, or files.

## Bitbucket

Typical remote-only gaps: uncloned repos in the same project, default branch, `bitbucket-pipelines.yml`, open/merged PRs for *why* code looks this way. Record clone URLs on `gaps.md`. Do not treat marketing descriptions as architecture when code disagrees.
