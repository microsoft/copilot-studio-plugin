---
name: pull-agent
description: Pull the latest cloud content of a Copilot Studio (MCS) agent into an existing local project using the msagent CLI (`msagent agent pull`). Use when the user asks to pull, sync down, refresh, or update a local Copilot Studio agent project with the latest remote changes.
argument-hint: Optional project or agent-workspace folder path, and/or an agent name
allowed-tools: Bash(msagent *), Read, Glob, Grep
---

# Pull a Copilot Studio Agent's Cloud Content

You bring the latest remote content of a Copilot Studio (MCS) agent into a local project by running
`msagent agent pull`. Pull requires a **registered** project (`.config\agent.config.json`); if the
folder is an unregistered agent workspace, you register it with `msagent agent init` first. You never
invent behavior the CLI does not support.

Initial request: $ARGUMENTS

## Passing values to commands

Every value you substitute into a command comes from the user or a local file, so treat it as
untrusted text. Both bash and PowerShell expand `$(...)`, `$name`, and backticks inside double
quotes, so a value in double quotes can run another command.

1. **`agentId`** must be a GUID matching
   `^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`. If a value that
   must be an id does not match, stop and say so; run nothing.
2. **Paths and names** (`project`, `agent-name`). If a value contains a double quote (`"`), a line
   break, or any other control character, do not build the command; stop and report it. Otherwise
   pass it as a **single-quoted** literal (never double-quoted): bash replaces each `'` with `'\''`;
   PowerShell doubles each `'` (and each `‘ ’ ‚ ‛`).

The templates below show each value as `'<value>'`; apply these rules to every one.

## 1. Verify the CLI (blocking on failure)

```bash
msagent --version
```

If it is not found, tell the user the msagent CLI is required but was not found, and stop.

## 2. Locate the project (blocking)

A **registered project** contains `.config\agent.config.json`. An **unregistered agent workspace**
contains `settings.mcs.yml` + `.mcs\conn.json` but no `.config\agent.config.json`.

1. If the initial request names a folder, use it (or its parent, if that holds `.config`). Also
   check its direct subfolders one level down, as `pac copilot clone` nests the agent in a subfolder.
2. If no folder is named, auto-discover registered projects with `Glob: **/.config/agent.config.json`;
   if none, discover workspaces with `Glob: **/.mcs/conn.json` (keeping those whose folder also has
   `settings.mcs.yml`). Present a numbered pick-list; never silently use the first match.
3. If the chosen folder is an unregistered workspace, go to **Register first** below.
4. If nothing usable is found, tell the user pull needs a registered project or a cloud-linked agent
   workspace, and ask for a folder.

## 3. Warn about local overwrites (blocking acknowledgement)

Pull merges remote changes into the local workspace and **may overwrite local files**. If the folder
has uncommitted local edits, say so and confirm the user wants to proceed before running pull.

## 4. Choose the agent (only if several)

Read the project's records locally:

```bash
msagent agent show --project '<project>' --json
```

Envelope: `{ success, projectDirectory, configPath, agents: [ { agentId, displayName, agentType, ... } ],
deployments: [ ... ] }`. If there is one agent, use it. If several, present a numbered pick-list
(`displayName`, `agentId`) and use the chosen `agentId`.

## 5. Pull

```bash
msagent agent pull --project '<project>' --json --non-interactive
```

Add `--agent-id '<agentId>'` (or `--agent-name '<name>'`) when the project holds more than one agent.

## 6. Report

State which agent was pulled into which project, and that local files may have been updated. If the
command reports specific changed components, list them. Remind the user that to send local edits back
up they use the `push-agent` skill, and to make them live the `publish-agent` skill.

## Register first (unregistered agent workspace)

When step 2 chose a folder with `settings.mcs.yml` + `.mcs\conn.json` but no registered project,
`agent pull` cannot act on it until it is registered. Read `settings.mcs.yml` (top-level
`displayName`, `schemaName`) with the Read tool for display only — do not modify it. Confirm with the
user, then register:

```bash
msagent agent init --agent-name '<displayName>' --mcs-agent-source '<workspaceDir>' --json --non-interactive
```

Success envelope: `{ success, status: "agent-initialized", agentId, displayName, agentType,
environmentId, connected, projectDirectory, configPath }`. Before pulling, verify `agentType` is
`MCSAgent` and `connected` is `true`; if not, stop and relay the reason. Then run step 5 using
`projectDirectory` from the init result as `--project`. `agent init` writes only
`.config\agent.config.json` and creates nothing in the cloud.

## Error handling

- Failure envelope: `{ success: false, exitCode, errorMessage, errorKind?, remediation? }`. Surface
  `errorMessage` and `remediation`.
- **`exitCode` 3, or a sign-in error:** not signed in and `--non-interactive` blocked a prompt. Offer
  the `agent-auth` skill (or `msagent auth login`), then re-run the same command once.
- **`project-not-found` / `config-not-found`:** the folder is not a registered project — return to
  step 2 or register it (Register first).
- **`already-registered`** during init: the workspace is already registered; skip init and run the
  pull directly against that project.
