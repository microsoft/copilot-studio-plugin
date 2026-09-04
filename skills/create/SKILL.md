---
user-invocable: true
description: Create (initialize) a new empty CLI-authoring Copilot Studio agent project in a target environment via `pac copilot init`. Use when the user wants to create a brand-new agent or scaffold a migration target project.
argument-hint: [display name] [target project directory] [environment id]
allowed-tools: Bash(pac auth *), Bash(pac copilot init *), Read, Write, Glob, Grep
context: fork
agent: copilot-studio-init
---

# Create Agent

Thin wrapper over the **Copilot Studio Init** agent for the **create/init** operation only.

The user wants to create a new empty agent project. Delegate to the Init agent, which runs the single
`pac copilot init` command. Collect the required inputs first, deriving nothing that was not provided:

1. **Display name** for the new agent.
2. **Target project directory.**
3. **Target environment id.**
4. Optional **publisher prefix** for the solution/components (falls back to the Init agent's default if not
   given).

Authenticate first if there is no active PAC profile (`pac auth create`). Then run init and report the created
project location.

Do **only** the initialization. Do not describe, design, edit, migrate, validate, test, or publish the agent.
