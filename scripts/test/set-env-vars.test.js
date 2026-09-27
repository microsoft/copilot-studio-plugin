const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { after } = require("node:test");

const HOOK = path.resolve(__dirname, "..", "..", "hooks", "set-env-vars.js");
const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST = fs.readFileSync(
  path.resolve(__dirname, "..", "native-deps.json"),
  "utf8"
);

const fixtureRoots = [];
after(() => {
  for (const root of fixtureRoots) fs.rmSync(root, { recursive: true, force: true });
});

// A home dir, a plugin data dir and a fake `npm` that logs each call and exits with the code in
// <fixture>/npm-exit (0 by default), so no test touches the network or the real ~.
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "set-env-vars-"));
  fixtureRoots.push(root);
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "npm"),
    '#!/bin/sh\necho "$@" >> "$FAKE_NPM_LOG"\n' +
      'if [ -f "$FAKE_PATHS_FILE" ]; then cp "$FAKE_PATHS_FILE" "$FAKE_NPM_LOG.paths"; fi\n' +
      'exit "$(cat "$FAKE_NPM_EXIT" 2>/dev/null || echo 0)"\n',
    { mode: 0o755 }
  );
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  return {
    root,
    home,
    data: path.join(root, "data"),
    pathsFile: path.join(home, ".copilot-studio-cli", "plugin-paths.json"),
    npmLog: path.join(root, "npm.log"),
    npmExit: path.join(root, "npm-exit"),
    bin,
  };
}

function runHook(fx, env) {
  return cp.spawnSync(process.execPath, [HOOK], {
    encoding: "utf8",
    env: {
      HOME: fx.home,
      USERPROFILE: fx.home,
      PATH: [fx.bin, "/usr/bin", "/bin"].join(path.delimiter),
      FAKE_NPM_LOG: fx.npmLog,
      FAKE_NPM_EXIT: fx.npmExit,
      FAKE_PATHS_FILE: fx.pathsFile,
      ...env,
    },
  });
}

function npmCalls(fx) {
  try {
    return fs.readFileSync(fx.npmLog, "utf8").trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

const posixOnly = { skip: process.platform === "win32" && "uses a POSIX shell script as npm" };

test("does nothing without a plugin data dir", posixOnly, () => {
  const fx = makeFixture();
  const res = runHook(fx, {});
  assert.equal(res.status, 0);
  assert.equal(fs.existsSync(fx.pathsFile), false);
  assert.equal(npmCalls(fx), 0);
});

test("a failed npm install is retried at the next session start", posixOnly, () => {
  const fx = makeFixture();
  fs.writeFileSync(fx.npmExit, "1");
  let res = runHook(fx, { CLAUDE_PLUGIN_DATA: fx.data });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /native dependency install skipped/);
  assert.equal(fs.readFileSync(path.join(fx.data, "package.json"), "utf8"), MANIFEST);
  assert.equal(fs.existsSync(path.join(fx.data, "installed-native-deps.json")), false);
  assert.equal(npmCalls(fx), 1);

  fs.writeFileSync(fx.npmExit, "0");
  res = runHook(fx, { CLAUDE_PLUGIN_DATA: fx.data });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(npmCalls(fx), 2);
  assert.equal(
    fs.readFileSync(path.join(fx.data, "installed-native-deps.json"), "utf8"),
    MANIFEST
  );

  res = runHook(fx, { CLAUDE_PLUGIN_DATA: fx.data });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(npmCalls(fx), 2, "an installed manifest is not installed again");
});

test("a data dir installed by an older version installs once more, then settles", posixOnly, () => {
  const fx = makeFixture();
  fs.mkdirSync(fx.data, { recursive: true });
  fs.writeFileSync(path.join(fx.data, "package.json"), MANIFEST);
  runHook(fx, { CLAUDE_PLUGIN_DATA: fx.data });
  runHook(fx, { CLAUDE_PLUGIN_DATA: fx.data });
  assert.equal(npmCalls(fx), 1);
});

test("accepts PLUGIN_DATA and COPILOT_PLUGIN_DATA", posixOnly, () => {
  for (const name of ["PLUGIN_DATA", "COPILOT_PLUGIN_DATA"]) {
    const fx = makeFixture();
    const res = runHook(fx, { [name]: fx.data });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(JSON.parse(fs.readFileSync(fx.pathsFile, "utf8")).pluginData, fx.data);
  }
});

test("records this copy under roots and keeps other installed copies", posixOnly, () => {
  const fx = makeFixture();
  const otherRoot = path.join(fx.root, "other-plugin-copy");
  fs.mkdirSync(otherRoot);
  const removedRoot = path.join(fx.root, "removed-version");
  fs.mkdirSync(path.dirname(fx.pathsFile), { recursive: true });
  fs.writeFileSync(
    fx.pathsFile,
    JSON.stringify({
      pluginData: "/other-data",
      pluginRoot: otherRoot,
      roots: { [otherRoot]: "/other-data", [removedRoot]: "/removed-data" },
    })
  );
  const res = runHook(fx, { CLAUDE_PLUGIN_DATA: fx.data });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(fx.pathsFile, "utf8")), {
    pluginData: fx.data,
    pluginRoot: PLUGIN_ROOT,
    roots: { [otherRoot]: "/other-data", [PLUGIN_ROOT]: fx.data },
  });
  assert.deepEqual(
    fs.readdirSync(path.dirname(fx.pathsFile)),
    ["plugin-paths.json"],
    "no temp file is left behind"
  );
});

