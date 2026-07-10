---
description: Migrate a Copilot Studio agent from the previous architecture to the new agentic loop, cloning it first if it is not already present locally.
argument-hint: Agent name or path to describe (and source environment if it must be cloned)
allowed-tools: Bash(pac), Bash(node *convert-actions-to-tools.js*), Read, Write, Glob, Grep, WebFetch(domain:raw.githubusercontent.com), Task
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

### 1a. Verify the PAC CLI prerequisite (blocking)

Before any command-specific work, run `pac` and read the PAC CLI version from the command output. Continue only when the installed PAC CLI version is greater than or equal to `2.9.3`.

If `pac` is unavailable, the version cannot be determined, or the version is less than `2.9.3`, stop the migration and tell the user to install the required PAC CLI version from https://learn.microsoft.com/en-us/power-platform/developer/cli/introduction#install-microsoft-power-platform-cli.
Don't install PAC CLI yourself, except if the user explicitly requests it. If you do install it because the user explicitly asked you, the only installation allowed is the official `dotnet tool install --global Microsoft.PowerApps.CLI.Tool`. Instead, if the user is installing it themselves, you may also use different methods such as the windows-specific MSI or other platform-specific methods.

### 1b. Check plugin health (best effort)

Run both checks below before the migration logic. These checks are important but non-blocking: make one reasonable attempt using the documented procedures and locations, but do not search alternative directories or repeatedly retry failures; you can continue if a file, property, directory, remote response, or valid version cannot be obtained.

First, read `path.join(os.homedir(), '.copilot-studio-cli', 'plugin-paths.json')` and get the `pluginRoot` for the current `mcs-assistant` plugin. Use that value for both checks.

#### Legacy plugin

The current plugin, `mcs-assistant@copilot-studio-plugin`, supports modern-orchestration agents. The legacy plugin, `copilot-studio@skills-for-copilot-studio`, supports only classic orchestration and may conflict with the current plugin.
1. Go up two directory levels from `pluginRoot` to find the installed plugins root directory.
2. Check whether that directory contains `skills-for-copilot-studio`.
3. If it is present, pause and warn the user that removing or disabling the legacy plugin is recommended. Ask the user whether they want to remove or disable it, but continue the migration if they choose not to.

#### Current plugin version

1. Read the installed version from the `version` property in `path.join(pluginRoot, '.claude-plugin', 'plugin.json')`.
2. Fetch the available version from the `version` property at https://raw.githubusercontent.com/microsoft/copilot-studio-plugin/refs/heads/main/.claude-plugin/plugin.json.
3. Compare the versions using semantic-version precedence, not lexicographic string ordering.
4. If the available version is newer, pause before continuing and use `ask_user` to show both version numbers and ask whether the user wants to update first. Offer **Update before migrating** and **Continue without updating**. If they choose to update, tell them to run `/plugin update mcs-assistant@copilot-studio-plugin`, then stop this migration run so they can update and rerun `/migrate`; do not update the plugin automatically. If they choose to continue, proceed with the installed version.
5. If the installed version is current or newer, continue without prompting.

If either check cannot be completed, briefly note which check was skipped and why, then continue. A Phase 1b failure must never stop the migration by itself.

### 2. Confirm the agent is available locally

Determine whether the requested agent already exists in the workspace before trying to describe it.
1. Auto-discover candidate agents with `Glob: **/agent.mcs.yml`.
2. If a matching `agent.mcs.yml` is found, the agent is present — continue to step 4.
3. If no matching agent is found, proceed to step 3 to clone it.

### 3. Clone the agent if it is missing

If the agent is not present locally, delegate the clone to the **Copilot Studio Manage** sub-agent (you can use the latest good, mid-tier AI model). Provide it with the agent name and source environment from the initial request (ask the user for these details if they were not supplied). Once the manage sub-agent has cloned the agent into the workspace, confirm the `agent.mcs.yml` now exists before continuing.

### 4. Initialize the migration target files

