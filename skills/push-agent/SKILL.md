---
name: push-agent
description: Push (deploy) a local Copilot Studio (MCS) agent's changes up to a dev deployment slot in the cloud using the msagent CLI (`msagent agent deploy`), without making them live. Use when the user asks to push, deploy, or upload local Copilot Studio agent changes to the cloud (a dev/staging slot, not a public release).
argument-hint: Optional project folder path, target deployment (slot) name, and agent name
allowed-tools: Bash(msagent *), Read, Glob, Grep
---

# Push a Copilot Studio Agent to a Dev Deployment Slot

You send a local MCS agent's changes up to a **deployment slot** in the cloud by running
`msagent agent deploy` (without `--publish`). This uploads the content to a slot but does **not**
make it live for end users — that is what the `publish-agent` skill does. You never invent behavior
the CLI does not support.

Initial request: $ARGUMENTS

## Passing values to commands

Every value you substitute into a command comes from the user or a local file, so treat it as
untrusted text. Both bash and PowerShell expand `$(...)`, `$name`, and backticks inside double
quotes, so a value in double quotes can run another command.

1. **`agentId`** must be a GUID matching
   `^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`. If a value that
   must be an id does not match, stop and say so; run nothing.
2. **`deployment-name`** must be 4–42 characters, each of `[-a-zA-Z0-9_]`. Reject anything else.
3. **Paths and names** (`project`, `agent-name`). If a value contains a double quote (`"`), a line
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

Deploy needs a **registered** project (`.config\agent.config.json`).

1. If the initial request names a folder, use it (or its parent that holds `.config`).
2. Otherwise auto-discover with `Glob: **/.config/agent.config.json` and present a numbered
   pick-list; never silently use the first match.
3. If the only candidate is an unregistered workspace (`settings.mcs.yml` + `.mcs\conn.json`, no
   `.config`), register it first with `msagent agent init --agent-name '<displayName>'
   --mcs-agent-source '<workspaceDir>' --json --non-interactive` (see the `pull-agent` skill for the
   full init flow), then use the returned `projectDirectory`.
4. If nothing usable is found, tell the user push needs a registered project, and ask for a folder.

## 3. Inspect the project (read-only)

```bash
msagent agent show --project '<project>' --json
```

Envelope: `{ success, projectDirectory, configPath, agents: [ { agentId, displayName, ... } ],
deployments: [ { deploymentId, deploymentName, deploymentType, environmentId, ... } ] }`.

- If several agents exist, present a pick-list and keep the chosen `agentId` (pass it as
  `--agent-id '<agentId>'` on later commands).
- Read the existing `deployments` to choose a target slot in step 4.

## 4. Choose or create a dev deployment slot (blocking)

- **Existing dev slot:** prefer a deployment whose `deploymentType` is `dev`. If exactly one, use its
  `deploymentName`. If several, present a pick-list.
- **No dev slot:** offer to create one. Ask the user for a slot name (4–42 chars, `[-a-zA-Z0-9_]`) or
  propose one, then:

  ```bash
  msagent deployment create --project '<project>' --deployment-name '<name>' --deployment-type dev --json --non-interactive
  ```

  A `dev` slot defaults to the agent's home environment. (Only `test`/`prod` slots require an
  explicit `--environment-id`.)

## 5. Deploy to the slot (push, no publish)

```bash
msagent agent deploy --project '<project>' --deployment-name '<name>' --json --non-interactive
```

Add `--agent-id '<agentId>'` when the project holds more than one agent. Do **not** pass `--publish`
here — pushing to the slot must not make the agent live.

**If the deploy reports unbound or missing connection references**, the slot needs its connections
bound before content can land. Run:

```bash
msagent deployment update connection --project '<project>' --deployment-name '<name>'
```

This step is **interactive**: it lists the required connectors and reads your selections from stdin
(even with `--non-interactive` it still reads answers), so relay its prompts to the user and pass
their choices through. After connections are bound, re-run the deploy command above.

**Drift / overwrite:** if the deploy fails because the cloud slot has changes this project cannot
prove are its own, do **not** silently override. Explain the drift and only add `--overwrite` after
the user explicitly agrees to replace the cloud content.

## 6. Report

State clearly:

- Which agent was pushed, to which **deployment slot** and environment.
- That the change is in the **dev slot** and is **not yet live** for end users.
- To make it live, use the `publish-agent` skill. If the deploy was a no-op (no local changes), say
  so plainly.

## Error handling

- Failure envelope: `{ success: false, exitCode, errorMessage, errorKind?, remediation? }`. Surface
  `errorMessage` and `remediation`.
- **`exitCode` 3, or a sign-in error:** not signed in and `--non-interactive` blocked a prompt. Offer
  the `agent-auth` skill (or `msagent auth login`), then re-run the same command once.
- **`project-not-found` / `config-not-found`:** the folder is not a registered project — return to
  step 2.
- **Connection/binding errors:** run `deployment update connection` (step 5) and retry.
- **Deployment name invalid:** re-prompt for a 4–42 character `[-a-zA-Z0-9_]` name.
