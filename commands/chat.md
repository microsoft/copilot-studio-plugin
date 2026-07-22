---
description: Chat with a locally-cloned Copilot Studio CLI (agentic-loop) agent to test it, streaming turns against the published agent via the agenticruntime endpoint.
argument-hint: Optional agent name/path and the first message to send
allowed-tools: Bash(pac), Bash(node *chat-with-agent.bundle.js*), Read, Write, Glob, Grep, Task, WebFetch(domain:raw.githubusercontent.com)
---

# Chat with a Copilot Studio CLI Agent

You are a workflow that lets the user hold a live conversation with a **locally-cloned CLI
(agentic-loop) Copilot Studio agent** so they can test it. You discover the agent, verify it is a
CLI agent, make sure an Entra app registration is configured, then run the bundled chat script and
relay turns. You never invent behavior the files do not support.

Initial request: $ARGUMENTS

---

## Core Process

### 1. Resolve the plugin paths (non-blocking)

Read `path.join(os.homedir(), '.copilot-studio-cli', 'plugin-paths.json')` to get `pluginRoot` and
`pluginData` for the current `mcs-assistant` plugin.

- The chat script is at `path.join(pluginRoot, 'scripts', 'chat-with-agent.bundle.js')`. Use this
  absolute path for every `node` invocation below.
- If `plugin-paths.json` cannot be read, fall back to locating `scripts/chat-with-agent.bundle.js`
  under the installed plugin directory. The script itself also self-discovers `pluginData`
  (env `CLAUDE_PLUGIN_DATA`/`COPILOT_PLUGIN_DATA` → `plugin-paths.json` → home), so you do not need
  to pass it in.

### 2. Verify the PAC CLI prerequisite (non-blocking)

Run `pac` and read the PAC CLI version. Chat itself does not call `pac`, but a recent PAC CLI is how
the user cloned the agent. Make one attempt; continue even if it cannot be read.

### 3. Locate the agent and confirm it is a CLI agent (blocking)

1. If the user named a path, use it as `--agent-dir`. Otherwise auto-discover candidate agents with
   `Glob: **/settings.mcs.yml` (a cloned CLI-agent workspace contains `settings.mcs.yml` and
   `.mcs/conn.json`).
2. If no agent is found, tell the user this skill needs a **locally-cloned agent** and that they can
   clone one with `pac copilot` (e.g. via `/migrate` or `pac copilot clone`). Stop.
3. If several are found, ask the user which one (or have them pass a path).
4. **CLI-agent gate.** Read the chosen agent's `settings.mcs.yml` and check
   `configuration.recognizer.kind`:
   - `CLIAgentRecognizer` or `CLICopilotRecognizer` → this is a CLI / agentic-loop agent. Proceed.
     (Both kinds are in use — `CLICopilotRecognizer` is the newer one produced by `pac copilot
     clone` / migration.)
   - anything else (e.g. `GenerativeAIRecognizer`) → stop and tell the user this skill only chats
     with **CLI-authored** agents, because only they are served by the agenticruntime endpoint this
     command uses. Suggest `/migrate` if they want to convert a classic agent.

   The chat script enforces this gate too (it exits with a clear JSON error), so you may also detect
   a non-CLI agent from a `recognizerKind` error in the script output.

### 4. Ensure an Entra app registration is configured (blocking on first use)

The chat script authenticates the **signed-in user** with MSAL device code, using a **public-client
Entra app registration** that has the delegated `CopilotStudio.Copilots.Invoke` permission. The app
id is remembered per-agent, so this setup is a one-time step.

1. Do a **dry probe**: run the script for the chosen agent with `--dry-run` (this resolves the
   connection and app id **without** authenticating or chatting):

   ```bash
   node "<pluginRoot>/scripts/chat-with-agent.bundle.js" --agent-dir "<agentDir>" --dry-run
   ```

   - If the JSON has `"needsClientId": true`, no app id is configured yet — run the **App
     registration setup workflow** below, then re-probe.
   - If it returns `"dryRun": true` with an `appClientId`, you are ready to chat (step 5). The probe
     also surfaces the resolved `cloud` and `directConnectUrl` for troubleshooting.
2. If the user already knows their app (client) id, you can skip the probe and pass
   `--client-id <appId>` on the first real run; the script saves it for next time.

#### App registration setup workflow

Guide the user through creating (or reusing) a Public client / native app registration. These steps
mirror the Copilot Studio client sample. Present them clearly and wait for the user to complete them
and paste back the **Application (client) ID**.

1. Open <https://portal.azure.com> and go to **Microsoft Entra ID → App registrations**.
2. Click **New registration**:
   - **Name**: anything, e.g. `Copilot Studio CLI chat`.
   - **Supported account types**: *Accounts in this organizational directory only*.
   - Leave the redirect URI empty for now; click **Register**.
3. On the app's **Overview**, copy the **Application (client) ID**. (The tenant id is read
   automatically from the agent's `.mcs/conn.json`, so you do not need to supply it.)
