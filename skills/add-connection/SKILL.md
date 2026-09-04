---
user-invocable: true
description: Set up and wire a connector connection for a modern Copilot Studio agent tool - guides connection creation in the portal (or via PAC for service principals), resolves the raw connection id, creates a dedicated Dataverse connection reference, and updates the tool YAML. Use when a connector-backed tool needs an authenticated connection, or for connection setup / connection reference wiring in general.
argument-hint: [connector name or tool file path]
allowed-tools: Bash(pac auth *), Bash(pac connection list *), Bash(pac connection create *), Bash(pac power-fx run *), Read, Write, Edit, Glob, Grep
context: fork
---

# Add Connection

Set up and wire an authenticated connector connection into a **modern (agentic-loop)** Copilot Studio agent
tool. This single skill covers the full **connection setup ops** flow: finding or creating the underlying
connection, creating a dedicated connection reference, and wiring the tool YAML.

Connector tools reference a Dataverse **connection reference** (a logical name) which in turn points at a raw
**connection** record. This skill: finds/creates the connection, creates a dedicated connection reference for
this agent, and updates the tool YAML to use it.

> Interactive (delegated) connections - SharePoint, Teams, Outlook, etc. - are created by the user signing in
> through the portal; they cannot be fully created non-interactively. Service-principal connections can be
> created with `pac connection create`. This skill guides both paths.

## Phase 0: Locate the agent and the tool

Auto-discover the agent (never hardcode):

```
Glob: **/agent.mcs.yml
```

- Read the agent `schemaName` from `settings.mcs.yml` / `agent.mcs.yml`.
- Read the target environment from `.mcs/conn.json` (`EnvironmentId`) if present; otherwise ask the user for
  the environment id or Dataverse URL.

Identify the connector tool that needs a connection under `capabilities/tools/`. A connector-backed tool has
`kind: ConnectorTool` and/or a `connectorId` and/or a `connectionReference`. Record its file path,
`connectorId` (e.g. `/providers/Microsoft.PowerApps/apis/shared_sharepointonline`), `operationId`, and current
`connectionReference`.

## Phase 1: Authenticate

Run only if there is no active PAC profile or a command reports an auth error:

```bash
pac auth create
```

## Phase 2: Find or create the connection

List existing connections in the environment:

```bash
pac connection list --environment "<environment-id-or-dataverse-url>"
```

Look for a usable, connected connection for the required `connectorId`.

**If a usable connection exists**, capture its **raw connection id** (e.g. `48e11359c0f344f9a495f649e515612a`).
Use the raw id exactly as PAC prints it - do not invent or reformat it into older forms like
`shared-sharepointonline-...`.

**If no usable connection exists**, choose a path:

- **Interactive / delegated (default for SharePoint, Teams, Outlook, etc.):** ask the user to create it in the
  portal at `https://make.preview.powerautomate.com/environments/<environment-id>/connections`, sign in for the
  connector, then tell you when done. Then re-run `pac connection list` and read the new raw connection id.
- **Service principal (app registration):** create it non-interactively:
  ```bash
  pac connection create --environment "<environment-id-or-dataverse-url>" --name "<connection-name>" --tenant-id "<tenant-id>" --application-id "<app-id>" --client-secret "<client-secret>"
  ```
  Then re-run `pac connection list` to read the new raw connection id.

Do not proceed until you have a raw connection id for the required connector.

## Phase 3: Create a dedicated connection reference

Create a **new** connection reference dedicated to this agent - do not reuse or mutate an existing shared one,
which may belong to another agent.

Choose a unique logical name using the pattern `<agent-schema-name>.cr.<connector-name>.<short-suffix>`.

Write a temporary Power Fx file **outside** the agent project directory (never inside it) and create the
record with `Collect` (do not use `Defaults('Connection References')`):

```powerfx
Collect('Connection References';
  {
    connectionreferencedisplayname: "<display-name>";
    connectionreferencelogicalname: "<new-connection-reference-logical-name>";
    connectorid: "<connector-id>";
    connectionid: "<raw-connection-id-from-pac-connection-list>"
  }
)
```

Run it:

```bash
pac power-fx run --environment "<environment-id-or-dataverse-url>" --file "<temp-connection-reference.powerfx>" --echo
```

Then write a `ShowColumns()` verification query and confirm the record exists with the expected `connectionid`
and `connectorid`. Delete the temporary Power Fx file when done.

## Phase 4: Wire the tool YAML

Update the connector tool under `capabilities/tools/` so its `connectionReference` uses the new dedicated
logical name:

```yaml
connectionReference: <new-connection-reference-logical-name>
```

## Phase 5: Validate and hand off

- The connection reference record **must exist before push**. If it does not, push fails with
  `A record with the specified key values does not exist in connectionreference entity`.
- Tell the user to sync (pull then push, via the push skill or `pac copilot push --project-dir "<agent-folder>"`).
- Report: the connector wired, the raw connection id used, the new connection-reference logical name, and the
  tool file updated.

## Error Handling

| Error | Likely cause | Resolution |
|---|---|---|
| Auth / active profile error | No/invalid PAC profile | Run `pac auth create`, then retry. |
| No connection for connector | Connection not created or not connected | Create it (portal or `pac connection create`), then re-list. |
| `Defaults('Connection References')` not supported | PAC Power Fx runner limitation | Use `Collect`, as shown above. |
| Push fails: record does not exist in connectionreference entity | Connection reference not created before push | Create/verify the connection reference (Phase 3), then push. |
| Connector id mismatch | Wrong `connectorId` on the tool | Confirm the tool's `connectorId` matches the connection's connector. |

## Final answer

Keep it short and factual: connector wired, raw connection id, new connection-reference logical name, tool file
updated, and the reminder that the connection reference must exist before pushing.
