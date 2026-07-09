---
description: Migrate a Copilot Studio agent from the previous architecture to the new agentic loop, cloning it first if it is not already present locally.
argument-hint: Agent name or path to describe (and source environment if it must be cloned)
allowed-tools: Bash(pac), Bash(node *convert-actions-to-tools.js*), Read, Write, Glob, Grep, Task
---

# Copilot Studio Agent Migration

You are a workflow that migrates a Copilot Studio agent from the previous architecture to the new agentic loop. You make sure the agent is available locally, delegate the actual migration to the appropriate sub-agents, and never invent behavior that the files do not support.

Initial request: $ARGUMENTS

---

## Core Process

### Resumability

Run the execution steps in their natural order, exactly as described below (tool migration → architect → push); each step depends on the previous one's output. You do not need a separate todo list to track this — the steps and the plan file below are the source of truth.

Persist the approved plan so a stopped migration can be resumed:

- When the user approves the migration plan (step 5a), write it to a Markdown file named `MIGRATION-PLAN-<random>.md`, where `<random>` is a short random string (e.g. 6-8 hex/alphanumeric chars) used only to keep the filename unique. Write it as a **sibling of the target project directory** (i.e., in the parent folder, next to the project — not inside it) so it is never packed or pushed with the agent.
- Update that same file after each subsequent major step completes (tool migration, architect, push), so it always reflects current state.
- At the start of a `/migrate` run, look for an existing `MIGRATION-PLAN-*.md` sibling to the resolved target/source workspace. If one exists and its plan is already approved, offer to resume from the next incomplete step instead of re-running describe and plan approval. If it exists but is not yet approved, re-present it for approval. If none exists, start fresh.

### 1. Ensure prerequisites

Before any command-specific work, run:

```bash
pac
```

Read the PAC CLI version from the command output. Continue only when the installed PAC CLI version is greater than or equal to `2.9.1`.

If `pac` is unavailable, the version cannot be determined, or the version is less than `2.9.1`, stop the migration and tell the user to install the required PAC CLI version from https://learn.microsoft.com/en-us/power-platform/developer/cli/introduction#install-microsoft-power-platform-cli.
Don't install PAC CLI yourself, except if the user explicitly requests it. If you do install it because the user explicitly asked you, the only installation allowed is the official `dotnet tool install --global Microsoft.PowerApps.CLI.Tool`. Instead, if the user is installing it themselves, you may also use different methods such as the windows-specific MSI or other platform-specific methods.

### 2. Confirm the agent is available locally

Determine whether the requested agent already exists in the workspace before trying to describe it.

1. Auto-discover candidate agents with `Glob: **/agent.mcs.yml`.
2. If a matching `agent.mcs.yml` is found, the agent is present — continue to step 4.
3. If no matching agent is found, proceed to step 3 to clone it.

### 3. Clone the agent if it is missing

If the agent is not present locally, delegate the clone to the **Copilot Studio Manage** sub-agent (you can use a good, mid-tier AI model). Provide it with the agent name and source environment from the initial request (ask the user for these details if they were not supplied). Once the manage sub-agent has cloned the agent into the workspace, confirm the `agent.mcs.yml` now exists before continuing.

### 4. Initialize the migration target files

With the source agent available locally, read the selected source agent's display name from `agent.mcs.yml` under `displayName`, and read the target environment ID from the selected source agent's `.mcs\conn.json` under `EnvironmentId` (migrating in a different environment is not yet supported).

You'd need to initialize the new/migrated agent, and for its display name you should choose exactly `<source displayName> (migrated)`. If the display name is exceeding 30 characters, propose to the user some shorter alternatives that still clearly indicate the agent is migrated. Ask the user to approve one of the proposed display names or provide a different one.

Use a new target project directory in the workspace named exactly like the migrated agent display name (`<source displayName> (migrated)`) unless the user explicitly supplied a different directory.

Delegate initialization to the **Copilot Studio Init** sub-agent (you can use a good, mid-tier AI model). Tell it the exact migrated agent display name, target project directory, and environment ID. Don't be too long in its task. The init sub-agent requires shorter task descriptions (as opposed to the architect sub-agent for example).

After the init sub-agent completes, confirm the target agent's `settings.mcs.yml` exists before continuing. This step MUST be completed before migrating tools or implementing migration steps, but can be run in parallel with the "describe old agent" step.

