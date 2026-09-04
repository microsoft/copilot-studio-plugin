---
user-invocable: true
description: Add a knowledge source (SharePoint folder or public website) to a modern Copilot Studio agent by authoring a KnowledgeSourceConfiguration component under capabilities/knowledge. Use when the user asks to add a knowledge source, documentation URL, website, or SharePoint site for the agent to search.
argument-hint: <url> [name]
allowed-tools: Read, Write, Glob, Grep
context: fork
agent: copilot-studio-architect
---

# Add Knowledge Source

Add a knowledge source to a **modern (agentic-loop)** Copilot Studio agent. This authors a
`KnowledgeSourceConfiguration` component under the agent's `capabilities/knowledge/` folder. It does not push;
after authoring, the user syncs with the push (or publish) skill (`pac copilot push`).

Supported here: **SharePoint** and **Public Website**. Other source types (Dataverse, uploaded files, AI
Search, SQL, Graph connectors) must be configured in the Copilot Studio portal - see Limitations.

## Phase 0: Locate the agent (never hardcode)

Auto-discover the modern agent workspace:

```
Glob: **/agent.mcs.yml
```

Confirm it is a modern CLI-authored agent: the project should contain `settings.mcs.yml` and a
`capabilities/` folder. If `capabilities/knowledge/` does not exist yet, create it. If multiple workspaces are
found, present a numbered pick-list rather than silently choosing one.

Also note the **customization/publisher prefix** used by the project's existing component files. PAC derives
each Dataverse `botcomponent.schemaname` from the file stem, so every component file stem must start with a
valid prefix for the target environment (e.g. `cr123_`) and be <= 100 characters. Reuse the prefix already
present on sibling files under `capabilities/`. If none exists, ask the user for the approved publisher prefix.

## Phase 1: Parse inputs

From the arguments and request, extract:
- The **URL** (required).
- An optional **name** and **description**. If not given, derive a short, descriptive name from the URL.

## Phase 2: Determine the source type

- URL contains `sharepoint.com` -> **SharePoint** (`SharePointKnowledgeSource`). Normalize the URL first (below).
- Otherwise -> **Public Website** (`PublicSiteSearchSource`).

### SharePoint URL normalization

Copilot Studio needs a direct folder path, e.g. `https://contoso.sharepoint.com/sites/MySite/Shared%20Documents/MyFolder`.

| URL pattern | Action |
|---|---|
| **Direct path** (`/sites/.../Shared%20Documents/...`) | Use as-is. |
| **AllItems.aspx with `?id=`** | Extract and URL-decode the `id` query parameter to get the path, prepend the origin (`https://<tenant>.sharepoint.com`), and drop all query params. |
| **Sharing link** (`/:f:/s/...`, `/:x:/s/...`) | Cannot convert - opaque token. Ask the user: *"That's a SharePoint sharing link - I can't extract the folder path. Please open the folder in SharePoint, copy the URL from the browser address bar, and paste it here."* |

**Encoding:** spaces in the final static URL must be `%20` (e.g. `Shared%20Documents`).

## Phase 3: Author the component YAML

Write to `capabilities/knowledge/<prefix>_<slug>_<shortid>.mcs.yml`, where `<prefix>` is the project's
customization prefix, `<slug>` is a slugified name, and `<shortid>` is a short unique suffix.

Every component starts with the `mcs.metadata` block.

**SharePoint** (this is the confirmed modern format used by this plugin):

```yaml
mcs.metadata:
  componentName: <Name>
  description: <what this knowledge source provides>
kind: KnowledgeSourceConfiguration
source:
  kind: SharePointKnowledgeSource
  siteUrl: https://contoso.sharepoint.com/sites/MySite/Shared%20Documents/MyFolder
  additionalSearchTerms:
  targetKind: Folder
```

**Public Website:**

> `PublicSiteSearchSource` uses Bing search to find relevant snippets within the scoped URL. It does **not**
> crawl or summarize full pages, and supports a **maximum depth of 2 levels** beyond the domain
> (e.g. `https://example.com/docs/api` works; `https://example.com/docs/api/v2` is too deep).

```yaml
mcs.metadata:
  componentName: <Name>
  description: <what this knowledge source provides>
kind: KnowledgeSourceConfiguration
source:
  kind: PublicSiteSearchSource
  site: https://www.example.com/docs
```

> **Schema note (verify on push).** This plugin's SharePoint knowledge uses the modern
> `SharePointKnowledgeSource` shape (`siteUrl`, `targetKind`). The public-website shape above follows the
> Copilot Studio authoring schema (`PublicSiteSearchSource` / `site`). Field/kind names for public websites
> can differ by PAC schema version, so after authoring, **validate by syncing** (Phase 5). If push reports an
> unknown `kind` or property, reconcile against the schema for the installed PAC version before retrying.

## Phase 4: Dynamic URLs (optional)

Knowledge URLs support `{VariableName}` placeholders via Power Fx interpolation for per-user routing, e.g.:

```yaml
source:
  kind: SharePointKnowledgeSource
  siteUrl: =$"{Global.UserKBURL}"
  targetKind: Folder
```

The variable must hold a clean direct URL (not an `AllItems.aspx` link) and be set **before** any
knowledge-search step runs.

## Phase 5: Validate and hand off

- Confirm the file is under `capabilities/knowledge/`, the stem starts with the customization prefix, and the
  `mcs.metadata` block plus `kind` are present.
- Tell the user to sync the change so the platform validates it: pull, then push (use the push skill or run
  `pac copilot push --project-dir "<agent-folder>"`). Report any schema error from push verbatim.

## Limitations

This skill creates **SharePoint** and **Public Website** sources. For the following, tell the user they must be
created in the Copilot Studio portal (they require Power Platform configuration), then cloned/pulled to edit
locally: Dataverse tables, uploaded files, AI Search, SQL Server, and Microsoft Graph connectors.
