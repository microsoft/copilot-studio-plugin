---
user-invocable: true
description: Migrate a classic Copilot Studio agent to the new agentic-loop architecture (cloning it first if it is not already local). Use when the user asks to migrate, upgrade, or convert an existing agent to the new experience.
argument-hint: Agent name or path to migrate (and source environment if it must be cloned)
allowed-tools: Bash(pac *), Bash(node *convert-actions-to-tools.js*), Read, Write, Glob, Grep, WebFetch(domain:raw.githubusercontent.com), Task
context: fork
---

# Migrate Agent

Thin wrapper that runs the plugin's migration workflow. The full, authoritative migration orchestration lives
in the plugin's migrate command; this skill executes that same workflow so migration is reachable as a skill.

## Instructions

1. **Read the migration workflow** and follow it exactly:
   ```
   Read: ${CLAUDE_SKILL_DIR}/../../commands/migrate.md
   ```
   Treat the user's arguments as that workflow's `$ARGUMENTS`.
2. Execute the workflow's steps in their natural order (PAC prerequisite check -> ensure the agent is local
   (clone if needed) -> describe -> plan + approval -> tool migration -> architect -> push), delegating to the
   sub-agents it names. Do not re-implement or reorder those steps here.

## Prerequisite

The migration workflow requires PAC CLI **>= 2.9.3**. Verify it before starting, exactly as the workflow's
first step specifies, and stop if the installed version is older.

## Guardrails

- Do not invent behavior the source agent files do not support.
- Do not skip the plan-approval step defined in the workflow.
- This skill is a thin entry point; the migrate command file is the single source of truth for the steps.
