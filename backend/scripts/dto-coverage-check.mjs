#!/usr/bin/env node
/**
 * DTO coverage census — item (5) D1.
 *
 * Counts whole-body @Body() sites in backend/src whose type is NOT a *Dto
 * class, and pins the count plus the exact pinned-exclusion set. This is a
 * faithful port of the item-(5) grounding classifier
 * (~/workspace/audit/dto-census.py, re-counted at d1989b74e): the
 * declaration index is built from `export class/interface/type` over
 * backend/src, named types are resolved against it, and each site is
 * classified by the same mutually-exclusive buckets. Re-running the
 * Python classifier at d1989b74e reproduces these numbers exactly:
 * 681 @Body( occurrences (624 whole-body + 57 property-form);
 * whole-body buckets dto-class 360, dto-interface 47, inline-object 151,
 * any 43, inline-other 9, named-interface 5, unknown 4, record 4,
 * no-annotation 1; non-DTO-class total 264 = 255 convertible + 9 pinned
 * exclusions.
 *
 * WHY 264 AND NOT 211: the verification files counted 211 sites without
 * a *Dto-named type, but 47 of the 407 "with DTO" sites use an INTERFACE
 * named *Dto, not a class — and the global ValidationPipe does nothing
 * for interfaces (it only validates classes). The real unvalidated
 * population is 217 + 47 = 264.
 *
 * Exit code: 0 iff the non-DTO count equals PINNED_COUNT and the
 * exclusion set (file:line) equals PINNED_EXCLUSIONS exactly; 1
 * otherwise, with the diff printed. `backend/test/critical/
 * dto-coverage.spec.ts` runs this script with --json and asserts the
 * same numbers, so a drift fails the spec. Each DTO package updates
 * PINNED_COUNT down by exactly the sites it converts, in the same
 * package (script constant + spec constant together); the last DTO
 * package pins 9 (exclusions only).
 *
 * D2 (INV-DTO-PILOT-PURCHASES-INVENTORY): the pilot converts 15 sites
 * (purchases 8 + inventory 7); the count is now 249 = 240 convertible +
 * 9 pinned exclusions. Whole-body total stays 624 and the buckets move
 * dto-class 360 -> 375, dto-interface 47 -> 39, inline-object 151 -> 146,
 * any 43 -> 42, named-interface 5 -> 4.
 *
 * D3 (INV-DTO-DELIVERY-REPS-58): delivery-reps converts 58 sites
 * (driver portal 3 + delivery-reps 4 + admin 27 + driver 24); the count
 * is now 191 = 182 convertible + 9 pinned exclusions. Whole-body total
 * stays 624 and the buckets move dto-class 375 -> 433, inline-object
 * 146 -> 94, any 42 -> 37, no-annotation 1 -> 0.
 *
 * D4 (INV-DTO-MARITIME-FREIGHT-28): maritime-freight converts 28 sites
 * (customer portal 5 + freight controller 22 + public tracking 1); the
 * count is now 163 = 154 convertible + 9 pinned exclusions. Whole-body
 * total stays 624 and the buckets move dto-class 433 -> 461,
 * inline-object 94 -> 81, any 37 -> 25, dto-interface 39 -> 38,
 * inline-other 9 -> 7.
 *
 * D5 (INV-DTO-SALES-27): sales converts 27 sites (13 dto-interface +
 * 13 inline-object + 1 named-interface); the count is now 136 = 127
 * convertible + 9 pinned exclusions. Whole-body total stays 624 and
 * the buckets move dto-class 461 -> 488, inline-object 81 -> 68,
 * dto-interface 38 -> 25, named-interface 4 -> 3.
 *
 * Package C (INV-DTO-SALES-QUOTATION-CREATE): the script has TWO
 * fixes. (a) CRLF: lines are split on /\r?\n/ — a Windows checkout
 * leaves a trailing \r that the old split('\n') kept, so an
 * annotation read as `UpsertUserDto\r` matched no DTO name. The tree
 * is LF-normalized (zero \r in backend/src), so this moves the count
 * by 0 here; it is robustness for Windows runs. (b) Per-import
 * declaration resolution: the declaration index was first-seen-wins
 * across the whole tree, so the sales POST /api/quotations create
 * site resolved to the import-sales CreateQuotationDto CLASS and was
 * counted dto-class while the controller imports the sales INTERFACE
 * and the pipe did nothing for it. Each site now resolves its names
 * through its own imports (following named imports and named/star
 * re-exports, multi-line blocks included), falling back to the global
 * index only when no import resolves — the diff proves exactly one
 * row moves (quotations.controller.ts:23 dto-class -> dto-interface).
 * Pin arithmetic: 136 + 0 (CRLF) + 1 (reveal) - 1 (convert) = 136 —
 * the pin STAYS 136 (127 convertible + 9 exclusions). Buckets end
 * where D5 left them (dto-class 488, dto-interface 25, inline-object
 * 68, any 25, inline-other 7, named-interface 3, unknown 4,
 * record 4). NOTE for D6: its expected pin (111) was derived from
 * the pre-Package-C census — D6 must re-derive from the live census.
 *
 * D6 (INV-DTO-ACCOUNTING-25): accounting converts 25 sites (11
 * dto-interface + 11 inline-object + 3 any); the count is now 111 =
 * 102 convertible + 9 pinned exclusions. The live census re-derived
 * the list (the grounding's 25 held exactly). Whole-body total stays
 * 624 and the buckets move dto-class 488 -> 513, inline-object
 * 68 -> 57, any 25 -> 22, dto-interface 25 -> 14.
 *
 * D7 (INV-DTO-SETTINGS-22): settings converts 22 sites (3
 * inline-other + 14 inline-object + 5 any); the count is now 89 =
 * 80 convertible + 9 pinned exclusions. The live census re-derived
 * the list (the grounding's 22 held exactly). Whole-body total stays
 * 624 and the buckets move dto-class 513 -> 535, inline-object
 * 57 -> 43, any 22 -> 17, inline-other 7 -> 4.
 *
 * Usage: node scripts/dto-coverage-check.mjs [--json]
 *   (run from the backend/ directory; paths are relative to backend/).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(BACKEND, 'src');

/** Whole-body @Body() sites whose type is not a *Dto class — pinned at D10 (15 — the 15 exclusions only; the tail converts the last 30). */
const PINNED_COUNT = 15;

