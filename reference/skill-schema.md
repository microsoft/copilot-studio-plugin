# Agent Skill Schema (authoritative)

**Single source of truth** for how agent skills are represented in a modern Copilot Studio
**agentic-loop** agent (`behaviors/`). The `/add-skill` command, the `scripts/add-skill.js` importer,
and the `copilot-studio-architect` agent all consult this file — edit the schema **here only** so the
three never drift.

The shapes below match what the platform produces when a skill is added in the browser and cloned
locally with `pac copilot`.

---

## Two variants

A skill is always `kind: InlineAgentSkill`, but it is materialized in one of two ways:

| Variant | Where the skill text lives | Marker | Emitted by |
|---|---|---|---|
| **Inline** | Embedded in the component's `content:` block | no `authoringSource` | `copilot-studio-architect` when authoring a new skill from an idea |
| **Upload** | A real `SKILL.md` file on disk, plus optional payload files | `authoringSource: Upload` | `/add-skill` import (`scripts/add-skill.js`), and a portal upload |

> **Open question — variant selection.** The platform accepts both, but there is currently no
> documented rule for *when* an author should prefer one over the other, and no verified statement
> that they are functionally equivalent at runtime. Until that is confirmed, keep using the variant
> each producer already emits (architect → inline; `/add-skill` → upload) and do not convert between
> them. Resolve this before relying on cross-variant behavior.

## File layout

```text
<agent>/
└── behaviors/
    └── <folder>/
        ├── SKILL.md                 # upload variant only — the manifest, this exact casing
        ├── skill.mcs.yml            # upload variant only — the anchor component
        ├── scripts/
        │   ├── redline.py           # payload file, copied verbatim
        │   └── redline.py.mcs.yml   # one sidecar per non-manifest payload file
        └── <folder>.mcs.yml         # inline variant — the whole skill in one component
```

A **single-`SKILL.md`** skill gets only the anchor: no `bundle`, no `manifestSchemaName`, no sidecars.
A **bundle** skill (any payload file beyond `SKILL.md`) gets all three.

## Inline variant — `InlineAgentSkill` with `content:`

```yaml
mcs.metadata:
  componentName: make-restaurant-reservation
  description: "Guides the user through making a restaurant reservation."
kind: InlineAgentSkill
content: |
  ---
  name: make-restaurant-reservation
  description: Guides the user through making a restaurant reservation.
  ---
  <!-- bic:source=blank -->
  <skill instructions in Markdown>
```

- `componentName` — the skill's kebab-case identifier.
- `description` — what the skill *does*, in enough detail that the orchestrator can decide when to
  invoke it. This is the selection signal; a vague description means the skill never fires.
- `content:` — a literal block scalar holding the full manifest, **including its own YAML
  frontmatter**. The `name`/`description` inside the frontmatter should match `mcs.metadata`.
- `<!-- bic:source=blank -->` — the provenance marker the platform writes for a skill authored from
  scratch. Preserve it verbatim on edit.

## Upload variant — anchor + sidecars

### Anchor — `behaviors/<folder>/skill.mcs.yml`

```yaml
mcs.metadata:
  componentName: pdf-redline
  description: Redlines a PDF contract and produces a summary of changes.
  schemaName: crbab_guitarcoach_dcF_b3.skill.pdfredline_Kq2
  bundle: crbab_guitarcoach_dcF_b3.file.pdfredlinezip_9Xa2L
  manifestSchemaName: crbab_guitarcoach_dcF_b3.file.skillmd_bT4nQ
kind: InlineAgentSkill
authoringSource: Upload
```

- `componentName` — the `behaviors/<folder>` name.
- `description` — read from the `description` key of the `SKILL.md` YAML frontmatter. Omit the line
  entirely when the manifest has none.
