---
description: Add an Agent Skill to a Copilot Studio agent - uploaded from your drive (a SKILL.md or .zip) or picked from the Power CAT "Cat Agent Skills" gallery - then optionally import it into a cloned agent workspace under behaviors/.
argument-hint: Optional skill name/slug or a local path to a SKILL.md / .zip
allowed-tools: Bash(node *add-skill.js*), Read, Glob, Grep
---

# Add a Copilot Studio Agent Skill

You help the user obtain an **Agent Skill** to add to a Copilot Studio agent. A skill is either
**uploaded from the user's local drive** (a `SKILL.md` file or a `.zip` bundle) or **selected from
the Power CAT "Cat Agent Skills" gallery** (`https://microsoft.github.io/cat-agent-skills/`,
source `github.com/microsoft/cat-agent-skills`) and downloaded locally.

**Flow:** first *acquire* the skill (validate a local file, or download a gallery skill into a local
folder), then optionally *import* it into a cloned Copilot Studio agent workspace under
`behaviors/<name>/`. By default the import also writes the **portal-style `.mcs.yml` companions** (an
anchor `skill.mcs.yml` plus per-file sidecars for bundle skills) so the on-disk layout matches a
Copilot Studio portal import. Import only materializes files on disk; **publishing to the cloud is
done from the VS Code Copilot Studio extension** (Agent Changes view / sync push) afterward - this
command never pushes.

Initial request: $ARGUMENTS

## Authoritative schema — read this before importing

The exact YAML for every skill component, the `behaviors/` file layout, anchor/sidecar rules, folder
naming, and schema-name conventions live in a single shared reference —
**`reference/skill-schema.md`**. It is the source of truth; the `copilot-studio-architect` agent and
`scripts/add-skill.js` use the same file, so the three never drift. **Read it before step 5** and
follow it exactly.

Resolve its path via the plugin root: read
`path.join(os.homedir(), '.copilot-studio-cli', 'plugin-paths.json')` to get `pluginRoot` for the
current `mcs-assistant` plugin, then read `path.join(pluginRoot, 'reference', 'skill-schema.md')`.
If `plugin-paths.json` cannot be read, fall back to locating `reference/skill-schema.md` under the
installed plugin directory.

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

Otherwise ask the user to choose the source **as a single, standalone question** with exactly two
options:

- **Upload from local drive** - they already have a `SKILL.md` or a `.zip`.
- **Select from the gallery** - browse the Cat Agent Skills catalog.

Keep this question to the source choice only. Do **not** bundle any other field into it - in
particular, never add an upload-path field with "leave blank if downloading from the gallery" (or
similar) wording. Ask for a local path only after the user picks **Upload** (step 3); ask nothing
about paths on the **gallery** branch until it is time to pick a destination (step 4).

## 3. Local upload

1. Ask for the full path if it was not provided.
2. Validate it exists and is a single `SKILL.md` (Markdown) or a `.zip`. If it is neither, tell the
   user what is accepted and stop.
3. Confirm the resolved absolute path. For a `SKILL.md`, its containing folder is the `--src` for
   import (step 5). For a `.zip`, you cannot extract it yourself - the only shell command available
   here is the `add-skill.js` script. Ask the user to extract it and give you the path to the
   extracted folder (the one holding `SKILL.md`), then use that as `--src`.

## 4. Select from the gallery

1. List the available skills as a **table** (box structure), which is the format to show the user:

   ```bash
   node "<scriptPath>" list --pretty
   ```

   This renders a table with columns `#`, `◆` (bundle marker), `Name`, `Description`, and `Slug`,
   already sorted by display name and limited to skills whose `platforms` include **Copilot Studio**.
   The layout is **deterministic** - a fixed render width and stable sort mean the same gallery data
   always produces the exact same table, regardless of terminal size. The `◆` marks a bundle skill
   (ships extra `scripts/`, `references/`, or `assets/`); an empty cell is a single `SKILL.md`. Add
   `--all` only if the user explicitly wants every platform. For programmatic use, plain
   `node "<scriptPath>" list` still emits JSON `{ ok, count, skills: [{ slug, name, description,
   platforms, tags, hasBundle }] }`.

2. Present that table to the user (do not flatten it into a plain list), then ask them to pick one by
   **number or name**. Map their choice to the exact `slug` from the table's `Slug` column for the
   download. If the initial request already named a skill, resolve it to a `slug` and confirm the
   match.

