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

// Two copies' sessions can start at the same moment, and without a lock the second write drops
// the first copy's entry. Take a lock file for the read-merge-write. A lock whose mtime is more
// than LOCK_STALE_MS away from now is left over from a killed hook; if the lock can't be had
// within LOCK_WAIT_MS, write anyway rather than hold up the session start. In that case, or if a
// takeover races, an entry can still be dropped, and that copy's next session start restores it.
const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 10000;
const lockFile = pathsFile + '.lock';

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isStale(stat) {
  return Math.abs(Date.now() - stat.mtimeMs) > LOCK_STALE_MS;
}

// On Windows, creating a file whose name is still being deleted fails with EPERM/EACCES/EBUSY.
function isBusy(err) {
  if (!err) return false;
  if (err.code === 'EEXIST') return true;
  return process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(err.code);
}

function acquireLock() {
  try {
    fs.mkdirSync(pd, { recursive: true });
  } catch {
    return null; // recordRoot reports it
  }
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    if (Date.now() > deadline) return null;
    try {
      return fs.openSync(lockFile, 'wx');
    } catch (err) {
      if (!isBusy(err)) return null;
      if (err.code !== 'EEXIST') {
        sleep(20 + Math.floor(Math.random() * 30));
        continue;
      }
    }
    try {
      if (isStale(fs.statSync(lockFile))) {
        // Move it aside and check what we moved: another hook may have taken it over and made a
        // fresh lock in between. Then put that one back (link fails if a newer lock exists).
        const stale = lockFile + '.' + process.pid + '.stale';
        fs.renameSync(lockFile, stale);
        if (!isStale(fs.statSync(stale))) {
          try {
            fs.linkSync(stale, lockFile);
          } catch {
            // a newer lock is already there
          }
          fs.unlinkSync(stale);
          sleep(20 + Math.floor(Math.random() * 30));
          continue;
        }
        fs.unlinkSync(stale);
        continue;
      }
    } catch (err) {
      if (err && err.code === 'ENOENT') continue; // released in the meantime
      // Anything else (EPERM, EBUSY: still held or can't be removed): wait it out below.
    }
    sleep(20 + Math.floor(Math.random() * 30));
  }
}

function recordRoot() {
  fs.mkdirSync(pd, { recursive: true });
  let paths = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(pathsFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) paths = parsed;
  } catch {
    // missing or unreadable: start over
  }
  const roots =
    paths.roots && typeof paths.roots === 'object' && !Array.isArray(paths.roots)
      ? paths.roots
      : {};
  // Drop copies that were removed or replaced by an update (each version has its own root). Only
  // a missing root counts: a sandboxed client may be unable to read another client's plugin folder.
  for (const root of Object.keys(roots)) {
    if (root === r) continue;
    try {
      fs.statSync(root);
    } catch (err) {
      if (err && err.code === 'ENOENT') delete roots[root];
    }
  }
  roots[r] = d;
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
}

function releaseLock(fd) {
  let ino = null;
  try {
    ino = fs.fstatSync(fd).ino;
  } catch {
    // remove it anyway below
  }
  try {
    fs.closeSync(fd);
  } catch {
    // still remove the file below
  }
  for (let i = 0; i < 3; i++) {
    try {
      // If our hold outlasted LOCK_STALE_MS, another hook may own the file now: leave it alone.
      if (ino !== null && fs.statSync(lockFile).ino !== ino) return;
      fs.unlinkSync(lockFile);
      return;
    } catch (err) {
      if (err && err.code === 'ENOENT') return; // taken over as stale by another hook
      sleep(20);
    }
  }
}

// This runs before the install below, which can take long enough to hit the hook timeout.
const lock = acquireLock();
try {
  recordRoot();
} catch (err) {
  // For example a read-only home: still export the env vars and install the native deps.
  console.error('[copilot-studio] could not record the plugin paths: ' + (err && err.message));
} finally {
  if (lock !== null) releaseLock(lock);
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
