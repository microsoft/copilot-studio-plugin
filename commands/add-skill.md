---
description: Add an Agent Skill to work with locally - either uploaded from your drive (a SKILL.md or .zip) or picked from the Power CAT "Cat Agent Skills" gallery, which is downloaded into a local folder. Does not yet import the skill into a Copilot Studio agent project.
argument-hint: Optional skill name/slug or a local path to a SKILL.md / .zip
allowed-tools: Bash(node *add-skill.js*), Read, Glob, Grep
---

# Add a Copilot Studio Agent Skill

You help the user obtain an **Agent Skill** to add to a Copilot Studio agent. A skill is either
**uploaded from the user's local drive** (a `SKILL.md` file or a `.zip` bundle) or **selected from
the Power CAT "Cat Agent Skills" gallery** (`https://microsoft.github.io/cat-agent-skills/`,
source `github.com/microsoft/cat-agent-skills`) and downloaded locally.

**Scope for now:** this command only *acquires* the skill (validates a local file, or downloads a
gallery skill into a local folder). **Importing** the skill into a Copilot Studio agent workspace
(materializing it under `behaviors/` and pushing with `pac copilot push`) is intentionally **out of
scope** and must not be attempted here. End by telling the user where the skill is and that import is
a later step.

Initial request: $ARGUMENTS

---

## 1. Locate the helper script (non-blocking)

Resolve `scripts/add-skill.js` inside this installed plugin. In order:

1. Read `path.join(os.homedir(), '.copilot-studio-cli', 'plugin-paths.json')` and use its
   `pluginRoot` -> `path.join(pluginRoot, 'scripts', 'add-skill.js')`.
2. If that file is unavailable, fall back to `${CLAUDE_PLUGIN_ROOT}/scripts/add-skill.js` when the env
   var is set.
3. Otherwise `Glob: **/scripts/add-skill.js` under the plugin directory.

Use this absolute path for every `node` invocation below.

## 2. Choose the source (blocking)

If the initial request already makes the source obvious, skip the question:

- A path ending in `.md` or `.zip`, or an existing file path -> **local upload** (step 3).
- A skill name/slug that is not a path -> treat as a **gallery** pick (step 4), matching it against
  the listed skills.

Otherwise ask the user to choose:

- **Upload from local drive** - they already have a `SKILL.md` or a `.zip`.
- **Select from the gallery** - browse the Cat Agent Skills catalog.

## 3. Local upload

1. Ask for the full path if it was not provided.
2. Validate it exists and is a single `SKILL.md` (Markdown) or a `.zip`. If it is neither, tell the
   user what is accepted and stop.
3. Confirm the resolved absolute path and that the file is ready. Do **not** import it (out of scope).

## 4. Select from the gallery

1. List the available skills:

   ```bash
   node "<scriptPath>" list
   ```

   By default this returns only skills whose `platforms` include **Copilot Studio**, already sorted
   by display name. (Add `--all` only if the user explicitly wants every platform.) The JSON is
   `{ ok, count, skills: [{ slug, name, description, platforms, tags, hasBundle }] }`.

2. Present the skills to the user as a **numbered list sorted by name**, each line showing the
   **name** and a short **description**. You may note which ship extra files (`hasBundle: true`,
   i.e. scripts/references) versus a single `SKILL.md`. Ask the user to pick one (by number or name).
   If the initial request named a skill, resolve it to a `slug` and confirm the match.

3. Download the chosen skill. Ask for a destination folder if the user has a preference; otherwise
   default to the current working directory.

   ```bash
   node "<scriptPath>" download --slug "<slug>" --dest "<destination-folder>"
   ```

   The result JSON is `{ ok, slug, name, hasBundle, dir, zip, files }`. The unpacked payload
   (`SKILL.md` plus any `scripts/`, `references/`, `assets/`) is written to `<dest>/<slug>/`, and when
   a prebuilt bundle exists, `<dest>/<slug>.zip` is saved too.

## 5. Report

Tell the user, concisely:

- The skill name and slug.
- Where it was saved - the unpacked folder path, and the `.zip` path when one was produced.
- Whether it is a single-`SKILL.md` skill or a bundle with extra files.
- That **import into a Copilot Studio agent is not done yet** - it is a separate, upcoming step.

## Error handling

- The script prints `{ "ok": false, "error": "..." }` and exits non-zero on failure. Surface the
  `error` message.
- A GitHub tree "truncated" error, rate-limit, or network failure from `list`/`download` is
  transient - report it and offer to retry. Setting `GITHUB_TOKEN` raises the API limit for the one
  tree call, but is not normally required.
- If the user picks a non-skill catalog entry (a Scout automation or a legacy `.zip`), `download`
  refuses it with a clear message; relay that and suggest picking an actual skill.
