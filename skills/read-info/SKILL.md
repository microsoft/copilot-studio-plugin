---
user-invocable: true
description: Read-only. Understand an existing Copilot Studio agent and produce a detailed report of what it does (topics, actions, knowledge, instructions). Use when the user asks what an agent does, to explain, summarize, or get info about an agent.
argument-hint: [agent name or project path]
allowed-tools: Read, Glob, Grep
context: fork
agent: copilot-studio-describer
---

# Read Agent Info

Thin wrapper over the **Copilot Studio Describer** agent (read-only) for the **read info / describe** operation.

The user wants to understand an existing agent. Delegate to the Describer agent:

1. Auto-discover the agent workspace (`Glob: **/agent.mcs.yml`). Never hardcode a name. If multiple are found,
   ask which one to describe.
2. Produce the Describer agent's structured, read-only report.

This skill is strictly **read-only**: never create, edit, delete, push, pull, publish, or test anything. If the
user actually wants changes, hand off to the appropriate authoring or manage skill instead.
