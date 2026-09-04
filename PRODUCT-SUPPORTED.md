# Product-Supported Readiness

This document tracks the readiness of the `mcs-assistant` plugin against its product-supported
definition-of-done. It is a checklist, not a guarantee - items in section 5 require a live environment to
close.

## 1. Skill surface (complete)

The plugin exposes the requested capabilities as user-invocable skills. 7 are thin wrappers over existing
agents/command; 4 fill real gaps.

| Capability | Skill | Type | Status |
| --- | --- | --- | --- |
| Migrate | `migrate` | wrapper -> migrate command | authored |
| Create | `create` | wrapper -> `copilot-studio-init` | authored |
| Read Info | `read-info` | wrapper -> `copilot-studio-describer` | authored |
| Clone | `clone` | wrapper -> `copilot-studio-manage` | authored |
| Pull | `pull` | wrapper -> `copilot-studio-manage` | authored |
| Push | `push` | wrapper -> `copilot-studio-manage` | authored |
| Publish | `publish` | wrapper -> `copilot-studio-manage` | authored |
| Delete | `delete` | gap, self-contained | authored |
| Add Knowledge source | `add-knowledge` | gap -> `copilot-studio-architect` | authored |
| Add Connection / Connection setup ops | `add-connection` | gap, self-contained (merged) | authored |
| AddSkill (net-new) | `add-skill` | gap, self-contained | authored |

## 2. Authoring quality bar (complete)

- Every `SKILL.md` is agent-facing only (no human onboarding/marketing prose in the skill body), following the
  cat-agent-skills authoring discipline used as the reference/quality bar.
- `allowed-tools` are least-privilege and scoped to the specific `pac` command patterns each skill uses.
- Agent workspaces are auto-discovered (`Glob: **/agent.mcs.yml`); no hardcoded agent names or paths.
- Destructive operations (`delete`) are gated behind an explicit, unambiguous user confirmation before
  `--confirm` is ever passed.

## 3. Packaging (complete)

- `plugin.json` and `marketplace.json` bumped to `1.1.0` with expanded descriptions.
- `CHANGELOG.md` documents the 1.1.0 additions.
- README has a Skills section and a Support-status section.
- `SUPPORT.md` provides real issue-reporting guidance.
- Experimental-research-project disclaimer removed (plugin presented as product supported).

## 4. Structural validation (complete)

- All `.claude-plugin/*.json` parse as valid JSON.
- All new `SKILL.md` files have well-formed YAML frontmatter delimited by `---`.

## 5. Live validation (blocked - needs PAC >= 2.9.3 + a Dataverse environment)

These cannot be closed in the current environment (local PAC is below 2.9.3 and there is no authenticated
environment). Each must be exercised against a disposable dev environment before declaring full support:

- [ ] `create` / `clone` / `pull` / `push` / `publish` against a real agent, verifying the Manage/Init agents
      run end-to-end.
- [ ] `delete` against a throwaway agent, including verifying the confirmation guardrail blocks a non-confirm
      response and that `pac copilot list` shows the agent gone afterwards.
- [ ] `add-knowledge`: **confirm the public-website knowledge `kind`/fields** for the installed PAC schema
      version. The SharePoint shape (`SharePointKnowledgeSource` / `siteUrl` / `targetKind: Folder`) is
      confirmed from the architect agent; the public-website shape (`PublicSiteSearchSource` / `site`) follows
      the authoring schema but must be verified by a successful `pac copilot push`.
- [ ] `add-connection`: exercise the connection-reference `Collect` flow and confirm push succeeds with the
      new reference.
- [ ] `migrate`: run the full workflow end-to-end.
- [ ] Confirm there is no runtime collision between the `migrate` **skill** and the existing `migrate`
      **command** (both would surface as `migrate`). If the host disallows the overlap, either rename the
      wrapper or have the command delegate to the skill.

## 6. Open decisions / tech debt

- The `migrate` skill delegates to `commands/migrate.md` (single source of truth). Consider consolidating the
  command and skill once the naming-overlap behavior is confirmed (see 5).
- cat-agent-skills is used here only as a **reference/quality bar**; these skills are not (yet) published to
  that community gallery. If co-publishing is later desired, each skill would need a `metadata.json` sidecar
  and would move to that repo's `submissions/` format.