/**
 * The 15 pinned exclusions. A DTO on any of these breaks a real flow — see
 * docs/DTO_AUTHORING_CONTRACT.md. File paths are relative to backend/,
 * line is the @Body() line. Bucket is the classifier bucket at D1.
 * D8 adds the 6 storefront webhook `any` sites (same rationale as the
 * tenant-subscription gateway webhook: provider payload + signature).
 */
const PINNED_EXCLUSIONS = [
  {
    file: 'src/core/logging/logs.controller.ts',
    line: 15,
    bucket: 'unknown',
    reason: 'POST frontend-error: free-form error sink',
  },
  {
    file: 'src/modules/hr/controllers/biometric-attendance.controller.ts',
    line: 153,
    bucket: 'unknown',
    reason: 'POST cdata: ZKTeco device push, raw text/Buffer',
  },
  {
    file: 'src/modules/hr/controllers/biometric-attendance.controller.ts',
    line: 196,
    bucket: 'unknown',
    reason: 'POST hikvision: Hikvision device push, raw body',
  },
  {
    file: 'src/modules/hr/controllers/biometric-attendance.controller.ts',
    line: 227,
    bucket: 'unknown',
    reason: 'POST json: generic device push, raw body',
  },
  {
    file: 'src/modules/settings/controllers/settings-backup.controller.ts',
    line: 61,
    bucket: 'record',
    reason: 'POST backup/config: open-ended settings map',
  },
  {
    file: 'src/modules/settings/controllers/settings-backup.controller.ts',
    line: 69,
    bucket: 'record',
    reason: 'POST backup/folder/test: open-ended settings map',
  },
  {
    file: 'src/modules/settings/controllers/tenant-transfer.controller.ts',
    line: 53,
    bucket: 'record',
    reason: 'multipart upload body: open-ended field map',
  },
  {
    file: 'src/modules/settings/settings.controller.ts',
    line: 52,
    bucket: 'record',
    reason: 'PUT settings: open-ended settings map',
  },
  {
    file: 'src/modules/tenant-subscription/tenant-subscription.controller.ts',
    line: 401,
    bucket: 'any',
    reason: 'POST webhooks/:gateway: provider payload + raw-body signature',
  },
  {
    file: 'src/modules/storefront/controllers/marketplace-sync.controller.ts',
    line: 176,
    bucket: 'any',
    reason: 'POST marketplaces/webhook/:marketplace: provider payload, 4 marketplaces + raw-payload persist',
  },
  {
    file: 'src/modules/storefront/storefront-public.controller.ts',
    line: 254,
    bucket: 'any',
    reason: 'POST webhooks/paymob: provider payload + HMAC over concatenated fields',
  },
  {
    file: 'src/modules/storefront/storefront-public.controller.ts',
    line: 264,
    bucket: 'any',
    reason: 'POST webhooks/xpay: provider payload + signature',
  },
  {
    file: 'src/modules/storefront/storefront-public.controller.ts',
    line: 274,
    bucket: 'any',
    reason: 'POST webhooks/tap: provider payload + HMAC over concatenated fields',
  },
  {
    file: 'src/modules/storefront/storefront-public.controller.ts',
    line: 284,
    bucket: 'any',
    reason: 'POST webhooks/stripe: provider payload + raw-body signature',
  },
  {
    file: 'src/modules/storefront/storefront-public.controller.ts',
    line: 303,
    bucket: 'any',
    reason: 'POST webhooks/marketplace/:marketplace: provider payload + raw-payload persist',
  },
];