test("replaces an unreadable plugin-paths.json", posixOnly, () => {
  const fx = makeFixture();
  fs.mkdirSync(path.dirname(fx.pathsFile), { recursive: true });
  fs.writeFileSync(fx.pathsFile, "{broken");
  const res = runHook(fx, { CLAUDE_PLUGIN_DATA: fx.data });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(fx.pathsFile, "utf8")).roots, {
    [PLUGIN_ROOT]: fx.data,
  });
});

test("records this copy before npm install runs", posixOnly, () => {
  const fx = makeFixture();
  const res = runHook(fx, { CLAUDE_PLUGIN_DATA: fx.data });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(npmCalls(fx), 1);
  const seenByNpm = JSON.parse(fs.readFileSync(fx.npmLog + ".paths", "utf8"));
  assert.equal(seenByNpm.roots[PLUGIN_ROOT], fx.data);
});

test("skips a data dir whose plugin root names another copy", posixOnly, () => {
  // Copilot CLI or Codex started from a Claude Code shell inherits Claude's exported pair.
  const inherited = { CLAUDE_PLUGIN_DATA: "/claude-data", CLAUDE_PLUGIN_ROOT: "/claude-root" };
  const fx = makeFixture();
  let res = runHook(fx, { ...inherited, COPILOT_PLUGIN_DATA: fx.data });
  assert.equal(res.status, 0, res.stderr);
  let paths = JSON.parse(fs.readFileSync(fx.pathsFile, "utf8"));
  assert.equal(paths.pluginData, fx.data);
  assert.equal(paths.roots[PLUGIN_ROOT], fx.data);

  const only = makeFixture();
  res = runHook(only, inherited);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.existsSync(only.pathsFile), false);
  assert.equal(npmCalls(only), 0);

  const own = makeFixture();
  res = runHook(own, { CLAUDE_PLUGIN_DATA: own.data, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  assert.equal(res.status, 0, res.stderr);
  paths = JSON.parse(fs.readFileSync(own.pathsFile, "utf8"));
  assert.equal(paths.roots[PLUGIN_ROOT], own.data);
});

// Two installed copies (their own hooks/ and scripts/) whose hooks start at the same moment.
function makeCopy(fx, name) {
  const copy = path.join(fx.root, name);
  fs.mkdirSync(path.join(copy, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(copy, "scripts"), { recursive: true });
  fs.copyFileSync(HOOK, path.join(copy, "hooks", "set-env-vars.js"));
  for (const f of ["plugin-data-dir.js", "native-deps.json"]) {
    fs.copyFileSync(path.resolve(__dirname, "..", f), path.join(copy, "scripts", f));
  }
  return { hook: path.join(copy, "hooks", "set-env-vars.js"), root: fs.realpathSync(copy) };
}

function startHook(fx, hook, data) {
  return new Promise((resolve) => {
    const child = cp.spawn(process.execPath, [hook], {
      env: {
        HOME: fx.home,
        USERPROFILE: fx.home,
        PATH: [fx.bin, "/usr/bin", "/bin"].join(path.delimiter),
        FAKE_NPM_LOG: fx.npmLog,
        FAKE_NPM_EXIT: fx.npmExit,
        FAKE_PATHS_FILE: fx.pathsFile,
        PLUGIN_DATA: data,
      },
      stdio: "ignore",
      timeout: 15000,
    });
    child.on("exit", (code, signal) => {
      assert.equal(signal, null, "hook timed out");
      resolve(code);
    });
  });
}

test("concurrent session starts keep both copies under roots", posixOnly, async () => {
  for (let i = 0; i < 20; i++) {
    const fx = makeFixture();
    const a = makeCopy(fx, "copy-a");
    const b = makeCopy(fx, "copy-b");
    await Promise.all([startHook(fx, a.hook, "/data-a"), startHook(fx, b.hook, "/data-b")]);
    const roots = JSON.parse(fs.readFileSync(fx.pathsFile, "utf8")).roots;
    assert.deepEqual(roots, { [a.root]: "/data-a", [b.root]: "/data-b" }, `run ${i}`);
  }
});

test("a stale lock is taken over and no lock is left behind", posixOnly, () => {
  const fx = makeFixture();
  const lockFile = fx.pathsFile + ".lock";
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, "");
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lockFile, old, old);
  const res = runHook(fx, { CLAUDE_PLUGIN_DATA: fx.data });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(fs.readFileSync(fx.pathsFile, "utf8")).roots[PLUGIN_ROOT], fx.data);
  assert.equal(fs.existsSync(lockFile), false);
});

