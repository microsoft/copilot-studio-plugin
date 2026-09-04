---
user-invocable: true
description: Push local Copilot Studio agent YAML changes up to the Dataverse environment (sync local -> cloud). Use when the user asks to save, sync up, or upload local agent edits.
argument-hint: [agent project path]
allowed-tools: Bash(pac auth *), Bash(pac copilot pull *), Bash(pac copilot push *), Read, Glob, Grep
context: fork
agent: copilot-studio-manage
---

# Push Agent

Thin wrapper over the **Copilot Studio Manage** agent for the **push** operation only.

The user wants to upload local agent edits to the cloud. Perform a push using the Manage agent's ALM rules:

1. Identify the agent workspace (`Glob: **/agent.mcs.yml`; environment from the sibling `.mcs/conn.json`).
2. Authenticate first if needed (`pac auth create`).
3. **Always pull before push** so local is based on the latest server state, then push.
4. If push reports there is nothing to send, tell the user the agent is already up to date.
5. Surface any schema/validation error from push verbatim.

Do **only** the pull-then-push. Do not publish as part of this skill unless the user asks (use the publish
skill for that).
