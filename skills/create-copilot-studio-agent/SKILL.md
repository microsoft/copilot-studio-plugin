---
name: create-copilot-studio-agent
description: Create a new Microsoft Copilot Studio CLI-authored agent project from a natural-language description, using the proper settings, behaviors, capabilities, infrastructure, and PAC synchronization structure. Use when the user asks to create, scaffold, initialize, or build a new MCS or Copilot Studio agent/project.
---

# Create a Copilot Studio Agent

Create a new **Copilot Studio CLI-authored agent** from a natural-language description. Collect the
required project identity, initialize a sync-connected workspace, implement the agent with the
modern YAML structure, validate it, and push it to Copilot Studio.

This skill creates and pushes the agent, but does not publish it unless the user explicitly requests
publication and confirms the publication warning.

## Required collaborators

Use these plugin agents in this order:

1. **Copilot Studio Init** — creates the empty sync-connected project.
2. **Copilot Studio Manage** — pulls before editing, pushes afterward, and performs the final pull.
3. **Copilot Studio Architect** — implements the requested behavior in the initialized project.

Do not replace their responsibilities with improvised PAC commands or hand-created workspace files.

## Process

### 1. Parse the request

Extract any values already supplied by the user:

- Agent behavior description.
- Agent display name.
- Target project directory.
- Target environment ID or absolute Dataverse HTTPS URL.
- Publisher customization prefix.

The behavior description should identify enough of the following to design the agent:

- role and primary jobs
- intended users
- tone and response style
- clarification and confirmation behavior
- knowledge sources
- live-data requirements
- external actions or integrations
- safety, privacy, and escalation constraints

Do not require the user to name YAML components. The Architect decides whether each requirement
belongs in instructions, knowledge, tools, or skills.

### 2. Resolve project identity

Resolve these values before initialization:

1. **Display name.** Use an explicit user-provided name when present. Otherwise derive a concise,
   human-readable name from the behavior description and show it with the other resolved values.
2. **Project directory.** Use an explicit path when present. Otherwise derive a slugified directory
   under the current working directory. Resolve it to an absolute path.
3. **Environment.** Require an environment ID or absolute Dataverse HTTPS URL. If the request
   contains a Copilot Studio URL with `/environments/<environmentId>/`, extract the environment ID.
   Do not silently select an environment when several are plausible.
4. **Publisher prefix.** Use an explicit value when present. Otherwise default to `catmgr`. Validate
   it: 2-8 alphanumeric characters, starts with a letter, and does not start with `mscrm`
   case-insensitively. Preserve the user's casing.

Ask only for values that cannot be safely derived. Before initialization, state the resolved display
name, absolute project directory, environment, and publisher prefix.

### 3. Protect the destination

Check the target project directory:

