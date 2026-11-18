import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const registry = JSON.parse(read('docs/capabilities/registry.json'));
const errors = [];
const files = new Set(), ids = new Set(), owners = new Map();
const index = read('SYSTEM_CAPABILITIES.md');
const modules = fs.readdirSync(path.join(root, 'backend/src/modules'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
for (const d of registry.domains) {
  if (ids.has(d.id) || files.has(d.file)) errors.push(`Duplicate domain/file: ${d.id}`);
  ids.add(d.id); files.add(d.file);
  if (!fs.existsSync(path.join(root, d.file))) { errors.push(`Missing file: ${d.file}`); continue; }
  if (!index.includes(`](${d.file})`)) errors.push(`Not linked from index: ${d.file}`);
  const text = read(d.file);
  if (!text.includes('](SYSTEM_CAPABILITIES.md)') || !text.includes('](docs/capabilities/README.md)')) errors.push(`Missing navigation: ${d.file}`);
  const anchors = [...text.matchAll(/<a id="([^"]+)"/g)].map(m => m[1]);
  if (new Set(anchors).size !== anchors.length) errors.push(`Duplicate explicit anchors: ${d.file}`);
  for (const m of d.modules) {
    if (owners.has(m)) errors.push(`Multiple owners: ${m}`);
    if (!modules.includes(m)) errors.push(`Unknown module: ${m}`);
    owners.set(m, d.file);
  }
}
for (const m of modules) if (!owners.has(m)) errors.push(`Module without documentation owner: ${m}`);
for (const f of fs.readdirSync(root).filter(f => f.endsWith('_CAPABILITIES.md') && f !== 'SYSTEM_CAPABILITIES.md')) if (!files.has(f)) errors.push(`Unregistered capability document: ${f}`);
const manifest = JSON.parse(read('docs/capabilities/migration-manifest.json'));
for (const entry of manifest.sections) {
  if (!files.has(entry.file)) errors.push(`Unknown migration destination: ${entry.file}`);
  else if (!read(entry.file).includes(`<a id="${entry.id}"></a>`)) errors.push(`Missing migration anchor: ${entry.id}`);
}

const reviewRegister = JSON.parse(read('docs/reviews/module-review-status.json'));
const allowedStates = new Set(['unverified_current_head', 'verified_scoped', 'release_blocked', 'release_ready']);
const moduleNames = new Set(modules);
const registerModules = new Set();
if (reviewRegister.schema_version !== 1 || !/^[a-f0-9]{40}$/.test(reviewRegister.baseline_code_commit || '')) errors.push('Bad review register schema or baseline SHA');
if (!Array.isArray(reviewRegister.modules)) errors.push('Review register modules must be an array');
else for (const r of reviewRegister.modules) {
  if (!r || typeof r.module !== 'string') { errors.push('Invalid review register entry'); continue; }
  if (registerModules.has(r.module)) errors.push('Duplicate review register module: ' + r.module);
  registerModules.add(r.module);
  if (!moduleNames.has(r.module)) errors.push('Unknown review register module: ' + r.module);
  if (owners.get(r.module) !== r.owner) errors.push('Mismatched review owner for ' + r.module);
  if (!allowedStates.has(r.state)) errors.push('Unknown review state: ' + r.module);
  if (!Array.isArray(r.verified_scope) || !Array.isArray(r.test_evidence) || !Array.isArray(r.blockers) || !Array.isArray(r.blocker_sources)) errors.push('Invalid evidence fields: ' + r.module);
  if (r.last_verified_commit !== null && !/^[a-f0-9]{40}$/.test(r.last_verified_commit || '')) errors.push('Invalid verified SHA for ' + r.module);
  if (['verified_scoped', 'release_ready'].includes(r.state) && (!r.last_verified_commit || !/^\d{4}-\d{2}-\d{2}$/.test(r.verified_at || '') || !r.verified_scope?.length || !r.test_evidence?.length)) errors.push('Missing actual verification evidence for ' + r.module);
  if (r.state === 'release_ready' && r.blockers?.length) errors.push('Release-ready with blockers: ' + r.module);
  if (r.state === 'release_blocked' && (!r.blockers?.length || !r.blocker_sources?.length)) errors.push('Release-blocked without cited blockers: ' + r.module);
}
for (const m of modules) if (!registerModules.has(m)) errors.push('Module missing from review register: ' + m);
// Validate navigational links in actively maintained architecture entrypoints.
// Historical capabilities/roadmap bodies intentionally retain older unverified references.
const navDocs = [
  'SYSTEM_CAPABILITIES.md', 'SYSTEM_MODES_AND_TIERS_MATRIX.md',
  'docs/capabilities/README.md', 'docs/reviews/README.md',
  'docs/README.md'
];
for (const doc of navDocs) {
  const contents = read(doc);
  if (/file:\/\/|file:\\\/|\]\([A-Za-z]:[\\/]/.test(contents)) errors.push('Machine-local link in ' + doc);
  const links = [...contents.matchAll(/!?\[[^\]\n]+\]\(([^)\s]+)\)/g)];
  for (const [, url] of links) {
    if (/^(https?:|mailto:|#)/i.test(url)) continue;
    if (/^[a-z]+:/i.test(url)) { errors.push('Unexpected URI scheme ' + url + ' in ' + doc); continue; }
    const target = decodeURIComponent(url.split(/[?#]/)[0]);
    if (!target) continue;
    const dest = path.resolve(root, path.dirname(doc), target);
    if (!dest.startsWith(root + path.sep) && dest !== root) errors.push('Link escapes repository in ' + doc + ': ' + url);
    else if (!fs.existsSync(dest)) errors.push('Broken relative link in ' + doc + ': ' + url);
  }
}
// Docs index: docs/README.md is the single index over the scattered docs.
// Every top-level docs/*.md file and every docs/*/ subdirectory must be
// reachable from it, and the central index must point at it. A new doc
// that no index links is invisible; this fails loudly instead of
// silently joining the 16 files that were unlinked before the index.
const docsIndexPath = path.join(root, 'docs/README.md');
if (!fs.existsSync(docsIndexPath)) {
  errors.push('Missing docs index: docs/README.md');
} else {
  const docsIndex = fs.readFileSync(docsIndexPath, 'utf8');
  for (const f of fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
    if (!docsIndex.includes(`](${f})`)) errors.push(`Not linked from docs index: docs/${f}`);
  }
  for (const d of fs.readdirSync(path.join(root, 'docs'), { withFileTypes: true }).filter((d) => d.isDirectory())) {
    if (!docsIndex.includes(`](${d.name}/README.md)`) && !docsIndex.includes(`](${d.name}/)`)) errors.push(`Not linked from docs index: docs/${d.name}/`);
  }
  if (!index.includes('](docs/README.md)')) errors.push('Not linked from index: docs/README.md');
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Capability docs OK: ${files.size} domains, ${owners.size} modules, ${manifest.sections.length} migration anchors.`);
