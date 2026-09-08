#!/usr/bin/env node
'use strict';

/*
 * add-skill.js - discover and download Agent Skills from the Power CAT
 * "Cat Agent Skills" gallery (github.com/microsoft/cat-agent-skills) so they can
 * be added to a Copilot Studio agent.
 *
 * Commands:
 *   list [--all] [--json]
 *     Enumerate gallery submissions and print the skills as JSON, sorted by
 *     display name. By default only skills whose metadata `platforms` include
 *     "Copilot Studio" are returned; pass --all to include every skill.
 *
 *   download --slug <slug> --dest <dir> [--json]
 *     Download one skill into <dir>. The unpacked payload (SKILL.md plus any
 *     scripts/, references/, assets/) is written to <dir>/<slug>/, and when the
 *     gallery publishes a prebuilt bundle for the skill, <dir>/<slug>.zip is
 *     saved too.
 *
 * Zero runtime dependencies: uses the Node >=18 global fetch and the standard
 * library only. Optional GITHUB_TOKEN / GH_TOKEN raises the api.github.com rate
 * limit for the single tree call.
 *
 * NOTE: importing the downloaded skill into a Copilot Studio agent workspace
 * (materializing it under behaviors/ and pushing with `pac copilot push`) is a
 * separate, out-of-scope step and is intentionally not performed here.
 */

const fs = require('fs');
const path = require('path');

const REPO = 'microsoft/cat-agent-skills';
const BRANCH = 'main';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const API_BASE = `https://api.github.com/repos/${REPO}`;
const PAGES_BASE = 'https://microsoft.github.io/cat-agent-skills';

// Sidecar files live next to the payload but are never part of the skill itself.
const SIDECARS = new Set(['metadata.json', 'metadata.yaml', 'metadata.yml', 'README.md']);
// Scaffolding folders in the gallery that are not real submissions.
const TEMPLATES = new Set(['_template', '_template-automation']);

function ghHeaders() {
  const headers = {
    'User-Agent': 'mcs-assistant-add-skill',
    Accept: 'application/vnd.github+json',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchText(url, headers) {
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchJson(url, headers) {
  return JSON.parse(await fetchText(url, headers));
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
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
  return files.filter((f) => !SIDECARS.has(topName(f)));
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
  try {
    return JSON.parse(await fetchText(`${RAW_BASE}/submissions/${slug}/metadata.json`));
  } catch {
    return null;
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

  skills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
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

  const skillDir = path.join(dest, slug);
  fs.mkdirSync(skillDir, { recursive: true });

  const saved = [];
  const meta = await readMetadata(slug);

  // Always write the unpacked payload (SKILL.md + scripts/references/assets).
  for (const rel of payloadFiles(files)) {
    const buf = await fetchBuffer(`${RAW_BASE}/submissions/${slug}/${rel}`);
    const target = path.join(skillDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
    saved.push(target);
  }

  // When the gallery publishes a prebuilt bundle, also save the .zip.
  let zipPath = null;
  if (info.hasBundle) {
    try {
      const buf = await fetchBuffer(`${PAGES_BASE}/bundles/${slug}.zip`);
      zipPath = path.join(dest, `${slug}.zip`);
      fs.writeFileSync(zipPath, buf);
      saved.push(zipPath);
    } catch (e) {
      // Non-fatal: the unpacked payload above is the source of truth.
      zipPath = null;
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
    process.stdout.write(JSON.stringify({ ok: true, count: skills.length, skills }, null, 2) + '\n');
    return;
  }

  if (cmd === 'download') {
    if (!args.slug) throw new Error('--slug <slug> is required for download.');
    const dest = path.resolve(typeof args.dest === 'string' ? args.dest : process.cwd());
    const result = await downloadSkill(args.slug, dest);
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
    return;
  }

  throw new Error(`Unknown command: ${cmd || '(none)'}. Use "list" or "download".`);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }) + '\n');
  // Signal failure via exit code rather than process.exit(): a forced exit while
  // fetch keep-alive sockets are still closing trips a libuv assertion on Windows.
  process.exitCode = 1;
});
