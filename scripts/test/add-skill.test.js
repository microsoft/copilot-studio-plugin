const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { after } = require("node:test");
const yaml = require("js-yaml");

const {
  SCHEMA_NAME_MAX,
  downloadSkill,
  importSkill,
  listSkills,
  readAgentSchemaPrefix,
  renderPrettyList,
  yamlScalar,
} = require("../add-skill");

// Every fixture root created during the run, removed once the file is done so a
// test pass does not leave a trail of mkdtemp directories behind in the OS temp dir.
const fixtureRoots = [];
after(() => {
  for (const root of fixtureRoots) fs.rmSync(root, { recursive: true, force: true });
});

// Build a throwaway cloned-agent workspace plus a source skill folder, so each
// test exercises the real importSkill path end to end.
function makeFixture({ schemaName, settingsLine, payload = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "add-skill-test-"));
  fixtureRoots.push(root);
  const workspace = path.join(root, "agent");
  const src = path.join(root, "skill-src");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(workspace, "agent.sync.yaml"), "kind: CLICopilotRecognizer\n");
  fs.writeFileSync(
    path.join(workspace, "settings.mcs.yml"),
    `${settingsLine || `schemaName: ${schemaName}`}\nkind: CLICopilotRecognizer\n`
  );
  fs.writeFileSync(
    path.join(src, "SKILL.md"),
    "---\nname: demo\ndescription: A demo skill.\n---\nBody.\n"
  );
  for (const [rel, content] of Object.entries(payload)) {
    const abs = path.join(src, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return { root, workspace, src };
}

function readAnchor(workspace, folder) {
  return yaml.load(
    fs.readFileSync(path.join(workspace, "behaviors", folder, "skill.mcs.yml"), "utf8")
  );
}

test("quotes plain scalars that a YAML 1.1 parser would read as booleans", () => {
  assert.equal(yamlScalar("on"), '"on"');
  assert.equal(yamlScalar("no"), '"no"');
  assert.equal(yamlScalar("TRUE"), '"TRUE"');
});

test("quotes plain scalars that would be read as numbers or null", () => {
  assert.equal(yamlScalar("123"), '"123"');
  assert.equal(yamlScalar("1.0"), '"1.0"');
  assert.equal(yamlScalar("null"), '"null"');
  assert.equal(yamlScalar("~"), '"~"');
});

test("quotes YAML timestamps so component metadata remains string-valued", () => {
  for (const timestamp of ["2026-09-17", "2026-09-17T12:00:00Z"]) {
    const emitted = yamlScalar(timestamp);
    assert.equal(emitted, `"${timestamp}"`);
    assert.equal(yaml.load(`value: ${emitted}\n`).value, timestamp);
  }
});

test("leaves an unambiguous scalar unquoted", () => {
  assert.equal(yamlScalar("make-restaurant-reservation"), "make-restaurant-reservation");
});

test("keeps a numeric skill folder name a string in the anchor componentName", () => {
  const { workspace, src } = makeFixture({ schemaName: "crbab_demo_dcF_b3" });
  const result = importSkill({ src, workspace, name: "123" });
  const anchor = readAnchor(workspace, result.folder);
  assert.equal(anchor["mcs.metadata"].componentName, "123");
});

test("keeps a payload path containing a YAML comment marker intact in its sidecar", () => {
  const { workspace, src } = makeFixture({
    schemaName: "crbab_demo_dcF_b3",
    payload: { "scripts/run #1.py": "print('hi')\n" },
  });
  const result = importSkill({ src, workspace, name: "demo" });
  const sidecar = yaml.load(
    fs.readFileSync(path.join(workspace, "behaviors", result.folder, "scripts", "run #1.py.mcs.yml"), "utf8")
  );
  assert.equal(sidecar["mcs.metadata"].componentName, "./scripts/run #1.py");
});

test("keeps the anchor schemaName within the Dataverse budget for a long agent prefix", () => {
  const schemaName = "crbab_averylongagentschemaname_abcdefghij";
  const { workspace, src } = makeFixture({ schemaName });
  const result = importSkill({ src, workspace, name: "a".repeat(60) });
  const anchor = readAnchor(workspace, result.folder);
  assert.ok(
    anchor["mcs.metadata"].schemaName.length <= SCHEMA_NAME_MAX,
    `schemaName was ${anchor["mcs.metadata"].schemaName.length} chars: ${anchor["mcs.metadata"].schemaName}`
  );
});

test("keeps a file sidecar schemaName within the Dataverse budget for a long filename", () => {
  const schemaName = "crbab_averylongagentschemaname_abcdefghij";
  const { workspace, src } = makeFixture({
    schemaName,
    payload: { [`${"b".repeat(70)}.py`]: "print('hi')\n" },
  });
  const result = importSkill({ src, workspace, name: "demo" });
  const sidecar = yaml.load(
    fs.readFileSync(
      path.join(workspace, "behaviors", result.folder, `${"b".repeat(70)}.py.mcs.yml`),
      "utf8"
    )
  );
  assert.ok(
    sidecar["mcs.metadata"].schemaName.length <= SCHEMA_NAME_MAX,
    `schemaName was ${sidecar["mcs.metadata"].schemaName.length} chars`
  );
});

test("warns when a schema segment had to be truncated to fit the budget", () => {
  const schemaName = "crbab_averylongagentschemaname_abcdefghij";
  const { workspace, src } = makeFixture({ schemaName });
  const result = importSkill({ src, workspace, name: "c".repeat(60) });
  assert.ok(
    result.warnings.some((w) => /truncat/i.test(w)),
    `expected a truncation warning, got: ${JSON.stringify(result.warnings)}`
  );
});

test("reports a clear error when the agent schema name leaves no component-name space", () => {
  const schemaName = `crbab_${"z".repeat(89)}`;
  const { workspace, src } = makeFixture({ schemaName });
  assert.throws(
    () => importSkill({ src, workspace, name: "demo" }),
    /leaves no valid component-name space/i
  );
});

// --- Agent schema prefix parsing -------------------------------------------

test("reads a double-quoted agent schemaName without the quotes", () => {
  const { workspace } = makeFixture({ settingsLine: 'schemaName: "crbab_demo_dcF_b3"' });
  assert.equal(readAgentSchemaPrefix(workspace), "crbab_demo_dcF_b3");
});

test("reads a single-quoted agent schemaName without the quotes", () => {
  const { workspace } = makeFixture({ settingsLine: "schemaName: 'crbab_demo_dcF_b3'" });
  assert.equal(readAgentSchemaPrefix(workspace), "crbab_demo_dcF_b3");
});

test("ignores a trailing inline comment on the agent schemaName", () => {
  const { workspace } = makeFixture({ settingsLine: "schemaName: crbab_demo_dcF_b3 # the prefix" });
  assert.equal(readAgentSchemaPrefix(workspace), "crbab_demo_dcF_b3");
});

test("rejects an agent schemaName that is not a usable Dataverse prefix", () => {
  const { workspace } = makeFixture({ settingsLine: "schemaName: not a prefix!" });
  assert.equal(readAgentSchemaPrefix(workspace), null);
});

test("emits a valid anchor schemaName when settings quotes the agent schemaName", () => {
  const { workspace, src } = makeFixture({ settingsLine: 'schemaName: "crbab_demo_dcF_b3"' });
  const result = importSkill({ src, workspace, name: "demo" });
  const anchor = readAnchor(workspace, result.folder);
  assert.match(anchor["mcs.metadata"].schemaName, /^crbab_demo_dcF_b3\.skill\.demo_[A-Za-z0-9]{3}$/);
});

test("still writes companions when settings comments the agent schemaName", () => {
  const { workspace, src } = makeFixture({ settingsLine: "schemaName: crbab_demo_dcF_b3 # prefix" });
  const result = importSkill({ src, workspace, name: "demo" });
  assert.equal(result.schemaPrefix, "crbab_demo_dcF_b3");
  assert.ok(result.companions.length > 0, "expected .mcs.yml companions to be written");
});

test("explains the accepted syntax when a multiline schemaName falls back to a bare skill", () => {
  const { workspace, src } = makeFixture({
    settingsLine: "schemaName: >-\n  crbab_demo_dcF_b3",
  });
  const result = importSkill({ src, workspace, name: "demo" });
  assert.equal(result.schemaPrefix, null);
  assert.ok(
    result.warnings.some((w) => /single-line.*schemaName.*plain or quoted/i.test(w)),
    `expected a syntax-specific warning, got: ${JSON.stringify(result.warnings)}`
  );
});

// --- Schema name shape ------------------------------------------------------

test("keeps a dotted skill name from adding extra schema-name segments", () => {
  const { workspace, src } = makeFixture({ schemaName: "crbab_demo_dcF_b3" });
  const result = importSkill({ src, workspace, name: "foo.bar" });
  const anchor = readAnchor(workspace, result.folder);
  assert.equal(
    anchor["mcs.metadata"].schemaName.split(".").length,
    3,
    `schemaName had extra segments: ${anchor["mcs.metadata"].schemaName}`
  );
});

test("strips non-alphanumerics from the anchor schema segment like the extension does", () => {
  const { workspace, src } = makeFixture({ schemaName: "crbab_demo_dcF_b3" });
  const result = importSkill({ src, workspace, name: "my-cool.skill" });
  const anchor = readAnchor(workspace, result.folder);
  assert.match(anchor["mcs.metadata"].schemaName, /^crbab_demo_dcF_b3\.skill\.mycoolskill_[A-Za-z0-9]{3}$/);
});

test("prefixes Windows reserved device stems even when an extension follows", () => {
  const { workspace, src } = makeFixture({ schemaName: "crbab_demo_dcF_b3" });
  const result = importSkill({ src, workspace, name: "CON.txt" });
  assert.equal(result.folder, "skill-CON.txt");
  assert.ok(fs.existsSync(path.join(workspace, "behaviors", "skill-CON.txt", "SKILL.md")));
});

// --- Payload fidelity -------------------------------------------------------

test("copies a nested .zip payload file verbatim", () => {
  const { workspace, src } = makeFixture({
    schemaName: "crbab_demo_dcF_b3",
    payload: { "assets/templates.zip": "PK\u0003\u0004stub" },
  });
  const result = importSkill({ src, workspace, name: "demo" });
  assert.ok(
    fs.existsSync(path.join(workspace, "behaviors", result.folder, "assets", "templates.zip")),
    `assets/templates.zip was dropped; got ${JSON.stringify(result.files)}`
  );
});

test("skips a root bundle zip that collides with the minted bundle name, and says so", () => {
  const { workspace, src } = makeFixture({
    schemaName: "crbab_demo_dcF_b3",
    payload: { "demo.zip": "PK\u0003\u0004stub" },
  });
  const result = importSkill({ src, workspace, name: "demo" });
  assert.ok(!fs.existsSync(path.join(workspace, "behaviors", result.folder, "demo.zip")));
  assert.ok(
    result.warnings.some((w) => /demo\.zip/.test(w)),
    `expected a warning naming the skipped zip, got: ${JSON.stringify(result.warnings)}`
  );
});

test("excludes a mixed-case sidecar file the same way as its lowercase spelling", () => {
  const { workspace, src } = makeFixture({
    schemaName: "crbab_demo_dcF_b3",
    payload: { "Metadata.json": "{}\n", "README.MD": "# readme\n" },
  });
  const result = importSkill({ src, workspace, name: "demo" });
  const dir = path.join(workspace, "behaviors", result.folder);
  assert.ok(!fs.existsSync(path.join(dir, "Metadata.json")), "Metadata.json should be excluded");
  assert.ok(!fs.existsSync(path.join(dir, "README.MD")), "README.MD should be excluded");
});

test("uses a non-empty schema segment for payload names without alphanumerics", () => {
  const { workspace, src } = makeFixture({
    schemaName: "crbab_demo_dcF_b3",
    payload: { "#": "payload\n" },
  });
  const result = importSkill({ src, workspace, name: "demo" });
  const sidecar = yaml.load(
    fs.readFileSync(
      path.join(workspace, "behaviors", result.folder, "#.mcs.yml"),
      "utf8"
    )
  );
  assert.match(
    sidecar["mcs.metadata"].schemaName,
    /^crbab_demo_dcF_b3\.file\.file_[A-Za-z0-9]{5}$/
  );
});

// --- Pretty listing ---------------------------------------------------------

test("never truncates a slug in the pretty table", () => {
  const slug = "a-really-long-gallery-submission-slug-that-exceeds-the-old-cap";
  const out = renderPrettyList([{ slug, name: "Long", description: "d", hasBundle: false }]);
  assert.ok(out.includes(slug), `slug was truncated:\n${out}`);
});

test("drops the Copilot Studio qualifier from the heading when listing every platform", () => {
  const skills = [{ slug: "s", name: "S", description: "d", hasBundle: false }];
  assert.match(renderPrettyList(skills, { all: true }), /1 skills\b/);
  assert.ok(!renderPrettyList(skills, { all: true }).includes("for Copilot Studio"));
  assert.ok(renderPrettyList(skills).includes("for Copilot Studio"));
});

// --- Gallery fetch behaviour ------------------------------------------------

// Serve the gallery from an in-memory tree so download/list run without network.
function stubGallery(t, { files, bundles = {}, status = {}, requests = [] }) {
  const real = global.fetch;
  t.after(() => { global.fetch = real; });
  global.fetch = async (url) => {
    const u = String(url);
    requests.push(u);
    const fail = Object.keys(status).find((k) => u.includes(k));
    if (fail) {
      const code = status[fail];
      return { ok: false, status: code, statusText: `status ${code}`, text: async () => "" };
    }
    if (u.includes("/git/trees/")) {
      const body = JSON.stringify({
        truncated: false,
        tree: Object.keys(files).map((p) => ({ type: "blob", path: p })),
      });
      return { ok: true, status: 200, statusText: "OK", text: async () => body };
    }
    const parsed = new URL(u);
    const rawMatch = parsed.pathname.match(/\/main\/(submissions\/.+)$/);
    const rawPath = rawMatch ? decodeURIComponent(rawMatch[1]) : null;
    if (rawPath && files[rawPath] !== undefined) {
      const body = files[rawPath];
      return {
        ok: true, status: 200, statusText: "OK",
        text: async () => body,
        arrayBuffer: async () => Buffer.from(body),
      };
    }
    const bundleMatch = parsed.pathname.match(/\/bundles\/(.+\.zip)$/);
    const bundleName = bundleMatch ? decodeURIComponent(bundleMatch[1]) : null;
    if (bundleName && bundles[bundleName] !== undefined) {
      const body = bundles[bundleName];
      return {
        ok: true, status: 200, statusText: "OK",
        text: async () => body,
        arrayBuffer: async () => Buffer.from(body),
      };
    }
    return { ok: false, status: 404, statusText: "Not Found", text: async () => "" };
  };
}

test("surfaces a non-404 metadata failure instead of silently dropping the skill", async (t) => {
  stubGallery(t, {
    files: {
      "submissions/demo/SKILL.md": "---\nname: demo\n---\n",
      "submissions/demo/metadata.json": JSON.stringify({ name: "Demo", platforms: ["Copilot Studio"] }),
    },
    status: { "submissions/demo/metadata.json": 500 },
  });
  await assert.rejects(() => listSkills({ all: true }), /500/);
});

test("surfaces malformed metadata instead of silently dropping the skill", async (t) => {
  stubGallery(t, {
    files: {
      "submissions/demo/SKILL.md": "---\nname: demo\n---\n",
      "submissions/demo/metadata.json": "{ not valid JSON",
    },
  });
  await assert.rejects(
    () => listSkills({ all: true }),
    /invalid metadata\.json.*demo/i
  );
});

test("URL-encodes gallery slugs and each payload path segment", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "add-skill-test-"));
  fixtureRoots.push(root);
  const slug = "demo #1";
  const requests = [];
  stubGallery(t, {
    files: {
      [`submissions/${slug}/SKILL.md`]: "---\nname: demo\n---\n",
      [`submissions/${slug}/metadata.json`]: JSON.stringify({
        name: "Demo",
        platforms: ["Copilot Studio"],
      }),
      [`submissions/${slug}/scripts/run #1.py`]: "print('ok')\n",
    },
    bundles: { [`${slug}.zip`]: "PK\u0003\u0004stub" },
    requests,
  });

  const result = await downloadSkill(slug, root);

  assert.equal(
    fs.readFileSync(path.join(result.dir, "scripts", "run #1.py"), "utf8"),
    "print('ok')\n"
  );
  assert.ok(
    requests.some((u) => u.includes("/submissions/demo%20%231/metadata.json")),
    `metadata slug was not encoded: ${JSON.stringify(requests)}`
  );
  assert.ok(
    requests.some((u) => u.includes("/submissions/demo%20%231/scripts/run%20%231.py")),
    `payload path was not encoded: ${JSON.stringify(requests)}`
  );
  assert.ok(
    requests.some((u) => u.includes("/bundles/demo%20%231.zip")),
    `bundle slug was not encoded: ${JSON.stringify(requests)}`
  );
});

