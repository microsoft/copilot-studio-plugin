---
name: publish-agent
description: Publish a Copilot Studio (MCS) agent so its deployed content becomes live for the users it is shared with, using the msagent CLI (`msagent agent deploy --publish`). Use when the user asks to publish, release, go live, or make a Copilot Studio agent available to its users.
argument-hint: Optional project folder path, deployment (slot) name, and agent name
allowed-tools: Bash(msagent *), Read, Glob, Grep
---

# Publish a Copilot Studio Agent (Make It Live)

You make a Copilot Studio (MCS) agent's deployed content **live** by running
`msagent agent deploy --publish`. Publishing releases the content of a deployment slot to the people
the agent is shared with, so it is gated behind an explicit confirmation. You never invent behavior
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

Publish needs a **registered** project (`.config\agent.config.json`).

1. If the initial request names a folder, use it (or its parent that holds `.config`).
2. Otherwise auto-discover with `Glob: **/.config/agent.config.json` and present a numbered
   pick-list; never silently use the first match.
3. If the only candidate is an unregistered workspace, register it first with `msagent agent init`
   (see the `pull-agent` skill), then use the returned `projectDirectory`.
4. If nothing usable is found, tell the user publish needs a registered project, and ask for a folder.

## 3. Inspect the project and choose the deployment (blocking)

```bash
msagent agent show --project '<project>' --json
```

Envelope: `{ success, projectDirectory, configPath, agents: [ { agentId, displayName, ... } ],
deployments: [ { deploymentId, deploymentName, deploymentType, environmentId, ... } ] }`.

- If several agents exist, present a pick-list; keep the chosen `agentId` for `--agent-id '<agentId>'`.
- Choose the deployment slot to publish. If the user named one, match it. Otherwise present the
  `deployments` as a numbered list (`deploymentName`, `deploymentType`, `environmentId`) and let the
  user pick. If there are no deployments yet, tell the user to **push** first with the `push-agent`
  skill — there is nothing to publish.

## 4. Confirmation gate (blocking — required)

Before publishing, show the target and get an explicit yes. Ask exactly:

> This will publish the agent and make it live for all users it's shared with. Should I proceed?

Include the agent's `displayName`, the `deploymentName`, and its `environmentId` in the message.
Proceed only on an unambiguous confirmation; anything else stops the flow.

## 5. Publish

```bash
msagent agent deploy --project '<project>' --deployment-name '<name>' --publish --json --non-interactive
```

Add `--agent-id '<agentId>'` when the project holds more than one agent. `--publish` deploys the
current content and then makes it live.

**If it reports unbound or missing connection references**, bind them first (interactive), then
retry publish:

```bash
msagent deployment update connection --project '<project>' --deployment-name '<name>'
```

Relay its prompts to the user and pass their answers through. **Drift / overwrite:** only add
`--overwrite` after the user explicitly agrees to replace cloud content that the project cannot prove
is its own.

## 6. Report

Confirm the agent was published and is now live in its environment for the users it is shared with.
State the agent, the deployment slot, and the environment. If the command indicates it was already
up to date, say so plainly.

## Error handling

- Failure envelope: `{ success: false, exitCode, errorMessage, errorKind?, remediation? }`. Surface
  `errorMessage` and `remediation`.
- **`exitCode` 3, or a sign-in error:** not signed in and `--non-interactive` blocked a prompt. Offer
  the `agent-auth` skill (or `msagent auth login`), then re-run the same command once.
- **`project-not-found` / `config-not-found`:** the folder is not a registered project — return to
  step 2.
- **No deployment to publish:** direct the user to the `push-agent` skill first.
- **Connection/binding errors:** run `deployment update connection` (step 5) and retry.
