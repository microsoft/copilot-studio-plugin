const fs = require('fs');
const cp = require('child_process');
const p = require('path');
const os = require('os');

// __dirname is the hooks/ directory; the plugin root is one level up
const r = p.resolve(__dirname, '..');
// Claude Code sets CLAUDE_PLUGIN_DATA, GitHub Copilot CLI COPILOT_PLUGIN_DATA, and Codex both
// PLUGIN_DATA and CLAUDE_PLUGIN_DATA. A variable whose *_PLUGIN_ROOT partner names another copy is
// skipped, the same way the scripts resolve it: a client started from a Claude Code shell inherits
// Claude's pair.
let d;
try {
  d = require(p.join(r, 'scripts', 'plugin-data-dir.js')).pluginDataFromEnv({ pluginRoot: r });
} catch {
  // A damaged install: fall back to the plain order rather than fail the session start.
  d = process.env.CLAUDE_PLUGIN_DATA || process.env.COPILOT_PLUGIN_DATA || process.env.PLUGIN_DATA;
}
const e = process.env.CLAUDE_ENV_FILE;
const pd = p.join(os.homedir(), '.copilot-studio-cli');
const pathsFile = p.join(pd, 'plugin-paths.json');

if (!d) {
  process.exit(0);
}

// Record this installed copy under `roots`, keyed by its plugin root, so each copy (for example
// one installed by Claude Code and one by Codex) finds its own data dir. The top-level fields are
// kept for older plugin versions and always describe the last session that started.
// This runs before the install below, which can take long enough to hit the hook timeout.
// Two sessions starting at the same moment can each drop the other's new entry; the next
// session start of that copy adds it back, and until then its scripts use `pluginData`.
let paths = {};
try {
  const parsed = JSON.parse(fs.readFileSync(pathsFile, 'utf8'));
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) paths = parsed;
} catch {
  // missing or unreadable: start over
}
const roots =
  paths.roots && typeof paths.roots === 'object' && !Array.isArray(paths.roots) ? paths.roots : {};
// Drop copies that were removed or replaced by an update (each version has its own root). Only a
// missing root counts: a sandboxed client may be unable to read another client's plugin folder.
for (const root of Object.keys(roots)) {
  if (root === r) continue;
  try {
    fs.statSync(root);
  } catch (err) {
    if (err && err.code === 'ENOENT') delete roots[root];
  }
}
roots[r] = d;
fs.mkdirSync(pd, { recursive: true });
const contents = JSON.stringify({ pluginData: d, pluginRoot: r, roots });
const tmp = pathsFile + '.' + process.pid + '.tmp';
try {
  // Write and rename so a session starting at the same time doesn't read a half-written file.
  // If the rename fails (for example EPERM on Windows while the file is open), fall back to a
  // plain write.
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, pathsFile);
} catch {
  try {
    fs.unlinkSync(tmp);
  } catch {
    // already gone
  }
  fs.writeFileSync(pathsFile, contents);
}

if (e) {
  fs.appendFileSync(
    e,
    'export CLAUDE_PLUGIN_DATA="' + d + '"\nexport CLAUDE_PLUGIN_ROOT="' + r + '"\n'
  );
}

// Install native deps (@azure/msal-node-extensions, keytar) that esbuild cannot
// bundle into the plugin data dir, so chat-with-agent can resolve them at runtime
// for OS-native encrypted token storage. Idempotent: only runs when the manifest
// differs from the one recorded after the last successful install, so a failed
// install is retried at the next session start.
try {
  const src = p.join(r, 'scripts', 'native-deps.json');
  const dst = p.join(d, 'package.json');
  const installed = p.join(d, 'installed-native-deps.json');
  const manifest = fs.readFileSync(src, 'utf8');
  let needsInstall = true;
  try {
    needsInstall = manifest !== fs.readFileSync(installed, 'utf8');
  } catch {
    needsInstall = true;
  }
  if (needsInstall) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(dst, manifest);
    cp.execSync('npm install --no-audit --no-fund', { cwd: d, stdio: 'inherit' });
    fs.writeFileSync(installed, manifest);
  }
} catch (err) {
  // Non-fatal: chat-with-agent falls back to a plaintext token cache if the
  // native deps are unavailable.
  console.error('[copilot-studio] native dependency install skipped: ' + (err && err.message ? err.message : err));
}
