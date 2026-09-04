---
user-invocable: true
description: Clone an existing Copilot Studio agent from a Dataverse environment into a local workspace (downloads its YAML files). Use when the user wants to pull down or clone an agent they do not have locally yet.
argument-hint: [agent name, Copilot Studio url, or environment hint]
allowed-tools: Bash(pac auth *), Bash(pac copilot list *), Bash(pac copilot clone *), Read, Glob, Grep
context: fork
agent: copilot-studio-manage
---

# Clone Agent

Thin wrapper over the **Copilot Studio Manage** agent for the **clone** operation only.

The user wants to clone an agent from the cloud into a local workspace. Perform a clone using the Manage
agent's ALM rules:

1. Resolve the target **environment** (from a discovered `.mcs/conn.json`, a pasted Copilot Studio URL, or by
   asking the user for the environment id / Dataverse URL). Never hardcode it.
2. Authenticate first if there is no active PAC profile or a command reports an auth error (`pac auth create`).
3. Run the clone, then confirm the result with `Glob: **/agent.mcs.yml` and check that `.mcs/conn.json` was
   written.
4. Report which agent was cloned and where its files live.

Do **only** the clone. Do not push, pull, publish, edit, or delete the agent.