- If it does not exist, continue.
- If it contains `settings.mcs.yml`, `agent.sync.yaml`, and `.mcs\`, treat it as an existing
  sync-connected CLI workspace. Do not initialize over it. Ask whether to resume or use another
  directory.
- If it exists but is incomplete or is not a Copilot Studio workspace, stop. Do not delete,
  overwrite, or merge into it. Ask the user to choose another directory or explicitly clean up the
  existing path themselves.

### 4. Initialize the workspace

Delegate to **Copilot Studio Init** with exactly:

- display name
- absolute target project directory
- environment ID or URL
- validated publisher prefix

The Init agent must run one `pac copilot init` command with `--authoring-mode cli-copilot`.

After it completes, verify:

- `<project>\settings.mcs.yml` exists
- `<project>\agent.sync.yaml` exists
- `<project>\.mcs\` exists
- `settings.mcs.yml` contains the expected display name and a nonempty `schemaName`
- `configuration.recognizer.kind` is `CLICopilotRecognizer` or `CLIAgentRecognizer`
- `configuration.authoringModel` is `CliCopilot`

If initialization fails or a marker is missing, stop and report the exact failure. Never create the
missing workspace files manually.

Read `.mcs\conn.json` only to assess client compatibility; never edit it. Record whether
`AgentManagementEndpoint` is a nonempty URL.

- A PAC-initialized or PAC-cloned workspace can have `AgentManagementEndpoint: null`. PAC pull and
  push may still work because PAC uses its external auth profile, but the Copilot Studio VS Code
  extension rejects that workspace as having incomplete connection settings.
- Do not repair the field manually and do not repeatedly clone with PAC; PAC can reproduce the same
  null endpoint.
- Mark the workspace as requiring extension reattachment. Tell the user to update or reload the
  Copilot Studio extension and run **Copilot Studio: Reattach Agent** from the VS Code Command
  Palette, selecting the same environment and agent. Current extension builds can also attempt an
  on-demand endpoint repair for PAC-cloned workspaces.
- If reattachment is unavailable or fails, use the extension's Clone Agent workflow to clone the
  already-pushed remote agent into a new folder, then open that extension-created workspace.

Missing `AgentManagementEndpoint` is a VS Code extension-readiness warning, not proof that the PAC
workspace or remote agent is invalid. Continue the PAC-based creation workflow, but do not report
the project as extension-ready until reattachment or an extension clone supplies complete metadata.

### 5. Pull before implementation

Delegate a pull to **Copilot Studio Manage** for the initialized project. Do not start implementation
until pull completes successfully.

### 6. Build the implementation brief

Turn the request into a concrete brief for the Architect. Include:

- exact target project directory
- new-agent mode, not migration mode
- resolved display name and `schemaName`
- role, users, capabilities, tone, clarification rules, and safety constraints
- concrete knowledge URLs or local files
- live-data and external-action requirements
- existing tools, knowledge, skills, and connections in the workspace
- assumptions and unresolved integration details

For current or live data, require a real tool when API-level reliability is expected. Do not claim a
connector-backed capability is implemented unless the environment has the required connection and
the project has a valid connection reference. A public website knowledge source is only a
best-effort fallback and must be identified as such.

### 7. Implement with the Architect

Delegate the brief to **Copilot Studio Architect**. Require it to write the complete YAML
implementation into the initialized project, not merely return a design.

The Architect must:

- preserve initialized identity and synchronization fields
- write global behavior into `settings.mcs.yml`
- place reusable procedures under `behaviors\`
- place knowledge under `capabilities\knowledge\`
- place tools under `capabilities\tools\` only when complete tool and connection metadata exists
- use the publisher customization prefix from `schemaName` for every newly authored flat component
  filename and keep the complete derived component schema within Dataverse's 100-character limit
- leave `.mcs\` and `agent.sync.yaml` untouched
- report exact files changed and unresolved gaps

If the Architect returns only a proposal or makes no concrete file changes, creation is incomplete.

### 8. Run the structural gate

Before push, inspect the resulting workspace and block on any failure:

1. `settings.mcs.yml`, `agent.sync.yaml`, and `.mcs\` still exist.
2. Initialized `displayName`, `schemaName`, recognizer, and authoring model are preserved.
3. Every new component is under `behaviors\`, `capabilities\`, or `infrastructure\`.
4. Every authored `*.mcs.yml` component except `settings.mcs.yml` contains `mcs.metadata` and
   `kind`.
5. Every new flat bot-component filename starts with the publisher customization prefix derived from
   `schemaName`, followed by `_` or `.`. For example, a `catmgr_...` agent uses
   `catmgr_getweather_a1B2c3.mcs.yml`. Do not repeat a long full agent `schemaName` in every filename
   when that would make the derived Dataverse component schema too long.
6. For each new flat component, conservatively calculate
   `<agent-schemaName> + "." + <filename-without-.mcs.yml>` and require at most 100 characters.
   Shorten the slug, never the publisher prefix or uniqueness suffix, when over budget.
7. Knowledge components follow `reference/knowledge-schema.md`, including its filename budget.
8. No connector tool contains an invented or placeholder `connectionReference`, connector ID,
   operation ID, input, or output.
9. Live-data behavior uses a real tool or is explicitly described as a best-effort grounded
   fallback that must not fabricate results.
10. `.mcs\` and `agent.sync.yaml` were not authored or modified by the Architect.
11. `.mcs\conn.json` was inspected without modification. If `AgentManagementEndpoint` is null or
    empty, record that VS Code extension reattachment is required; do not block PAC push solely for
    this reason.

If a filename lacks the required namespace, rename it before push:

```text
<publisher-prefix>_<budgeted-slug>_<short-unique-id>.mcs.yml
```

Never wait for Dataverse to discover a predictable prefix error.

### 9. Push and verify

Delegate push to **Copilot Studio Manage**. It must follow its normal pull-before-push rules and
surface conflicts rather than overwrite remote changes.

After a successful push, delegate one final pull:

- Zero applied changes confirms local and remote synchronization.
- If remote changes are applied, inspect them and confirm that the authored components still exist
  in PAC's canonical layout.

Do not publish unless explicitly requested. Publication requires the Manage agent's standard warning
and explicit confirmation.

### 10. Report

Report:

- display name
- project directory
- environment
- agent ID and schema name when available
- component areas and principal files created
- push result
- final synchronization result
- unresolved connectors, knowledge, or live-data limitations
- VS Code extension readiness, including whether **Copilot Studio: Reattach Agent** is required
- publication status

Do not claim an unavailable integration works. Do not dump complete YAML unless requested.

## Resumability and errors

- Preserve a successfully initialized workspace when a later phase fails.
- Resume an existing sync-connected workspace only after the user chooses to resume it.
- If files already exist, inspect and continue from the first incomplete phase rather than creating
  duplicate components.
- On `ExportKeyAttributeInvalidPrefix`, correct new component paths to start with the valid
  publisher customization prefix before retrying.
- On `StringLengthTooLong` for `botcomponent.schemaname`, shorten component filename slugs until the
  conservative derived-name calculation is at most 100 characters.
- On push conflicts, use the Manage agent's pull-and-resolve workflow.
- If a connector connection is unavailable, do not invent it. Report the gap and either omit that
  capability or use a clearly disclosed best-effort knowledge fallback when appropriate.
- If VS Code reports incomplete `.mcs\conn.json` settings and `AgentManagementEndpoint` is null,
  direct the user to **Copilot Studio: Reattach Agent** or the extension's Clone Agent workflow.
  Never hand-edit `.mcs\conn.json`.
