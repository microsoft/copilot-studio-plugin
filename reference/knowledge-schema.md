# Knowledge Source Schema (authoritative)

**Single source of truth** for how knowledge sources are represented in a modern Copilot Studio
**agentic-loop** agent (`capabilities/knowledge`). Both the `add-knowledge` skill and the
`copilot-studio-architect` agent consult this file — edit the schema **here only** so the two never
drift.

The shapes below match what the platform produces when a source is added in the browser and cloned
locally with `pac copilot`.

---

## File layout

```text
<agent>/
└── capabilities/
    └── knowledge/
        ├── <schemaName>.<slug>_<id>.mcs.yml   # source-backed sources (website / SharePoint / OneDrive)
        └── files/
            ├── <uploaded-file>                # the copied file itself
            └── <slug>_<id>.mcs.yml            # metadata-only sidecar for the uploaded file
```

## Metadata block

Every source-backed component starts with an `mcs.metadata:` block, then
`kind: KnowledgeSourceConfiguration`, then a `source:` block:

- `componentName` — a friendly identifier: the **file name** for files, or the **full URL** for
  websites.
- `description` — describe the **subject matter** the source covers, not just its name. The
  orchestrator uses this to decide when to search the source, so write it to be genuinely
  descriptive (e.g. *"HR leave policies and employee entitlements"* beats *"HR docs"*).

### YAML-safe scalar encoding

Treat names, descriptions, URLs, and paths as external data, not YAML. Emit every externally derived
string as a double-quoted YAML scalar using `JSON.stringify(value)` semantics. This escapes quotes,
backslashes, control characters, and newlines while producing a JSON string that is also valid YAML.
Never paste a user-provided value directly after `componentName:`, `description:`, or `siteUrl:`.
For example, `Policy area: HR` must be emitted as `"Policy area: HR"`, not as a raw plain scalar.

## Source kinds

### Public Website — `WebsiteKnowledgeSource`

```yaml
mcs.metadata:
  componentName: "https://en.wikipedia.org/wiki/Electric_guitar"
  description: "This knowledge source searches information on the web found in https://en.wikipedia.org/wiki/Electric_guitar website"
kind: KnowledgeSourceConfiguration
source:
  kind: WebsiteKnowledgeSource
  siteUrl: "https://en.wikipedia.org/wiki/Electric_guitar"
```