### 5. Describe the source agent

With the source agent available locally, delegate the description to the **Copilot Studio Describer** sub-agent (you MUST use the best of the bests AI model, high reasoning effort). Give it the selected source agent path explicitly, not the newly initialized target agent path. It is read-only: it reads the source agent's files, asks any needed clarification questions, and produces a detailed descriptive report, that will be later used by the architect sub-agent to implement the migrated agent YAML. Run the describer in the background so you can keep its session alive for iteration in the next step.

### 5a. Inventory legacy actions for plan input

Before building the user-approved migration plan, inspect the legacy action files so tool selection is decided in the same approval loop as all other migration scope decisions.

1. Check for an `actions` folder in the selected source agent path.
2. If the folder does not exist, note in the migration plan that no legacy actions were found.
3. If the folder exists, run the inventory command:

```bash
node scripts\convert-actions-to-tools.js <legacy-actions-folder> --list
```

Use the inventory and the describer report together to identify every legacy action's source file name, whole `mcs.metadata` object, `modelDisplayName`, `modelDescription`, `action.operationId`, support status, and likely relevance to the modern agent. The source file name is the stable selector to use later with `--include` or `--exclude`.

### 5b. Review and approve the migration plan (mandatory gate)

Before any tool migration or YAML implementation, the user must approve a **migration plan** derived from the description. This is a single iterative loop, not a set of discrete questions: you present one consolidated plan, the user approves or comments, and you re-present the whole updated plan each round until they confirm. The architect MUST NOT run until the user approves the plan.

1. **Build the plan from the description.** Using the describer's report, assemble one consolidated artifact that describes the agent being built, not just the legacy one. Make clear throughout that these capabilities are what the **new (migrated) agent will have** — i.e., what is being carried over and built into the modern agent. Include these parts:
   - **What the new agent is for** — the one-paragraph high-level summary, framed as the purpose of the migrated agent.
   - **Capabilities of the new agent** — the `Capability` vs `Behavior` table, presented as the capabilities that will become part of the migrated agent. State explicitly that approving the plan means these become the modern agent's capabilities. The `Capability` column is phrased from the agent's perspective using agent-as-actor verbs (e.g., "Retrieves the user's cases", not "View my cases"), covering both user-initiated capabilities and always-on ones (identifies user & country, handles language, formatting). The `Behavior` column describes what the agent does and its decision logic in plain language (no variables, connectors, flows, or topic names) and how the start-of-conversation context (country, language) shapes later answers.
   - **Tool/action migration decisions** — for each legacy action from step 5a, include a table with the action file name, the most important inventory fields (`mcs.metadata`, `modelDisplayName`, `modelDescription`, and `action.operationId`), support status, approved decision, and rationale. Use these decisions:
     - `migrate`: convert this action into a modern tool.
     - `skip`: intentionally exclude this action/capability from the modern agent.
     - `manual`: do not auto-convert; the architect should implement the behavior another way or list it as a gap.
     - `unsupported`: the action cannot be auto-converted; pass it to the architect for manual refactor or gap handling if the capability remains in scope.
   - **Migration plan** — for each open gap the describer surfaced (e.g., duplicate regional knowledge as topics vs sub-agents, non-migratable ServiceNow flows, language handling, country allow-lists, cleanup), propose how to handle it in the migration with a recommended approach, not just an open question. Make these proposals concrete so the user can react to a plan rather than start from a blank page.
   - Offer the full describer report on request.
2. **Present the whole plan and ask for approval** using the `ask_user` tool. Offer only two explicit choices — **Approve** (proceed to migration) and **Stop** — plus the free-text "Other" option that `ask_user` provides. Do not add a separate "request changes" choice: the free-text "Other" already lets the user request changes or comment on any part of the plan (description corrections, a different gap resolution, added guidance). Make the prompt clear that typing in "Other" is how to request changes.
3. **Iterate on comments.** If the user requests changes via the free-text answer, apply their feedback: for description corrections, send the feedback to the existing describer sub-agent (via `write_agent`) so it refines the same report with full context; for plan/gap-handling changes, update the proposals directly. Then re-present the **entire** plan in full again — the complete "what the new agent is for" paragraph, the full capabilities table with every row rendered, and the full migration plan — with the requested changes already applied. Do NOT show a diff, delta, or shorthand such as "same as above, minus the X row"; always render the whole updated plan from top to bottom so the user reviews the complete current state each round. Then ask for approval once more. Repeat until the user approves or stops.
4. Capture the approved plan — including the agreed handling for every gap and every tool/action migration decision — to pass forward to the architect as explicit decisions, not guesses. On approval, write the full plan to the sibling `MIGRATION-PLAN-<random>.md` file (see "Resumability") so it can be resumed or used as the architect's input spec. Only after the user approves the plan, continue to tool migration and implementation.

