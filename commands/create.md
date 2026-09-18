---
description: Create a new Copilot Studio CLI agent project, implement its behavior with the modern settings/knowledge/tools/skills structure, and push it to the target environment.
argument-hint: Agent description, optionally including display name, project directory, environment ID or URL, and publisher prefix
allowed-tools: Bash(pac), Read, Write, Glob, Grep, Task
---

# Create a Copilot Studio Agent

You are an orchestration workflow that creates a new **Copilot Studio CLI-authored agent** from a
natural-language description. You collect the required project identity, initialize a sync-connected
workspace, delegate YAML implementation to the Copilot Studio Architect, validate the structure, and
push the completed project to Copilot Studio.

Initial request: $ARGUMENTS

This command creates and pushes the agent, but does not publish it unless the user explicitly asks
to publish and confirms the Manage agent's publication warning.

---

## Core process

Run these phases in order. Do not skip initialization, architect implementation, structural checks,
or push.

### 1. Parse the request

Extract any values already supplied in `$ARGUMENTS`:

- Agent behavior description.
- Agent display name.
- Target project directory.
- Target environment ID or absolute Dataverse HTTPS URL.
- Publisher customization prefix.

The behavior description must identify enough of the following to design the agent:

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

### 2. Resolve required project identity

Resolve these values before initialization:

1. **Display name.** Use an explicit user-provided name when present. Otherwise derive a concise,
   human-readable name from the behavior description and show it to the user with the other derived
   defaults before initialization.
2. **Project directory.** Use an explicit path when present. Otherwise create a slugified directory
   name under the current working directory. Resolve it to an absolute path.
3. **Environment.** Require an environment ID or absolute Dataverse HTTPS URL. If the initial
   request contains a Copilot Studio URL with `/environments/<environmentId>/`, extract the
   environment ID. Do not silently select an environment when several are plausible.
4. **Publisher prefix.** Use an explicit value when present. Otherwise default to `catmgr`. Validate
   it before continuing: 2-8 alphanumeric characters, starts with a letter, and does not start with
   `mscrm` case-insensitively. Preserve the user's casing.

Ask only for values that cannot be safely derived. Before running initialization, clearly state the
resolved display name, absolute project directory, environment, and publisher prefix.

### 3. Protect the destination

Check the target project directory before initialization:

- If it does not exist, continue.
- If it contains `settings.mcs.yml`, `agent.sync.yaml`, and `.mcs/`, treat it as an existing
  sync-connected CLI workspace. Do not initialize over it. Ask whether to resume implementation in
  that workspace or use a different directory.
- If it exists but is incomplete or is not a Copilot Studio workspace, stop. Do not delete,
  overwrite, or merge into it. Ask the user to choose a different directory or explicitly clean up
  the existing path themselves.

### 4. Initialize the workspace

Delegate initialization to the **Copilot Studio Init** sub-agent. Give it exactly:

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

If initialization fails or any marker is missing, stop and report the exact failure. Do not create
the missing files manually.

### 5. Pull before implementation

Delegate a pull to the **Copilot Studio Manage** sub-agent for the initialized project. Do not start
the Architect until pull completes successfully.

### 6. Build the implementation brief

Turn the user's request into a concrete brief for the Architect. Include:

- exact target project directory
- new-agent mode, not migration mode
- resolved display name and the `schemaName` read from `settings.mcs.yml`
- role, users, capabilities, tone, clarification rules, and safety constraints
- concrete knowledge URLs or local files supplied by the user
- live-data and external-action requirements
- existing tools, knowledge, skills, and connections discovered in the initialized workspace
- assumptions made and unresolved integration details

For current or live data, explicitly require a real tool when API-level reliability is expected.
Do not claim a connector-backed capability is implemented unless the environment has the required
connection and the project has a valid connection reference. A public website knowledge source is
only a best-effort fallback and must be identified as such.

### 7. Implement with the Architect

Delegate the brief to the **Copilot Studio Architect** sub-agent. Require it to write the complete
YAML implementation into the initialized project rather than returning only a design.

The Architect must:

- preserve initialized identity and synchronization fields
- write global behavior into `settings.mcs.yml`
- place reusable procedures under `behaviors\`
- place knowledge under `capabilities\knowledge\`
- place tools under `capabilities\tools\` only when complete tool and connection metadata exists
- use the exact `schemaName` as the namespace for every newly authored component path
- leave `.mcs\` and `agent.sync.yaml` untouched
- report the exact files changed and any unresolved gaps

If the Architect returns only a proposal or no concrete file changes, treat creation as incomplete.

### 8. Run the structural gate

Before push, inspect the resulting workspace and block on any failure:

1. `settings.mcs.yml`, `agent.sync.yaml`, and `.mcs\` still exist.
2. Initialized `displayName`, `schemaName`, recognizer, and authoring model were preserved.
3. Every new component is under `behaviors\`, `capabilities\`, or `infrastructure\`.
4. Every authored `*.mcs.yml` component except `settings.mcs.yml` contains `mcs.metadata` and
   `kind`.
5. Every new flat bot-component filename starts with the exact `schemaName` followed by `.`. PAC may
   later normalize an inline skill into `behaviors\<component-schema-name>\skill.mcs.yml`; that
   synchronized shape is valid.
6. Knowledge components follow `reference/knowledge-schema.md`.
7. No connector tool contains an invented or placeholder `connectionReference`, connector ID,
   operation ID, input, or output.
8. Live-data behavior uses a real tool or is explicitly described as a best-effort grounded
   fallback that must not fabricate results.
9. `.mcs\` and `agent.sync.yaml` were not authored or modified by the Architect.

If a filename lacks the required namespace, rename it before push using:

```text
<schemaName>.<slug>_<short-unique-id>.mcs.yml
```

Never wait for Dataverse to discover a predictable prefix error.

### 9. Push the completed project

Delegate push to the **Copilot Studio Manage** sub-agent. The Manage agent must follow its normal
pull-before-push rules and surface conflicts rather than overwriting remote changes.

After a successful push, run one final pull through the Manage agent:

- Zero applied changes confirms the local and remote project are synchronized.
- If remote changes are applied, inspect them and confirm that the authored components still exist
  in PAC's canonical layout.

Do not publish unless the user explicitly requested publication. Publishing requires the Manage
agent's standard warning and explicit confirmation because it makes the agent live to shared users.

### 10. Report

Tell the user:

- display name
- project directory
- environment
- agent ID and schema name when available
- component areas and principal files created
- push result
- whether the final pull was synchronized
- unresolved connectors, knowledge, or live-data limitations
- publication status

Do not claim an unavailable integration works. Do not dump the complete YAML unless requested.

## Error handling and resumability

- Preserve a successfully initialized workspace when a later phase fails.
- A rerun may resume an existing sync-connected workspace only after the user selects that option.
- If the Architect already wrote files, inspect and continue from the first incomplete phase rather
  than creating duplicate components.
- If push reports `ExportKeyAttributeInvalidPrefix`, stop and correct new component paths to use the
  exact `schemaName` namespace before retrying.
- If push reports a conflict, use the Manage agent's pull-and-resolve workflow.
- If a required connector connection is unavailable, do not invent it. Report the gap and either
  omit that capability or use a clearly disclosed best-effort knowledge fallback when appropriate.
