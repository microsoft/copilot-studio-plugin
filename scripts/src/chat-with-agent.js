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
 *
 * Output (stdout): a single JSON object with the full activity payloads and conversation_id.
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
      if (entry.name === "agent.mcs.yml" && entry.isFile()) {
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
      "No agent.mcs.yml found in the current directory tree. Use --agent-dir to point at a cloned Copilot Studio agent."
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

  // --- CLI-agent gate: only CLIAgentRecognizer agents use the /3p agenticruntime path. ---
  const recognizerKind = settings?.configuration?.recognizer?.kind;
  if (recognizerKind !== "CLIAgentRecognizer") {
    die(
      `This agent is not a CLI (agentic-loop) agent. settings.mcs.yml recognizer.kind is ` +
        `'${recognizerKind || "unset"}', expected 'CLIAgentRecognizer'. ` +
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

async function getAccessToken({ tenantId, clientId, scope, cachePath }) {
  const cachePlugin = {
    beforeCacheAccess: async (context) => {
      if (fs.existsSync(cachePath)) {
        context.tokenCache.deserialize(fs.readFileSync(cachePath, "utf-8"));
      }
    },
    afterCacheAccess: async (context) => {
      if (context.cacheHasChanged) {
        fs.writeFileSync(cachePath, context.tokenCache.serialize());
      }
    },
  };

  const app = new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
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

  const result = await app.acquireTokenByDeviceCode({
    scopes: [scope],
    deviceCodeCallback: (response) => {
      log(response.message);
    },
  });
  return result.accessToken;
}

// ---------------------------------------------------------------------------
// Chat (single turn; multi-turn via --conversation-id)
// ---------------------------------------------------------------------------

function activityToDict(activity) {
  return JSON.parse(JSON.stringify(activity));
}

async function chat({ utterance, conversationId, directConnectUrl, cloud, token }) {
  const settings = { directConnectUrl, cloud };
  const client = new CopilotStudioClient(settings, token);

  const startActivities = [];
  if (!conversationId) {
    log("Starting new conversation...");
    for await (const activity of client.startConversationStreaming({
      emitStartConversationEvent: true,
    })) {
      startActivities.push(activityToDict(activity));
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
    activities.push(activityToDict(activity));
  }

  return {
    status: "ok",
    utterance,
    conversation_id: conversationId || client.conversationId || null,
    start_activities: startActivities,
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
  if (!clientId) {
    die(
      "No app registration configured. Provide --client-id <appId> (an Entra public-client app " +
        "with the CopilotStudio.Copilots.Invoke delegated permission). It will be saved for this " +
        "agent. See /copilot-studio:chat for the setup steps.",
      { needsClientId: true, tenantId: config.tenantId, agentId: config.agentId }
    );
  }

  // Persist the client id whenever it was supplied explicitly, so future runs reuse it.
  if (args.clientId) {
    saveClientId({ agentId: config.agentId, tenantId: config.tenantId, cloud, clientId });
  }

  const directConnectUrl =
    args.directConnectUrl ||
    buildDirectConnectUrl(config.environmentId, config.schemaName, cloud);
  log(`Cloud: ${cloud}`);
  log(`Direct connect URL: ${directConnectUrl}`);

  const scope = scopeForCloud(cloud);

  // --dry-run: report the resolved connection plan without authenticating or chatting.
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
          appClientId: clientId,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  log("Authenticating (device code)...");
  const token = await getAccessToken({
    tenantId: config.tenantId,
    clientId,
    scope,
    cachePath: tokenCachePath(config.agentId),
  });

  try {
    const result = await chat({
      utterance: args.utterance,
      conversationId: args.conversationId,
      directConnectUrl,
      cloud,
      token,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (e) {
    die(`Unexpected error: ${e.message}`);
  }
}

main().catch((e) => die(`Unexpected error: ${e.message}`));
