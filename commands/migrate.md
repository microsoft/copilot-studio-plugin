---
description: Migrate a Copilot Studio agent from the previous architecture to the new agentic loop, cloning it first if it is not already present locally.
argument-hint: Agent name or path to describe (and source environment if it must be cloned)
allowed-tools: Bash(node *ensure-prerequisites.js*), Bash(node *convert-actions-to-tools.js*), Read, Glob, Grep, Task
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

With the source agent available locally, read the selected source agent's display name from `agent.mcs.yml` under `displayName`, and read the target environment ID from the selected source agent's `.mcs\conn.json` under `EnvironmentId` (migrating in a different environment is not yet supported).

You'd need to initialize the new/migrated agent, and for its display name you should choose exactly `NEW <source displayName>`

Use a new target project directory in the workspace named exactly like the migrated agent display name (`NEW <source displayName>`) unless the user explicitly supplied a different directory.

Delegate initialization to the **Copilot Studio Init** sub-agent (you can use a good, mid-tier AI model). Tell it the exact migrated agent display name, target project directory, and environment ID. Don't be too long in its task. The init sub-agent requires shorter task descriptions (as opposed to the architect sub-agent for example).

After the init sub-agent completes, confirm the target agent's `settings.mcs.yml` exists before continuing. This step MUST be completed before migrating tools or implementing migration steps, but can be run in parallel with the "describe old agent" step.

### 5. Describe the source agent

With the source agent available locally, delegate the description to the **Copilot Studio Describer** sub-agent (you MUST use the best of the bests AI model, high reasoning effort). Give it the selected source agent path explicitly, not the newly initialized target agent path. It is read-only: it reads the source agent's files, asks any needed clarification questions, and produces a detailed descriptive report, that will be later used by the architect sub-agent to implement the migrated agent YAML.

### 6. Migrate tools and actions
The tool migration process converts the legacy YAML format of actions (located in the \actions folder in the legacy agent) to the new format (to be placed in capabilities\tools in the new agent). The procedure is as follows:
Step 1: Check for legacy actions. Verify if the \actions folder exists in the legacy agent. If it does not exist, no actions need to be migrated; you can proceed directly to the next steps of the migration.
Step 2: Prepare the destination folder. If the \actions folder exists, check if the capabilities\tools folder exists in the new agent. If it does not exist, create it.
Step 3: Run the migration script. Execute the migration script: node scripts\convert-actions-to-tools.js <legacy-actions-folder> <new-tools-folder>
The script will convert all connector and MCP servers, but will automatically skip any workflows, AI Prompts, or other unsupported actions. If the script encounters unsupported actions, do not worry. Capture the converted-tool summary and the skipped unsupported action list, then pass both to the Architect agent in the subsequent step so that the behavior can be manually refactored into instructions, skills, knowledge, or explicit open gaps.

### 7. Implement the migrated agent YAML
After the describer produces its report and tool/action migration is complete, give the agent description as input specs for the **Copilot Studio Architect** sub-agent (you MUST use the best of the bests AI model, high reasoning effort), and ask it to modify the newly initialized modern agent project directly.

The architect sub-agent must receive:

1. The selected source agent path.
2. The newly initialized target agent project directory.
3. The migrated target display name (`NEW <source displayName>`).
4. The target environment ID.
5. The complete Copilot Studio Describer report.
6. The tool/action migration result, including migrated tools and unsupported skipped actions.

Tell the architect explicitly that the final migration artifact is the YAML written under the target project directory. If the describer report identifies gaps or uncertainties in understanding the original agent, discuss implementation strategies with the user before proceeding, and highlight those to the architect so it can make reasonable assumptions where needed to complete the YAML implementation, while listing any unresolved gaps in its final response.

After the architect completes, confirm that the target project still contains `settings.mcs.yml` and that the architect reports concrete YAML file or component-area changes. If the architect returns only a JSON/design proposal without writing files, treat the migration as incomplete and re-run or stop with that error instead of presenting the migration as complete.

### 8. Push the migrated agent to the target environment

After the architect completes, delegate the push to the **Copilot Studio Manage** sub-agent (you can use a good, mid-tier AI model). Provide it with the target project directory and target environment ID. Confirm that the push was successful before completing the migration workflow.


---

## Output Guidance

Deliver the actual migration outcome: where the migrated modern agent YAML was written, which target files or component areas were changed, which migrated tools were preserved, and any unresolved gaps or assumptions. Do not stop at component guidance or a proposed design.
