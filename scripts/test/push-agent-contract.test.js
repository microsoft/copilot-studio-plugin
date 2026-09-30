const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("workspace discovery only offers connected PAC workspaces", () => {
  const skill = read("skills/push-agent/SKILL.md");

  assert.match(
    skill,
    /directories containing `\.mcs\/conn\.json` and\s+either `settings\.mcs\.yml` or `agent\.mcs\.yml`/i
  );
  assert.doesNotMatch(
    skill,
    /directories containing `\.mcs\/conn\.json`,\s+`settings\.mcs\.yml`, or `agent\.mcs\.yml`/i
  );
});

test("migration invokes push-agent directly with Skill permission", () => {
  const migration = read("commands/migrate.md");
  const pushStart = migration.indexOf("### 8. Push the migrated agent");
  const outputStart = migration.indexOf("## Output Guidance", pushStart);
  const pushSection = migration.slice(pushStart, outputStart);

  assert.match(migration, /allowed-tools:.*\bSkill\b/);
  assert.match(pushSection, /mcs-assistant:push-agent/);
  assert.doesNotMatch(pushSection, /Copilot Studio Manage/);
});

test("management uses the qualified push-agent identifier on every route", () => {
  const manager = read("agents/copilot-studio-manage.md");

  assert.match(manager, /`mcs-assistant:push-agent`/);
  assert.doesNotMatch(manager, /`push-agent`/);
});
