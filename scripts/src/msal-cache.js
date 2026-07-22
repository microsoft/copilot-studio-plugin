/**
 * msal-cache.js — MSAL token-cache plugin backed by OS-native secure storage.
 *
 * Uses @azure/msal-node-extensions to persist MSAL's token cache via the
 * platform credential manager (Keychain on macOS, DPAPI on Windows, libsecret
 * on Linux). The on-disk cache file (~/.copilot-studio-cli/<account>.cache.json)
 * is an encrypted blob, not readable JSON.
 *
 * @azure/msal-node-extensions and keytar are native modules that cannot be
 * bundled by esbuild; they are installed into the plugin data dir at SessionStart
 * (see hooks/set-env-vars.js + scripts/native-deps.json) and resolved at runtime
 * via the NODE_PATH banner injected by the build. When they cannot be loaded
 * (e.g. running the bundle standalone before the deps are provisioned, or a
 * machine where keytar failed to build), we fall back to a plaintext file cache
 * so the flow keeps working, with a clear warning on stderr.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const CACHE_DIR = path.join(os.homedir(), ".copilot-studio-cli");
const SERVICE_NAME = "copilot-studio-cli";

/**
 * Encrypted cache plugin via @azure/msal-node-extensions.
 * Throws if the native extension cannot be required.
 */
async function createCachePlugin(accountName) {
  const {
    PersistenceCreator,
    PersistenceCachePlugin,
    DataProtectionScope,
  } = require("@azure/msal-node-extensions");

  const cachePath = path.join(CACHE_DIR, `${accountName}.cache.json`);
  const persistence = await PersistenceCreator.createPersistence({
    cachePath,
    dataProtectionScope: DataProtectionScope.CurrentUser,
    serviceName: SERVICE_NAME,
    accountName,
    usePlaintextFileOnLinux: true,
  });
  return new PersistenceCachePlugin(persistence);
}

/**
 * Plaintext file-cache plugin (the pre-encryption behavior). Used only as a
 * fallback when the native extension is unavailable.
 */
function createPlaintextCachePlugin(cachePath) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  } catch {
    // best effort
  }
  return {
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
}

/**
 * Preferred entry point: try OS-native encrypted storage, and if the native
 * module can't be loaded, transparently fall back to a plaintext file cache.
 *
 * @param {string} accountName  Per-agent cache slot (e.g. "chat-<AgentId>").
 * @param {string} fallbackPath Plaintext cache path used only on fallback.
 * @param {(msg: string) => void} [warn] Optional stderr logger.
 */
async function createCachePluginWithFallback(accountName, fallbackPath, warn) {
  try {
    return await createCachePlugin(accountName);
  } catch (e) {
    if (typeof warn === "function") {
      warn(
        "Encrypted token storage unavailable (@azure/msal-node-extensions could not be " +
          `loaded: ${e && e.message ? e.message : e}). Falling back to a plaintext token ` +
          "cache. Run a fresh session so the plugin can install its native dependencies, " +
          "or reinstall the plugin, to enable OS-keychain encryption."
      );
    }
    return createPlaintextCachePlugin(fallbackPath);
  }
}

module.exports = {
  createCachePlugin,
  createPlaintextCachePlugin,
  createCachePluginWithFallback,
  CACHE_DIR,
  SERVICE_NAME,
};
