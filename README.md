# Copilot Studio Plugin

This repository is the successor to [skills-for-copilot-studio](https://github.com/microsoft/skills-for-copilot-studio). It contains a plugin for creating, editing, validating, and migrating classic agents to the new experience.

This plugin relies on the new version of the Power Platform CLI (`pac`), specifically version 2.9.3. A version greater that that is required to use the plugin. Install the latest version from [here](https://learn.microsoft.com/en-us/power-platform/developer/cli/introduction?tabs=windows) or just grab it from the [nuget feed](https://www.nuget.org/packages/Microsoft.PowerApps.CLI).

## Support status

This plugin is **product supported**. The Copilot Studio YAML schema continues to evolve, so always review generated YAML and validate it against your environment (by pushing) before relying on it. See [`SUPPORT.md`](SUPPORT.md) for how to get help and [`PRODUCT-SUPPORTED.md`](PRODUCT-SUPPORTED.md) for the readiness checklist.

## Installation

```bash
/plugin marketplace add microsoft/copilot-studio-plugin
/plugin install mcs-assistant@copilot-studio-plugin
```

## Skills

The plugin ships user-invocable skills that cover the agent project lifecycle. Thin wrappers delegate to the plugin's agents/commands; the rest are self-contained.

| Skill | What it does |
| --- | --- |
| `migrate` | Migrate a classic agent to the new agentic-loop architecture (runs the migrate workflow). |
| `create` | Initialize a new empty agent project (`pac copilot init`). |
| `read-info` | Read-only: describe what an existing agent does. |
| `clone` | Clone an agent from an environment into a local workspace. |
| `pull` | Sync cloud changes down into the local workspace. |
| `push` | Pull-then-push local YAML edits up to the environment. |
| `publish` | Push and publish an agent so changes go live for shared users. |
| `delete` | Delete an agent from an environment (destructive; requires explicit confirmation). |
| `add-knowledge` | Author a SharePoint or public-website knowledge source under `capabilities/knowledge/`. |
| `add-connection` | Set up and wire a connector connection + connection reference onto a tool. |
| `add-skill` | Scaffold a new plugin skill (`skills/<name>/SKILL.md`). |

Skills are auto-discovered from the `skills/` folder when the plugin is loaded. See [`CHANGELOG.md`](CHANGELOG.md) for version history.


## Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
