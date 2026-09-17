#!/usr/bin/env node
'use strict';

/*
 * add-skill.js - discover and download Agent Skills from the Power CAT
 * "Cat Agent Skills" gallery (github.com/microsoft/cat-agent-skills) so they can
 * be added to a Copilot Studio agent.
 *
 * Commands:
 *   list [--all] [--pretty] [--json]
 *     Enumerate gallery submissions and print the skills as JSON, sorted by
 *     display name. By default only skills whose metadata `platforms` include
 *     "Copilot Studio" are returned; pass --all to include every skill. Pass
 *     --pretty to render a plain, deterministic (fixed-width) box table instead
 *     of JSON.
 *
 *   download --slug <slug> [--dest <dir>] [--json]
 *     Download one skill into <dir>. When --dest is omitted the skill is saved
 *     to a temporary user folder (<os-tmp>/mcs-add-skill). The unpacked payload
 *     (SKILL.md plus any scripts/, references/, assets/) is written to
 *     <dir>/<slug>/, and when the gallery publishes a prebuilt bundle for the
 *     skill, <dir>/<slug>.zip is saved too.
 *
 *   import --src <dir> --workspace <agentDir> [--name <folder>] [--force]
 *          [--include-sidecars] [--no-sidecars] [--json]
 *     Materialize a downloaded skill folder into a cloned Copilot Studio agent
 *     workspace as a skill under <agentDir>/behaviors/<folder>/. The manifest is
 *     written as SKILL.md and every other payload file is copied verbatim
 *     (preserving scripts/ etc.). By default this also emits the portal-style
 *     .mcs.yml companions so the on-disk layout matches a Copilot Studio portal
 *     import: an anchor skill.mcs.yml (the InlineAgentSkill identity) plus one
 *     <file>.mcs.yml sidecar per non-manifest payload file for bundle skills.
 *     The schema prefix for every component is read from the workspace
 *     settings.mcs.yml `schemaName`; when it cannot be determined (or with
 *     --no-sidecars) a bare behaviors/ skill is written instead and the VS Code
 *     Copilot Studio extension synthesizes the companions on the next read / pull.
 *     Pushing to the cloud is done from the extension afterwards.
 *
 * Zero runtime dependencies: uses the Node >=18 global fetch and the standard
 * library only. Optional GITHUB_TOKEN / GH_TOKEN raises the api.github.com rate
 * limit for the single tree call.
 *
 * The component shapes this script emits are documented in
 * reference/skill-schema.md. Keep the two in sync: that file is what the
 * /add-skill command and the copilot-studio-architect agent read.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const REPO = 'microsoft/cat-agent-skills';
const BRANCH = 'main';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const API_BASE = `https://api.github.com/repos/${REPO}`;
const PAGES_BASE = 'https://microsoft.github.io/cat-agent-skills';

// Sidecar files live next to the payload but are never part of the skill itself.
// Matched case-insensitively: the gallery and local uploads spell these both ways.
const SIDECARS = new Set(['metadata.json', 'metadata.yaml', 'metadata.yml', 'readme.md']);

function isSidecarLeaf(leaf) {
  return SIDECARS.has(String(leaf || '').toLowerCase());
}
// Scaffolding folders in the gallery that are not real submissions.
const TEMPLATES = new Set(['_template', '_template-automation']);

// The manifest the extension keys on to recognize a folder as a skill. It must
// be written with this exact name/casing (SkillLayout.ManifestFileName).
const MANIFEST_NAME = 'SKILL.md';
// The folder skills live under in a cloned agent workspace (LspProjection.BehaviorsFolder).
const BEHAVIORS_DIR = 'behaviors';
// The workspace layout marker + settings file a cloned CLI agent carries; bare
// skill folders are only synthesized in that layout (AgentClassifier.WorkspaceLayoutMarkerFileName).
const LAYOUT_MARKER = 'agent.sync.yaml';
const SETTINGS_FILE = 'settings.mcs.yml';
// Portal-style companions the extension normally synthesizes on pull; import can
// emit them directly so the on-disk layout matches a Copilot Studio portal import.
// The per-skill "anchor" carries the InlineAgentSkill identity; each bundle
// payload file gets a "<file>.mcs.yml" sidecar next to it.
const SKILL_ANCHOR = 'skill.mcs.yml';
const MCS_SIDECAR_SUFFIX = '.mcs.yml';
// Dataverse caps a schema name at 100 characters. See reference/skill-schema.md.
const SCHEMA_NAME_MAX = 100;
// Windows reserved device names — unusable as a folder name there.
const RESERVED_DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

function ghHeaders() {
  const headers = {
    'User-Agent': 'mcs-assistant-add-skill',
    Accept: 'application/vnd.github+json',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function httpError(url, res) {
  const err = new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  err.status = res.status;
  return err;
}

async function fetchText(url, headers) {
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) throw httpError(url, res);
  return res.text();
}

async function fetchJson(url, headers) {
  return JSON.parse(await fetchText(url, headers));
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw httpError(url, res);
  return Buffer.from(await res.arrayBuffer());
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value));
}

function submissionUrl(slug, relativePath) {
  const encodedPath = String(relativePath)
    .split('/')
    .map(encodePathSegment)
    .join('/');
  return `${RAW_BASE}/submissions/${encodePathSegment(slug)}/${encodedPath}`;
}

function bundleUrl(slug) {
  return `${PAGES_BASE}/bundles/${encodePathSegment(slug)}.zip`;
}

// Bounded-concurrency map so `list` does not open ~100 sockets at once.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

// One recursive tree call returns every path in the repo; group blobs by slug.
async function getSubmissions() {
  const data = await fetchJson(`${API_BASE}/git/trees/${BRANCH}?recursive=1`, ghHeaders());
  if (data.truncated) {
    throw new Error('GitHub tree response was truncated; cannot enumerate submissions reliably.');
  }
  const map = new Map(); // slug -> string[] (paths relative to submissions/<slug>/)
  for (const entry of data.tree) {
    if (entry.type !== 'blob') continue;
    const m = entry.path.match(/^submissions\/([^/]+)\/(.+)$/);
    if (!m) continue;
    const [, slug, rel] = m;
    if (TEMPLATES.has(slug)) continue;
    if (!map.has(slug)) map.set(slug, []);
    map.get(slug).push(rel);
  }
  return map;
}

function topName(rel) {
  return rel.split('/')[0];
}

function isSkillFile(rel) {
  return rel === 'SKILL.md' || rel === 'skill.md';
}

// Files that make up the downloadable skill (everything except sidecars).
function payloadFiles(files) {
  return files.filter((f) => !isSidecarLeaf(topName(f)));
}

function classify(files) {
  const top = files.filter((f) => !f.includes('/'));
  const hasSkill = files.some(isSkillFile);
  const hasLegacyZip = top.some((f) => f.toLowerCase().endsWith('.zip'));
  const hasRootJson = top.some((f) => f.toLowerCase().endsWith('.json') && !/^metadata\.json$/i.test(f));

  let type = 'unknown';
  if (hasSkill) type = 'skill';
  else if (hasLegacyZip) type = 'legacy-zip';
  else if (hasRootJson) type = 'automation';

  // A skill "has a bundle" when it ships payload files beyond SKILL.md.
  const extras = payloadFiles(files).filter((f) => !isSkillFile(f));
  return { type, hasBundle: extras.length > 0 };
}

async function readMetadata(slug) {
  let text;
  try {
    text = await fetchText(submissionUrl(slug, 'metadata.json'));
  } catch (e) {
    // A missing metadata.json simply means "not a listable skill". Any other
    // failure (rate limit, outage) must surface instead of silently shrinking
    // the gallery listing to whatever happened to succeed.
    if (e && e.status === 404) return null;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Invalid metadata.json for gallery skill "${slug}": ${e && e.message ? e.message : String(e)}`,
      { cause: e });
  }
}

async function listSkills({ all } = {}) {
  const submissions = await getSubmissions();
  const slugs = [...submissions.keys()];

  const rows = await mapLimit(slugs, 8, async (slug) => {
    const info = classify(submissions.get(slug));
    const meta = info.type === 'skill' ? await readMetadata(slug) : null;
    return { slug, info, meta };
  });

  let skills = rows
    .filter((r) => r.info.type === 'skill' && r.meta)
    .map((r) => ({
      slug: r.slug,
      name: r.meta.name || r.slug,
      description: r.meta.description || '',
      platforms: Array.isArray(r.meta.platforms) ? r.meta.platforms : [],
      tags: Array.isArray(r.meta.tags) ? r.meta.tags : [],
      hasBundle: r.info.hasBundle,
    }));

  if (!all) {
    skills = skills.filter((s) => s.platforms.some((p) => /copilot studio/i.test(p)));
  }

  // Deterministic ordering: case-insensitive by name using code-point order
  // (locale-independent, unlike localeCompare) with slug as a stable tiebreaker,
  // so the same gallery data always lists in exactly the same sequence.
  skills.sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  return skills;
}

async function downloadSkill(slug, dest) {
  const submissions = await getSubmissions();
  if (!submissions.has(slug)) {
    throw new Error(`Skill not found in gallery: "${slug}"`);
  }
  const files = submissions.get(slug);
  const info = classify(files);
  if (info.type !== 'skill') {
    throw new Error(`"${slug}" is a ${info.type} entry, not an unpacked Agent Skill; cannot add it to a Copilot Studio agent.`);
  }

  const skillDir = path.resolve(dest, slug);
  const destRoot = path.resolve(dest);
  if (skillDir !== destRoot && !skillDir.startsWith(destRoot + path.sep)) {
    throw new Error(`Refusing to download "${slug}": it does not resolve to a folder inside ${destRoot}.`);
  }
  const bundleFile = path.resolve(dest, `${slug}.zip`);
  if (bundleFile !== destRoot && !bundleFile.startsWith(destRoot + path.sep)) {
    throw new Error(`Refusing to download "${slug}": its bundle does not resolve inside ${destRoot}.`);
  }
  // A download reflects the gallery as it is now, so clear any earlier copy first:
  // otherwise files deleted upstream (or left behind by a half-finished run) linger
  // and get imported as if they were still part of the skill.
  fs.rmSync(skillDir, { recursive: true, force: true });
  fs.rmSync(bundleFile, { force: true });
  fs.mkdirSync(skillDir, { recursive: true });

  const saved = [];
  const meta = await readMetadata(slug);

  // Always write the unpacked payload (SKILL.md + scripts/references/assets).
  for (const rel of payloadFiles(files)) {
    const buf = await fetchBuffer(submissionUrl(slug, rel));
    const target = path.join(skillDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
    saved.push(target);
  }

  // When the gallery publishes a prebuilt bundle, also save the .zip.
  let zipPath = null;
  if (info.hasBundle) {
    try {
      const buf = await fetchBuffer(bundleUrl(slug));
      zipPath = bundleFile;
      fs.writeFileSync(zipPath, buf);
      saved.push(zipPath);
    } catch (e) {
      // A 404 means this gallery entry has no prebuilt archive; the unpacked
      // payload remains the source of truth. Other failures are transient or
      // operational and must not be reported as a successful full download.
      if (e && e.status === 404) {
        zipPath = null;
      } else {
        throw e;
      }
    }
  }

  return {
    slug,
    name: meta && meta.name ? meta.name : slug,
    hasBundle: info.hasBundle,
    dir: skillDir,
    zip: zipPath,
    files: saved,
  };
}

// Recursively list files under `dir`, returning POSIX-style paths relative to it.
function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
  return out;
}

// Turn an arbitrary name into a single, filesystem- and schema-safe folder
// segment. The extension derives the skill's displayName and its
// `<bot>.skill.<segment>` schema name from this folder, so keep it to the
// Dataverse-friendly kebab set and well under the 100-char schema cap.
function sanitizeFolderName(name) {
  let s = String(name || '')
    .replace(/[\\/]+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (s.length === 0) s = 'skill';
  if (RESERVED_DEVICE_NAMES.has(s.toLowerCase())) s = `skill-${s}`;
  if (s.length > 60) s = s.slice(0, 60).replace(/[-.]+$/g, '');
  return s;
}

function isManifestLeaf(rel) {
  return rel.indexOf('/') < 0 && rel.toLowerCase() === MANIFEST_NAME.toLowerCase();
}

// --- Portal-style .mcs.yml companion emission -------------------------------

// Base62 uniqueness token that trails a Dataverse schema name
// (<prefix>.<type>.<segment>_<token>). Length is cosmetic — observed portal
// output uses ~3 chars for skills and ~5 for files — so we mirror that for
// parity; only validity and uniqueness actually matter.
const SCHEMA_TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function schemaToken(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += SCHEMA_TOKEN_ALPHABET[bytes[i] % SCHEMA_TOKEN_ALPHABET.length];
  return out;
}

// The <segment> of a file component's schema name: lowercase, alphanumerics only
// (SKILL.md -> skillmd, template.docx -> templatedocx, redline.py -> redlinepy).
function fileSchemaSegment(fileName) {
  return String(fileName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// A component schema name is `<prefix>.<infix>.<segment>_<token>`, so the segment
// gets whatever the 100-char Dataverse cap leaves after the prefix, the infix, the
// token, and the 3 separators (two dots, one underscore).
function schemaSegmentBudget(prefix, infix, tokenLen) {
  return SCHEMA_NAME_MAX - String(prefix || '').length - infix.length - tokenLen - 3;
}

// The two component shapes a skill import emits. A prefix that leaves no room for
// either one is fatal — better to stop than to write a schema name Dataverse rejects.
const SCHEMA_SHAPES = [
  { infix: 'skill', tokenLen: 3, label: 'the skill anchor' },
  { infix: 'file', tokenLen: 5, label: 'skill payload files' },
];

function assertSchemaBudget(prefix) {
  for (const { infix, tokenLen, label } of SCHEMA_SHAPES) {
    if (schemaSegmentBudget(prefix, infix, tokenLen) < 1) {
      throw new Error(
        `The agent schema name "${prefix}" leaves no valid component-name space for ${label} under the ${SCHEMA_NAME_MAX}-character Dataverse limit.`);
    }
  }
}

// Truncate a schema segment on the right to its budget, warning when it happens so
// the caller can tell the user the on-disk name and the schema name diverged.
function fitSchemaSegment(segment, { prefix, infix, tokenLen, label, warnings }) {
  const budget = schemaSegmentBudget(prefix, infix, tokenLen);
  const seg = String(segment || '');
  if (seg.length <= budget) return seg;
  const cut = seg.slice(0, budget);
  warnings.push(
    `Schema name for ${label} was truncated to fit the ${SCHEMA_NAME_MAX}-character Dataverse limit ("${seg}" -> "${cut}").`);
  return cut;
}

// A Dataverse schema name is a publisher prefix plus an alphanumeric/underscore
// name. Anything else (quotes left in, a stray comment, a sentence) cannot anchor
// a component name, so we treat it as "no prefix" rather than emit it verbatim.
const SCHEMA_PREFIX_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

// Resolve a single-line YAML scalar the way a parser would: honour quoting, and
// drop a trailing `#` comment on plain scalars. Used for the values this script
// scrapes out of settings.mcs.yml and SKILL.md frontmatter without a full parse.
function plainYamlValue(rawValue) {
  const v = String(rawValue == null ? '' : rawValue).trim();
  if (v[0] === '"') {
    const m = v.match(/^"((?:[^"\\]|\\.)*)"/);
    return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '';
  }
  if (v[0] === "'") {
    const m = v.match(/^'((?:[^']|'')*)'/);
    return m ? m[1].replace(/''/g, "'") : '';
  }
  const comment = v.match(/(?:^|\s)#/);
  return (comment ? v.slice(0, comment.index) : v).trim();
}

// The extension mints component segments from ASCII letters and digits only
// (SkillLayout.MintBundleSchemaName), so the folder name has to be reduced the
// same way. Without this, a folder like "foo.bar" would smuggle an extra dot into
// `<prefix>.skill.<segment>` and produce a four-segment schema name.
function skillSchemaSegment(folder) {
  const seg = String(folder || '').replace(/[^A-Za-z0-9]+/g, '');
  return seg.length === 0 ? 'skill' : seg;
}

// The agent schemaName is the prefix every component hangs off; read it from the
// workspace settings file. Returns null when it cannot be determined, or when the
// value is not a usable Dataverse prefix — a prefix we cannot trust would produce
// component names Dataverse rejects.
function readAgentSchemaPrefix(wsDir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(wsDir, SETTINGS_FILE), 'utf8');
  } catch {
    return null;
  }
  const m = raw.replace(/^\uFEFF/, '').match(/^schemaName:[ \t]*(.*)$/m);
  if (!m) return null;
  const value = plainYamlValue(m[1]);
  return SCHEMA_PREFIX_RE.test(value) ? value : null;
}

// Pull the `description` from the SKILL.md YAML frontmatter (single-line scalar).
// Returns '' when there is no frontmatter or no description key.
function readManifestDescription(manifestAbs) {
  let raw;
  try {
    raw = fs.readFileSync(manifestAbs, 'utf8');
  } catch {
    return '';
  }
  raw = raw.replace(/^\uFEFF/, '');
  const fm = raw.match(/^---[^\n]*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!fm) return '';
  const m = fm[1].match(/^description:[ \t]*(.*)$/m);
  if (!m) return '';
  return plainYamlValue(m[1]);
}

// Plain scalars a YAML 1.1 parser (what the Copilot Studio tooling reads these
// files with) resolves to something other than a string. Names like "on", "123",
// or "null" must be quoted or they come back as a boolean, a number, or null.
const YAML11_BOOL = /^(y|n|yes|no|true|false|on|off)$/i;
const YAML11_NULL = /^(~|null)$/i;
const YAML11_NUMBER =
  /^[-+]?(0x[0-9a-f_]+|0o?[0-7_]+|[0-9][0-9_]*(\.[0-9_]*)?([eE][-+]?[0-9]+)?|\.[0-9_]+([eE][-+]?[0-9]+)?|\.(inf|nan))$/i;
// Sexagesimals ("1:30") are integers in YAML 1.1.
const YAML11_SEXAGESIMAL = /^[-+]?[0-9][0-9_]*(:[0-5]?[0-9])+(\.[0-9_]*)?$/;

// Emit a YAML scalar the way the portal does: a plain scalar when unambiguous,
// otherwise a double-quoted scalar. Byte-compatible with portal-authored anchors
// for typical descriptions, while staying safe for values with YAML indicators.
function yamlScalar(value) {
  const s = String(value == null ? '' : value);
  const needsQuote =
    s.length === 0 ||
    /^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s) ||
    /:\s/.test(s) ||
    /\s#/.test(s) ||
    /:$/.test(s) ||
    /\s$/.test(s) ||
    /[\n\r\t]/.test(s) ||
    YAML11_BOOL.test(s) ||
    YAML11_NULL.test(s) ||
    YAML11_NUMBER.test(s) ||
    YAML11_SEXAGESIMAL.test(s);
  if (!needsQuote) return s;
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

// Write the portal-style companions for an already-materialized behaviors/<folder>/
// skill: the anchor skill.mcs.yml, plus one <file>.mcs.yml sidecar per non-manifest
// payload file (bundle skills only). `payloadRel` are POSIX-relative paths under the
// skill folder, excluding the manifest. Returns the list of companion paths written
// (relative to the workspace, POSIX-style).
function writeMcsCompanions({ behaviorsDir, folder, prefix, description, payloadRel, warnings }) {
  const isBundle = payloadRel.length > 0;
  const written = [];

  const anchorLines = ['mcs.metadata:', `  componentName: ${yamlScalar(folder)}`];
  if (description) anchorLines.push(`  description: ${yamlScalar(description)}`);
  const skillSeg = fitSchemaSegment(skillSchemaSegment(folder), {
    prefix, infix: 'skill', tokenLen: 3, label: `the skill anchor "${folder}"`, warnings,
  });
  anchorLines.push(`  schemaName: ${prefix}.skill.${skillSeg}_${schemaToken(3)}`);
  if (isBundle) {
    const bundleSeg = fitSchemaSegment(fileSchemaSegment(`${folder}.zip`), {
      prefix, infix: 'file', tokenLen: 5, label: `the "${folder}" bundle`, warnings,
    });
    const manifestSeg = fitSchemaSegment(fileSchemaSegment(MANIFEST_NAME), {
      prefix, infix: 'file', tokenLen: 5, label: `the ${MANIFEST_NAME} manifest`, warnings,
    });
    anchorLines.push(`  bundle: ${prefix}.file.${bundleSeg}_${schemaToken(5)}`);
    anchorLines.push(`  manifestSchemaName: ${prefix}.file.${manifestSeg}_${schemaToken(5)}`);
  }
  anchorLines.push('kind: InlineAgentSkill');
  anchorLines.push('authoringSource: Upload');
  // The portal writes the anchor without a trailing newline; sidecars keep theirs.
  fs.writeFileSync(path.join(behaviorsDir, SKILL_ANCHOR), anchorLines.join('\n'));
  written.push(`${BEHAVIORS_DIR}/${folder}/${SKILL_ANCHOR}`);

  if (isBundle) {
    for (const rel of payloadRel) {
      const leaf = rel.split('/').pop();
      const fileSeg = fitSchemaSegment(fileSchemaSegment(leaf), {
        prefix, infix: 'file', tokenLen: 5, label: `payload file "${rel}"`, warnings,
      });
      const lines = [
        'mcs.metadata:',
        `  componentName: ${yamlScalar(`./${rel}`)}`,
        `  schemaName: ${prefix}.file.${fileSeg}_${schemaToken(5)}`,
      ];
      fs.writeFileSync(path.join(behaviorsDir, rel) + MCS_SIDECAR_SUFFIX, lines.join('\n') + '\n');
      written.push(`${BEHAVIORS_DIR}/${folder}/${rel}${MCS_SIDECAR_SUFFIX}`);
    }
  }
  return written;
}

// Materialize a downloaded skill folder as a bare behaviors/<folder>/ skill in a
// cloned agent workspace. Writes SKILL.md + every payload file verbatim; the
// extension synthesizes the InlineAgentSkill component (and parents every file
// to it) on the next workspace read / sync.
function importSkill({ src, workspace, name, force, includeSidecars, noSidecars }) {
  const srcDir = path.resolve(src);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    throw new Error(`--src is not a directory: ${srcDir}`);
  }
  const wsDir = path.resolve(workspace);
  if (!fs.existsSync(wsDir) || !fs.statSync(wsDir).isDirectory()) {
    throw new Error(`--workspace is not a directory: ${wsDir}`);
  }

  const allFiles = walkFiles(srcDir);
  const manifestRel = allFiles.find(isManifestLeaf);
  if (!manifestRel) {
    throw new Error(`No ${MANIFEST_NAME} found at the top of ${srcDir}; this folder is not an importable skill.`);
  }

  // Non-fatal environment checks — surface them so the user knows why a synced
  // skill might not appear if the target is not a cloned CLI agent.
  const warnings = [];
  if (!fs.existsSync(path.join(wsDir, SETTINGS_FILE))) {
    warnings.push(`Workspace has no ${SETTINGS_FILE}; it does not look like a cloned agent. Clone/attach an agent here first, or the skill will not be picked up.`);
  }
  if (!fs.existsSync(path.join(wsDir, LAYOUT_MARKER))) {
    warnings.push(`Workspace has no ${LAYOUT_MARKER} layout marker; bare ${BEHAVIORS_DIR}/ skills are only synthesized in code-first (CLI) agent workspaces.`);
  } else {
    try {
      const settings = fs.readFileSync(path.join(wsDir, SETTINGS_FILE), 'utf8');
      if (!/CLICopilotRecognizer|cliagent/i.test(settings)) {
        warnings.push(`${SETTINGS_FILE} does not look like a code-first (CLI) agent; InlineAgentSkill is only supported on Copilot Studio CLI agents.`);
      }
    } catch {
      /* best-effort */
    }
  }

  const folder = sanitizeFolderName(name || path.basename(srcDir));
  const behaviorsDir = path.join(wsDir, BEHAVIORS_DIR, folder);

  // The agent schema prefix decides how much room a component name has under the
  // Dataverse cap. Resolve and validate it before materializing anything, so an
  // unusable prefix fails fast instead of leaving a half-written skill behind.
  const schemaPrefix = noSidecars ? null : readAgentSchemaPrefix(wsDir);
  if (schemaPrefix) assertSchemaBudget(schemaPrefix);

  if (fs.existsSync(behaviorsDir)) {
    if (!force) {
      throw new Error(`${BEHAVIORS_DIR}/${folder} already exists in the workspace. Pass --force to overwrite, or choose another --name.`);
    }
    fs.rmSync(behaviorsDir, { recursive: true, force: true });
  }

  const written = [];
  const skippedBundleZips = [];
  let extraManifestSkipped = false;
  for (const rel of allFiles) {
    const leaf = rel.split('/').pop();
    if (!includeSidecars && rel.indexOf('/') < 0 && isSidecarLeaf(leaf)) continue;
    // The extension mints this skill's bundle as "<folder>.zip", so a root-level
    // source file with that exact name would collide with it. Every other archive
    // is ordinary payload and is copied verbatim.
    if (rel.indexOf('/') < 0 && leaf.toLowerCase() === `${folder.toLowerCase()}.zip`) {
      skippedBundleZips.push(rel);
      continue;
    }
    // MCS companions are (re)generated below, never copied from the source.
    if (leaf.toLowerCase().endsWith(MCS_SIDECAR_SUFFIX)) continue;
    // The manifest must land as exactly SKILL.md; skip any duplicate-cased root manifest.
    let destRel = rel;
    if (isManifestLeaf(rel)) {
      if (rel === manifestRel) destRel = MANIFEST_NAME;
      else { extraManifestSkipped = true; continue; }
    }
    const target = path.join(behaviorsDir, destRel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(srcDir, rel), target);
    written.push(`${BEHAVIORS_DIR}/${folder}/${destRel.split(path.sep).join('/')}`);
  }
  if (extraManifestSkipped) {
    warnings.push(`Multiple root manifest files found; kept "${manifestRel}" as ${MANIFEST_NAME} and skipped the other.`);
  }
  for (const rel of skippedBundleZips) {
    warnings.push(`Skipped "${rel}": it collides with the bundle archive the extension mints for "${folder}". Rename it (or move it into a subfolder) to ship it as payload.`);
  }

  // Emit portal-style .mcs.yml companions so the on-disk layout matches a Copilot
  // Studio portal import. Requires the agent schema prefix from settings.mcs.yml;
  // without it (or with --no-sidecars) we leave a bare behaviors/ skill for the
  // extension to synthesize on pull.
  let companions = [];
  if (!noSidecars) {
    if (!schemaPrefix) {
      warnings.push(`Could not read a usable agent schemaName from ${SETTINGS_FILE}; wrote a bare ${BEHAVIORS_DIR}/ skill without .mcs.yml companions (the extension will synthesize them on pull).`);
    } else {
      const prefixLen = `${BEHAVIORS_DIR}/${folder}/`.length;
      const payloadRel = written
        .map((w) => w.slice(prefixLen))
        .filter((rel) => rel.toLowerCase() !== MANIFEST_NAME.toLowerCase());
      const description = readManifestDescription(path.join(behaviorsDir, MANIFEST_NAME));
      companions = writeMcsCompanions({ behaviorsDir, folder, prefix: schemaPrefix, description, payloadRel, warnings });
    }
  }

  return {
    folder,
    workspace: wsDir,
    behaviorsDir,
    manifest: `${BEHAVIORS_DIR}/${folder}/${MANIFEST_NAME}`,
    files: written.sort(),
    companions: companions.sort(),
    schemaPrefix,
    warnings,
    next: [
      `Open the agent workspace in VS Code (Copilot Studio extension) to see "${folder}" under Skills.`,
      'Use the Agent Changes view (or sync push) to publish the new skill to the cloud.',
    ],
  };
}

