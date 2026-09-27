const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { after } = require("node:test");

const { pathsFilePath, resolvePluginDataDir } = require("../plugin-data-dir");

const fixtureRoots = [];
after(() => {
  for (const root of fixtureRoots) fs.rmSync(root, { recursive: true, force: true });
});

function makeHome(pluginPaths) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-data-dir-"));
  fixtureRoots.push(home);
  if (pluginPaths !== undefined) {
    fs.mkdirSync(path.dirname(pathsFilePath(home)), { recursive: true });
    fs.writeFileSync(
      pathsFilePath(home),
      typeof pluginPaths === "string" ? pluginPaths : JSON.stringify(pluginPaths)
    );
  }
  return home;
}

test("an env var wins over plugin-paths.json", () => {
  const home = makeHome({ pluginData: "/last", roots: { "/root": "/own" } });
  for (const name of ["CLAUDE_PLUGIN_DATA", "COPILOT_PLUGIN_DATA", "PLUGIN_DATA"]) {
    assert.equal(
      resolvePluginDataDir({ env: { [name]: "/from-env" }, homedir: home, pluginRoot: "/root" }),
      "/from-env"
    );
  }
  assert.equal(
    resolvePluginDataDir({
      env: { CLAUDE_PLUGIN_DATA: "/claude", PLUGIN_DATA: "/codex" },
      homedir: home,
      pluginRoot: "/root",
    }),
    "/claude"
  );
});

test("blank env vars are ignored", () => {
  const home = makeHome({ pluginData: "/last" });
  assert.equal(
    resolvePluginDataDir({ env: { CLAUDE_PLUGIN_DATA: "  " }, homedir: home, pluginRoot: "/x" }),
    "/last"
  );
});

test("this copy's entry under roots wins over the last session's pluginData", () => {
  const home = makeHome({
    pluginData: "/codex-data",
    pluginRoot: "/codex-root",
    roots: { "/codex-root": "/codex-data", "/claude-root": "/claude-data" },
  });
  assert.equal(
    resolvePluginDataDir({ env: {}, homedir: home, pluginRoot: "/claude-root" }),
    "/claude-data"
  );
});

test("roots entries match through symlinks", () => {
  const home = makeHome();
  const realRoot = path.join(home, "real-root");
  const linkRoot = path.join(home, "link-root");
  fs.mkdirSync(realRoot);
  fs.symlinkSync(realRoot, linkRoot, "dir");
  fs.mkdirSync(path.dirname(pathsFilePath(home)), { recursive: true });
  fs.writeFileSync(
    pathsFilePath(home),
    JSON.stringify({ pluginData: "/last", roots: { [realRoot]: "/own" } })
  );
  assert.equal(resolvePluginDataDir({ env: {}, homedir: home, pluginRoot: linkRoot }), "/own");
});

test("without an own entry it uses the last session's pluginData", () => {
  const home = makeHome({ pluginData: "/last", roots: { "/other": "/other-data" } });
  assert.equal(resolvePluginDataDir({ env: {}, homedir: home, pluginRoot: "/mine" }), "/last");
  const legacy = makeHome({ pluginData: "/legacy", pluginRoot: "/whatever" });
  assert.equal(resolvePluginDataDir({ env: {}, homedir: legacy, pluginRoot: "/mine" }), "/legacy");
});

test("a missing, unparsable or malformed plugin-paths.json falls back to the home dir", () => {
  for (const contents of [undefined, "{not json", "[]", JSON.stringify({ roots: [], pluginData: 5 })]) {
    const home = makeHome(contents);
    assert.equal(
      resolvePluginDataDir({ env: {}, homedir: home, pluginRoot: "/mine" }),
      path.join(home, ".copilot-studio-cli")
    );
  }
});

test("the default plugin root is the directory above scripts/", () => {
  const pluginRoot = path.resolve(__dirname, "..", "..");
  const home = makeHome({ pluginData: "/last", roots: { [pluginRoot]: "/own" } });
  assert.equal(resolvePluginDataDir({ env: {}, homedir: home }), "/own");
});

