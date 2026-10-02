const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function readSkill() {
  return fs.readFileSync(path.join(root, "skills", "create-agent", "SKILL.md"), "utf8");
}

function readArchitect() {
  return fs.readFileSync(
    path.join(root, "agents", "copilot-studio-architect.md"),
    "utf8"
  );
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
  assert.match(
    skill,
    /After every successful push, including an explicit `No local changes detected` result/i
  );
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
  assert.match(skill, /Require `kind` only when that component schema\s+defines it/i);
  assert.match(
    skill,
    /Uploaded-file knowledge sidecars and uploaded-skill payload sidecars[\s\S]*omit `kind`/i
  );
  assert.match(
    skill,
    /uploaded knowledge sidecar's on-disk stem unprefixed[\s\S]*`<slug>_<id>\.mcs\.yml`/i
  );
  assert.match(skill, /Leave `\.mcs\/`\s+and `agent\.sync\.yaml` untouched/i);
});

test("architect applies component fields and filenames by authoritative schema", () => {
  const architect = readArchitect();

  assert.doesNotMatch(architect, /\.mcs\\/);
  assert.match(
    architect,
    /Every authored component `\*\.mcs\.yml` except the root `settings\.mcs\.yml`[\s\S]*contain `mcs\.metadata`/i
  );
  assert.match(architect, /settings file follows the MCS2 settings schema[\s\S]*do not add component metadata/i);
  assert.match(
    architect,
    /uploaded-file knowledge sidecars and uploaded-skill payload[\s\S]*omit `kind`/i
  );
  assert.match(
    architect,
    /Knowledge and skill components instead follow the exact[\s\S]*authoritative references/i
  );
});

test("explicit publication intent routes through publish-agent after success", () => {
  const skill = readSkill();

  assert.match(skill, /^allowed-tools:.*\bSkill\b/m);
  assert.match(skill, /^allowed-tools:.*Bash\(pac auth \*\)/m);
  assert.match(skill, /^allowed-tools:.*Bash\(pac copilot init \*\)/m);
  assert.match(skill, /^allowed-tools:.*Bash\(pac copilot pull \*\)/m);
  assert.match(skill, /^allowed-tools:.*Bash\(pac copilot push \*\)/m);
  assert.doesNotMatch(skill, /^allowed-tools:.*Bash\(pac \*\)/m);
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
