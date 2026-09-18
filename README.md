# Copilot Studio Authoring Plugin 

This repository is the successor to [skills-for-copilot-studio](https://github.com/microsoft/skills-for-copilot-studio). It contains a plugin and supporting skills for Microsoft Copilot Studio GHCP Harness use for creating, editing, validating, and migrating Microsoft Copilot Studio Classic Harness agents to Microsoft Copilot Studio GHCP Harness agents.

This plugin requires the Power Platform CLI (`pac`), specifically version 2.9.3 or higher. Install the latest version from [here](https://learn.microsoft.com/en-us/power-platform/developer/cli/introduction?tabs=windows) or just grab it from the [NuGet feed](https://www.nuget.org/packages/Microsoft.PowerApps.CLI).

## Disclaimer

This plugin work in progress and supported by Github Issues only at this time, we are working to improve this feature set. The Copilot Studio YAML schema may change without notice. Always review and validate generated YAML before pushing to your environment - AI-generated output may contain errors or unsupported patterns. 

## Installation

```bash
/plugin marketplace add microsoft/copilot-studio-plugin
/plugin install mcs-assistant@copilot-studio-plugin
```

## Commands

| Command | Description |
|---|---|
| `/create` | Create, structure, and push a new CLI-authored Copilot Studio agent from a natural-language description. |
| `/migrate` | Migrate a classic Copilot Studio agent to the new agentic-loop architecture. |
| `/add-knowledge` | Add public website, SharePoint, OneDrive, or uploaded-file knowledge to a local agent. |
| `/chat` | Chat with and test a locally cloned CLI-authored agent. |

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