const CLASS_RE = /export (?:abstract )?class ([A-Za-z0-9_]+)/;
const INTERFACE_RE = /export interface ([A-Za-z0-9_]+)/;
const TYPE_RE = /export type ([A-Za-z0-9_]+)/;
const BODY_RE = /@Body\(/g;
const PROPERTY_RE = /^@Body\(\s*['"]([^'"]+)['"]/;
const IDENT_RE = /[A-Za-z_$][\w$]*/g;
const SINGLE_IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const ANY_RE = /^any(\[\])?$/;
const ANNOTATION_RE = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(.+)$/;

function collectTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function balancedType(text) {
  let depth = 0;
  const out = [];
  for (const ch of text) {
    if ('<({['.includes(ch)) depth += 1;
    else if ('>)}]'.includes(ch)) {
      if (depth === 0) break;
      depth -= 1;
    }
    if (depth === 0 && (ch === ',' || ch === '=')) break;
    out.push(ch);
  }
  return out.join('').trim();
}

const NAMED_IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const NAMED_REEXPORT_RE = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const STAR_REEXPORT_RE = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;

/** Parse a `{ A, B as C }` brace body into [{ exported, local }] pairs. */
function parseBraceNames(body) {
  const out = [];
  for (const part of body.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(t);
    if (m) out.push({ exported: m[1], local: m[2] || m[1] });
  }
  return out;
}

function classify(typeStr, siteFile, ctx) {
  if (typeStr === null || typeStr === undefined) return { bucket: 'no-annotation', detail: '' };
  const t = typeStr.trim();
  if (!t) return { bucket: 'no-annotation', detail: '' };
  const names = t.match(IDENT_RE) || [];
  // Package C: each name resolves through the SITE file's own imports
  // (resolveSiteName), not the global first-seen-wins index. A name no
  // import resolves falls back to the global index, so every other site
  // classifies exactly as before — only genuine collisions move.
  const kinds = names.map((n) => ({ name: n, kind: ctx.resolveSiteName(siteFile, n) }));
  const dtoClasses = kinds.filter(
    ({ name, kind }) => name.endsWith('Dto') && (kind === 'class' || (kind === null && ctx.dtoClassNames.has(name))),
  );
  if (dtoClasses.length > 0) return { bucket: 'dto-class', detail: dtoClasses[0].name };
  const dtoIfaces = kinds.filter(
    ({ name, kind }) =>
      name.endsWith('Dto') && (kind === 'interface' || (kind === null && ctx.dtoIfaceNames.has(name))),
  );
  if (dtoIfaces.length > 0) return { bucket: 'dto-interface', detail: dtoIfaces[0].name };
  if (ANY_RE.test(t)) return { bucket: 'any', detail: '' };
  if (t === 'unknown') return { bucket: 'unknown', detail: '' };
  if (t.startsWith('Record<')) return { bucket: 'record', detail: '' };
  if (t.startsWith('{')) return { bucket: 'inline-object', detail: '' };
  if (SINGLE_IDENT_RE.test(t)) {
    return {
      bucket: `named-${ctx.resolveSiteName(siteFile, t) || ctx.decl.get(t) || 'undeclared'}`,
      detail: t,
    };
  }
  return { bucket: 'inline-other', detail: t.slice(0, 60) };
}

function census() {
  const files = collectTsFiles(SRC);
  const contents = new Map();
  // Package C: split on /\r?\n/ — a Windows (CRLF) checkout leaves a
  // trailing \r on every line, which the old split('\n') kept; the
  // annotation regex then captured e.g. `UpsertUserDto\r`, which matches
  // no DTO name and misclassifies the site. The tree is LF-normalized
  // today (no \r in backend/src), so this moves the count by 0 here —
  // it is robustness for Windows runs, not a count change.
  for (const file of files) contents.set(file, fs.readFileSync(file, 'utf8').split(/\r?\n/));

  // Declaration index: name -> kind (class/interface/type), first seen wins.
  // Package C: the global index stays ONLY as the fallback. Each site
  // resolves its names through its own imports (resolveSiteName below),
  // so a name declared twice with different kinds (CreateQuotationDto:
  // import-sales class vs sales interface) classifies per site.
  const decl = new Map();
  const declByFile = new Map();
  const fileSet = new Set(files);
  for (const file of files) {
    const perFile = new Map();
    declByFile.set(file, perFile);
    for (const line of contents.get(file)) {
      let m = CLASS_RE.exec(line);
      if (m) {
        if (!decl.has(m[1])) decl.set(m[1], 'class');
        if (!perFile.has(m[1])) perFile.set(m[1], 'class');
        continue;
      }
      m = INTERFACE_RE.exec(line);
      if (m) {
        if (!decl.has(m[1])) decl.set(m[1], 'interface');
        if (!perFile.has(m[1])) perFile.set(m[1], 'interface');
        continue;
      }
      m = TYPE_RE.exec(line);
      if (m) {
        if (!decl.has(m[1])) decl.set(m[1], 'type');
        if (!perFile.has(m[1])) perFile.set(m[1], 'type');
      }
    }
  }

  // Per-file import / re-export tables, parsed lazily from the file text.
  // The regexes span lines: controllers and barrels use multi-line
  // `import { ... } from` / `export { ... } from` blocks.
  const importCache = new Map();
  function importsOf(file) {
    if (importCache.has(file)) return importCache.get(file);
    const map = new Map();
    const text = contents.get(file).join('\n');
    NAMED_IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = NAMED_IMPORT_RE.exec(text)) !== null) {
      for (const { exported, local } of parseBraceNames(m[1])) {
        if (!map.has(local)) map.set(local, { exported, specifier: m[2] });
      }
    }
    importCache.set(file, map);
    return map;
  }

  const reexportCache = new Map();
  function reexportsOf(file) {
    if (reexportCache.has(file)) return reexportCache.get(file);
    const named = [];
    const star = [];
    const text = contents.get(file).join('\n');
    NAMED_REEXPORT_RE.lastIndex = 0;
    let m;
    while ((m = NAMED_REEXPORT_RE.exec(text)) !== null) {
      named.push({ names: parseBraceNames(m[1]), specifier: m[2] });
    }
    STAR_REEXPORT_RE.lastIndex = 0;
    while ((m = STAR_REEXPORT_RE.exec(text)) !== null) star.push(m[1]);
    const out = { named, star };
    reexportCache.set(file, out);
    return out;
  }

  function resolveSpecifier(fromFile, spec) {
    if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
    const base = path.dirname(fromFile);
    const candidates = [];
    if (spec.endsWith('.js')) candidates.push(path.resolve(base, `${spec.slice(0, -3)}.ts`));
    candidates.push(path.resolve(base, `${spec}.ts`));
    candidates.push(path.resolve(base, spec, 'index.ts'));
    candidates.push(path.resolve(base, spec));
    for (const c of candidates) if (fileSet.has(c)) return c;
    return null;
  }

  const declKindCache = new Map();
  function resolveDeclaration(file, name, seen) {
    const key = `${file}\0${name}`;
    if (declKindCache.has(key)) return declKindCache.get(key);
    if (seen.has(key)) return null;
    seen.add(key);
    let kind = declByFile.get(file)?.get(name) ?? null;
    if (!kind) {
      for (const { names, specifier } of reexportsOf(file).named) {
        const hit = names.find((n) => n.local === name);
        if (!hit) continue;
        const target = resolveSpecifier(file, specifier);
        if (target) kind = resolveDeclaration(target, hit.exported, seen);
        if (kind) break;
      }
    }
    if (!kind) {
      for (const specifier of reexportsOf(file).star) {
        const target = resolveSpecifier(file, specifier);
        if (target) kind = resolveDeclaration(target, name, seen);
        if (kind) break;
      }
    }
    if (kind) declKindCache.set(key, kind);
    return kind;
  }

  function resolveSiteName(siteFile, name) {
    const own = declByFile.get(siteFile)?.get(name);
    if (own) return own;
    const imp = importsOf(siteFile).get(name);
    if (imp) {
      const target = resolveSpecifier(siteFile, imp.specifier);
      if (target) {
        const kind = resolveDeclaration(target, imp.exported, new Set());
        if (kind) return kind;
      }
    }
    return decl.get(name) ?? null;
  }
  const dtoClassNames = new Set(
    [...decl.entries()]
      .filter(([, k]) => k === 'class')
      .map(([n]) => n)
      .filter((n) => n.endsWith('Dto')),
  );
  const dtoIfaceNames = new Set(
    [...decl.entries()]
      .filter(([, k]) => k === 'interface')
      .map(([n]) => n)
      .filter((n) => n.endsWith('Dto')),
  );

  const rows = [];
  for (const file of files) {
    const lines = contents.get(file);
    const rel = path.relative(BACKEND, file).split(path.sep).join('/');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      BODY_RE.lastIndex = 0;
      let m;
      while ((m = BODY_RE.exec(line)) !== null) {
        const rest = line.slice(m.index);
        const pm = PROPERTY_RE.exec(rest);
        if (pm) {
          rows.push({ file: rel, line: i + 1, form: 'property', prop: pm[1], bucket: 'property-form', type: '' });
          continue;
        }
        // Whole-body: type on the same line after the closing paren?
        let tstr = null;
        const close = line.indexOf(')', m.index);
        const after = close >= 0 ? line.slice(close + 1) : '';
        const cm = /:\s*(.+)$/.exec(after);
        if (cm) {
          tstr = balancedType(cm[1]);
          if (!tstr) tstr = null;
        }
        if (tstr === null) {
          // Look at the following lines (up to 3) for "name: Type".
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
            const lm = ANNOTATION_RE.exec(lines[j]);
            if (lm) {
              tstr = balancedType(lm[2]);
              break;
            }
            if (lines[j].trim() && !lines[j].trimStart().startsWith('@')) break;
          }
        }
        const { bucket, detail } = classify(tstr, file, { decl, dtoClassNames, dtoIfaceNames, resolveSiteName });
        rows.push({ file: rel, line: i + 1, form: 'whole', prop: '', bucket, type: (tstr || '').slice(0, 80), detail });
      }
    }
  }

  const whole = rows.filter((r) => r.form === 'whole');
  const property = rows.filter((r) => r.form === 'property');
  const buckets = {};
  for (const r of whole) buckets[r.bucket] = (buckets[r.bucket] || 0) + 1;
  const nonDto = whole.filter((r) => r.bucket !== 'dto-class');
  const pinnedKeys = new Set(PINNED_EXCLUSIONS.map((e) => `${e.file}:${e.line}`));
  const exclusions = nonDto.filter((r) => pinnedKeys.has(`${r.file}:${r.line}`));
  return { rows, whole, property, buckets, nonDto, exclusions, pinnedCount: PINNED_COUNT };
}