With the source agent available locally, read the selected source agent's display name from `agent.mcs.yml` under `displayName`, and read the target environment ID from the selected source agent's `.mcs\conn.json` under `EnvironmentId` (migrating in a different environment is not yet supported).

You'd need to initialize the new/migrated agent, and for its display name you should choose exactly `<source displayName> (migrated)`. If the display name is exceeding 30 characters, propose to the user some shorter alternatives that still clearly indicate the agent is migrated. Ask the user to approve one of the proposed display names or provide a different one.

Use a new target project directory in the workspace named exactly like the migrated agent display name (`<source displayName> (migrated)`) unless the user explicitly supplied a different directory.

Delegate initialization to the **Copilot Studio Init** sub-agent (you can use the latest good, mid-tier AI model). Tell it the exact migrated agent display name, target project directory, and environment ID. Don't be too long in its task. The init sub-agent requires shorter task descriptions (as opposed to the architect sub-agent for example).

After the init sub-agent completes, confirm the target agent's `settings.mcs.yml` exists before continuing. This step MUST be completed before migrating tools or implementing migration steps, but can be run in parallel with the "describe old agent" step.

### 5. Describe the source agent

With the source agent available locally, delegate the description to the **Copilot Studio Describer** sub-agent (you MUST use the latest best of the bests AI model, with high reasoning effort). Give it the selected source agent path explicitly, not the newly initialized target agent path. It is read-only: it reads the source agent's files, asks any needed clarification questions, and produces a detailed descriptive report, that will be later used by the architect sub-agent to implement the migrated agent YAML. Run the describer in the background so you can keep its session alive for iteration in the next step.

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

Step 1: Check the approved migration plan. If there are no actions with the `migrate` decision, do not run the converter. Record in the plan that no tools were auto-migrated, and carry any `manual` or `unsupported` decisions forward to the architect so that the architect can found other ways.
Step 2: If there are approved actions to migrate, check if the `capabilities\tools` folder exists in the new agent. If it does not exist, create it.
Step 3: Run the migration script using one command derived from the approved decisions.

- To migrate all directly supported actions, run: `node scripts\convert-actions-to-tools.js <legacy-actions-folder> <new-tools-folder> --all --report <tool-migration-report-json>`

- To migrate a selected subset, pass the approved action file names after `--include`: `node scripts\convert-actions-to-tools.js <legacy-actions-folder> <new-tools-folder> --include "<action-file-1.mcs.yml>" "<action-file-2.mcs.yml>" --report <tool-migration-report-json>`

- If the approved plan keeps almost every supported action except a few, you may instead use `--exclude` with the omitted action file names: `node scripts\convert-actions-to-tools.js <legacy-actions-folder> <new-tools-folder> --exclude "<skipped-action-file.mcs.yml>" --report <tool-migration-report-json>`

Do not use `--clean` with `--include` or `--exclude`; partial migration must not delete tools outside the selected subset.

Step 4: Capture the converted-tool report, including converted tools, unsupported or invalid selected actions, and intentionally excluded actions. Update the sibling `MIGRATION-PLAN-<random>.md` file with the tool migration result before proceeding.

The script will convert supported connector and MCP actions, but will automatically skip workflows, AI Prompts, or other unsupported actions. If selected actions are unsupported, do not treat that as a failure by itself. Capture the skipped unsupported action list and pass it to the Architect agent so that the behavior can be manually refactored into instructions, skills, knowledge, or explicit open gaps.

Step 5: If no converted tools are connector-backed, skip this step. A connector-backed tool is any converted tool with: `kind: ConnectorTool` OR `connectorId` OR `connectionReference`

For every converted connector tool:
1. Read the tool YAML under `<new-agent>\capabilities\tools\`.
2. Record the tool file path, `connectorId`, `connectionReference`, and `operationId`.
3. Run: `pac connection list --environment <target-environment-id>`
4. Determine whether the target environment has a usable connected connection for each required `connectorId`.

If any required connection is missing or not connected, stop before architect implementation and explain to the user that in order to migrate the connector-backed tools, they must either create the missing connection or otherwise you could skip/drop the functionality supported by that connector tool. Say to them that, if they want you to migrate those actions, they must create the missing connections by going to `https://make.preview.powerautomate.com/environments/<target-environment-id>/connections` and explicitly create the connections for each connector tool that is missing a usable connection.

