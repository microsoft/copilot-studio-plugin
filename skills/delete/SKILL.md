---
user-invocable: true
description: Delete a Copilot Studio agent from a Dataverse environment (cloud) using PAC. This is a destructive operation and always requires explicit user confirmation before anything is deleted. Use when the user asks to delete, remove, or destroy an agent in an environment.
argument-hint: [agent name, bot id, or schema name] [environment id or url]
allowed-tools: Bash(pac auth *), Bash(pac copilot list *), Bash(pac copilot delete *), Read, Glob, Grep
context: fork
---

# Delete Agent (Cloud)

Delete a Copilot Studio agent from a Dataverse environment using the Power Platform CLI (`pac`).

> **This is a destructive, irreversible cloud operation.** It deletes the agent record from the target
> environment. You MUST get explicit user confirmation (see Phase 3) before passing `--confirm`. Never
> delete without showing the user exactly what will be removed first.

This is a standalone skill on purpose: the plugin's Manage agent explicitly excludes `delete` from its ALM
scope, so deletion lives here with its own guardrail rather than inside the sync/publish flow.

## Scope

- This skill deletes the agent **in the cloud environment** (the Dataverse `bot` record).
- It does **not** delete local workspace files. If the user also wants the local folder removed, tell them
  which folder it is and let them delete it themselves - do not delete local files as part of this skill.
- It does not publish, pull, push, or otherwise modify other agents.

## Prerequisite: PAC version

This skill relies on `pac copilot delete`, which requires PAC CLI **>= 2.9.3**. If `pac` is missing or older,
stop and tell the user to install the required version from
https://learn.microsoft.com/en-us/power-platform/developer/cli/introduction#install-microsoft-power-platform-cli.
Do not install PAC yourself unless the user explicitly asks.

## Phase 0: Resolve the target agent and environment

You need two things: a **bot identifier** (`--bot`, either the Copilot ID GUID or the schema name) and an
**environment** (`--environment`, a GUID or Dataverse URL).

Resolve them in this order:

1. **From a local workspace.** Auto-discover the agent - never hardcode a name:
   ```
   Glob: **/agent.mcs.yml
   ```
   - Read the schema name / bot id from `settings.mcs.yml` or `agent.mcs.yml` (look for `schemaName` and, if
     present, the bot/agent id).
   - Read the environment from the sibling `.mcs/conn.json` (`EnvironmentId`) if it exists.
   - If multiple workspaces are found, present a numbered pick-list; never silently pick the first.
2. **From a Copilot Studio URL.** If the user pastes a URL containing
   `/environments/<environmentId>/bots/<botId>/`, extract both IDs and use them.
3. **Ask the user.** If neither the bot identifier nor the environment can be resolved, ask for the missing
   value. Prefer a schema name or bot id already present in project files or user-provided context.

## Phase 1: Authenticate

Commands that talk to Dataverse require an authenticated PAC profile. Run this only when no active profile
exists or a command reports an auth/profile error:

```bash
pac auth create
```

Let the user complete sign-in, then continue.

## Phase 2: Confirm the agent exists

List agents in the target environment and confirm the target is present before attempting deletion:

```bash
pac copilot list --environment "<environment-id-or-dataverse-url>"
```

- Match the target by display name, schema name, or bot id and capture its identity.
- If the agent is **not** in the list, stop and tell the user it was not found in that environment (it may
  already be deleted or you may have the wrong environment). Do not run delete.

## Phase 3: Explicit confirmation (MANDATORY)

Before deleting, show the user exactly what will be removed and require an explicit, unambiguous yes:

> **You are about to permanently delete this agent from the cloud:**
> - Agent: `<display name>`
> - Bot id / schema name: `<id-or-schema>`
> - Environment: `<environment-id-or-url>`
>
> This cannot be undone. Type **delete** to confirm, or anything else to cancel.

Rules:
- Only proceed if the user clearly confirms (e.g. "delete", "yes, delete it").
- If the response is ambiguous, negative, or empty, **cancel** and report that nothing was deleted.
- Never pass `--confirm` unless the user has explicitly confirmed in this phase.

## Phase 4: Delete

Only after explicit confirmation, run:

```bash
pac copilot delete --bot "<bot-id-or-schema-name>" --environment "<environment-id-or-dataverse-url>" --confirm
```

- `--confirm` (`-y`) is required for the delete to actually execute.
- Read the command output directly and surface any error in full.

## Phase 5: Verify and report

Confirm the deletion took effect:

```bash
pac copilot list --environment "<environment-id-or-dataverse-url>"
```

- Confirm the agent no longer appears.
- Report: which agent (name + id) was deleted, from which environment, and whether the verification listing
  confirms it is gone.
- If the user has a local workspace for this agent, remind them the **local files were not deleted** and tell
  them the folder path so they can remove it if they wish.

## Error Handling

| Error | Likely cause | Resolution |
|---|---|---|
| Authentication or active profile error | No/invalid PAC auth profile | Run `pac auth create`, then retry. |
| Agent not found in list | Wrong environment, or already deleted | Verify the environment and bot identifier; do not run delete. |
| Delete reports insufficient permissions | User lacks maker/admin rights on the agent | Ask the user to confirm they have delete permission in that environment. |
| Delete succeeds but agent still listed | Deletion still propagating | Re-run `pac copilot list` after a moment; if it persists, report the raw output. |
| `pac copilot delete` unknown/invalid command | PAC older than 2.9.3 | Ask the user to upgrade PAC to >= 2.9.3. |

## Final answer

Keep it short and factual: the agent deleted (name + id), the environment, confirmation that it no longer
appears in the listing, and the reminder about local files if a local workspace exists.