- `schemaName` — see [Schema names](#schema-names).
- `bundle` / `manifestSchemaName` — **bundle skills only**. `bundle` names the notional
  `<folder>.zip` file component; `manifestSchemaName` names the `SKILL.md` file component.
- `authoringSource: Upload` — required; it is what distinguishes this variant.
- The portal writes the anchor **without a trailing newline**; sidecars keep theirs. Match that for
  byte-parity.

### Payload sidecar — `behaviors/<folder>/<path>.mcs.yml`

One per non-manifest payload file, written *next to* the file it describes (so `scripts/redline.py`
gets `scripts/redline.py.mcs.yml`). Metadata only — no `kind:`, no `authoringSource:`.

```yaml
mcs.metadata:
  componentName: ./scripts/redline.py
  schemaName: crbab_guitarcoach_dcF_b3.file.redlinepy_9Xa2L
```

- `componentName` — the POSIX-style path **relative to the skill folder**, prefixed with `./`.
- No sidecar is written for `SKILL.md` itself; it is named by the anchor's `manifestSchemaName`.

### Bare fallback

When the agent `schemaName` cannot be read from `settings.mcs.yml`, write the payload files only
(no anchor, no sidecars) and warn. The VS Code Copilot Studio extension synthesizes the companions on
the next workspace read / sync. A bare skill is only recognized inside a **code-first (CLI) agent**
workspace — one carrying `agent.sync.yaml` and a `settings.mcs.yml` that names a CLI recognizer.

## YAML-safe scalar encoding

Treat folder names, descriptions, and payload paths as external data, not YAML. Never paste a value
directly after `componentName:` or `description:`.

A value **must** be emitted as a double-quoted scalar whenever it:

- is empty, starts with a YAML indicator (`- ? : , [ ] { } # & * ! | > ' " % @ \``) or whitespace,
  contains `: `, ` #`, a trailing `:`, trailing whitespace, or any newline/tab; **or**
- would resolve to a non-string under **YAML 1.1**, which is what the Copilot Studio tooling reads
  these files with — `y`, `n`, `yes`, `no`, `true`, `false`, `on`, `off` (any casing); `~`, `null`;
  any integer, float, hex, octal, `.inf`/`.nan`; and sexagesimals such as `1:30`.

A skill folder named `on` or `123` is the common trap: emitted plain, it comes back as the boolean
`true` or the number `123`.

Per variant:

- **Upload** — quote only when the rules above require it. The portal writes plain scalars for
  ordinary values, and the anchor should stay byte-comparable with a portal import. The reference
  implementation is `yamlScalar()` in `scripts/add-skill.js`; it already enforces this, so do not
  hand-edit generated companions.
- **Inline** — always double-quote `componentName` and `description`. These are authored by a model
  from user text, where the cheapest safe rule is to quote unconditionally.

## Folder naming

The `behaviors/<folder>` segment is also the skill's display name and the source of its schema
segment, so keep it filesystem- and Dataverse-safe:

- Replace path separators with `-`, reduce every other character outside `[A-Za-z0-9._-]` to `-`,
  collapse runs of `-`, and trim leading/trailing `-` and `.`.
- Fall back to `skill` when that leaves an empty string.
- Prefix Windows reserved device names (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`)
  with `skill-`.
- Cap the result at 60 characters. This is a readability cap, **not** the schema limit — see below.

Dots and dashes survive here on purpose — they read well as a display name — so the schema segment is
derived separately (see below) rather than reusing the folder name as-is.

## Schema names

Every component schema name has the shape:

```text
<agentSchemaName>.<infix>.<segment>_<token>
```

| Component | `<infix>` | `<segment>` | `<token>` |
|---|---|---|---|
| Skill anchor | `skill` | the `behaviors/` folder name with every non-alphanumeric removed (`my.cool-skill` → `mycoolskill`), falling back to `skill` when that empties it | 3 chars |
| Manifest, bundle, payload file | `file` | the file name, lowercased, non-alphanumerics removed (`SKILL.md` → `skillmd`, `redline.py` → `redlinepy`) | 5 chars |

`<agentSchemaName>` is read from the workspace `settings.mcs.yml` (e.g. `crbab_guitarcoach_dcF_b3`).
`<token>` is a random base62 string; its length is cosmetic parity with portal output — only validity
and uniqueness matter.

Both segments are reduced to alphanumerics because a `.` in a segment would silently add a fourth
schema-name level, and the extension mints its own segments the same way
(`SkillLayout.MintBundleSchemaName` keeps only ASCII letters and digits).

### Reading the agent schema name

`settings.mcs.yml` is scraped, not fully parsed, so resolve the `schemaName:` value the way a YAML
parser would before using it as a prefix:

- Honour double and single quoting, and unescape the contents. `schemaName: "crbab_x"` is the prefix
  `crbab_x`, never `"crbab_x"` — pasting the quotes through produces an invalid schema name *and*
  invalid YAML in the anchor.
- Drop a trailing `#` comment on an unquoted value.
- Require the result to match `^[A-Za-z][A-Za-z0-9_]*$`. Anything else is not a usable Dataverse
  prefix; treat it as "no prefix" and fall back to a bare skill rather than emitting it verbatim.

### 100-character schema-name budget

Dataverse caps a schema name at 100 characters. Apply the limit **before** writing:

- Segment budget = `100 - length(agentSchemaName) - length(infix) - length(token) - 3`
  (the two dots and the underscore).
- Strip unsupported characters first, then truncate the segment on the right to its budget, and warn
  that the on-disk name and the schema name now differ.
- If the budget is less than one character for **either** shape, stop and report that the agent
  schema name leaves no valid component-name space. Check this before materializing any file, so a
  failure does not leave a half-written skill folder behind.

The 60-character folder cap is not sufficient on its own: a 40-character agent schema name plus a
60-character folder yields a 111-character anchor schema name.

## Collision and overwrite rules

- Never overwrite an existing `behaviors/<folder>/` without explicit confirmation (`--force`).
- Regenerate companions; never copy a `.mcs.yml` from the skill source.
- Gallery sidecars (`metadata.json`, `metadata.yaml`, `metadata.yml`, `README.md`) are excluded from
  the payload by default, matched **case-insensitively** and only at the skill root.
- Payload archives are copied verbatim like any other file. The one exception is a root-level
  `<folder>.zip`, which would collide with the bundle archive the extension mints for the skill:
  skip it and say so, rather than dropping it silently.
- The manifest must land as exactly `SKILL.md`. If the source has several root manifests differing
  only by casing, keep one and report the one skipped.

## Best practices

- **Prefer a few focused skills over one comprehensive package.** Each skill should cover one clear
  procedure.
- **Add a skill only when the task genuinely needs a procedure.** For tasks a model already handles
  from general knowledge, a skill adds little and can get in the way.
- **Write the description for the orchestrator.** It is the selection signal, not documentation.
- Skill content should cover trigger/use guidance, required inputs, clarifying questions, tool-use
  steps, confirmation rules for side effects, expected outputs, and fallback/escalation behavior.

Classification guidance — skill vs tool, skill vs knowledge, and skill effectiveness heuristics —
lives in the `copilot-studio-architect` agent, not here. This file covers the **schema** only.

## Limitations

- `InlineAgentSkill` is supported on **Copilot Studio CLI (code-first) agents** only.
- Import materializes files on disk. **Publishing is done from the VS Code Copilot Studio extension**
  (Agent Changes view / sync push); no command here pushes to the cloud.