### 6. Migrate tools and actions
The tool migration process converts only the approved legacy actions from the `MIGRATION-PLAN-<random>.md` tool/action decisions table.

Step 1: Check the approved plan. If there are no actions with the `migrate` decision, do not run the converter. Record in the plan that no tools were auto-migrated, and carry any `manual` or `unsupported` decisions forward to the architect.

Step 2: Prepare the destination folder. If there are approved actions to migrate, check if the `capabilities\tools` folder exists in the new agent. If it does not exist, create it.

Step 3: Run the migration script using one command derived from the approved decisions:

- To migrate all directly supported actions, run:

```bash
node scripts\convert-actions-to-tools.js <legacy-actions-folder> <new-tools-folder> --all --report <tool-migration-report-json>
```

- To migrate a selected subset, pass the approved action file names after `--include`:

```bash
node scripts\convert-actions-to-tools.js <legacy-actions-folder> <new-tools-folder> --include "<action-file-1.mcs.yml>" "<action-file-2.mcs.yml>" --report <tool-migration-report-json>
```

- If the approved plan keeps almost every supported action except a few, you may instead use `--exclude` with the omitted action file names:

```bash
node scripts\convert-actions-to-tools.js <legacy-actions-folder> <new-tools-folder> --exclude "<skipped-action-file.mcs.yml>" --report <tool-migration-report-json>
```

Do not use `--clean` with `--include` or `--exclude`; partial migration must not delete tools outside the selected subset.

Step 4: Capture the converted-tool report, including converted tools, unsupported or invalid selected actions, and intentionally excluded actions. Update the sibling `MIGRATION-PLAN-<random>.md` file with the tool migration result before proceeding.

The script will convert supported connector and MCP actions, but will automatically skip workflows, AI Prompts, or other unsupported actions. If selected actions are unsupported, do not treat that as a failure by itself. Capture the skipped unsupported action list and pass it to the Architect agent so that the behavior can be manually refactored into instructions, skills, knowledge, or explicit open gaps.

### 7. Implement the migrated agent YAML
After the user has approved the migration plan (step 5b) and tool/action migration is complete, give the agent description as input specs for the **Copilot Studio Architect** sub-agent (you MUST use the best of the bests AI model, high reasoning effort), and ask it to modify the newly initialized modern agent project directly.

The architect sub-agent must receive:

1. The selected source agent path.
2. The newly initialized target agent project directory.
3. The migrated target display name (usually `<source displayName> (migrated)`).
4. The target environment ID.
5. The complete Copilot Studio Describer report and the approved migration plan (including the agreed handling for every gap and every tool/action decision).
6. The tool/action migration result, including migrated tools, intentionally excluded actions, unsupported skipped actions, and invalid selected actions.
7. The user's decisions on the open gaps, as captured in the approved plan (step 5b).

Tell the architect explicitly that the final migration artifact is the YAML written under the target project directory. If the describer report identifies gaps or uncertainties in understanding the original agent, discuss implementation strategies with the user before proceeding, and highlight those to the architect so it can make reasonable assumptions where needed to complete the YAML implementation, while listing any unresolved gaps in its final response.

After the architect completes, confirm that the target project still contains `settings.mcs.yml` and that the architect reports concrete YAML file or component-area changes. If the architect returns only a JSON/design proposal without writing files, treat the migration as incomplete and re-run or stop with that error instead of presenting the migration as complete.

### 8. Push the migrated agent to the target environment

After the architect completes, delegate the push to the **Copilot Studio Manage** sub-agent (you can use a good, mid-tier AI model). Provide it with the target project directory and target environment ID. Confirm that the push was successful before completing the migration workflow. Publishing is not necessary.


---

## Output Guidance

Deliver the actual migration outcome: where the migrated modern agent YAML was written, which target files or component areas were changed, which migrated tools were preserved, and any unresolved gaps or assumptions. Do not stop at component guidance or a proposed design.
