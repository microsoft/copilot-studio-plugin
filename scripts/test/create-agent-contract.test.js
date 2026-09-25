const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function readSkill() {
  return fs.readFileSync(path.join(root, "skills", "create-agent", "SKILL.md"), "utf8");
}

test("create follows the PAC initialize, pull, push, and final-pull lifecycle", () => {
  const skill = readSkill();
  const init = skill.indexOf("pac copilot init --name");
  const initialPull = skill.indexOf("pac copilot pull --project-dir", init);
  const push = skill.indexOf("pac copilot push --project-dir", initialPull);
  const finalPull = skill.indexOf("pac copilot pull --project-dir", push);

  assert.notEqual(init, -1);
  assert.notEqual(initialPull, -1);
  assert.notEqual(push, -1);
  assert.notEqual(finalPull, -1);
  assert.ok(init < initialPull);
  assert.ok(initialPull < push);
  assert.ok(push < finalPull);
});

test("create enforces Preview-safe fields and PAC-specific identifiers", () => {
  const skill = readSkill();

  assert.match(skill, /Display name[\s\S]*1-30 characters/i);
  assert.match(skill, /Instructions[\s\S]*8,000 characters/i);
  assert.match(skill, /Normalize an exact `Default-<GUID>` value to the bare GUID/i);
  assert.match(skill, /Publisher prefix[\s\S]*\^\[A-Za-z\]/);
  assert.match(skill, /Derived schema name[\s\S]*length\(prefix\)[\s\S]*<= 100/i);
});

test("create validates the MCS2 authoring shape without editing CLI metadata", () => {
  const skill = readSkill();

  assert.match(skill, /root `template` beginning with `cliagent-`/i);
  assert.match(skill, /`configuration\.authoringModel: CliCopilot`/);
  assert.match(skill, /`CLIAgentRecognizer` or `CLICopilotRecognizer`/);
  assert.match(skill, /Never create default topics/i);
  assert.match(skill, /Every authored `\*\.mcs\.yml` except[\s\S]*`mcs\.metadata` and `kind`/i);
  assert.match(skill, /Leave `\.mcs\/`\s+and `agent\.sync\.yaml` untouched/i);
});

test("explicit publication intent routes through publish-agent after success", () => {
  const skill = readSkill();

  assert.match(skill, /^allowed-tools:.*\bSkill\b/m);
  assert.match(skill, /Record whether the initial request explicitly asks to publish/i);
  assert.match(skill, /Do not infer publication intent[\s\S]*create[\s\S]*deploy[\s\S]*test/i);
  assert.match(skill, /invoke `mcs-assistant:publish-agent`/);
  assert.match(
    skill,
    /exact workspace, agent ID or schema name, environment,\s+push result, and final-pull result/i
  );
  assert.match(skill, /initial create-and-publish wording is intent, not that final confirmation/i);
  assert.match(skill, /failed or completed only partially, do not\s+invoke the publish skill/i);
  assert.doesNotMatch(skill, /```bash\s+pac copilot publish/i);
});
