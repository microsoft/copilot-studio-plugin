/**
 * Resolve the plugin's persistent data directory (native deps, chat-config.json, token cache).
 *
 * Order:
 *   1. CLAUDE_PLUGIN_DATA / COPILOT_PLUGIN_DATA / PLUGIN_DATA (set for hooks; usually not for
 *      commands the model runs).
 *   2. ~/.copilot-studio-cli/plugin-paths.json `roots[<this plugin root>]`, written by the
 *      SessionStart hook of this installed copy.
 *   3. The same file's top-level `pluginData`, written by whichever client (Claude Code, Codex,
 *      GitHub Copilot CLI) started a session last. It can belong to another installed copy.
 *   4. ~/.copilot-studio-cli.
 *
 * This file is plain CommonJS so the bundles' banner can require it before anything else loads
 * (to set NODE_PATH for the native deps), and the bundled sources use the same logic.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

// This file lives in <pluginRoot>/scripts/, and so do the bundles that include it.
const DEFAULT_PLUGIN_ROOT = path.dirname(__dirname);

function pathsFilePath(homedir = os.homedir()) {
  return path.join(homedir, ".copilot-studio-cli", "plugin-paths.json");
}

// realpathSync.native also returns the on-disk letter case, which the JS implementation doesn't.
function realpathOrSelf(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

// Windows paths are case-insensitive, and clients don't agree on the case (`C:\` vs `c:\`).
function sameRoot(a, b, platform) {
  const x = realpathOrSelf(a);
  const y = realpathOrSelf(b);
  return platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readPluginPaths(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function lookupRoot(roots, pluginRoot, platform) {
  if (!roots || typeof roots !== "object" || Array.isArray(roots)) return null;
  const direct = nonEmpty(roots[pluginRoot]);
  if (direct) return direct;
  for (const [root, data] of Object.entries(roots)) {
    if (nonEmpty(data) && sameRoot(root, pluginRoot, platform)) return data;
  }
  return null;
}

function resolvePluginDataDir({
  env = process.env,
  homedir = os.homedir(),
  pluginRoot = DEFAULT_PLUGIN_ROOT,
  platform = process.platform,
} = {}) {
  const fromEnv =
    nonEmpty(env.CLAUDE_PLUGIN_DATA) ||
    nonEmpty(env.COPILOT_PLUGIN_DATA) ||
    nonEmpty(env.PLUGIN_DATA);
  if (fromEnv) return fromEnv;

  const parsed = readPluginPaths(pathsFilePath(homedir));
  if (parsed) {
    const own = lookupRoot(parsed.roots, pluginRoot, platform);
    if (own) return own;
    const last = nonEmpty(parsed.pluginData);
    if (last) return last;
  }
  return path.join(homedir, ".copilot-studio-cli");
}

module.exports = { pathsFilePath, readPluginPaths, resolvePluginDataDir };
