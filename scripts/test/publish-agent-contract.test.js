const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("draft readiness is bound to the exact publish target", () => {
  const skill = read("skills/publish-agent/SKILL.md");
  const manager = read("agents/copilot-studio-manage.md");

  assert.match(skill, /exact agent and environment/i);
  assert.match(skill, /generic statement that\s+"push succeeded,"[\s\S]*insufficient/i);
  assert.match(manager, /exact workspace, agent, and environment/i);
});

test("chat recovery delegates publishing through the publish-agent skill", () => {
  const command = read("commands/chat.md");
  const source = read("scripts/src/chat-with-agent.js");

  assert.match(command, /allowed-tools:.*\bSkill\b/);
  assert.match(command, /allowed-tools:.*Bash\(pac \*\)/);
  assert.match(command, /mcs-assistant:publish-agent/);
  assert.doesNotMatch(command, /pac copilot publish --bot-id/);
  assert.doesNotMatch(source, /pac copilot publish --bot-id/);
  assert.match(source, /agentId:\s+publishTarget\.agentId/);
  assert.match(source, /environmentId:\s+publishTarget\.environmentId/);
});

test("custom chat endpoints do not reuse configured publish recovery identifiers", () => {
  const command = read("commands/chat.md");
  const source = read("scripts/src/chat-with-agent.js");

  assert.match(source, /const publishTarget = args\.directConnectUrl\s*\?\s*null/);
  assert.match(source, /if \(!publishTarget\)/);
  assert.match(source, /agentId:\s+publishTarget\.agentId/);
  assert.match(source, /environmentId:\s+publishTarget\.environmentId/);
  assert.match(command, /custom direct-connect URL[\s\S]*explicit publish target/i);
});

test("generated chat bundle matches safe publish guidance", () => {
  const bundle = read("scripts/chat-with-agent.bundle.js");

  assert.doesNotMatch(bundle, /pac copilot publish --bot-id/);
  assert.match(bundle, /mcs-assistant:publish-agent/);
  assert.match(bundle, /publishTarget/);
});