Once you've explained this to the user, ask them to choose one of the following options:
- `I created the connections; re-check`
- `Skip/remove the connector tool for now`
- `Stop migration`

If the user decided to skip/remove the connector tool, update the migration plan to reflect that decision and continue with the migration. If the user created the connections, rerun:

```powershell
pac connection list --environment <target-environment-id>
```

Then identify the new raw connection ID for the required connector from `pac connection list`, such as `48e11359c0f344f9a495f649e515612a`. Do not invent or convert it to older formatted IDs like `shared-sharepointonline-...`.

Step 6: Create a dedicated Dataverse connection reference for the migrated agent (do not update that existing classic connection reference by default, because it may also be used by the source/classic agent or other components in the target environment). Instead, create a dedicated connection reference for the migrated agent and update the migrated tool YAML to use the new logical name.

First choose a unique logical name for the migrated connection reference. A good pattern is `<target-agent-schema-name>.cr.<connector-name>.<short-connection-id-or-random-suffix>`.

To create the new connection reference, you can write temporary .powerfx files to serve that goal to a temporary location (not the agent project directory) and run them with `pac power-fx run --environment <target-environment-id> --file <created-formula.powerfx> --echo`

You can create connection references with `Collect`. Do not use `Defaults('Connection References')`; the PAC Power Fx runner may recognize `Defaults` but not support it.

```powerfx
Collect('Connection References';
  {
    connectionreferencedisplayname: "<display-name>";
    connectionreferencelogicalname: "<new-migrated-connection-reference-logical-name>";
    connectorid: "<connector-id>";
    connectionid: "<raw-connection-id-from-pac-connection-list>"
  }
)
```

Run it with `pac power-fx run --environment <target-environment-id> --file <rebind-connection-reference.fx> --echo`

After creating the record, write a `ShowColumns()` verification query and confirm the new record exists with the expected `connectionid` and `connectorid`.

Then update the migrated tool YAML under `<new-agent>\capabilities\tools\` so its `connectionReference` uses the new dedicated logical name `connectionReference: <new-migrated-connection-reference-logical-name>`

If the referenced Dataverse `Connection References` record does not exist before push, push can fail with an error like `A record with the specified key values does not exist in connectionreference entity`. After updating the tool YAML, record the new connection-reference logical name, display name, `connectionid`, and `connectorid` in `MIGRATION-PLAN-<random>.md`.

If creating the new connection reference fails, stop and ask whether the user wants to create or bind the connection reference in the target solution UI, skip/remove the connector tool for now, or explicitly approve patching the existing classic connection reference.

### 7. Implement the migrated agent YAML
After the user has approved the migration plan (step 5b) and tool/action migration is complete, give the agent description as input specs for the **Copilot Studio Architect** sub-agent (you MUST use the latest best of the bests AI model, with high reasoning effort), and ask it to modify the newly initialized modern agent project directly.

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

After the architect completes, validate every authored `.mcs.yml` component file under the target project, including skills, tools, knowledge, and any other component folders: PAC derives each Dataverse `botcomponent.schemaname` from the file stem, so every bot-component file stem must start with a valid customization prefix for the target environment and must be no more than 100 characters long. If needed, rename files to short prefixed stems such as `<publisher>_filename.mcs.yml` before pushing

After that validation, delegate the push to the **Copilot Studio Manage** sub-agent (you can use the latest good, mid-tier AI model). Provide it with the target project directory and target environment ID. Confirm that the push was successful before completing the migration workflow. Publishing is not necessary.

## Output Guidance

Deliver the actual migration outcome: where the migrated modern agent YAML was written, which target files or component areas were changed, which migrated tools were preserved, and any unresolved gaps or assumptions. For the unresolved gaps/assumptions section, make sure to make it well-evident, possibly even using a different color for that section title. Do not stop at component guidance or a proposed design.
