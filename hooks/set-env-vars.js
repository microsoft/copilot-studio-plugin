const fs = require('fs');
const cp = require('child_process');
const p = require('path');
const os = require('os');

// __dirname is the hooks/ directory; the plugin root is one level up
const r = p.resolve(__dirname, '..');
const d = process.env.CLAUDE_PLUGIN_DATA || process.env.COPILOT_PLUGIN_DATA;
const e = process.env.CLAUDE_ENV_FILE;
const pd = p.join(os.homedir(), '.copilot-studio-cli');
const pathsFile = p.join(pd, 'plugin-paths.json');

if (!d) {
  process.exit(0);
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

fs.mkdirSync(pd, { recursive: true });
fs.writeFileSync(pathsFile, JSON.stringify({ pluginData: d, pluginRoot: r }));

if (e) {
  fs.appendFileSync(
    e,
    'export CLAUDE_PLUGIN_DATA="' + d + '"\nexport CLAUDE_PLUGIN_ROOT="' + r + '"\n'
  );
}