test("removes files left over from a previous download of the same slug", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "add-skill-test-"));
  fixtureRoots.push(root);
  const files = {
    "submissions/demo/SKILL.md": "---\nname: demo\n---\n",
    "submissions/demo/metadata.json": JSON.stringify({ name: "Demo", platforms: ["Copilot Studio"] }),
    "submissions/demo/scripts/old.py": "print('old')\n",
  };
  stubGallery(t, { files });
  await downloadSkill("demo", root);
  assert.ok(fs.existsSync(path.join(root, "demo", "scripts", "old.py")));

  delete files["submissions/demo/scripts/old.py"];
  await downloadSkill("demo", root);
  assert.ok(
    !fs.existsSync(path.join(root, "demo", "scripts", "old.py")),
    "stale scripts/old.py survived a re-download"
  );
});

test("removes a stale sibling bundle when a refreshed bundle is unavailable", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "add-skill-test-"));
  fixtureRoots.push(root);
  const files = {
    "submissions/demo/SKILL.md": "---\nname: demo\n---\n",
    "submissions/demo/metadata.json": JSON.stringify({
      name: "Demo",
      platforms: ["Copilot Studio"],
    }),
    "submissions/demo/scripts/run.py": "print('ok')\n",
  };
  const bundles = { "demo.zip": "PK\u0003\u0004old" };
  stubGallery(t, { files, bundles });

  const first = await downloadSkill("demo", root);
  assert.ok(first.zip);
  assert.ok(fs.existsSync(path.join(root, "demo.zip")));

  delete bundles["demo.zip"];
  const second = await downloadSkill("demo", root);

  assert.equal(second.zip, null);
  assert.ok(!fs.existsSync(path.join(root, "demo.zip")), "stale demo.zip survived refresh");
});

