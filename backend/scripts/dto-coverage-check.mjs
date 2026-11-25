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
 * Usage: node scripts/dto-coverage-check.mjs [--json]
 *   (run from the backend/ directory; paths are relative to backend/).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(BACKEND, 'src');

/** Whole-body @Body() sites whose type is not a *Dto class — pinned at D3 (191 after delivery-reps converts 58). */
const PINNED_COUNT = 191;

/**
 * The 9 pinned exclusions. A DTO on any of these breaks a real flow — see
 * docs/DTO_AUTHORING_CONTRACT.md. File paths are relative to backend/,
 * line is the @Body() line. Bucket is the classifier bucket at D1.
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
    line: 60,
    bucket: 'record',
    reason: 'POST backup/config: open-ended settings map',
  },
  {
    file: 'src/modules/settings/controllers/settings-backup.controller.ts',
    line: 68,
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
    line: 396,
    bucket: 'any',
    reason: 'POST webhooks/:gateway: provider payload + raw-body signature',
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

function classify(typeStr, decl, dtoClassNames, dtoIfaceNames) {
  if (typeStr === null || typeStr === undefined) return { bucket: 'no-annotation', detail: '' };
  const t = typeStr.trim();
  if (!t) return { bucket: 'no-annotation', detail: '' };
  const names = t.match(IDENT_RE) || [];
  const dtoClasses = names.filter((n) => dtoClassNames.has(n));
  if (dtoClasses.length > 0) return { bucket: 'dto-class', detail: dtoClasses[0] };
  const dtoIfaces = names.filter((n) => dtoIfaceNames.has(n));
  if (dtoIfaces.length > 0) return { bucket: 'dto-interface', detail: dtoIfaces[0] };
  if (ANY_RE.test(t)) return { bucket: 'any', detail: '' };
  if (t === 'unknown') return { bucket: 'unknown', detail: '' };
  if (t.startsWith('Record<')) return { bucket: 'record', detail: '' };
  if (t.startsWith('{')) return { bucket: 'inline-object', detail: '' };
  if (SINGLE_IDENT_RE.test(t)) return { bucket: `named-${decl.get(t) || 'undeclared'}`, detail: t };
  return { bucket: 'inline-other', detail: t.slice(0, 60) };
}

function census() {
  const files = collectTsFiles(SRC);
  const contents = new Map();
  for (const file of files) contents.set(file, fs.readFileSync(file, 'utf8').split('\n'));

  // Declaration index: name -> kind (class/interface/type), first seen wins.
  const decl = new Map();
  for (const file of files) {
    for (const line of contents.get(file)) {
      let m = CLASS_RE.exec(line);
      if (m) {
        if (!decl.has(m[1])) decl.set(m[1], 'class');
        continue;
      }
      m = INTERFACE_RE.exec(line);
      if (m) {
        if (!decl.has(m[1])) decl.set(m[1], 'interface');
        continue;
      }
      m = TYPE_RE.exec(line);
      if (m && !decl.has(m[1])) decl.set(m[1], 'type');
    }
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
        const { bucket, detail } = classify(tstr, decl, dtoClassNames, dtoIfaceNames);
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