// --- Pretty gallery rendering ----------------------------------------------
// `list --pretty` prints a plain box table instead of JSON so the gallery is
// easy to browse in the terminal. Output is deterministic (fixed width) and
// includes a `Slug` column so the exact download slug sits next to each row.

// Fixed render width so the table is byte-for-byte identical every run,
// independent of the terminal size. Column widths derive only from this and the
// (deterministic) gallery data, never from process.stdout.columns.
const PRETTY_WIDTH = 120;

// Collapse whitespace, truncate with an ellipsis, and pad to an exact width.
function fitCell(text, width, align) {
  let s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (s.length > width) s = width <= 1 ? '…' : s.slice(0, width - 1).replace(/\s+$/, '') + '…';
  const pad = ' '.repeat(Math.max(0, width - s.length));
  return align === 'right' ? pad + s : s + pad;
}

function renderPrettyList(skills, { width = PRETTY_WIDTH, all = false } = {}) {
  const term = Math.max(72, Math.min(width, 200));
  const wNum = Math.max(2, String(skills.length).length);
  const wBundle = 1;
  const wName = 28;
  // Slugs are the exact key used for `download --slug`, so never truncate them:
  // size the column to the longest slug and let Description flex (down to its
  // floor, after which the table simply renders wider than the nominal width).
  const maxSlug = skills.reduce((m, s) => Math.max(m, String(s.slug || '').length), 0);
  const wSlug = Math.max(8, maxSlug);
  // Each column renders as "│ <cell> " (1 border + 2 spaces = 3 chars) and the
  // row ends with a trailing "│": 5 columns => 5*3 + 1 = 16 chars of chrome.
  const chrome = 5 * 3 + 1;
  const wDesc = Math.max(14, term - (wNum + wBundle + wName + wSlug + chrome));

  const widths = [wNum, wBundle, wName, wDesc, wSlug];
  const rule = (l, m, r) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  const cell = (text, w, align) => ` ${fitCell(text, w, align)} `;

  const out = [];
  out.push(rule('┌', '┬', '┐'));
  out.push(
    '│' + cell('#', wNum, 'right') +
    '│' + cell('◆', wBundle, 'left') +
    '│' + cell('Name', wName, 'left') +
    '│' + cell('Description', wDesc, 'left') +
    '│' + cell('Slug', wSlug, 'left') + '│');
  out.push(rule('├', '┼', '┤'));
  skills.forEach((s, i) => {
    out.push(
      '│' + cell(String(i + 1), wNum, 'right') +
      '│' + cell(s.hasBundle ? '◆' : ' ', wBundle, 'left') +
      '│' + cell(s.name || s.slug, wName, 'left') +
      '│' + cell(s.description, wDesc, 'left') +
      '│' + cell(s.slug, wSlug, 'left') + '│');
  });
  out.push(rule('└', '┴', '┘'));

  const heading = `Cat Agent Skills  ${skills.length} skills${all ? '' : ' for Copilot Studio'}`;
  const legend = '◆ = bundle (ships scripts / references / assets) · others are a single SKILL.md';

  return `\n${heading}\n\n${out.join('\n')}\n\n${legend}`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd === 'list') {
    const skills = await listSkills({ all: !!args.all });
    if (args.pretty) {
      process.stdout.write(renderPrettyList(skills, { all: !!args.all }) + '\n');
      return;
    }
    process.stdout.write(JSON.stringify({ ok: true, count: skills.length, skills }, null, 2) + '\n');
    return;
  }

  if (cmd === 'download') {
    if (!args.slug) throw new Error('--slug <slug> is required for download.');
    // Default to a temporary user folder so gallery downloads don't clutter the
    // working directory; the returned `dir` is used as --src for import.
    const dest = path.resolve(
      typeof args.dest === 'string' ? args.dest : path.join(os.tmpdir(), 'mcs-add-skill'));
    const result = await downloadSkill(args.slug, dest);
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
    return;
  }

  if (cmd === 'import') {
    if (typeof args.src !== 'string') throw new Error('--src <dir> is required for import.');
    if (typeof args.workspace !== 'string') throw new Error('--workspace <agentDir> is required for import.');
    const result = importSkill({
      src: args.src,
      workspace: args.workspace,
      name: typeof args.name === 'string' ? args.name : undefined,
      force: !!args.force,
      includeSidecars: !!args['include-sidecars'],
      noSidecars: !!args['no-sidecars'],
    });
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
    return;
  }

  throw new Error(`Unknown command: ${cmd || '(none)'}. Use "list", "download" or "import".`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }) + '\n');
    // Signal failure via exit code rather than process.exit(): a forced exit while
    // fetch keep-alive sockets are still closing trips a libuv assertion on Windows.
    process.exitCode = 1;
  });
}

module.exports = {
  SCHEMA_NAME_MAX,
  downloadSkill,
  importSkill,
  listSkills,
  readAgentSchemaPrefix,
  renderPrettyList,
  yamlScalar,
};
