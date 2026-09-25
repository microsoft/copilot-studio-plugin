const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const repositoryRoot = path.resolve(__dirname, "..", "..");

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function readSkill(name) {
  return readRepositoryFile(path.join("skills", name, "SKILL.md"));
}

test("new msagent skills expose valid discoverable frontmatter", () => {
  for (const name of [
    "agent-auth",
    "clone-agent",
    "list-agents",
    "pull-agent",
    "push-agent",
    "publish-agent",
  ]) {
    const skill = readSkill(name);
    const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);

    assert.ok(frontmatter, `${name} must have YAML frontmatter`);
    const metadata = yaml.load(frontmatter[1]);
    assert.equal(metadata.name, name);
    assert.match(metadata.description, /Use when /);
    assert.equal(metadata["allowed-tools"], "Bash(msagent *), Read, Glob, Grep");
  }
});

test("account switching supplies the account required by msagent", () => {
  const skill = readSkill("agent-auth");

  assert.match(
    skill,
    /msagent auth switch --account '<account>' --json --non-interactive/
  );
});

test("non-login discovery commands are non-interactive", () => {
  for (const name of [
    "agent-auth",
    "clone-agent",
    "list-agents",
    "pull-agent",
    "push-agent",
    "publish-agent",
  ]) {
    const commandLines = readSkill(name)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) =>
        /^msagent (?:auth status|env (?:list|select)|agent (?:list|show))\b/.test(line)
      );

    for (const command of commandLines) {
      assert.match(
        command,
        /--non-interactive/,
        `${name} command must not open authentication UI: ${command}`
      );
    }
  }
});

test("state-changing skills revalidate identity after interactive login", () => {
  for (const name of ["clone-agent", "pull-agent", "push-agent", "publish-agent"]) {
    const skill = readSkill(name);
    assert.match(
      skill,
      /After (?:the user completes|login completes).*msagent auth status --json --non-interactive/s,
      `${name} must revalidate the account, tenant, and environment after login`
    );
    assert.match(
      skill,
      /re-confirm/i,
      `${name} must re-confirm changed targets after login`
    );
  }
});

test("mutating existing projects resolve and pass an exact agent id", () => {
  for (const name of ["pull-agent", "push-agent", "publish-agent"]) {
    const skill = readSkill(name);
    assert.match(
      skill,
      /If the initial request named an agent/,
      `${name} must verify an explicitly named agent`
    );
    assert.match(
      skill,
      /--agent-id '<agentId>'/,
      `${name} must pass the resolved agent id`
    );
  }
});

test("unregistered workspace registration verifies its cloud identity", () => {
  for (const name of ["pull-agent", "push-agent", "publish-agent"]) {
    const skill = readSkill(name);
    assert.match(skill, /\.mcs\\conn\.json/);
    assert.match(skill, /connected.*true/s);
    assert.match(skill, /mcsAgentId.*AgentId/s);
    assert.match(skill, /environmentId.*EnvironmentId/s);
  }
});

test("deployment commands include the owning agent selector", () => {
  const push = readSkill("push-agent");
  const publish = readSkill("publish-agent");

  assert.match(
    push,
    /msagent deployment create[\s\S]*--agent-id '<agentId>'[\s\S]*--deployment-name '<name>'/
  );
  assert.match(
    push,
    /msagent deployment update connection[\s\S]*--agent-id '<agentId>'[\s\S]*--deployment-name '<name>'/
  );
  assert.match(
    publish,
    /msagent deployment update connection[\s\S]*--agent-id '<agentId>'[\s\S]*--deployment-name '<name>'/
  );
});

test("publish confirmation states that local content is deployed before going live", () => {
  const skill = readSkill("publish-agent");

  assert.match(skill, /current local project content/i);
  assert.match(skill, /deploy(?:ed|s|ing)?[\s\S]*then[\s\S]*publish/i);
  assert.match(skill, /project path/i);
});

test("pull always confirms before potentially overwriting local files", () => {
  const skill = readSkill("pull-agent");

  assert.match(skill, /Always get explicit\s+confirmation/i);
  assert.doesNotMatch(skill, /If the folder has uncommitted local edits/);
});

test("clone resolves display names in the source environment and rejects ambiguity", () => {
  const skill = readSkill("clone-agent");

  assert.match(
    skill,
    /msagent agent list --environment-id '<srcEnv>' --json --non-interactive/
  );
  assert.match(skill, /If several agents have that display name/i);
});

test("README documents both CLI prerequisites and the tested msagent version", () => {
  const readme = readRepositoryFile("README.md");

  assert.match(readme, /Power Platform CLI \(`pac`\)/);
  assert.match(readme, /`msagent` CLI/);
  assert.match(readme, /0\.1\.49-beta or later/);
  assert.match(readme, /tested minimum/);
});

test("the migration-only manage agent contains no stale publish path", () => {
  const agent = readRepositoryFile("agents/copilot-studio-manage.md");

  assert.doesNotMatch(agent, /do not publish unless/i);
});
