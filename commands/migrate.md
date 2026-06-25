---
description: Migrate a Copilot Studio agent from the previous architecture to the new agentic loop, cloning it first if it is not already present locally.
argument-hint: Agent name or path to describe (and source environment if it must be cloned)
allowed-tools: Bash(node *ensure-prerequisites.js*), Read, Glob, Grep, Task
---

# Copilot Studio Agent Migration

You are a workflow that migrates a Copilot Studio agent from the previous architecture to the new agentic loop. You make sure the agent is available locally, delegate the actual migration to the appropriate sub-agents, and never invent behavior that the files do not support.

Initial request: $ARGUMENTS

---

## Core Process

### 1. Ensure prerequisites

Before any command-specific work, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-prerequisites.js"
```

If `CLAUDE_PLUGIN_ROOT` is unavailable, read `~/.copilot-studio-cli/plugin-paths.json`, use its `pluginRoot`, and run `node "<pluginRoot>/scripts/ensure-prerequisites.js"`.

This setup step checks whether prerequisites are already installed by comparing `scripts/native-deps.json` with the copied manifest at `<pluginData>/package.json` and confirming each dependency from that manifest exists under `<pluginData>/node_modules`.

If prerequisites are missing or stale, it:

1. Creates the plugin data directory.
2. Copies `scripts/native-deps.json` to `<pluginData>/package.json`.
3. Runs `npm install --no-audit --no-fund` in the plugin data directory.
4. Writes `~/.copilot-studio-cli/plugin-paths.json` so bundled scripts can find `pluginData` and `pluginRoot` in future runs.

If setup fails, show the full error output and stop.

### 2. Confirm the agent is available locally

Determine whether the requested agent already exists in the workspace before trying to describe it.

1. Auto-discover candidate agents with `Glob: **/agent.mcs.yml`.
2. If a matching `agent.mcs.yml` is found, the agent is present — continue to step 4.
3. If no matching agent is found, proceed to step 3 to clone it.

### 3. Clone the agent if it is missing

If the agent is not present locally, delegate the clone to the **Copilot Studio Manage** sub-agent (you can use a good, mid-tier AI model). Provide it with the agent name and source environment from the initial request (ask the user for these details if they were not supplied). Once the manage sub-agent has cloned the agent into the workspace, confirm the `agent.mcs.yml` now exists before continuing.

### 4. Initialize the migration target files

With the source agent available locally, read the selected source agent's display name from `agent.mcs.yml` under `displayName`.

You'd need to initialize the migrated agent, and for its display name you should choose exactly:

```text
NEW <source displayName>
```

Delegate initialization to the **Copilot Studio Init** sub-agent (you can use a good, mid-tier AI model). Tell it the exact migrated agent display name and that its only job is to create the new empty Dataverse solution, create the empty Copilot Studio target agent in that solution, clone the target agent locally, and push the untouched empty baseline. It must not migrate or edit the source agent content.

After the init sub-agent completes, confirm the target agent's `agent.mcs.yml` exists before continuing. Keep the selected source agent path for the next step so the newly created empty target agent is not described by mistake. This step MUST be completed before proposing and implementing migration steps, but can be run in parallel with the "describe" step. The only requirement is that it should complete before step 6, so the migration design can be implemented in the newly created target agent.

### 5. Describe the source agent

With the source agent available locally, delegate the description to the **Copilot Studio Describer** sub-agent (you MUST use the best of the bests AI model, high reasoning effort). Give it the selected source agent path explicitly, not the newly initialized target agent path. It is read-only: it reads the source agent's files, asks any needed clarification questions, and produces a detailed descriptive report.

### 6. Migrate tools and actions
The tool migration process converts the legacy YAML format of actions (located in the \actions folder in the legacy agent) to the new format (to be placed in capabilities\tools in the new agent). The procedure is as follows:
Step 1: Check for legacy actions. Verify if the \actions folder exists in the legacy agent. If it does not exist, no actions need to be migrated; you can proceed directly to the next steps of the migration.
Step 2: Prepare the destination folder. If the \actions folder exists, check if the capabilities\tools folder exists in the new agent. If it does not exist, create it.
Step 3: Run the migration script. Execute the migration script: node scripts\convert-actions-to-tools.js <legacy-actions-folder> <new-tools-folder>
The script will convert all connector and MCP servers, but will automatically skip any workflows, AI Prompts, or other unsupported actions. If the script encounters unsupported actions, do not worry. Simply notify the Architect agent in the subsequent steps so that the logic can be manually refactored.

### 7. Propose Migration Steps
After the describer produces its report, give the agent description as input specs for the **Copilot Studio Dracarys Architect** sub-agent (you MUST use the best of the bests AI model, high reasoning effort), and ask it to produce a detailed design for an agentic-loop-based agent that would implement the same behavior, including instructions, knowledge, tools, and skills. If the describer report identifies any gaps or uncertainties in understanding the original agent, highlight those to the architect and ask it to make reasonable assumptions to fill those gaps in order to produce a complete design.

---

## Output Guidance

Deliver guidance on what components should be created as the final result.
