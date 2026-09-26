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
    '#!/bin/sh\necho "$@" >> "$FAKE_NPM_LOG"\nexit "$(cat "$FAKE_NPM_EXIT" 2>/dev/null || echo 0)"\n',
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