// Loads the hook with fs.unlinkSync failing with EPERM for the lock, as when another process
// (an antivirus scanner on Windows) holds it.
function runHookWithStuckLock(fx, env) {
  const wrapper = path.join(fx.root, "stuck-lock.js");
  fs.writeFileSync(
    wrapper,
    'const fs = require("fs");\n' +
      "const unlink = fs.unlinkSync;\n" +
      "const rename = fs.renameSync;\n" +
      'const deny = () => Object.assign(new Error("EPERM"), { code: "EPERM" });\n' +
      'fs.unlinkSync = (p) => { if (String(p).includes(".lock")) throw deny(); return unlink(p); };\n' +
      'fs.renameSync = (a, b) => { if (String(a).endsWith(".lock")) throw deny(); return rename(a, b); };\n' +
      `require(${JSON.stringify(HOOK)});\n`
  );
  return cp.spawnSync(process.execPath, [wrapper], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      HOME: fx.home,
      USERPROFILE: fx.home,
      PATH: [fx.bin, "/usr/bin", "/bin"].join(path.delimiter),
      FAKE_NPM_LOG: fx.npmLog,
      FAKE_NPM_EXIT: fx.npmExit,
      FAKE_PATHS_FILE: fx.pathsFile,
      ...env,
    },
  });
}

test("a lock that can't be removed delays the hook by at most a few seconds", posixOnly, () => {
  for (const age of [60000, 0]) {
    const fx = makeFixture();
    const lockFile = fx.pathsFile + ".lock";
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, "");
    const when = new Date(Date.now() - age);
    fs.utimesSync(lockFile, when, when);
    const started = Date.now();
    const res = runHookWithStuckLock(fx, { CLAUDE_PLUGIN_DATA: fx.data });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(Date.now() - started < 6000, `took ${Date.now() - started} ms`);
    assert.equal(JSON.parse(fs.readFileSync(fx.pathsFile, "utf8")).roots[PLUGIN_ROOT], fx.data);
  }
});

test("concurrent session starts over a stale lock keep both copies", posixOnly, async () => {
  for (let i = 0; i < 10; i++) {
    const fx = makeFixture();
    const a = makeCopy(fx, "copy-a");
    const b = makeCopy(fx, "copy-b");
    const lockFile = fx.pathsFile + ".lock";
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, "");
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(lockFile, old, old);
    await Promise.all([startHook(fx, a.hook, "/data-a"), startHook(fx, b.hook, "/data-b")]);
    const roots = JSON.parse(fs.readFileSync(fx.pathsFile, "utf8")).roots;
    assert.deepEqual(roots, { [a.root]: "/data-a", [b.root]: "/data-b" }, `run ${i}`);
    assert.equal(fs.existsSync(lockFile), false);
  }
});

const asRoot = typeof process.getuid === "function" && process.getuid() === 0;

test(
  "a read-only home still exports the env vars",
  { skip: posixOnly.skip || (asRoot && "root can write anyway") },
  () => {
    const fx = makeFixture();
    const envFile = path.join(fx.root, "claude-env");
    fs.chmodSync(fx.home, 0o555);
    try {
      const res = runHook(fx, { CLAUDE_PLUGIN_DATA: fx.data, CLAUDE_ENV_FILE: envFile });
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stderr, /could not record the plugin paths/);
      assert.match(fs.readFileSync(envFile, "utf8"), /export CLAUDE_PLUGIN_DATA=/);
      assert.equal(npmCalls(fx), 1);
    } finally {
      fs.chmodSync(fx.home, 0o755);
    }
  }
);

test("a lock dated in the future is taken over as stale", posixOnly, () => {
  const fx = makeFixture();
  const lockFile = fx.pathsFile + ".lock";
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, "");
  const future = new Date(Date.now() + 60000);
  fs.utimesSync(lockFile, future, future);
  const started = Date.now();
  const res = runHook(fx, { CLAUDE_PLUGIN_DATA: fx.data });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.equal(fs.existsSync(lockFile), false);
});

test("the hook waits for a held lock and records after it is released", posixOnly, async () => {
  const fx = makeFixture();
  const a = makeCopy(fx, "copy-a");
  const lockFile = fx.pathsFile + ".lock";
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, "");
  const started = Date.now();
  const done = startHook(fx, a.hook, "/data-a");
  setTimeout(() => fs.unlinkSync(lockFile), 400);
  assert.equal(await done, 0);
  const took = Date.now() - started;
  assert.ok(took >= 400 && took < 2900, `took ${took} ms`);
  assert.equal(JSON.parse(fs.readFileSync(fx.pathsFile, "utf8")).roots[a.root], "/data-a");
});