4. Under **Manage → Authentication → Add a platform**, choose **Mobile and desktop applications**
   (Public client / native), add the redirect URI `http://localhost` (**HTTP, not HTTPS**), and
   save. This makes it a public client (no secret), which is what device-code login needs.
5. Under **Manage → API permissions → Add a permission → APIs my organization uses**, search for
   **Power Platform API**:
   - Choose **Delegated permissions → CopilotStudio → CopilotStudio.Copilots.Invoke**, then
     **Add permissions**.
   - If **Power Platform API** is not listed, an admin must add it to the tenant first — see the
     Power Platform API authentication docs (register the `Power Platform API` service principal).
   - *(Optional)* Click **Grant admin consent** to avoid a per-user consent prompt.
6. Ask the user to paste the **Application (client) ID**. You pass it on the first chat turn (next
   step) via `--client-id`; the script saves it automatically **after** the first successful
   sign-in — keyed by the agent's `AgentId`, plus a per-tenant default so other agents in the same
   tenant reuse it. Nothing is written if sign-in fails, so a wrong id is never persisted. The config
   file (`<pluginData>/chat-config.json`) lives in the plugin **data** directory (separate from the
   plugin code), so it survives `/plugin update`.

   *(Advanced: `--set-client-id "<appId>"` pre-saves the id without a sign-in — only use this if you
   are certain the app registration is correct, since it is not validated.)*

### 5. Run a chat turn

Invoke the bundled script. It emits a single JSON object on **stdout** (progress and the device-code
prompt go to **stderr**).

- **First turn** (starts a new conversation):

  ```bash
  node "<pluginRoot>/scripts/chat-with-agent.bundle.js" --agent-dir "<agentDir>" "<user message>"
  ```

  Add `--client-id "<appId>"` on the very first run if it was just provided (subsequent runs reuse
  the saved id). The script prints a device-code login prompt to stderr the first time — relay it to
  the user and wait for them to complete sign-in.

- **Follow-up turns** (continue the same conversation): pass the `conversation_id` from the previous
  turn's JSON:

  ```bash
  node "<pluginRoot>/scripts/chat-with-agent.bundle.js" --agent-dir "<agentDir>" "<next message>" --conversation-id "<conversation_id>"
  ```

- **Overrides** (rarely needed): `--cloud <Prod|Test|Preprod|Dev>` for non-prod environments, or
  `--direct-connect-url <url>` to bypass URL derivation entirely.

### 6. Relay the response

From the JSON output:
- Read `conversation_id` and reuse it for every follow-up turn in this session.
- Show the agent's reply from `activities` — render the text of the final `type: "message"` activity
  (the incremental `type: "typing"` activities carry the answer-so-far; the last `message` is the
  complete answer). Note any `type: "event"` `turn.complete` as end-of-turn.
- If `status` is `"error"`, surface the `error` message. For `needsClientId`, run the setup workflow
  (step 4). For a non-CLI `recognizerKind`, stop per the gate (step 3). If the error carries
  `httpStatus: 404`, the agent is almost certainly **not published** — tell the user to publish it in
  Copilot Studio (or run `pac copilot publish --bot-id <AgentId>`) and then retry.

Keep the loop going: after each agent reply, ask the user for their next message and send it with the
same `--conversation-id`, until the user is done.

---

## Notes

- **Sub-agents can reuse this exact script.** Any sub-agent can run
  `node "<pluginRoot>/scripts/chat-with-agent.bundle.js" …` with the same flags; there is one
  implementation and one saved app registration.
- **The agent must be published.** Chat runs against the *published* CLI agent. Before streaming a
  turn the script does a one-shot preflight against the agenticruntime `/conversations` endpoint: a
  `404` (unpublished agent) fails fast with a clear "publish the agent" message instead of hanging.
  This works around microsoft/Agents-for-js#1198, where the streaming client retries a non-2xx
  forever and never returns.
- **What this command does not do.** It does not author, edit, publish, or manage the agent, and it
  does not use Direct Line. It only chats with an already-published CLI agent. Use `/migrate` or the
  manage agent for those tasks.
- **Auth footprint.** Access and refresh tokens are cached **per-agent in OS-native encrypted
  storage** (macOS Keychain / Windows DPAPI / Linux libsecret) via `@azure/msal-node-extensions`;
  the on-disk `~/.copilot-studio-cli/chat-<AgentId>.cache.json` holds no readable token. The native
  dependencies are installed automatically into `<pluginData>` at session start. If they can't be
  loaded (e.g. a standalone run before provisioning), the script **falls back to a plaintext token
  cache** under `<pluginData>/token-cache/` and prints a warning. Nothing is written into the
  agent's `.mcs/` folder. The app id, tenant id, and environment id are not secrets (public client,
  no secret), so they are stored as plain JSON in `<pluginData>/chat-config.json`.
