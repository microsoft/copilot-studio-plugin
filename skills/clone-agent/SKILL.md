---
name: clone-agent
description: Clone an existing Copilot Studio (MCS) agent into a new local msagent project, seeded from a source agent in the cloud, using the msagent CLI (`msagent agent create` in clone mode). Use when the user asks to clone, copy, duplicate, or scaffold a new local project from an existing Copilot Studio agent.
argument-hint: The source agent id or schema name, its source environment, and a target project directory
allowed-tools: Bash(msagent *), Read, Glob, Grep
---

# Clone a Copilot Studio Agent into a New Local Project

You create a **new local MCS project** that is a clone of an existing cloud agent by running
`msagent agent create` in clone mode (`--mcs-clone-agent-id` / `--mcs-clone-agent-schemaname`). The
new project is registered with msagent (a `.config\agent.config.json` is written) and inherits the
source agent's display name. You never invent behavior the CLI does not support.

> **Semantics.** msagent clone *seeds a new project from* a source agent; it is not a plain download
> of the same agent for in-place editing. To refresh an **already-registered** project with the
> latest remote content, use the `pull-agent` skill instead.

Initial request: $ARGUMENTS

## Passing values to commands

Every value you substitute into a command comes from the user or a local file, so treat it as
untrusted text. Both bash and PowerShell expand `$(...)`, `$name`, and backticks inside double
quotes, so a value in double quotes can run another command.

1. **IDs** (`mcs-clone-agent-id`, `environment-id`, `mcs-clone-environment-id`) must be GUIDs
   matching `^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`; an
   environment id may also be the `Default-<guid>` form. If a value that must be an id does not
   match, stop and say so; run nothing.
2. **Paths and schema names** (`project`, `mcs-clone-agent-schemaname`). If a value contains a double
   quote (`"`), a line break, or any other control character, do not build the command; stop and
   report it. Otherwise pass it as a **single-quoted** literal (never double-quoted), escaping inner
   single quotes: bash replaces each `'` with `'\''`; PowerShell doubles each `'` (and each `‘ ’ ‚ ‛`).

The templates below show each value as `'<value>'`; apply these rules to every one.

## 1. Verify the CLI (blocking on failure)

```bash
msagent --version
```

If it is not found, tell the user the msagent CLI is required but was not found, and stop.

## 2. Resolve inputs (blocking)

1. **Source agent** — one of:
   - `--mcs-clone-agent-id '<id>'` (a GUID), or
   - `--mcs-clone-agent-schemaname '<schemaName>'`.

   If the user gives an agent **display name**, resolve it first with `msagent agent list --json`
   (match `displayName`, then use its `mcsAgentId` or `schemaName`) and confirm the match. If the
   user pastes a Copilot Studio web URL containing `/environments/<environmentId>/bots/<botId>/`,
   take `<botId>` as the clone-source id and `<environmentId>` as the source environment.
2. **Source environment** — `--mcs-clone-environment-id '<srcEnv>'`. It defaults to the target
   environment, then the active environment. Confirm which environment holds the source agent.
3. **Target project directory** — `--project '<dir>'`. It is created if missing. Refuse to clone into
   a folder that already contains a registered project (`.config\agent.config.json`) or agent files
   (`settings.mcs.yml`); ask for an empty/new folder instead.
4. **Target environment** (optional) — `--environment-id '<targetEnv>'`, where the clone is created.
   Defaults to the active environment. Confirm; it is often the same as the source environment.

## 3. Confirm the plan (blocking)

Because this creates a new agent seeded from the source, show a short summary and get a yes:

```text
About to clone:
  source agent   <id-or-schemaName> in <srcEnv>
  into project   <dir>
  target env     <targetEnv or active environment>
The new project inherits the source agent's display name and is registered with msagent.
```

## 4. Run the clone

```bash
msagent agent create --project '<dir>' --agent-type MCSAgent --mcs-clone-agent-id '<id>' --mcs-clone-environment-id '<srcEnv>' --json --non-interactive
```

- Use `--mcs-clone-agent-schemaname '<schemaName>'` instead of `--mcs-clone-agent-id` when you only
  have the schema name.
- Add `--environment-id '<targetEnv>'` only when the target differs from the default.
- Do **not** pass `--name`: a clone inherits the source agent's name.

## 5. Verify and report

On success, confirm the project was materialized and registered: use `Glob` to check that `<dir>`
now contains `settings.mcs.yml` (or `agent.mcs.yml`) and `.config\agent.config.json`. Then tell the
user:

- The project directory created and the cloned agent's display/schema name (from the command's JSON
  result).
- Next steps: edit locally, then **push** with the `push-agent` skill and **publish** with the
  `publish-agent` skill when ready.

## Error handling

- Failure envelope: `{ success: false, exitCode, errorMessage, errorKind?, remediation? }`. Surface
  `errorMessage` and `remediation`.
- **`exitCode` 3, or a sign-in error:** not signed in and `--non-interactive` blocked a prompt. Offer
  the `agent-auth` skill (or `msagent auth login`), then re-run the same command once.
- **Destination not empty / already a project:** do not overwrite. Ask for a new folder.
- **Source not found / environment not found:** relay the remediation; offer `msagent agent list --json`
  (to reconfirm the source) or `msagent env list --json` (to reconfirm the environment).
