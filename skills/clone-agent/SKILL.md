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

1. **Source environment** — resolve `--mcs-clone-environment-id '<srcEnv>'` before resolving the
   source agent. If the user supplied an environment display name, run
   `msagent env list --json --non-interactive`, require exactly one case-insensitive match, and use
   its `environmentId`. If no source environment was supplied, run
   `msagent auth status --json --non-interactive`, show the active environment, and require the user
   to confirm it. Never silently substitute the active environment.
2. **Source agent** — one of:
   - `--mcs-clone-agent-id '<id>'` (a GUID), or
   - `--mcs-clone-agent-schemaname '<schemaName>'`.

   If the user gives an agent **display name**, resolve it in the source environment:

   ```bash
   msagent agent list --environment-id '<srcEnv>' --json --non-interactive
   ```

   Require exactly one case-insensitive `displayName` match, then use its `mcsAgentId` or
   `schemaName`. If several agents have that display name, present their ids and schema names and
   require an exact choice; if none match, stop. If the user pastes a Copilot Studio web URL
   containing `/environments/<environmentId>/bots/<botId>/`, take `<botId>` as the clone-source id
   and `<environmentId>` as the source environment.
3. **Target project directory** — `--project '<dir>'`. It is created if missing. Require the target
   to be absent or empty; refuse to clone into a folder containing a registered project, agent
   files, or unrelated files. Ask for a new/empty folder rather than risking a merge or overwrite.
4. **Target environment** — resolve an exact `environmentId` and always pass it as
   `--environment-id '<targetEnv>'`. If the user does not name one, get the active environment from
   `msagent auth status --json --non-interactive`, show it, and require confirmation. It is often the
   same as the source environment, but do not assume that.

## 3. Confirm the plan (blocking)

Because this creates a new agent seeded from the source, show a short summary and get a yes:

```text
About to clone:
  source agent   <id-or-schemaName> in <srcEnv>
  into project   <dir>
  target env     <targetEnv>
The new project inherits the source agent's display name and is registered with msagent.
```

## 4. Run the clone

```bash
msagent agent create --project '<dir>' --agent-type MCSAgent --mcs-clone-agent-id '<id>' --mcs-clone-environment-id '<srcEnv>' --environment-id '<targetEnv>' --json --non-interactive
```

- Use `--mcs-clone-agent-schemaname '<schemaName>'` instead of `--mcs-clone-agent-id` when you only
  have the schema name.
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
  the `agent-auth` skill (or `msagent auth login`). After the user completes login, run
  `msagent auth status --json --non-interactive`. Compare its account, tenant, and environment with
  the confirmed source and target. If any security context changed, show the changes and re-confirm
  the full clone plan before re-running the same command once.
- **Destination not empty / already a project:** do not overwrite. Ask for a new folder.
- **Source not found / environment not found:** relay the remediation; offer
  `msagent agent list --environment-id '<srcEnv>' --json --non-interactive` (to reconfirm the
  source) or `msagent env list --json --non-interactive` (to reconfirm the environment).
