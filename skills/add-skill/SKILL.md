---
user-invocable: true
description: Scaffold a brand-new plugin skill (a skills/<name>/SKILL.md, plus an optional README.md) following this plugin's skill conventions. Use when the user wants to add, author, or scaffold a new skill for the mcs-assistant plugin.
argument-hint: <new-skill-name> [one-line purpose]
allowed-tools: Read, Write, Glob, Grep
context: fork
---

# Add Skill

Scaffold a new **plugin skill** for this repository: a `skills/<name>/SKILL.md` file (plus an optional
`README.md` sidecar) that follows the conventions used by the existing skills in this plugin. This is a
net-new authoring capability - there is no `pac` operation involved; it only writes local files.

## Phase 0: Resolve the skill identity

1. Determine the **slug**: lowercase, hyphenated (e.g. `add-topic`, `run-eval`). Derive it from the requested
   name; confirm with the user if ambiguous.
2. Check for collisions - the slug must not already exist:
   ```
   Glob: skills/*/SKILL.md
   ```
   Also check `commands/*.md` and `agents/*.md` for a same-named command or agent, to avoid a confusing
   duplicate surface. If a collision exists, stop and ask the user for a different name or confirm they intend
   to overwrite.

## Phase 1: Decide the skill shape

Ask (or infer from the request) two things:

1. **Self-contained vs delegating.** If the skill's work is already owned by an existing agent
   (`copilot-studio-manage`, `copilot-studio-init`, `copilot-studio-describer`, `copilot-studio-architect`),
   prefer a thin skill that delegates via the `agent:` frontmatter field rather than duplicating that agent's
   logic. Otherwise author a self-contained skill.
2. **Tools needed.** List the minimal `allowed-tools` the skill actually needs (e.g. specific `Bash(pac ...)`
   command patterns, `Read`, `Write`, `Glob`, `Grep`). Keep it least-privilege - do not grant broad `Bash(*)`.

## Phase 2: Author `skills/<slug>/SKILL.md`

Write the file with this frontmatter (omit `agent:` for a self-contained skill):

```markdown
---
user-invocable: true
description: <one precise, trigger-focused sentence: WHEN the agent should use this skill>
argument-hint: <expected arguments, in [brackets] if optional>
allowed-tools: <least-privilege comma-separated list>
context: fork
agent: <existing-agent-name>   # only when delegating; otherwise remove this line
---

# <Title Case Name>

<One or two lines: what this skill does.>

## Instructions
1. <Concrete, numbered, imperative steps addressed to the agent.>
2. ...

## Guardrails
- <What the skill must not do; confirmation gates for any destructive action.>
```

Authoring rules (the quality bar for this plugin's skills):

- **`SKILL.md` is agent-facing only.** Write imperative instructions to the agent. Do not put human onboarding,
  "why use this", setup prose, or marketing in `SKILL.md` - that belongs in the optional `README.md`.
- The frontmatter **`description`** is the trigger the model reads to decide *when* to invoke - make it a
  precise "Use this skill when..." sentence. Do not restate *when to use* inside the body.
- Auto-discover agent workspaces with `Glob: **/agent.mcs.yml`; **never hardcode** an agent name or path.
- Any **destructive or irreversible** action must have an explicit user-confirmation gate before it runs.
- Prefer delegating to an existing agent over duplicating its logic.

## Phase 3: Optional `README.md`

If the skill has genuine human-facing content (setup steps, prerequisites, examples, adoption notes), add a
`skills/<slug>/README.md` sidecar for it - keep that content out of `SKILL.md`. If there is no human-facing
content, do not create an empty README.

## Phase 4: Validate and report

- Confirm the folder name, the frontmatter `name`-equivalent title, and the slug all agree.
- Confirm the YAML frontmatter is well-formed (delimited by `---`, valid keys) and `allowed-tools` is
  least-privilege.
- Tell the user the new skill path, whether it delegates or is self-contained, and that it will be discovered
  from the `skills/` folder the next time the plugin is loaded (reload the session to pick it up).

## Guardrails

- Do not modify unrelated skills, agents, or commands.
- Do not grant broader tool permissions than the new skill needs.
- Do not author a skill that performs a destructive action without a confirmation gate.
