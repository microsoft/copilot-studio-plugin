# Copilot Studio Authoring Plugin 

This repository is the successor to [skills-for-copilot-studio](https://github.com/microsoft/skills-for-copilot-studio). It contains a plugin and supporting skills for Microsoft Copilot Studio GHCP Harness use for creating, editing, validating, and migrating Microsoft Copilot Studio Classic Harness agents to Microsoft Copilot Studio GHCP Harness agents.

This plugin requires the Power Platform CLI (`pac`), specifically version 2.9.3 or higher. Install the latest version from [here](https://learn.microsoft.com/en-us/power-platform/developer/cli/introduction?tabs=windows) or just grab it from the [NuGet feed](https://www.nuget.org/packages/Microsoft.PowerApps.CLI).

## Disclaimer

This plugin work in progress and supported by Github Issues only at this time, we are working to improve this feature set. The Copilot Studio YAML schema may change without notice. Always review and validate generated YAML before pushing to your environment - AI-generated output may contain errors or unsupported patterns. 

## Installation

### Claude Code

```bash
/plugin marketplace add microsoft/copilot-studio-plugin
/plugin install mcs-assistant@copilot-studio-plugin
```

### Codex

```bash
codex plugin marketplace add microsoft/copilot-studio-plugin
codex plugin add mcs-assistant@copilot-studio-plugin
```

Then start Codex, open `/hooks` and trust the plugin's `SessionStart` hook before your first message
(if you already sent one, start a new session). Codex skips plugin hooks until you trust them, and
asks again when an update changes the hook. The hook installs the native modules that keep sign-in
tokens in the OS credential store; without them the chat skill falls back to a plaintext token
cache.

Codex's default sandbox (`workspace-write`) blocks network access and writes outside the workspace.
`pac`, the chat and knowledge-access scripts and the add-skill gallery need both, so the skills run
those commands with escalated permissions, which Codex asks you to approve. With
`approval_policy = "never"` Codex can't ask; use full access (`--sandbox danger-full-access`) for
these sessions instead.

Platform notes:

- On Windows, Codex's sandbox can't read the installed plugin's files, so Codex also asks before it
  reads the skill and agent files.
- On Ubuntu 24.04, AppArmor blocks the user namespaces that Codex's sandbox (bubblewrap) needs.
  Commands fail inside the sandbox and Codex asks to run them outside it.
- On Linux, sign-in tokens are stored through the Secret Service (for example GNOME Keyring). If it's
  locked or not running, for example in an SSH session after a reboot, the chat skill writes them to a
  plaintext file under `~/.copilot-studio-cli` and doesn't warn you.
- The chat skill saves the app registration (client ID) in the plugin's data folder, so if you use the
  plugin from both Claude Code and Codex, you enter it once in each.

Run a skill with `$mcs-assistant:<skill>` (for example `$mcs-assistant:add-knowledge`) or pick it
from `/skills`. Codex doesn't register the plugin's agents; the skills start them as sub-agents.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
