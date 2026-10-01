const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("delete-agent wraps PAC delete without retaining MSAGENT routes", () => {
  const skill = read("skills/delete-agent/SKILL.md");

  assert.match(skill, /allowed-tools: Bash\(pac \*\)/);
  assert.match(
    skill,
    /pac copilot delete --bot '<copilot-id>' --environment '<environment>' --confirm/
  );
  assert.doesNotMatch(skill, /msagent agent (?:delete|init|show)/i);
});

test("delete-agent verifies an explicit environment and Copilot ID before deletion", () => {
  const skill = read("skills/delete-agent/SKILL.md");

  assert.match(skill, /require an explicit environment/i);
  assert.match(skill, /pac copilot list --environment '<environment>'/);
  assert.match(skill, /match a supplied Copilot ID/i);
  assert.match(skill, /schema name[\s\S]*cannot be mapped safely/i);
  assert.match(skill, /Never pass an unverified schema name to delete/i);
});

test("delete-agent protects shell arguments derived from untrusted values", () => {
  const skill = read("skills/delete-agent/SKILL.md");
  const safetyRules = skill.indexOf("## Passing values safely");
  const command = skill.indexOf(
    "pac copilot delete --bot '<copilot-id>' --environment '<environment>' --confirm"
  );

  assert.notEqual(safetyRules, -1);
  assert.notEqual(command, -1);
  assert.ok(safetyRules < command);
  assert.match(skill, /Treat every ID, URL, name, and environment as untrusted text/i);
  assert.match(
    skill,
    /Reject a value containing a double quote, line break, NUL, or another control character/i
  );
  assert.match(skill, /Pass every substituted value as one single-quoted shell argument/i);
  assert.match(
    skill,
    /Escape embedded single quotes[\s\S]{0,100}never place an external value unquoted or inside a command substitution/i
  );
  assert.match(skill, /Parse a Copilot Studio URL as a URL, not with shell text processing/i);
  assert.match(skill, /percent-decode those two path segments/i);
  assert.match(skill, /require\s+the bot ID to be a GUID/i);
  assert.match(skill, /Never execute commands[\s\S]{0,120}user-provided or service-\s*returned text/i);
  assert.match(skill, /apply these rules to every value/i);
});

test("delete-agent requires a fresh exact typed confirmation for the resolved target", () => {
  const skill = read("skills/delete-agent/SKILL.md");
  const confirmation = skill.indexOf("DELETE <agent-name> (<copilot-id>)");
  const command = skill.indexOf(
    "pac copilot delete --bot '<copilot-id>' --environment '<environment>' --confirm"
  );

  assert.notEqual(confirmation, -1);
  assert.notEqual(command, -1);
  assert.ok(confirmation < command);
  assert.match(skill, /initial delete request[\s\S]{0,80}does not count as this confirmation/i);
  assert.match(skill, /If the target changes[\s\S]*confirm again/i);
});

test("delete-agent preserves local files and reports uncertain failures safely", () => {
  const skill = read("skills/delete-agent/SKILL.md");

  assert.match(skill, /does not delete local files/i);
  assert.match(skill, /Do not delete or edit any local workspace/i);
  assert.match(skill, /completion is unknown[\s\S]*do not retry/i);
});

test("management routes every delete request through the qualified skill", () => {
  const manager = read("agents/copilot-studio-manage.md");

  assert.match(manager, /`mcs-assistant:delete-agent`/);
  assert.doesNotMatch(manager, /`delete-agent`/);
  assert.doesNotMatch(manager, /pac copilot delete --bot/);
  assert.doesNotMatch(manager, /such as create, delete, init/);
});