function main() {
  const { whole, property, buckets, nonDto, exclusions } = census();
  const asJson = process.argv.includes('--json');
  const exclusionKeys = exclusions.map((r) => `${r.file}:${r.line}`).sort();
  const pinnedKeys = PINNED_EXCLUSIONS.map((e) => `${e.file}:${e.line}`).sort();
  const countOk = nonDto.length === PINNED_COUNT;
  const setOk = JSON.stringify(exclusionKeys) === JSON.stringify(pinnedKeys);
  const ok = countOk && setOk;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          pinnedCount: PINNED_COUNT,
          nonDtoCount: nonDto.length,
          wholeBodyTotal: whole.length,
          propertyFormTotal: property.length,
          buckets,
          exclusions: exclusions.map((r) => ({ file: r.file, line: r.line, bucket: r.bucket, type: r.type })),
          nonDto: nonDto.map((r) => ({ file: r.file, line: r.line, bucket: r.bucket, type: r.type })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `DTO coverage: ${whole.length} whole-body @Body() (${buckets['dto-class'] || 0} dto-class, ${nonDto.length} non-DTO), ${property.length} property-form`,
    );
    console.log(`Non-DTO buckets: ${JSON.stringify(buckets)}`);
    console.log(
      `Pinned count: ${PINNED_COUNT}, exclusions: ${exclusions.length} of ${PINNED_EXCLUSIONS.length} pinned`,
    );
    if (!countOk) console.log(`MISMATCH: non-DTO count is ${nonDto.length}, pinned ${PINNED_COUNT}`);
    if (!setOk) {
      const missing = pinnedKeys.filter((k) => !exclusionKeys.includes(k));
      const extra = exclusionKeys.filter((k) => !pinnedKeys.includes(k));
      if (missing.length > 0)
        console.log(`MISSING pinned exclusions (no longer non-DTO sites): ${JSON.stringify(missing)}`);
      if (extra.length > 0)
        console.log(
          `EXTRA exclusions (non-DTO sites matching no pin — update the pin list deliberately): ${JSON.stringify(extra)}`,
        );
    }
    console.log(ok ? 'DTO coverage OK' : 'DTO coverage MISMATCH');
  }
  process.exitCode = ok ? 0 : 1;
}

main();
