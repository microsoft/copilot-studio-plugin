---
name: agent-auth
description: Sign in to, inspect, switch, or sign out of the msagent (Microsoft AgentHosting) CLI session, and view or select the active Power Platform environment. Use when the user asks to sign in, log in, authenticate, check who they are signed in as, switch account or tenant, sign out, or choose the active environment for Copilot Studio agent operations.
argument-hint: Optional "status", "login", "switch", "logout", or an environment id/name to select
allowed-tools: Bash(msagent *), Read, Glob, Grep
---

# Manage the msagent Sign-in and Environment

You help the user manage their **msagent CLI** session: sign in, check the current sign-in state,
switch account, sign out, and choose the active **Power Platform environment** that the other
Copilot Studio agent skills (`clone-agent`, `pull-agent`, `push-agent`, `publish-agent`,
`list-agents`) use. You never invent behavior the CLI does not support.

Initial request: $ARGUMENTS

CLI messages may still refer to the CLI by its former name, `ah`. Treat `ah` as `msagent` when you
relay or act on them.

## Passing values to commands

Every value you substitute into a command comes from the user or a local file, so treat it as
untrusted text. Both bash and PowerShell expand `$(...)`, `$name`, and backticks inside double
quotes, so a value in double quotes can run another command.

1. **IDs** (`environmentId`, `tenantId`) must be GUIDs matching
   `^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`. An
   `environmentId` may also take the `Default-<guid>` form. If a value that must be an id does not
   match, stop and tell the user it looks hand-edited; run nothing.
2. **Names and other text.** If a value contains a double quote (`"`), a line break, or any other
   control character, do not build the command; stop and report it. Otherwise pass it as a
   **single-quoted** literal (never double-quoted), escaping inner single quotes for the shell:
   - **bash**: replace each `'` with `'\''`.
   - **PowerShell**: double each `'` (and each `‘`, `’`, `‚`, `‛`).

The templates below show each value as `'<value>'`; apply these rules to every one.

## 1. Verify the CLI (blocking on failure)

```bash
msagent --version
```

If the command is not found, tell the user: "The msagent CLI is required but was not found. Install
it, then retry." Stop.

## 2. Decide the action

Pick from the initial request; if it is ambiguous, default to **status** first, then ask what the
user wants to do.

- "who am I", "am I signed in", "status" → **Status**
- "sign in", "log in", "authenticate" → **Login**
- "switch account/tenant" → **Switch**
- "sign out", "log out" → **Logout**
- an environment id/name, "use environment…", "select environment" → **Select environment**
- "list environments" → **List environments**

## 3. Status (read-only, never acquires a token)

```bash
msagent auth status --json
```

Envelope: `{ success, status, signedIn, account, tenantId, environmentId, environmentDisplayName,
environmentTenantId, environmentTenantBound }`. Report `signedIn`, the `account`, the `tenantId`, and
the active environment (`environmentDisplayName` / `environmentId`). If `signedIn` is `false`, offer
to run **Login**.

## 4. Login (interactive)

Sign-in opens a real browser / WAM / device-code flow, so run it **without** `--non-interactive` and
let the user complete it:

```bash
msagent auth login
```

To sign in to a specific tenant, add `--tenant '<tenantId>'`. After the user finishes, run
`msagent auth status --json` and report the resulting account and environment.

## 5. Switch account

```bash
msagent auth switch
```

This never acquires a token; it selects among already-cached accounts. Follow with
`msagent auth status --json` and report the active account.

## 6. Logout (blocking confirmation)

Signing out clears cached accounts. Confirm with the user first ("This signs you out of msagent and
clears cached accounts. Proceed?"). On explicit yes:

```bash
msagent auth logout
```

## 7. Environments

List the environments the signed-in account can reach:

```bash
msagent env list --json
```

Envelope: `{ success, status, environments: [{ environmentId, displayName, tenantId, apiEndpoint,
isActive }] }`. Present them as a table and mark the `isActive` one. If the user named an environment
by display name, resolve it to its `environmentId` here.

Select the active environment for later commands:

```bash
msagent env select '<environment-id>'
```

Confirm the newly active environment with `msagent env list --json` (or `auth status --json`).

## 8. Report

State plainly what changed: the signed-in account and tenant, and the active environment
(`displayName` + `environmentId`). If the user was trying to run another agent operation, tell them
they can now retry it.

## Error handling

- Commands print `{ "success": false, exitCode, errorMessage, errorKind?, remediation? }` on failure.
  Always surface `errorMessage` and `remediation`.
- `msagent auth status`, `switch`, and `logout` never open identity UI. Only `login` does. If a
  non-interactive context blocks the browser, tell the user to run `msagent auth login` themselves.
- If `env select` reports the environment is not found or not available to the account, relay the
  remediation and offer to run `msagent env list --json` so the user can pick a reachable one.
