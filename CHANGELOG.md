# Changelog

All notable changes to the `mcs-assistant` plugin are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [1.1.0]

### Added

- **Skills subsystem** (`skills/`) exposing the agent project lifecycle as user-invocable skills:
  - Thin wrappers that delegate to the plugin's existing agents/command (no logic duplication):
    - `clone`, `pull`, `push`, `publish` -> `copilot-studio-manage`
    - `create` -> `copilot-studio-init`
    - `read-info` -> `copilot-studio-describer`
    - `migrate` -> the `migrate` command workflow
  - Gap-filling skills:
    - `delete` - self-contained destructive delete via `pac copilot delete`, with a mandatory
      explicit-confirmation guardrail. Kept out of `copilot-studio-manage`, whose ALM scope excludes delete.
    - `add-knowledge` - authors a modern `KnowledgeSourceConfiguration` (SharePoint / public website) under
      `capabilities/knowledge/` (delegates to `copilot-studio-architect`).
    - `add-connection` - full connection setup: find/create connection, create a dedicated connection
      reference, and wire the tool YAML.
    - `add-skill` - scaffolds a new plugin skill (`skills/<name>/SKILL.md`).
- `PRODUCT-SUPPORTED.md` readiness/compliance checklist.
- Real `SUPPORT.md` issue-reporting guidance (replaced the unedited template).
- README "Skills" and "Support status" sections.

### Changed

- Plugin promoted from **experimental** to **product supported**: removed the experimental-research-project
  disclaimer from the README.
- Expanded plugin/marketplace descriptions to reflect the lifecycle + skills surface.
- Version bumped `1.0.2` -> `1.1.0` in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.

### Notes

- Skills are validated structurally (frontmatter well-formed, JSON parses). PAC-backed behavior requires
  PAC CLI **>= 2.9.3** and an authenticated Dataverse environment to live-test; see
  [`PRODUCT-SUPPORTED.md`](PRODUCT-SUPPORTED.md) for the outstanding live-validation items.
