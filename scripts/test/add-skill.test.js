const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const { SCHEMA_NAME_MAX, importSkill, yamlScalar } = require("../add-skill");

// Build a throwaway cloned-agent workspace plus a source skill folder, so each
// test exercises the real importSkill path end to end.
function makeFixture({ schemaName, payload = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "add-skill-test-"));
  const workspace = path.join(root, "agent");
  const src = path.join(root, "skill-src");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(workspace, "agent.sync.yaml"), "kind: CLICopilotRecognizer\n");
  fs.writeFileSync(path.join(workspace, "settings.mcs.yml"), `schemaName: ${schemaName}\nkind: CLICopilotRecognizer\n`);
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