test("roots match a differently cased plugin root on Windows only", () => {
  const home = makeHome({
    pluginData: "/last",
    roots: { "C:\\Users\\x\\plugins\\mcs-assistant\\1.0.2": "C:/data/own" },
  });
  assert.equal(
    resolvePluginDataDir({
      env: {},
      homedir: home,
      pluginRoot: "c:\\Users\\X\\plugins\\mcs-assistant\\1.0.2",
      platform: "win32",
    }),
    "C:/data/own"
  );
  assert.equal(
    resolvePluginDataDir({
      env: {},
      homedir: home,
      pluginRoot: "c:\\Users\\X\\plugins\\mcs-assistant\\1.0.2",
      platform: "linux",
    }),
    "/last"
  );
});

test("an env var whose plugin root names another copy is skipped", () => {
  const home = makeHome({ pluginData: "/last", roots: { "/copilot-root": "/copilot-data" } });
  // `copilot` started from a Claude Code shell inherits Claude's exported pair.
  const inherited = { CLAUDE_PLUGIN_DATA: "/claude-data", CLAUDE_PLUGIN_ROOT: "/claude-root" };
  assert.equal(
    resolvePluginDataDir({ env: inherited, homedir: home, pluginRoot: "/copilot-root" }),
    "/copilot-data"
  );
  assert.equal(
    resolvePluginDataDir({ env: inherited, homedir: home, pluginRoot: "/claude-root" }),
    "/claude-data"
  );
  assert.equal(
    resolvePluginDataDir({
      env: {
        ...inherited,
        COPILOT_PLUGIN_DATA: "/copilot-env",
        COPILOT_PLUGIN_ROOT: "/copilot-root",
      },
      homedir: home,
      pluginRoot: "/copilot-root",
    }),
    "/copilot-env"
  );
});

test("env plugin roots match through symlinks", () => {
  const home = makeHome();
  const realRoot = path.join(home, "real-root");
  const linkRoot = path.join(home, "link-root");
  fs.mkdirSync(realRoot);
  fs.symlinkSync(realRoot, linkRoot, "dir");
  assert.equal(
    resolvePluginDataDir({
      env: { CLAUDE_PLUGIN_DATA: "/claude-data", CLAUDE_PLUGIN_ROOT: linkRoot },
      homedir: home,
      pluginRoot: realRoot,
    }),
    "/claude-data"
  );
});

test("a skipped env var falls through to pluginData and then the home dir", () => {
  const inherited = { CLAUDE_PLUGIN_DATA: "/claude-data", CLAUDE_PLUGIN_ROOT: "/claude-root" };
  const home = makeHome({ pluginData: "/last" });
  assert.equal(
    resolvePluginDataDir({ env: inherited, homedir: home, pluginRoot: "/mine" }),
    "/last"
  );
  const empty = makeHome();
  assert.equal(
    resolvePluginDataDir({ env: inherited, homedir: empty, pluginRoot: "/mine" }),
    path.join(empty, ".copilot-studio-cli")
  );
});

test("an env plugin root that differs only in case matches on Windows only", () => {
  const home = makeHome({ pluginData: "/last" });
  const env = {
    CLAUDE_PLUGIN_DATA: "C:/data/claude",
    CLAUDE_PLUGIN_ROOT: "C:\\Users\\x\\plugins\\mcs-assistant\\1.0.2",
  };
  const pluginRoot = "c:\\Users\\X\\plugins\\mcs-assistant\\1.0.2";
  assert.equal(
    resolvePluginDataDir({ env, homedir: home, pluginRoot, platform: "win32" }),
    "C:/data/claude"
  );
  assert.equal(
    resolvePluginDataDir({ env, homedir: home, pluginRoot, platform: "linux" }),
    "/last"
  );
});