test("surfaces non-404 bundle failures instead of reporting a partial success", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "add-skill-test-"));
  fixtureRoots.push(root);
  stubGallery(t, {
    files: {
      "submissions/demo/SKILL.md": "---\nname: demo\n---\n",
      "submissions/demo/metadata.json": JSON.stringify({
        name: "Demo",
        platforms: ["Copilot Studio"],
      }),
      "submissions/demo/scripts/run.py": "print('ok')\n",
    },
    status: { "/bundles/demo.zip": 503 },
  });

  await assert.rejects(() => downloadSkill("demo", root), /503/);
});

test("keeps the previous download intact when a refresh fails", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "add-skill-test-"));
  fixtureRoots.push(root);
  fs.mkdirSync(path.join(root, "demo"), { recursive: true });
  fs.writeFileSync(path.join(root, "demo", "SKILL.md"), "previous manifest\n");
  fs.writeFileSync(path.join(root, "demo.zip"), "previous bundle");
  stubGallery(t, {
    files: {
      "submissions/demo/SKILL.md": "---\nname: new demo\n---\n",
      "submissions/demo/metadata.json": JSON.stringify({
        name: "New Demo",
        platforms: ["Copilot Studio"],
      }),
      "submissions/demo/scripts/run.py": "print('new')\n",
    },
    status: { "/bundles/demo.zip": 503 },
  });

  await assert.rejects(() => downloadSkill("demo", root), /503/);

  assert.equal(
    fs.readFileSync(path.join(root, "demo", "SKILL.md"), "utf8"),
    "previous manifest\n"
  );
  assert.equal(fs.readFileSync(path.join(root, "demo.zip"), "utf8"), "previous bundle");
  assert.ok(!fs.existsSync(path.join(root, "demo", "scripts", "run.py")));
});

test("treats a missing optional bundle as a successful unpacked download", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "add-skill-test-"));
  fixtureRoots.push(root);
  stubGallery(t, {
    files: {
      "submissions/demo/SKILL.md": "---\nname: demo\n---\n",
      "submissions/demo/metadata.json": JSON.stringify({
        name: "Demo",
        platforms: ["Copilot Studio"],
      }),
      "submissions/demo/scripts/run.py": "print('ok')\n",
    },
  });

  const result = await downloadSkill("demo", root);

  assert.equal(result.zip, null);
  assert.ok(fs.existsSync(path.join(result.dir, "scripts", "run.py")));
});
