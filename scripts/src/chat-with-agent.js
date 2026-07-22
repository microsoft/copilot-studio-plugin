/**
 * chat-with-agent.js — Chat with a published Copilot Studio *CLI (agentic-loop)* agent.
 *
 * This talks to the agenticruntime "3p" (third-party) Direct-to-Engine endpoint, which is
 * how CLI-authored / agentic-loop agents are served. It:
 *   1. Discovers the local agent workspace (.mcs/conn.json + settings.mcs.yml).
 *   2. Verifies the agent is a CLI agent (settings.mcs.yml -> recognizer.kind === CLIAgentRecognizer).
 *   3. Builds the /3p directConnectUrl from environmentId + schemaName + cloud.
 *   4. Authenticates with MSAL device-code (public client) for the CopilotStudio.Copilots.Invoke
 *      permission and streams a single turn.
 *
 * Connection values are auto-discovered; the only thing the user must supply is an Entra
 * public-client app id (--client-id) with the CopilotStudio.Copilots.Invoke delegated
 * permission. That id is remembered per-agent in <pluginData>/chat-config.json.
 *
 * Usage:
 *   node chat-with-agent.bundle.js --client-id <id> "your message"
 *   node chat-with-agent.bundle.js "follow-up" --conversation-id <id>      (client-id reused from config)
 *   node chat-with-agent.bundle.js --agent-dir <path> "hello"
 *   node chat-with-agent.bundle.js --cloud Test "hello"
 *   node chat-with-agent.bundle.js --direct-connect-url <url> "hello"      (override URL derivation)
 *   node chat-with-agent.bundle.js --set-client-id <id> [--agent-dir <path>]   (save app id, no chat)
 *   node chat-with-agent.bundle.js --dry-run [--agent-dir <path>]           (resolve plan, no auth/chat)
 *   node chat-with-agent.bundle.js --pretty "hello"                         (live terminal chat UI)
 *   node chat-with-agent.bundle.js --raw "hello"                            (full activity dump)
 *
 * Output (stdout): by default a distilled JSON summary of the turn — { conversation_id, greeting,
 *   reasoning[], steps[] (tool/status cues), text (final answer), attachments[] }. Attachments the
 *   agent produces are materialized to disk (<pluginData>/chat-attachments/<conversationId>/) and
 *   only their file paths are returned, so large images never bloat the caller's context. Use
 *   --raw for the full activity payloads, or --pretty for a colorized live terminal experience.
 * Diagnostics (stderr): human-readable progress lines (incl. the device-code prompt).
 * Exit codes: 0 = success, 1 = error.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { PublicClientApplication } = require("@azure/msal-node");
const { CopilotStudioClient } = require("@microsoft/agents-copilotstudio-client");
const { Activity } = require("@microsoft/agents-activity");
const { createCachePluginWithFallback } = require("./msal-cache");
const { summarizeTurn } = require("./response-format");
const { createLiveRenderer } = require("./terminal-render");

// Recognizer kinds that indicate a CLI / agentic-loop agent (served by the /3p agenticruntime
// endpoint). Both are in active use: CLIAgentRecognizer (earlier) and CLICopilotRecognizer
// (the newer kind produced by pac clone / migration). Anything else (e.g. GenerativeAIRecognizer)
// is a classic/generative-orchestration agent and is not supported by this skill.
const CLI_RECOGNIZER_KINDS = ["CLIAgentRecognizer", "CLICopilotRecognizer"];

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function log(msg) {
  process.stderr.write(msg + "\n");
}

function die(msg, extra) {
  process.stdout.write(
    JSON.stringify(Object.assign({ status: "error", error: msg }, extra || {})) + "\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Cloud helpers (mirror the SDK's PowerPlatformCloud host/scope derivation)
// ---------------------------------------------------------------------------

// Maps a normalized cloud name -> Power Platform API endpoint suffix.
const CLOUD_SUFFIX = {
  Prod: "api.powerplatform.com",
  FirstRelease: "api.powerplatform.com",
  Test: "api.test.powerplatform.com",
  Preprod: "api.preprod.powerplatform.com",
  Dev: "api.dev.powerplatform.com",
  Exp: "api.exp.powerplatform.com",
  Prv: "api.prv.powerplatform.com",
  Gov: "api.gov.powerplatform.microsoft.us",
  GovFR: "api.gov.powerplatform.microsoft.us",
  High: "api.high.powerplatform.microsoft.us",
  DoD: "api.appsplatform.us",
  Mooncake: "api.powerplatform.partner.microsoftonline.cn",
};

// Prod/FirstRelease split the environment GUID 30/2; every other cloud splits 31/1.
function idSuffixLength(cloud) {
  return cloud === "Prod" || cloud === "FirstRelease" ? 2 : 1;
}

function normalizeCloud(value) {
  if (!value) return "Prod";
  const found = Object.keys(CLOUD_SUFFIX).find(
    (k) => k.toLowerCase() === String(value).toLowerCase()
  );
  return found || "Prod";
}

// Infer the cloud from the AgentManagementEndpoint host in conn.json (best effort, default Prod).
function inferCloudFromConn(conn) {
  const host = `${conn.AgentManagementEndpoint || ""} ${conn.DataverseEndpoint || ""}`.toLowerCase();
  if (/\b(test)\b|\.test\./.test(host)) return "Test";
  if (/preprod/.test(host)) return "Preprod";
  if (/\bdev\b|\.dev\./.test(host)) return "Dev";
  return "Prod";
}

// Build the env-specific host, e.g. <30hex>.<2hex>.environment.api.powerplatform.com
function environmentHost(environmentId, cloud) {
  const suffix = CLOUD_SUFFIX[cloud] || CLOUD_SUFFIX.Prod;
  const id = environmentId.toLowerCase().replace(/-/g, "");
  const n = idSuffixLength(cloud);
  const prefix = id.substring(0, id.length - n);
  const tail = id.substring(id.length - n);
  return `${prefix}.${tail}.environment.${suffix}`;
}

// The agenticruntime 3p base URL for a CLI agent. The SDK's createURL() appends
// /conversations[/{id}] and preserves any existing api-version, so we pin api-version=1
// here (the documented public 3p contract) rather than let the SDK default to the
// published-bot preview version.
function buildDirectConnectUrl(environmentId, schemaName, cloud) {
  const host = environmentHost(environmentId, cloud);
  return `https://${host}/copilotstudio/agenticruntime/3p/dataverse-backed/authenticated/bots/${schemaName}?api-version=1`;
}

function scopeForCloud(cloud) {
  const suffix = CLOUD_SUFFIX[cloud] || CLOUD_SUFFIX.Prod;
  return `https://${suffix}/.default`;
}

// ---------------------------------------------------------------------------
// Plugin data dir + config (app-registration storage)
// ---------------------------------------------------------------------------

// Resolve the runtime's persistent per-plugin data dir the same way the plugin's
// SessionStart hook does: env var -> plugin-paths.json (pluginData) -> home fallback.
function resolvePluginDataDir() {
  const fromEnv = process.env.CLAUDE_PLUGIN_DATA || process.env.COPILOT_PLUGIN_DATA;
  if (fromEnv && fromEnv.trim()) return fromEnv;

  try {
    const pathsFile = path.join(os.homedir(), ".copilot-studio-cli", "plugin-paths.json");
    const parsed = JSON.parse(fs.readFileSync(pathsFile, "utf-8"));
    if (parsed.pluginData && String(parsed.pluginData).trim()) return parsed.pluginData;
  } catch {
    // fall through to home
  }
  return path.join(os.homedir(), ".copilot-studio-cli");
}

function configPath() {
  const dir = resolvePluginDataDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best effort
  }
  return path.join(dir, "chat-config.json");
}

function readConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) {
    return { version: 1, agents: {}, tenantDefaults: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    parsed.version = parsed.version || 1;
    parsed.agents = parsed.agents || {};
    parsed.tenantDefaults = parsed.tenantDefaults || {};
    return parsed;
  } catch {
    // Corrupt file: back it up rather than crash or silently wipe.
    try {
      fs.renameSync(file, file + ".bak");
      log(`Warning: ${file} was unreadable; backed up to ${path.basename(file)}.bak`);
    } catch {
      // ignore
    }
    return { version: 1, agents: {}, tenantDefaults: {} };
  }
}

// Read-merge-write upsert: never clobber other agents' entries.
function saveClientId({ agentId, tenantId, cloud, clientId }) {
  const file = configPath();
  const cfg = readConfig();
  if (agentId) {
    cfg.agents[agentId] = Object.assign({}, cfg.agents[agentId], {
      appClientId: clientId,
      tenantId: tenantId || cfg.agents[agentId]?.tenantId,
      cloud: cloud || cfg.agents[agentId]?.cloud,
    });
  }
  if (tenantId) {
    cfg.tenantDefaults[tenantId] = Object.assign({}, cfg.tenantDefaults[tenantId], {
      appClientId: clientId,
    });
  }
  try {
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  } catch (e) {
    log(`Warning: could not persist client id to ${file}: ${e.message}`);
  }
}

function resolveClientId({ explicit, agentId, tenantId }) {
  if (explicit) return explicit;
  if (process.env.appClientId) return process.env.appClientId;
  const cfg = readConfig();
  if (agentId && cfg.agents[agentId]?.appClientId) return cfg.agents[agentId].appClientId;
  if (tenantId && cfg.tenantDefaults[tenantId]?.appClientId)
    return cfg.tenantDefaults[tenantId].appClientId;
  return null;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    utterance: null,
    clientId: null,
    conversationId: null,
    agentDir: null,
    cloud: null,
    directConnectUrl: null,
    setClientId: null,
    dryRun: false,
    raw: false,
    pretty: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--client-id":
        parsed.clientId = args[++i];
        break;
      case "--set-client-id":
        parsed.setClientId = args[++i];
        break;
      case "--conversation-id":
        parsed.conversationId = args[++i];
        break;
      case "--agent-dir":
        parsed.agentDir = args[++i];
        break;
      case "--cloud":
        parsed.cloud = args[++i];
        break;
      case "--direct-connect-url":
        parsed.directConnectUrl = args[++i];
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--raw":
        parsed.raw = true;
        break;
      case "--pretty":
        parsed.pretty = true;
        break;
      default:
        if (!args[i].startsWith("--")) {
          parsed.utterance = args[i];
        }
        break;
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Agent discovery + config loading
// ---------------------------------------------------------------------------

function findAgentDirs(startDir) {
  const results = [];

  function search(dir, depth) {
    if (depth > 5) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      // A cloned Copilot Studio agent has settings.mcs.yml at its root alongside
      // a .mcs/conn.json — the two files loadAgentConfig requires. (There is no
      // agent.mcs.yml in a `pac copilot clone` workspace.)
      if (
        entry.name === "settings.mcs.yml" &&
        entry.isFile() &&
        fs.existsSync(path.join(dir, ".mcs", "conn.json"))
      ) {
        results.push(dir);
      } else if (entry.isDirectory()) {
        search(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  search(startDir, 0);
  return results;
}

function resolveAgentDir(args) {
  if (args.agentDir) return path.resolve(args.agentDir);

  const found = findAgentDirs(process.cwd());
  if (found.length === 0) {
    die(
      "No cloned Copilot Studio agent (settings.mcs.yml + .mcs/conn.json) found in the current " +
        "directory tree. Use --agent-dir to point at a cloned agent."
    );
  }
  if (found.length > 1) {
    const dirs = found.map((d) => path.relative(process.cwd(), d));
    die(`Multiple agents found: ${dirs.join(", ")}. Use --agent-dir to choose one.`, {
      candidates: dirs,
    });
  }
  return found[0];
}

function loadAgentConfig(agentDir) {
  const connPath = path.join(agentDir, ".mcs", "conn.json");
  if (!fs.existsSync(connPath)) {
    die(
      `No .mcs/conn.json at ${connPath}. Is this a Copilot Studio agent cloned with 'pac copilot clone'?`
    );
  }
  const conn = JSON.parse(fs.readFileSync(connPath, "utf-8"));

  const settingsPath = path.join(agentDir, "settings.mcs.yml");
  if (!fs.existsSync(settingsPath)) {
    die(`No settings.mcs.yml at ${settingsPath}.`);
  }
  const settings = yaml.load(fs.readFileSync(settingsPath, "utf-8")) || {};

  // --- CLI-agent gate: only CLI-authored agents use the /3p agenticruntime path. ---
  const recognizerKind = settings?.configuration?.recognizer?.kind;
  if (!CLI_RECOGNIZER_KINDS.includes(recognizerKind)) {
    die(
      `This agent is not a CLI (agentic-loop) agent. settings.mcs.yml recognizer.kind is ` +
        `'${recognizerKind || "unset"}', expected one of ${CLI_RECOGNIZER_KINDS.join(", ")}. ` +
        `The chat skill only supports CLI-authored agents.`,
      { recognizerKind: recognizerKind || null, agentDir }
    );
  }

  const environmentId = conn.EnvironmentId;
  const tenantId = conn.AccountInfo?.TenantId;
  const agentId = conn.AgentId;
  const schemaName = settings.schemaName;

  if (!environmentId) die("EnvironmentId not found in .mcs/conn.json");
  if (!tenantId) die("TenantId not found in .mcs/conn.json");
  if (!schemaName) die("schemaName not found in settings.mcs.yml");

  return { environmentId, tenantId, agentId, schemaName, conn, displayName: settings.displayName };
}

// ---------------------------------------------------------------------------
// Authentication (MSAL device-code with a per-agent file cache)
// ---------------------------------------------------------------------------

function tokenCachePath(agentId) {
  const dir = path.join(resolvePluginDataDir(), "token-cache");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best effort
  }
  const safe = (agentId || "default").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(dir, `${safe}.json`);
}

// Per-agent slot name for the encrypted OS-keychain token cache.
function cacheAccountName(agentId) {
  const safe = (agentId || "default").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `chat-${safe}`;
}

// MSAL-node masks a failed /devicecode request (e.g. the app registration does not exist in this
// tenant, or public-client flows are disabled) as an opaque "post_request_failed: invalid_grant"
// and invokes the device-code callback with an empty response, so the user never sees the real
// reason. When that happens we ask the token endpoint directly to surface the actual AADSTS error.
async function diagnoseDeviceCodeFailure({ authority, clientId, scope }) {
  try {
    const body = new URLSearchParams({ client_id: clientId, scope }).toString();
    const res = await fetch(`${authority}/oauth2/v2.0/devicecode`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json().catch(() => null);
    if (data && data.error) {
      const desc = String(data.error_description || "").split("\n")[0].trim();
      const codes = data.error_codes || [];
      let hint = "";
      if (data.error === "unauthorized_client" || codes.includes(700016)) {
        hint =
          " The app registration (--client-id) must exist in this agent's tenant and allow public" +
          " client (device code) flows. Create or consent the app in the correct tenant, or pass a" +
          " different --client-id.";
      } else if (data.error === "invalid_client" || codes.includes(7000218)) {
        hint = " Enable 'Allow public client flows' on the app registration.";
      } else if (codes.includes(70011) || /scope/i.test(desc)) {
        hint = " The requested scope may be invalid for this app registration.";
      }
      return `Device-code sign-in could not start: ${data.error}${desc ? ` — ${desc}` : ""}.${hint}`;
    }
  } catch {
    // best effort; fall back to the generic error
  }
  return null;
}

async function getAccessToken({ tenantId, clientId, scope, accountName, fallbackCachePath }) {
  const authority = `https://login.microsoftonline.com/${tenantId}`;
  const cachePlugin = await createCachePluginWithFallback(accountName, fallbackCachePath, log);

  const app = new PublicClientApplication({
    auth: { clientId, authority },
    cache: { cachePlugin },
  });

  const accounts = await app.getTokenCache().getAllAccounts();
  if (accounts.length > 0) {
    try {
      const result = await app.acquireTokenSilent({ scopes: [scope], account: accounts[0] });
      log("Using cached token.");
      return result.accessToken;
    } catch {
      // fall through to device code
    }
  }

  let sawPrompt = false;
  try {
    const result = await app.acquireTokenByDeviceCode({
      scopes: [scope],
      deviceCodeCallback: (response) => {
        if (response && response.message) {
          sawPrompt = true;
          log(response.message);
        }
      },
    });
    return result.accessToken;
  } catch (e) {
    // If we never received a real device-code prompt, the /devicecode call itself failed; surface
    // the underlying AADSTS error instead of MSAL's misleading post_request_failed/invalid_grant.
    if (!sawPrompt) {
      const detail = await diagnoseDeviceCodeFailure({ authority, clientId, scope });
      if (detail) die(detail);
    }
    const code = e && (e.errorCode || e.name);
    const msg = e && (e.errorMessage || e.message);
    die(`Authentication failed${code ? `: ${code}` : ""}${msg ? ` (${msg})` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Chat (single turn; multi-turn via --conversation-id)
// ---------------------------------------------------------------------------

function activityToDict(activity) {
  return JSON.parse(JSON.stringify(activity));
}

// Derive the conversations endpoint from the base directConnectUrl by inserting
// `/conversations` before the query string (e.g. `.../bots/<schema>?api-version=1`
// -> `.../bots/<schema>/conversations?api-version=1`).
function conversationsUrl(directConnectUrl) {
  const u = new URL(directConnectUrl);
  u.pathname = u.pathname.replace(/\/+$/, "") + "/conversations";
  return u.toString();
}

// One-shot preflight so we fail fast with a clear error instead of hanging.
//
// The SDK streams over `eventsource-client`, which auto-reconnects on connection
// errors and treats a non-2xx (e.g. a 404 for an unpublished agent) as a droppable
// connection -> it retries forever and the `for await` loop never yields or ends,
// hanging the process. See microsoft/Agents-for-js#1198. Until that is fixed we do a
// single plain POST to the conversations endpoint and inspect the HTTP status before
// handing off to the streaming client. Note: a 200 here starts a throwaway conversation
// server-side (POST is not read-only), which is acceptable for a test/dev tool.
async function preflightRuntime({ directConnectUrl, token, schemaName, agentId }) {
  const url = conversationsUrl(directConnectUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ emitStartConversationEvent: true }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      die(
        `Timed out after 25s waiting for the agenticruntime to respond at ${url}. ` +
          `The endpoint may be unreachable or the environment is misconfigured.`,
        { endpoint: url }
      );
    }
    // Any other network error: don't block — let the SDK attempt and surface its own error.
    log(`Preflight request failed (${e.message}); continuing to the streaming client.`);
    return;
  }
  clearTimeout(timer);

  if (res.ok) {
    // Healthy. Abandon this preflight stream; the SDK starts the real conversation.
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    return;
  }

  const bodyText = await res.text().catch(() => "");
  const snippet = bodyText.trim().split("\n")[0].slice(0, 200);
  const withSnippet = snippet ? `: ${snippet}` : "";

  if (res.status === 404) {
    die(
      `The agenticruntime has no agent at this endpoint (HTTP 404${withSnippet}). ` +
        `The most common cause is that the agent '${schemaName}' has not been published ` +
        `(a fresh clone is unpublished until you publish it). Publish it in Copilot Studio, ` +
        `or run \`pac copilot publish --bot-id ${agentId}\`, then retry.`,
      { httpStatus: 404, schemaName, agentId, endpoint: url }
    );
  }
  if (res.status === 401) {
    die(
      `The runtime rejected the access token (HTTP 401${withSnippet}). The token is ` +
        `invalid or expired for this endpoint — re-run to sign in again.`,
      { httpStatus: 401, endpoint: url }
    );
  }
  if (res.status === 403) {
    die(
      `The runtime denied access (HTTP 403${withSnippet}). The signed-in user or app ` +
        `may lack permission to this agent or environment.`,
      { httpStatus: 403, endpoint: url }
    );
  }
  die(
    `The agenticruntime returned HTTP ${res.status}${withSnippet} when starting a ` +
      `conversation at ${url}.`,
    { httpStatus: res.status, endpoint: url }
  );
}

async function chat({
  utterance,
  conversationId,
  directConnectUrl,
  cloud,
  token,
  schemaName,
  agentId,
  onActivity,
}) {
  const settings = { directConnectUrl, cloud };
  const client = new CopilotStudioClient(settings, token);
  const isStart = !conversationId;
  const emit = typeof onActivity === "function" ? onActivity : () => {};

  const startActivities = [];
  if (!conversationId) {
    await preflightRuntime({ directConnectUrl, token, schemaName, agentId });
    log("Starting new conversation...");
    for await (const activity of client.startConversationStreaming({
      emitStartConversationEvent: true,
    })) {
      const dict = activityToDict(activity);
      startActivities.push(dict);
      emit(dict, "start");
      if (activity.conversation?.id) conversationId = activity.conversation.id;
    }
    // For the 3p controller the id rides the x-ms-conversationid response header, which the
    // client tracks internally (TS `private` is not enforced at runtime).
    if (!conversationId && client.conversationId) conversationId = client.conversationId;
    if (!conversationId) die("Could not obtain a conversation id from startConversation.");
    log(`Conversation started: ${conversationId}`);
  } else {
    log(`Reusing conversation: ${conversationId}`);
  }

  log(`Sending: ${utterance}`);
  const message = Activity.fromObject({
    type: "message",
    text: utterance,
    conversation: { id: conversationId },
  });

  const activities = [];
  for await (const activity of client.sendActivityStreaming(message, conversationId)) {
    const dict = activityToDict(activity);
    activities.push(dict);
    emit(dict, "turn");
  }

  return {
    conversationId: conversationId || client.conversationId || null,
    isStart,
    startActivities,
    activities,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  const agentDir = resolveAgentDir(args);
  log(`Agent directory: ${path.relative(process.cwd(), agentDir) || "."}`);
  const config = loadAgentConfig(agentDir);
  log(`Agent: ${config.displayName || config.schemaName} (${config.schemaName})`);

  const cloud = normalizeCloud(args.cloud || inferCloudFromConn(config.conn));

  // --set-client-id: persist the app id and exit (used by the setup workflow).
  if (args.setClientId) {
    saveClientId({
      agentId: config.agentId,
      tenantId: config.tenantId,
      cloud,
      clientId: args.setClientId,
    });
    process.stdout.write(
      JSON.stringify(
        { status: "ok", saved: true, agentId: config.agentId, tenantId: config.tenantId },
        null,
        2
      ) + "\n"
    );
    return;
  }

  if (!args.utterance && !args.dryRun)
    die("Missing message argument. Pass the utterance to send as a quoted string.");

  const clientId = resolveClientId({
    explicit: args.clientId,
    agentId: config.agentId,
    tenantId: config.tenantId,
  });

  const directConnectUrl =
    args.directConnectUrl ||
    buildDirectConnectUrl(config.environmentId, config.schemaName, cloud);
  const scope = scopeForCloud(cloud);

  // --dry-run: report the resolved connection plan without authenticating or chatting. This must
  // work before app-registration setup, so a missing client id is reported (not fatal) here.
  if (args.dryRun) {
    process.stdout.write(
      JSON.stringify(
        {
          status: "ok",
          dryRun: true,
          agentDir,
          displayName: config.displayName || null,
          schemaName: config.schemaName,
          environmentId: config.environmentId,
          tenantId: config.tenantId,
          agentId: config.agentId,
          cloud,
          directConnectUrl,
          scope,
          appClientId: clientId || null,
          needsClientId: !clientId,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  if (!clientId) {
    die(
      "No app registration configured. Provide --client-id <appId> (an Entra public-client app " +
        "with the CopilotStudio.Copilots.Invoke delegated permission). It will be saved for this " +
        "agent. See /mcs-assistant:chat for the setup steps.",
      { needsClientId: true, tenantId: config.tenantId, agentId: config.agentId }
    );
  }

  // Persist the client id only after it successfully authenticates (below), so a wrong/typo'd
  // id is never saved or reused. --dry-run and failed sign-ins therefore never write config.

  log(`Cloud: ${cloud}`);
  log(`Direct connect URL: ${directConnectUrl}`);

  log("Authenticating (device code)...");
  const token = await getAccessToken({
    tenantId: config.tenantId,
    clientId,
    scope,
    accountName: cacheAccountName(config.agentId),
    fallbackCachePath: tokenCachePath(config.agentId),
  });

  // Auth succeeded, so this client id is valid for the tenant — persist it for future runs.
  if (args.clientId) {
    saveClientId({ agentId: config.agentId, tenantId: config.tenantId, cloud, clientId });
  }

  try {
    const renderer = args.pretty ? createLiveRenderer({ out: process.stdout }) : null;
    if (renderer) renderer.userEcho(args.utterance);

    const result = await chat({
      utterance: args.utterance,
      conversationId: args.conversationId,
      directConnectUrl,
      cloud,
      token,
      schemaName: config.schemaName,
      agentId: config.agentId,
      onActivity: renderer ? (a) => renderer.onActivity(a) : undefined,
    });

    const conversationId = result.conversationId;
    const attachmentsDir = path.join(
      resolvePluginDataDir(),
      "chat-attachments",
      conversationId || "unknown"
    );
    const summary = summarizeTurn({
      startActivities: result.startActivities,
      activities: result.activities,
      attachmentsDir,
      isStart: result.isStart,
    });

    if (renderer) {
      if (result.isStart && summary.greeting) renderer.greeting(summary.greeting);
      renderer.finishTurn(summary);
      process.stderr.write(`Conversation id: ${conversationId}\n`);
      return;
    }

    if (args.raw) {
      // Full, unfiltered activity dump for debugging.
      process.stdout.write(
        JSON.stringify(
          {
            status: "ok",
            utterance: args.utterance,
            conversation_id: conversationId,
            start_activities: result.startActivities,
            activities: result.activities,
          },
          null,
          2
        ) + "\n"
      );
      return;
    }

    // Default: distilled, high-signal summary for the coding agent. Large attachments are
    // materialized to disk (see summary.attachments[].path) rather than inlined as base64.
    process.stdout.write(
      JSON.stringify(
        {
          status: "ok",
          utterance: args.utterance,
          conversation_id: conversationId,
          greeting: summary.greeting,
          reasoning: summary.reasoning,
          steps: summary.steps,
          text: summary.text,
          attachments: summary.attachments,
          activity_count: result.activities.length,
        },
        null,
        2
      ) + "\n"
    );
  } catch (e) {
    die(`Unexpected error: ${e.message}`);
  }
}

main().catch((e) => die(`Unexpected error: ${e.message}`));
