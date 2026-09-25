---
name: list-agents
description: List the Copilot Studio (MCS) agents in a Power Platform environment or across the whole tenant using the msagent CLI (`msagent agent list`). Use when the user asks to list, show, find, or browse the Copilot Studio agents in an environment or tenant.
argument-hint: Optional environment id or name, "tenant" for tenant-wide, and an optional row limit
allowed-tools: Bash(msagent *), Read, Glob, Grep
---

# List Copilot Studio Agents

You list the Copilot Studio (MCS) agents visible to the signed-in msagent account, in one
environment or across the tenant, by running `msagent agent list`. You never invent behavior the CLI
does not support. Note that **an agent that has never been deployed is not listed.**

Initial request: $ARGUMENTS

## Passing values to commands

Every value you substitute into a command comes from the user or a local file, so treat it as
untrusted text. Both bash and PowerShell expand `$(...)`, `$name`, and backticks inside double
quotes, so a value in double quotes can run another command.

1. **`environmentId`** must be a GUID matching
   `^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`, or the
   `Default-<guid>` form. If a value that must be an id does not match, stop and say so; run nothing.
2. **`limit`** must be a positive integer.

Pass any resolved value as a **single-quoted** literal (never double-quoted). For bash, replace each
inner `'` with `'\''`; for PowerShell, double each `'`.

## 1. Verify the CLI (blocking on failure)

```bash
msagent --version
```

If it is not found, tell the user the msagent CLI is required but was not found, and stop.

## 2. Resolve scope (blocking only if ambiguous)

- **Default:** the signed-in account's **active** environment. Do not pass `--environment-id`.
- **A specific environment:** if the user names an environment by id, use it. If by display name,
  resolve it first with `msagent env list --json --non-interactive` (envelope
  `{ environments: [{ environmentId, displayName, isActive }] }`). Require exactly one
  case-insensitive match; if several match, ask for the exact `environmentId`.
- **Tenant-wide:** if the user asks for every environment, use `--tenant-wide`.
- **Limit:** default is 20 rows. Pass `--limit '<n>'` only if the user asks for a different count.

## 3. List

```bash
msagent agent list --json --non-interactive
```

Add `--environment-id '<id>'`, `--tenant-wide`, or `--limit '<n>'` as resolved in step 2.

Success envelope: `{ success, status: "agents-listed", scope, environmentId, limit, truncated,
agents: [ { mcsAgentId, agentId, displayName, schemaName, agentType, lifecycleState, tenantId,
environmentId, lastChangedOn, deploymentSlotCount } ], diagnostics }`.

## 4. Report

Present the agents as a table with the columns that matter: **Display name**, **Schema name**,
**Type**, **Lifecycle state**, **Last changed**, and (for tenant-wide) **Environment**. Use the
`mcsAgentId` as the identifier to show, since `agentId` is often `null` for agents that only exist in
the cloud. If `truncated` is `true`, tell the user the list was capped at `limit` and they can raise
it with a larger limit. Relay any `diagnostics` entries. If `agents` is empty, say no deployed
Copilot Studio agents were found in that scope, and remind the user that never-deployed agents do not
appear.

## Error handling

- Failure envelope: `{ success: false, exitCode, errorMessage, errorKind?, remediation? }`. Surface
  `errorMessage` and `remediation`.
- **`exitCode` 3, or a sign-in error:** the session is not signed in and `--non-interactive`
  prevented a prompt. Offer the `agent-auth` skill (or `msagent auth login`). After the user signs
  in, run `msagent auth status --json --non-interactive`; if the original command used the active
  environment and it changed, show the new scope before re-running the list once.
- **Environment not found / not available:** relay the remediation and offer
  `msagent env list --json --non-interactive` so the user can pick a reachable environment.
