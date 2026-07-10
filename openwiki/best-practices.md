# Best practices

**Used-in-this-repo inventory** for OpenWiki — not a TypeScript/Node textbook. List only what this codebase adopts (with paths). Skip generally public knowledge (common idioms, generic style guides) unless encoded here with evidence. Architecture: [overview](./architecture/overview.md). Agent runtime: [workflow](./agent/workflow.md).

## Inventory tags

Machine-friendly signals for external rule tooling (archetype / pack selection, local overlays):

- **language:** typescript
- **runtime:** node>=20 (CI 22)
- **archetype:** cli
- **libs:** deepagents, langchain, ink, vitest, zod
- **module:** openwiki (`package.json` name)

## Language & runtime

| Item | Value | Evidence |
|------|--------|----------|
| Language | TypeScript via `tsc` | `tsconfig.json`, `src/**/*.ts(x)` |
| Runtime | Node.js `>=20` | `package.json` `engines` |
| Module system | ESM + `.js` import suffixes in TS | `"type": "module"`, source imports |
| Package manager | pnpm 10.x | `packageManager`, `pnpm-lock.yaml` |
| CLI UI | React 18 + Ink 5 | `src/cli.tsx`, `src/credentials.tsx` |
| Tests | Vitest | `package.json` scripts, `test/` |

## Used practices

Local conventions with evidence — not generic TS advice:

1. **ESM + explicit `.js` extensions** in TS imports (`from "./types.js"`). Evidence: entire `src/` import style.
2. **Provider config is centralized** in `src/constants.ts` (`PROVIDER_CONFIGS`, `OpenWikiProvider`); model clients branch in `src/agent/index.ts` `createModel()`.
3. **Product documentation rules live in prompts** (`src/agent/prompt.ts`), not ad-hoc comments; CLI surface is `src/commands.ts` + `src/cli.tsx`.
4. **FS optionality** via `src/fs-errors.ts` (`isFileNotFoundError`, `isExpectedSnapshotRaceError`), not scattered `ENOENT` checks.
5. **Secrets never enter wiki content**; credentials only via `src/env.ts` → `~/.openwiki/.env` (document env *names*, not values).
6. **Code-mode writes only under `openwiki/`**; personal brain is `~/.openwiki/wiki` — different root.
7. **Update metadata is content-gated** (`createOpenWikiContentSnapshot` in `src/agent/utils.ts`) so no-op updates do not churn `.last-update.json`.
8. **Surgical wiki updates** — few source changes ⇒ few page edits; best-practices only when stack/utils change.

## Frameworks & libraries (used)

| Name | Role | Where used | Evidence / Notes |
|------|------|------------|------------------|
| deepagents | Agent + local shell backend | `src/agent/index.ts` | Virtual FS for wiki writes |
| langchain / @langchain/* | Model clients, tools | `src/agent/index.ts`, connectors | Anthropic / OpenAI / OpenRouter branches |
| @langchain/langgraph-checkpoint-sqlite | Checkpoints | agent runtime | SQLite under `~/.openwiki/` |
| ink + react | Interactive TUI | `src/cli.tsx`, `src/credentials.tsx` | Onboarding + stream UX |
| zod | Config/external shapes | connectors / config | Boundary validation |
| marked | Markdown | CLI/render paths | Keep out of agent core |
| cron-parser / cronstrue | Schedules | `src/schedules.ts` | Connector + power schedules |
| vitest | Unit tests | `test/` | `pnpm test` |
| typescript / eslint / prettier | Gates | root configs | typecheck / lint / format |

## Shared utilities (internal)

| Utility / module | Path | Purpose | When to reuse |
|------------------|------|---------|---------------|
| Provider config + resolution | `src/constants.ts` | Providers, models, env keys, base URLs, retries | Any provider/model/env work |
| Env load/save + diagnostics | `src/env.ts` | `~/.openwiki/.env` merge | Credentials / config persistence |
| Run context + git evidence | `src/agent/utils.ts` | Run context, last-update, content snapshot | Agent init/update lifecycle |
| Prompt assembly | `src/agent/prompt.ts` | System/user prompts by mode | Wiki structure / agent rules |
| Docs-only backend | `src/agent/docs-only-backend.ts` | Write constraints | Backend / path-root behavior |
| FS error helpers | `src/fs-errors.ts` | Expected missing-file / race | Optional files |
| HTML strip | `src/utils.ts` (`stripHtmlTags`) | Sanitize untrusted text | Connector-ish text cleanup |
| Code-mode setup | `src/code-mode.ts` | GH workflow + AGENTS snippet | Repo bootstrap for scheduled wiki |
| Onboarding state | `src/onboarding.ts` | Onboarding + instructions paths | Personal mode setup |
| Schedules | `src/schedules.ts` | Cron install/list/pause | Connector automation |
| Ingestion | `src/ingestion.ts` | Connector → wiki update prompts | Source refresh |
| Connectors | `src/connectors/*` | MCP/API sources, raw IO | New sources |
| Auth | `src/auth/*` | OAuth / tokens | Login + rotation |
| Startup | `src/startup.ts` | Startup command resolve | Entrypoint / mode |
| Diagnostics | `src/diagnostics.ts` | User-facing errors | Avoid raw stacks in UX |

## Tooling & quality gates

```sh
pnpm install
pnpm typecheck    # tsc --noEmit
pnpm lint:check
pnpm format:check
pnpm test
pnpm build        # clean + tsc → dist/
```

Dev: `pnpm dev` (`tsx src/cli.tsx`). Bin: `openwiki` → `dist/cli.js`.

## Watch-outs

Repo-specific only:

- **Two wiki roots:** code → `openwiki/`; personal → `~/.openwiki/wiki`.
- **Virtual paths** in agent FS (`/openwiki/...`); host absolute paths nest wrongly.
- **No secret documentation** — env names only.
- **Provider add is multi-file:** `constants.ts` + `createModel()` + credential UX if selectable.
- **Do not hand-edit generated OpenWiki pages** in consumer repos unless asked; regenerate with `openwiki code --update`.

## Public knowledge not restated

Deliberately omitted (assume the agent already knows): generic TypeScript typing essays, React hooks basics, “write clean code”, npm vs pnpm ideology, and language-wide error-handling tutorials not encoded as local modules or configs.

## Related wiki

- [Quickstart](./quickstart.md)
- [Architecture overview](./architecture/overview.md)
- [Agent workflow](./agent/workflow.md)
- [CLI usage](./cli/usage.md)
- [Credentials and updates](./operations/credentials-and-updates.md)
