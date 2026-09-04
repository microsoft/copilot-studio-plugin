---
user-invocable: true
description: Pull the latest server-side changes for a locally cloned Copilot Studio agent (sync cloud -> local). Use before editing, or when the user asks to refresh / sync down the local agent files.
argument-hint: [agent project path]
allowed-tools: Bash(pac auth *), Bash(pac copilot pull *), Read, Glob, Grep
context: fork
agent: copilot-studio-manage
---

# Pull Agent

Thin wrapper over the **Copilot Studio Manage** agent for the **pull** operation only.

The user wants to sync the cloud agent's latest state into the local workspace. Perform a pull using the Manage
agent's ALM rules:

1. Identify the agent workspace (`Glob: **/agent.mcs.yml`; read the environment from the sibling
   `.mcs/conn.json`). If multiple workspaces exist, present a numbered pick-list; never silently pick one.
2. Authenticate first if needed (`pac auth create`).
3. Run the pull and report what changed locally.

Do **only** the pull. This is the correct first step before any local edit.
