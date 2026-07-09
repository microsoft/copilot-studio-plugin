# Copilot Studio Plugin

This repository is the successor to [skills-for-copilot-studio](https://github.com/microsoft/skills-for-copilot-studio). It contains an experimental plugin for creating, editing, validating, and migrating Copilot Studio YAML projects.

This plugin relies on the new version of the Power Platform CLI (`pac`), specifically version 2.9.1. A version greater that that is required to use the plugin. Install the latest version from [here](https://learn.microsoft.com/en-us/power-platform/developer/cli/introduction?tabs=windows) or just grab it from the [nuget feed](https://www.nuget.org/packages/Microsoft.PowerApps.CLI).

## Disclaimer

This plugin is an experimental research project, not an officially supported Microsoft product. The Copilot Studio YAML schema may change without notice. Always review and validate generated YAML before pushing to your environment - AI-generated output may contain errors or unsupported patterns. This plugin is not meant for production use.

## Installation

```bash
git clone https://github.com/microsoft/copilot-studio-plugin.git

# Load for a single session
claude --plugin-dir /path/to/copilot-studio-plugin
```

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