3. Download the chosen skill. **Do not ask the user where to save it** - omit `--dest` so it lands in
   a temporary user folder automatically (`<os-tmp>/mcs-add-skill/<slug>`):

   ```bash
   node "<scriptPath>" download --slug "<slug>"
   ```

   The result JSON is `{ ok, slug, name, hasBundle, dir, zip, files }`. Use the returned `dir` as the
   `--src` when importing (step 5) - do not prompt for a location. The unpacked payload (`SKILL.md`
   plus any `scripts/`, `references/`, `assets/`) is written to `dir`, and when a prebuilt bundle
   exists, `<os-tmp>/mcs-add-skill/<slug>.zip` is saved too.

## 5. Import into a cloned agent workspace (optional)

Offer to import the acquired skill into a **cloned Copilot Studio agent workspace** (a folder that
contains `settings.mcs.yml` + `agent.sync.yaml`, produced by the extension's Clone Agent command). If
the user does not have one yet, tell them to clone/attach an agent first, and stop after acquiring.

Import writes the skill under `behaviors/<name>/`: the manifest as `SKILL.md` and every other payload
file (e.g. `scripts/`) copied verbatim. By default it then also emits the **portal-style `.mcs.yml`
companions** — an anchor `skill.mcs.yml` plus, for bundle skills, one sidecar per non-manifest
payload file — so the on-disk layout matches a Copilot Studio portal import. The script owns those
shapes; `reference/skill-schema.md` documents them.

Every component's schema name is prefixed with the agent `schemaName` read from the workspace
`settings.mcs.yml`. If that value is missing, or is not a usable Dataverse prefix - or you pass
`--no-sidecars` - the import falls back to a **bare `behaviors/<name>/` folder** and the extension
synthesizes the companions on the next workspace read / sync. A `warning` explains the fallback
except when you asked for it with `--no-sidecars`. If the agent `schemaName` is so
long that it leaves no room for a component name under the 100-character Dataverse limit, the import
fails before writing anything - relay that error and suggest a shorter agent schema name.

```bash
node "<scriptPath>" import --src "<skill-folder>" --workspace "<cloned-agent-folder>" [--name "<folder>"] [--force] [--no-sidecars]
```

- `--src` is the unpacked skill folder (`<dest>/<slug>/` from step 4, or the folder holding an
  uploaded `SKILL.md`). It must contain a top-level `SKILL.md` (case-insensitive; written as
  `SKILL.md`).
- `--workspace` is the cloned agent root. `--name` overrides the `behaviors/` folder name (defaults to
  the source folder name, sanitized). `--force` overwrites an existing `behaviors/<name>/`.
- `--no-sidecars` skips companion generation and writes a bare skill (the pre-existing behavior).
- Gallery sidecars (`metadata.json`, `metadata.yaml`, `metadata.yml`, `README.md`) are excluded by
  default, matched case-insensitively at the skill root; pass `--include-sidecars` to keep them. Any
  `.mcs.yml` files already in `--src` are ignored and regenerated.
- Archives inside the payload (e.g. `assets/templates.zip`) are copied like any other file. A
  root-level `<name>.zip` is skipped, because it would collide with the bundle archive the extension
  mints for the skill; the import reports that in `warnings`.

The result JSON is `{ ok, folder, workspace, behaviorsDir, manifest, files, companions, schemaPrefix, warnings, next }`.
`companions` lists the `.mcs.yml` files written (empty when bare) and `schemaPrefix` is the agent
schema used. Relay any `warnings` (e.g. the target does not look like a cloned CLI agent, or the
schema prefix could not be read) - the files are still written, but a non-agent workspace will not
pick the skill up.

For a `.zip` upload, `--src` must point at the folder the **user** extracted it to (see step 3), so
that it holds the `SKILL.md` plus any payload files.

## 6. Report

Tell the user, concisely:

- The skill name and slug.
- Where it was saved - the unpacked folder path (for a gallery skill this is the temporary
  `<os-tmp>/mcs-add-skill/<slug>` folder), and the `.zip` path when one was produced.
- Whether it is a single-`SKILL.md` skill or a bundle with extra files.
- If imported: the `behaviors/<name>/` path created, the `.mcs.yml` companions written (or that it
  fell back to a bare skill, with the reason from `warnings`), and any other warnings; and that
  **publishing to the cloud is the next step, done from the VS Code Copilot Studio extension** (Agent
  Changes view / sync push) - this command does not push.

## Error handling

- The script prints `{ "ok": false, "error": "..." }` and exits non-zero on failure. Surface the
  `error` message.
- A GitHub tree "truncated" error, rate-limit, or network failure from `list`/`download` is
  transient - report it and offer to retry. Setting `GITHUB_TOKEN` raises the API limit for the one
  tree call, but is not normally required.
- If the user picks a non-skill catalog entry (a Scout automation or a legacy `.zip`), `download`
  refuses it with a clear message; relay that and suggest picking an actual skill.