- No `targetKind`.
- The URL defines a **search scope**. Following Copilot Studio's
  [public-website URL rules](https://learn.microsoft.com/microsoft-copilot-studio/knowledge-add-public-website#url-type-and-structure),
  it must be an absolute HTTPS URL with no embedded username or password and at most **two nonempty
  path segments** after the host (ignore one trailing slash). Reject deeper paths and ask for a
  broader base URL.
- The site must be publicly accessible without a login and indexed by Bing. Do not use a search
  engine URL as a source.

### SharePoint — single file — `SharePointKnowledgeSource`, `targetKind: File`

```yaml
mcs.metadata:
  componentName: "Circle_of_fifths.docx"
  description: "This knowledge source provides information found in Circle_of_fifths.docx SharePoint."
kind: KnowledgeSourceConfiguration
source:
  kind: SharePointKnowledgeSource
  siteUrl: "https://contoso.sharepoint.com/sites/MySite/Shared%20Documents/Circle_of_fifths.docx"
  targetKind: File
```

### SharePoint — folder / library — `SharePointKnowledgeSource`, `targetKind: Folder`

```yaml
mcs.metadata:
  componentName: "Travel-Italy"
  description: "This knowledge source provides information found in the Travel-Italy SharePoint folder."
kind: KnowledgeSourceConfiguration
source:
  kind: SharePointKnowledgeSource
  siteUrl: "https://contoso.sharepoint.com/sites/MySite/Shared%20Documents/Travel-Italy"
  additionalSearchTerms:
  targetKind: Folder
```

- Include the (empty) `additionalSearchTerms:` line for folder sources.

### OneDrive — file — `SharePointKnowledgeSource`, `targetKind: File`

OneDrive for Business is a **personal SharePoint site**, so a OneDrive file uses the same
`SharePointKnowledgeSource` kind, with a `-my.sharepoint.*/personal/...` URL and
`targetKind: File`:

```yaml
mcs.metadata:
  componentName: "popular_guitar_brands.docx"
  description: "This knowledge source provides information found in popular_guitar_brands.docx."
kind: KnowledgeSourceConfiguration
source:
  kind: SharePointKnowledgeSource
  siteUrl: "https://contoso-my.sharepoint.com/personal/user_contoso_onmicrosoft_com/Documents/popular_guitar_brands.docx"
  targetKind: File
```

### Uploaded file — metadata-only sidecar (no `source:` block)

Copy the actual file into `capabilities/knowledge/files/`, then write a sidecar **next to it** that
contains **only** the `mcs.metadata` block (no `kind:`/`source:`):

```yaml
mcs.metadata:
  componentName: "electric-guitar-history.md"
  description: "This knowledge source searches information contained in electric-guitar-history.md"
```

- `componentName` — the file name with extension.
- Per Copilot Studio's
  [uploaded-document requirements](https://learn.microsoft.com/microsoft-copilot-studio/knowledge-add-file-upload#supported-document-types),
  supported extensions are `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.pdf`, `.txt`,
  `.md`, `.log`, `.html`, `.htm`, `.csv`, `.xml`, `.odt`, `.ods`, `.odp`, `.epub`, `.rtf`,
  `.pages`, `.key`, `.numbers`, `.json`, `.yml`, `.yaml`, and `.tex` (case-insensitive).
- Reject files larger than 512 MB, encrypted/password-protected files, images, video, executables,
  audio, and other unsupported types. PDFs should contain selectable text or annotated images.
- The source must be a regular file of a supported type. Do not copy directories or unsupported
  files, and do **not** create a sidecar for a file that is not physically present.
- Before copying, check whether the destination payload exists and scan sidecars for a matching
  `mcs.metadata.componentName`. Never overwrite either one without explicit confirmation.
- For an explicit replacement, preserve and update the one existing sidecar filename. If no matching
  sidecar exists or several match, stop rather than guessing. To keep both sources, choose a
  different destination payload name and use that exact name as `componentName`.

## `targetKind` — File vs Folder

- The URL ends in a document (`.docx`, `.pdf`, `.pptx`, `.xlsx`, `.txt`, …) → `targetKind: File`.
- The URL points at a folder or document library → `targetKind: Folder` (add `additionalSearchTerms:`).

## Filename conventions

- **Source-backed** (website / SharePoint / OneDrive):
  `capabilities/knowledge/<schemaName>.<slug>_<id>.mcs.yml`
  - `<schemaName>` — the agent's schema name from `settings.mcs.yml` (e.g. `crbab_guitarcoach_dcF_b3`).
  - `<slug>` — the `componentName` with non-alphanumeric/underscore characters removed
    (e.g. `popular_guitar_brands.docx` → `popular_guitar_brandsdocx`;
    `https://en.wikipedia.org/wiki/Electric_guitar` → `httpsenwikipediaorgwikiElectric_guitar`).
  - `<id>` — a 12-character alphanumeric suffix.
- **Uploaded file** sidecar: `capabilities/knowledge/files/<slug>_<id>.mcs.yml`
  - `<slug>` — the file name with non-alphanumeric characters removed
    (e.g. `electric-guitar-history.md` → `electricguitarhistorymd`).
- When **editing** an existing component, keep its existing filename and suffix.

### 100-character schema-name budget

Dataverse schema names must be at most 100 characters. Apply the limit before writing:

- Source-backed stem: `<schemaName>.<slug>_<id>`. Its slug budget is
  `100 - length(schemaName) - length(id) - 2` for the dot and underscore.
- Uploaded sidecar stem on disk: `<slug>_<id>`. PAC qualifies it as
  `<schemaName>.file.<slug>_<id>`, so its slug budget is
  `100 - length(schemaName) - length(".file.") - length(id) - 1`.
- Strip unsupported slug characters first, use `knowledge` if that produces an empty slug, then
  truncate the slug on the right to its budget. If the budget is less than one character, stop and
  report that the agent schema name leaves no valid component-name space.
- Confirm the resulting `*.mcs.yml` path does not exist. Generate a new 12-character id if it does.

Do not prefix an uploaded sidecar's on-disk stem with `<schemaName>`: PAC adds
`<schemaName>.file.` while compiling that folder.

## SharePoint / OneDrive URL normalization

Copilot Studio needs a direct path — not a browser UI URL. Normalize before writing:

Require an absolute HTTPS URL with no embedded username or password before applying these rules.

| URL pattern | Action |
|---|---|
| **Direct path** (`/sites/.../Shared%20Documents/...` or `/personal/.../Documents/...`) | **Use as-is** — already correct. |
| **`AllItems.aspx` with `?id=` param** | **Extract and decode** the `id` query parameter to get the path, then prepend the origin (`https://<host>`) to build the direct path. Drop all query params (`?id=`, `&viewid=`, etc.). |
| **Sharing link** (`/:f:/s/...`, `/:w:/...`, `/:x:/...`, `/:b:/...`) | **Cannot convert** — opaque token, no extractable path. Ask the user to open the item in SharePoint/OneDrive, copy the URL from the browser address bar, and paste it. |

**Encoding:** spaces in the final `siteUrl` must be `%20` (e.g. `Shared%20Documents`).

## Best practices

- **One source per content domain.** Prefer several narrow, well-described sources over one broad
  one; avoid overlapping sources — it degrades relevance ranking.
- **Descriptions matter.** The orchestrator reads each source's `description` to decide when to
  search it.
- **SharePoint / OneDrive permissions are enforced at runtime.** These sources use the **end user's**
  delegated permissions — each user must already have access to the file/library in SharePoint or
  OneDrive, or the agent returns nothing for them. (This is why a file can work for the author but
  appear empty for other users.)
- **Content quality.** Use documents with clear headings/titles, one topic each; avoid image-only or
  table-only files.
- **Test after adding.** Ask the agent a representative question and verify it retrieves and cites the
  new source.

## Optional: verifying a SharePoint/OneDrive link before adding

You can pre-check that a SharePoint/OneDrive link is valid and readable **without downloading the
file**, using a single Microsoft Graph call (`GET /shares/{id}/driveItem`). The `add-knowledge`
skill exposes this as an **opt-in** step backed by `scripts/verify-knowledge-access.bundle.js`.

- **What it proves:** the author can read the item (`200`), or Graph denied it (`403` — either no
  access *or* the link doesn't resolve; the `/shares` endpoint returns `403` for both, and rarely a
  `404`).
- **⚠️ It checks the author only.** Because knowledge is retrieved at runtime with **each end user's**
  delegated permissions, a positive result confirms *your* access — not that end users can read the
  item. Always pair it with the runtime-permissions note above.
- **Setup:** it reuses the per-agent Entra public-client app id saved by the `/chat` skill; that app
  registration must additionally have delegated Graph **`Files.ReadWrite`** consented. Microsoft
  [documents that permission](https://learn.microsoft.com/graph/api/shares-get?view=graph-rest-1.0#permissions)
  as the least-privileged delegated permission for `GET /shares`; the script only issues a `GET`,
  but the consent grants the app read/write access to files the signed-in user can access. State
  that impact before the user opts in. The `--client-id` must be an app **you own** in the tenant —
  a Microsoft **first-party/sample** app id fails with **`AADSTS65002`** (first-party apps can't get
  Graph tokens, and an id preauthorized for the Copilot Studio / Power Platform API is *not*
  authorized for Graph). It is best-effort — if it isn't configured, skip it and add the source
  anyway.
- **Token storage:** reuse the per-agent cache only when OS-backed encrypted persistence is
  available. If secure persistence cannot be initialized, the check uses an in-memory cache and
  writes no Graph credentials to disk.
- **National clouds:** SharePoint hosts in US Government, DoD, and China automatically select the
  corresponding Microsoft Graph and Entra authority hosts. Use `--cloud` only when automatic
  inference is insufficient.

## Limitations

Public Website, SharePoint, OneDrive, and uploaded files can be authored directly in YAML. Other
knowledge types require Power Platform setup in the Copilot Studio UI and must be re-cloned/pulled to
edit locally:

- Dataverse tables
- AI Search
- SQL Server
- Microsoft Graph connectors (registered in the M365 admin center)
