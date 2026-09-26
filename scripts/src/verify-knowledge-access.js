/**
 * verify-knowledge-access.js — Opt-in pre-check for SharePoint/OneDrive knowledge links.
 *
 * Before adding a SharePoint or OneDrive file/folder as a knowledge source, this verifies two
 * things for the *signed-in (author) user*, without downloading the file:
 *   1. the link is valid (the item exists), and
 *   2. the signed-in user can read it.
 *
 * It does this with a single Microsoft Graph call:
 *     GET https://graph.microsoft.com/v1.0/shares/{shareId}/driveItem
 * where {shareId} is the "u!"-encoded item URL. A 200 means valid + accessible; 403 means the
 * user has no access or the link cannot be resolved; 404 means the link is invalid / not found.
 *
 * IMPORTANT (delegated permissions): SharePoint/OneDrive knowledge is retrieved at runtime using
 * *each end user's* permissions. This check runs as the author, so a positive result confirms the
 * author's access only — it does NOT guarantee that end users of the agent can access the item.
 * The result therefore includes `checkedAs: "author"` and a note to that effect.
 *
 * Auth mirrors chat-with-agent: MSAL device-code against a public-client Entra app
 * (--client-id), reusing the per-agent app id saved in <pluginData>/chat-config.json. The app
 * registration must additionally have the delegated Microsoft Graph permissions
 * Files.ReadWrite consented for the Graph call to succeed.
 *
 * IMPORTANT: --client-id must be an app registration YOU own in the agent's tenant. A Microsoft
 * first-party (Microsoft-owned) or sample app id will fail with AADSTS65002 — first-party apps can
 * only get Microsoft Graph tokens if Graph's owner preauthorized them, which a tenant admin cannot
 * grant. An app id that is preauthorized for the Copilot Studio / Power Platform API (so the /chat
 * skill works) is NOT automatically authorized for Microsoft Graph; use your own app for this check.
 *
 * Usage:
 *   node verify-knowledge-access.bundle.js --agent-dir <path> "<sharepoint-or-onedrive-url>"
 *   node verify-knowledge-access.bundle.js --agent-dir <path> --url <url> --client-id <appId>
 *   node verify-knowledge-access.bundle.js --tenant-id <guid> --client-id <appId> --url <url>
 *   node verify-knowledge-access.bundle.js --url <url> --dry-run     (encode + plan, no auth)
 *
 * Output (stdout): a single distilled JSON object:
 *   { status, url, checkedAs, item?, httpStatus?, note, ... }
 *   status ∈ "ok" | "accessible" | "forbidden" | "notfound" | "skipped" | "error".
 * Diagnostics (stderr): human-readable progress + the device-code prompt.
 * Exit codes: 0 = a definitive determination was made (including forbidden/notfound/skipped),
 *             1 = an operational error (bad input, auth failure, network).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { PublicClientApplication } = require("@azure/msal-node");
const { createSecureCachePlugin } = require("./secure-msal-cache");
const { resolvePluginDataDir } = require("../plugin-data-dir");

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function log(msg) {
  process.stderr.write(msg + "\n");
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function die(msg, extra) {
  emit(Object.assign({ status: "error", error: msg }, extra || {}));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Cloud -> Microsoft Graph host (national clouds use different Graph endpoints)
// ---------------------------------------------------------------------------

const GRAPH_HOST = {
  Prod: "graph.microsoft.com",
  FirstRelease: "graph.microsoft.com",
  Test: "graph.microsoft.com",
  Preprod: "graph.microsoft.com",
  Dev: "graph.microsoft.com",
  Exp: "graph.microsoft.com",
  Prv: "graph.microsoft.com",
  Gov: "graph.microsoft.us",
  GovFR: "graph.microsoft.us",
  High: "graph.microsoft.us",
  DoD: "dod-graph.microsoft.us",
  Mooncake: "microsoftgraph.chinacloudapi.cn",
};

const AUTHORITY_HOST = {
  Prod: "login.microsoftonline.com",
  FirstRelease: "login.microsoftonline.com",
  Test: "login.microsoftonline.com",
  Preprod: "login.microsoftonline.com",
  Dev: "login.microsoftonline.com",
  Exp: "login.microsoftonline.com",
  Prv: "login.microsoftonline.com",
  Gov: "login.microsoftonline.us",
  GovFR: "login.microsoftonline.us",
  High: "login.microsoftonline.us",
  DoD: "login.microsoftonline.us",
  Mooncake: "login.partner.microsoftonline.cn",
};

function normalizeCloud(value) {
  if (!value) return "Prod";
  const found = Object.keys(GRAPH_HOST).find(
    (k) => k.toLowerCase() === String(value).toLowerCase()
  );
  return found || null;
}

function graphHostForCloud(cloud) {
  return GRAPH_HOST[cloud] || null;
}

function authorityHostForCloud(cloud) {
  return AUTHORITY_HOST[cloud] || null;
}

// Best-effort cloud inference from conn.json endpoints (default Prod). Mirrors chat-with-agent for
// Test/Preprod/Dev. National clouds are inferred separately from the SharePoint URL because gateway
// host patterns can be ambiguous (for example, "us-il107" can appear in a commercial host).
function inferCloudFromConn(conn) {
  const host = `${conn.AgentManagementEndpoint || ""} ${conn.DataverseEndpoint || ""}`.toLowerCase();
  if (/preprod/.test(host)) return "Preprod";
  if (/\b(test)\b|\.test\./.test(host)) return "Test";
  if (/\bdev\b|\.dev\./.test(host)) return "Dev";
  return "Prod";
}

function inferCloudFromUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (host.endsWith(".sharepoint-mil.us")) return "DoD";
    if (host.endsWith(".sharepoint.us")) return "High";
    if (host.endsWith(".sharepoint.cn")) return "Mooncake";
  } catch {
    // URL validation happens separately.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plugin data dir + saved app-registration lookup (shared with chat-with-agent)
// ---------------------------------------------------------------------------

// Read the per-agent / per-tenant app id saved by the chat skill's setup flow.
function resolveClientId({ explicit, agentId, tenantId }) {
  if (explicit) return explicit;
  if (process.env.appClientId) return process.env.appClientId;
  try {
    const file = path.join(resolvePluginDataDir(), "chat-config.json");
    const cfg = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (agentId && cfg.agents?.[agentId]?.appClientId) return cfg.agents[agentId].appClientId;
    if (tenantId && cfg.tenantDefaults?.[tenantId]?.appClientId)
      return cfg.tenantDefaults[tenantId].appClientId;
  } catch {
    // no saved config
  }
  return null;
}

// Reuse the same per-agent encrypted cache slot as chat so a single sign-in serves both. The
// Graph token is cached under its own scopes within that account's MSAL cache.
function cacheAccountName(agentId) {
  const safe = (agentId || "default").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `chat-${safe}`;
}

// ---------------------------------------------------------------------------
// Agent workspace lookup (only tenantId + agentId are needed here)
// ---------------------------------------------------------------------------

function loadConn(agentDir) {
  const connPath = path.join(agentDir, ".mcs", "conn.json");
  if (!fs.existsSync(connPath)) {
    die(
      `No .mcs/conn.json at ${connPath}. Is this a Copilot Studio agent cloned with 'pac copilot clone'? ` +
        `You can instead pass --tenant-id and --client-id directly.`
    );
  }
  const conn = JSON.parse(fs.readFileSync(connPath, "utf-8"));
  return {
    conn,
    tenantId: conn.AccountInfo?.TenantId || null,
    agentId: conn.AgentId || null,
    environmentId: conn.EnvironmentId || null,
  };
}

// ---------------------------------------------------------------------------
// URL classification + Graph share-id encoding
// ---------------------------------------------------------------------------

// SharePoint/OneDrive hosts (commercial + national clouds). OneDrive for Business is a personal
// SharePoint site (host contains "-my.sharepoint").
function classifyUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { kind: "invalid", reason: "Not a valid URL." };
  }
  const host = u.hostname.toLowerCase();
  const isSpo = /\.sharepoint\.(com|us|cn)$/.test(host) || host.endsWith(".sharepoint-mil.us");
  if (!isSpo) {
    return {
      kind: "other",
      reason:
        "Not a SharePoint/OneDrive URL — access pre-check only applies to SharePoint and OneDrive links.",
    };
  }
  if (u.protocol !== "https:") {
    return { kind: "invalid", reason: "SharePoint and OneDrive URLs must use HTTPS." };
  }
  if (u.username || u.password) {
    return {
      kind: "invalid",
      reason: "SharePoint and OneDrive URLs must not contain embedded credentials.",
    };
  }
  // Opaque sharing links (/:f:/, /:w:/, /:x:/, /:b:/, ...) can still be resolved by Graph /shares,
  // but our add-knowledge flow rejects them earlier because the folder path can't be extracted for
  // the YAML. We still allow verifying them here.
  const isSharing = /\/:[a-z]:\//i.test(u.pathname);
  const isOneDrive = host.includes("-my.sharepoint");
  return { kind: isOneDrive ? "onedrive" : "sharepoint", isSharing, host };
}

// Encode a URL as a Graph share id: "u!" + base64url(url) with padding removed.
// See https://learn.microsoft.com/graph/api/shares-get#encoding-sharing-urls
function encodeShareId(url) {
  const b64 = Buffer.from(url, "utf8").toString("base64");
  return "u!" + b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
}

function defaultGraphScopes(graphHost) {
  return [`https://${graphHost}/Files.ReadWrite`];
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    url: null,
    agentDir: null,
    tenantId: null,
    clientId: null,
    cloud: null,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--url":
        parsed.url = args[++i];
        break;
      case "--agent-dir":
        parsed.agentDir = args[++i];
        break;
      case "--tenant-id":
        parsed.tenantId = args[++i];
        break;
      case "--client-id":
        parsed.clientId = args[++i];
        break;
      case "--cloud":
        parsed.cloud = args[++i];
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      default:
        if (!args[i].startsWith("--") && !parsed.url) parsed.url = args[i];
        break;
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Authentication (MSAL device-code, Graph scopes)
// ---------------------------------------------------------------------------

function firstLine(s) {
  return String(s || "").split(/\r?\n/)[0].trim();
}

// Map well-known Entra (AADSTS) failure codes found in an error/description string to an actionable
// hint. The most important here is AADSTS65002: it means --client-id is a Microsoft first-party app
// that cannot obtain Graph tokens, so the user must supply their own app registration instead.
function authErrorHint(text) {
  const s = String(text || "");
  if (/AADSTS65002\b/.test(s)) {
    return (
      "That --client-id is a Microsoft first-party (Microsoft-owned) application, which cannot " +
      "obtain Microsoft Graph tokens: first-party apps require preauthorization by the API owner " +
      "that a tenant admin cannot grant. Use YOUR OWN Entra app registration instead — create a " +
      "single-tenant app, enable 'Allow public client flows', add the delegated Graph permission " +
      "Files.ReadWrite, grant consent, then re-run with --client-id <your-app-id>. " +
      "Note: an app id preauthorized for the Copilot Studio / Power Platform API (used by the /chat " +
      "skill) is NOT automatically authorized for Microsoft Graph."
    );
  }
  if (/AADSTS700016\b/.test(s) || /unauthorized_client/.test(s)) {
    return (
      "The app registration (--client-id) must exist in this agent's tenant and allow public " +
      "client (device code) flows. Create or consent the app in the correct tenant, or pass a " +
      "different --client-id."
    );
  }
  if (/AADSTS7000218\b/.test(s) || /invalid_client/.test(s)) {
    return "Enable 'Allow public client flows' on the app registration.";
  }
  if (/AADSTS65001\b/.test(s) || /consent_required/.test(s) || /interaction_required/.test(s)) {
    return (
      "Consent has not been granted — add and consent the delegated Microsoft Graph permission " +
      "Files.ReadWrite on the app registration, then retry."
    );
  }
  return "";
}

// MSAL-node can mask a failed /devicecode request (app registration missing in the tenant, public
// client flows disabled, or an unauthorized client/scope) as an opaque
// "post_request_failed: invalid_grant" and invoke the device-code callback with an empty response,
// so the user never sees the real reason. When that happens we ask the token endpoint directly to
// surface the actual AADSTS error.
async function diagnoseDeviceCodeFailure({ authority, clientId, scopes }) {
  try {
    const scope = Array.isArray(scopes) ? scopes.join(" ") : String(scopes || "");
    const body = new URLSearchParams({ client_id: clientId, scope }).toString();
    const res = await fetch(`${authority}/oauth2/v2.0/devicecode`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json().catch(() => null);
    if (data && data.error) {
      const desc = firstLine(data.error_description);
      const hint = authErrorHint(desc) || authErrorHint(data.error);
      return `Device-code sign-in could not start: ${data.error}${desc ? ` — ${desc}` : ""}.${
        hint ? " " + hint : ""
      }`;
    }
  } catch {
    // best effort; fall back to the generic error
  }
  return null;
}

async function resolveSecureCachePlugin(
  accountName,
  warn = log,
  cacheFactory = createSecureCachePlugin
) {
  try {
    return await cacheFactory(accountName);
  } catch {
    warn(
      "Encrypted token storage is unavailable. Using an in-memory token cache for this run; " +
        "no Microsoft Graph credentials will be written to disk."
    );
    return null;
  }
}

function buildMsalConfig({ clientId, authority, cachePlugin }) {
  const config = { auth: { clientId, authority } };
  if (cachePlugin) config.cache = { cachePlugin };
  return config;
}

async function getGraphToken({ tenantId, clientId, scopes, authorityHost, accountName }) {
  const authority = `https://${authorityHost}/${tenantId}`;
  const cachePlugin = await resolveSecureCachePlugin(accountName);
  const app = new PublicClientApplication(buildMsalConfig({ clientId, authority, cachePlugin }));

  const accounts = await app.getTokenCache().getAllAccounts();
  if (accounts.length > 0) {
    try {
      const result = await app.acquireTokenSilent({ scopes, account: accounts[0] });
      log("Using cached token.");
      return result.accessToken;
    } catch {
      // fall through to device code
    }
  }

  let sawPrompt = false;
  try {
    const result = await app.acquireTokenByDeviceCode({
      scopes,
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
      const detail = await diagnoseDeviceCodeFailure({ authority, clientId, scopes });
      if (detail) die(detail, { tenantId });
    }
    const code = e && (e.errorCode || e.name);
    const msg = e && (e.errorMessage || e.message);
    const hint = authErrorHint(msg) || authErrorHint(String(code));
    die(
      `Authentication failed${code ? `: ${code}` : ""}${msg ? ` (${firstLine(msg)})` : ""}. ` +
        (hint ||
          "The app registration must allow public-client (device code) flows and have the " +
            "delegated Microsoft Graph permission Files.ReadWrite consented."),
      { tenantId }
    );
  }
}

// ---------------------------------------------------------------------------
// Graph call
// ---------------------------------------------------------------------------

async function checkAccess({ graphHost, shareId, token }) {
  const select = "id,name,webUrl,size,folder,file,parentReference";
  const url = `https://${graphHost}/v1.0/shares/${shareId}/driveItem?$select=${encodeURIComponent(
    select
  )}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return { res, url };
}

const AUTHOR_NOTE =
  "This confirms the signed-in (author) user's access only. SharePoint/OneDrive knowledge is " +
  "retrieved at runtime using each end user's permissions, so ensure end users of the agent also " +
  "have access to this item.";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  if (!args.url) {
    die(
      'Missing URL. Pass the SharePoint/OneDrive link as a quoted string or via --url "<url>".'
    );
  }

  const cls = classifyUrl(args.url);
  if (cls.kind === "invalid") {
    die(cls.reason, { url: args.url });
  }
  if (cls.kind === "other") {
    // Not applicable — report skipped (not an error) so callers can proceed without a check.
    emit({
      status: "skipped",
      url: args.url,
      reason: cls.reason,
      note: "Public website and uploaded-file sources do not need a SharePoint/OneDrive access check.",
    });
    return;
  }

  // Resolve tenant + agent (optional) for auth.
  let tenantId = args.tenantId;
  let agentId = null;
  let cloud = args.cloud || inferCloudFromUrl(args.url);
  if (args.agentDir) {
    const info = loadConn(path.resolve(args.agentDir));
    tenantId = tenantId || info.tenantId;
    agentId = info.agentId;
    cloud = cloud || inferCloudFromConn(info.conn);
  }
  cloud = normalizeCloud(cloud);
  if (!cloud) {
    die(
      `Unknown cloud '${args.cloud}'. Use Prod, FirstRelease, Test, Preprod, Dev, Exp, Prv, Gov, GovFR, High, DoD, or Mooncake.`
    );
  }
  const graphHost = graphHostForCloud(cloud);
  const authorityHost = authorityHostForCloud(cloud);
  const shareId = encodeShareId(args.url);
  const scopes = defaultGraphScopes(graphHost);

  const clientId = resolveClientId({ explicit: args.clientId, agentId, tenantId });

  // --dry-run: report the resolved plan (encoding, scopes, endpoint) without authenticating. This
  // lets the whole non-auth path be exercised in tests and before app-registration setup.
  if (args.dryRun) {
    emit({
      status: "ok",
      dryRun: true,
      url: args.url,
      sourceKind: cls.kind,
      isSharingLink: !!cls.isSharing,
      tenantId: tenantId || null,
      agentId: agentId || null,
      cloud,
      graphHost,
      authorityHost,
      authority: tenantId ? `https://${authorityHost}/${tenantId}` : null,
      shareId,
      graphEndpoint: `https://${graphHost}/v1.0/shares/${shareId}/driveItem`,
      scopes,
      appClientId: clientId || null,
      needsClientId: !clientId,
      checkedAs: "author",
      note: AUTHOR_NOTE,
    });
    return;
  }

  if (!tenantId) {
    die(
      "No tenant id. Pass --tenant-id <guid>, or --agent-dir <path> to a cloned agent whose " +
        ".mcs/conn.json carries the tenant id."
    );
  }
  if (!clientId) {
    die(
      "No app registration configured. Provide --client-id <appId> — an Entra public-client app " +
        "that YOU own in this tenant, with the delegated Microsoft Graph permission Files.ReadWrite " +
        "consented. Do NOT use a Microsoft first-party/sample app id (it will " +
        "fail with AADSTS65002). If you already set up the chat skill's app id for this agent and " +
        "it is your own registration, add that Graph permission to the same app.",
      { needsClientId: true, tenantId, agentId }
    );
  }

  log(`Cloud: ${cloud} (Graph: ${graphHost})`);
  log("Authenticating (device code)...");
  const token = await getGraphToken({
    tenantId,
    clientId,
    scopes,
    authorityHost,
    accountName: cacheAccountName(agentId),
  });

  log("Checking access via Microsoft Graph...");
  let res, url;
  try {
    ({ res, url } = await checkAccess({ graphHost, shareId, token }));
  } catch (e) {
    die(`Graph request failed: ${e.message}`, { graphHost });
  }

  if (res.status === 200) {
    let item = null;
    try {
      const body = await res.json();
      item = {
        name: body.name || null,
        webUrl: body.webUrl || null,
        isFolder: !!body.folder,
        isFile: !!body.file,
        size: typeof body.size === "number" ? body.size : null,
        driveId: body.parentReference?.driveId || null,
        itemId: body.id || null,
      };
    } catch {
      // still a 200 = accessible even if body parse fails
    }
    emit({
      status: "accessible",
      url: args.url,
      httpStatus: 200,
      checkedAs: "author",
      item,
      note: AUTHOR_NOTE,
    });
    return;
  }

  if (res.status === 403) {
    emit({
      status: "forbidden",
      url: args.url,
      httpStatus: 403,
      checkedAs: "author",
      note:
        "Access denied — Graph could not return this item for the signed-in user. Either you do not " +
        "have access, or the link does not resolve (a wrong/renamed URL): the Graph /shares endpoint " +
        "returns 403 for both. Re-copy the URL from the browser address bar and confirm you were " +
        "granted access in SharePoint/OneDrive, then retry. " +
        AUTHOR_NOTE,
    });
    return;
  }

  if (res.status === 404) {
    emit({
      status: "notfound",
      url: args.url,
      httpStatus: 404,
      checkedAs: "author",
      note:
        "The link could not be resolved (item not found). Check that the URL points at an existing " +
        "file or folder — open it in the browser and copy the address-bar URL.",
    });
    return;
  }

  if (res.status === 401) {
    die(
      "Graph returned 401 Unauthorized — the token was rejected. Ensure the app registration has the " +
        "delegated Graph permission Files.ReadWrite consented.",
      { httpStatus: 401, endpoint: url }
    );
  }

  // Any other status: surface a short snippet for diagnosis.
  let snippet = "";
  try {
    const text = await res.text();
    snippet = text ? ` — ${text.slice(0, 300)}` : "";
  } catch {
    // ignore
  }
  die(`Graph returned HTTP ${res.status}${snippet}`, { httpStatus: res.status, endpoint: url });
}

if (require.main === module) {
  main().catch((e) => die(`Unexpected error: ${e.message}`));
}

module.exports = {
  authorityHostForCloud,
  buildMsalConfig,
  classifyUrl,
  defaultGraphScopes,
  encodeShareId,
  graphHostForCloud,
  inferCloudFromConn,
  inferCloudFromUrl,
  normalizeCloud,
  resolveSecureCachePlugin,
};
