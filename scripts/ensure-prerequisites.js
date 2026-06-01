const fs = require('fs');
const cp = require('child_process');
const p = require('path');
const os = require('os');

const pluginRoot = p.resolve(__dirname, '..');
const pathsDir = p.join(os.homedir(), '.copilot-studio-cli');
const pathsFile = p.join(pathsDir, 'plugin-paths.json');
let pluginData = process.env.CLAUDE_PLUGIN_DATA || process.env.COPILOT_PLUGIN_DATA;

if (!pluginData && fs.existsSync(pathsFile)) {
  pluginData = JSON.parse(fs.readFileSync(pathsFile, 'utf8')).pluginData;
}

if (!pluginData) {
  console.error('CLAUDE_PLUGIN_DATA or COPILOT_PLUGIN_DATA is required to install Copilot Studio prerequisites.');
  process.exit(1);
}

const sourceManifest = p.join(pluginRoot, 'scripts', 'native-deps.json');
const installedManifest = p.join(pluginData, 'package.json');
const nodeModules = p.join(pluginData, 'node_modules');
const manifestText = fs.readFileSync(sourceManifest, 'utf8');
const requiredDependencies = Object.keys(JSON.parse(manifestText).dependencies || {});

function dependencyPath(name) {
  return p.join(nodeModules, ...name.split('/'));
}

function manifestMatches() {
  return fs.existsSync(installedManifest) && fs.readFileSync(installedManifest, 'utf8') === manifestText;
}

function prerequisitesInstalled() {
  return manifestMatches() && requiredDependencies.every((name) => fs.existsSync(dependencyPath(name)));
}

function writePluginPaths() {
  fs.mkdirSync(pathsDir, { recursive: true });
  fs.writeFileSync(pathsFile, JSON.stringify({ pluginData, pluginRoot }));
}

if (!prerequisitesInstalled()) {
  fs.mkdirSync(pluginData, { recursive: true });
  fs.copyFileSync(sourceManifest, installedManifest);
  cp.execSync('npm install --no-audit --no-fund', { cwd: pluginData, stdio: 'inherit' });
}

writePluginPaths();
