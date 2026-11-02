#!/usr/bin/env node
/**
 * حارس سلامة كتالوج التسعير — PRICING_AND_PACKAGING.md §13
 *
 * يمنع أن يكسر تعديلٌ يدوي في `pricing-catalog.json` الموقعَ أو نسخة الأوفلاين.
 * يُشغَّل بـ: node pricing/validate-catalog.mjs
 *
 * القواعد المفروضة:
 *  1. كل منتج يشير إلى نطاق موجود.
 *  2. كل مجموعة ميزات مُشار إليها (في النطاق أو في تجاوز المنتج) موجودة في featureGroups.
 *  3. كل نطاق له المستويات الثلاثة، وكل مستوى له سعر في كل بلد حالته ready أو partial.
 *  4. السنوي = الشهري × annualEqualsMonths بالضبط (لا تقريب يدوي مخالف).
 *  5. الأسعار تصاعدية داخل النطاق: L1 < L2 < L3.
 *  6. كل بلد status = blocked لا يحمل أي سعر في أي مكان.
 *  7. عملة كل سعر تطابق عملة بلده في countries.
 *  8. أي منتج sellOffline = false يحمل سبباً مكتوباً.
 *  9. المنتجات التي بلا نقطة بيع لا تحمل مجموعة online في أي مستوى.
 * 10. كل طابق يعلن includedFromLevel ومجموعة ميزاته موجودة.
 * 11. الفرع الإضافي لا يتجاوز نصف سعر المستوى الأول الشهري لنطاقه (تقريب
 *     النصف إلى الأعلى لوحدة عملة كاملة)، ولا يحمل سعراً لأي بلد محظور،
 *     والبلدان بلا سعر فرع تبقى null (اتصل بنا) ولا يُخترع لها رقم.
 *
 * ويولّد بعد نجاح التحقق مصدرَ الباك إند:
 *   backend/src/modules/tenant-subscription/pricing/pricing-catalog.generated.ts
 * فيبقى الـJSON هو المكان الوحيد الذي يُعدَّل. الوضع `--check` يتحقق فقط ولا يكتب،
 * ويفشل إن كان المولَّد قديماً — للاستخدام في `npm run guards`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, 'pricing-catalog.json'), 'utf8'));
const errors = [];
const fail = (msg) => errors.push(msg);

const { bands, products, featureGroups, countries, offline } = catalog;
const LEVELS = ['L1', 'L2', 'L3'];
const sellableCountries = Object.entries(countries)
  .filter(([, c]) => c.status === 'ready' || c.status === 'partial')
  .map(([code]) => code);
const blockedCountries = Object.entries(countries)
  .filter(([, c]) => c.status === 'blocked')
  .map(([code]) => code);

// 1 + 2 + 9
for (const p of products) {
  if (!bands[p.band]) fail(`المنتج ${p.id}: نطاق غير موجود «${p.band}»`);
  const groupsByLevel = p.levelGroupsOverride ?? bands[p.band]?.levelGroups ?? {};
  for (const lvl of LEVELS) {
    for (const g of groupsByLevel[lvl] ?? []) {
      if (!featureGroups[g]) fail(`المنتج ${p.id} المستوى ${lvl}: مجموعة ميزات غير موجودة «${g}»`);
      if (g === 'online' && p.pos === false) {
        fail(`المنتج ${p.id}: بلا نقطة بيع لكنه يحمل مجموعة online في ${lvl}`);
      }
    }
  }
  // 8
  if (p.sellOffline === false && !p.sellOfflineReason) {
    fail(`المنتج ${p.id}: sellOffline=false بلا sellOfflineReason`);
  }
  if (offline.notSoldOfflineProducts?.includes(p.id) && p.sellOffline !== false) {
    fail(`المنتج ${p.id}: مذكور في offline.notSoldOfflineProducts لكن sellOffline ليست false`);
  }
}

// 3 → 7
for (const [bandId, band] of Object.entries(bands)) {
  for (const g of Object.values(band.levelGroups ?? {}).flat()) {
    if (!featureGroups[g]) fail(`النطاق ${bandId}: مجموعة ميزات غير موجودة «${g}»`);
  }
  for (const lvl of LEVELS) {
    const level = band.levels?.[lvl];
    if (!level) { fail(`النطاق ${bandId}: المستوى ${lvl} مفقود`); continue; }
    if (!level.publicName) fail(`النطاق ${bandId}/${lvl}: publicName مفقود`);

    for (const code of sellableCountries) {
      const price = level.prices?.[code];
      if (!price) { fail(`النطاق ${bandId}/${lvl}: لا سعر للبلد ${code}`); continue; }
      // 7
      if (price.currency !== countries[code].currency) {
        fail(`النطاق ${bandId}/${lvl}/${code}: العملة «${price.currency}» تخالف عملة البلد «${countries[code].currency}»`);
      }
      // 4
      const expected = price.monthly * catalog.annualEqualsMonths;
      if (price.annual !== expected) {
        fail(`النطاق ${bandId}/${lvl}/${code}: السنوي ${price.annual} ويجب أن يكون ${expected} (الشهري × ${catalog.annualEqualsMonths})`);
      }
    }
    // 6
    for (const code of blockedCountries) {
      if (level.prices?.[code]) fail(`النطاق ${bandId}/${lvl}: البلد ${code} محظور ويحمل سعراً`);
    }
  }
  // 5
  for (const code of sellableCountries) {
    const [a, b, c] = LEVELS.map((l) => band.levels?.[l]?.prices?.[code]?.monthly);
    if (!(a < b && b < c)) {
      fail(`النطاق ${bandId}/${code}: الأسعار غير تصاعدية (${a} → ${b} → ${c})`);
    }
    const [pa, pb, pc] = LEVELS.map((l) => band.levels?.[l]?.prices?.[code]?.perpetual);
    if (pa != null && pb != null && pc != null && !(pa < pb && pb < pc)) {
      fail(`النطاق ${bandId}/${code}: أسعار الترخيص الدائم غير تصاعدية (${pa} → ${pb} → ${pc})`);
    }
  }
}

// 10. كل طابق يعلن صراحةً من أي مستوى يصبح مضمّناً (null = يُباع مفرداً دائماً)
for (const f of catalog.floors?.items ?? []) {
  if (!('includedFromLevel' in f)) fail(`الطابق ${f.id}: includedFromLevel مفقود (استخدم null إن كان يُباع مفرداً دائماً)`);
  if (f.featureGroup && !featureGroups[f.featureGroup]) fail(`الطابق ${f.id}: مجموعة ميزات غير موجودة «${f.featureGroup}»`);
}

// 11. الفرع الإضافي: سقف نصف سعر المستوى الأول، بلا سعر لبلد محظور،
//     والبلدان بلا سعر تبقى null (اتصل بنا) ولا يُخترع لها رقم.
for (const [bandId, band] of Object.entries(bands)) {
  const l1 = band.levels?.L1?.prices ?? {};
  for (const [code, value] of Object.entries(catalog.addons?.extraBranch?.monthly?.[bandId] ?? {})) {
    if (blockedCountries.includes(code)) {
      fail(`النطاق ${bandId}: الفرع الإضافي يحمل سعراً للبلد المحظور ${code}`);
      continue;
    }
    const base = l1[code]?.monthly;
    if (typeof base !== 'number') { fail(`النطاق ${bandId}: الفرع الإضافي للبلد ${code} بلا سعر مستوى أول`); continue; }
    if (typeof value !== 'number' || value > Math.ceil(base / 2)) {
      fail(`النطاق ${bandId}/${code}: الفرع الإضافي ${value} يتجاوز نصف سعر المستوى الأول ${base}`);
    }
  }
}

if (errors.length) {
  console.error(`\n✗ كتالوج التسعير مخالف — ${errors.length} خطأ:\n`);
  for (const e of errors) console.error('  · ' + e);
  console.error('\nالمرجع: PRICING_AND_PACKAGING.md §13\n');
  process.exit(1);
}

/* ---------------- توليد مصدر الباك إند ---------------- */

const generatedPath = join(
  here, '..', 'backend', 'src', 'modules', 'tenant-subscription', 'pricing', 'pricing-catalog.generated.ts',
);

/** مفاتيح التوثيق (`_note`, `_readme`, `_warning`) لقارئ الـJSON البشري ولا محل لها في وقت التشغيل. */
const stripDocKeys = (value) => {
  if (Array.isArray(value)) return value.map(stripDocKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => [k, stripDocKeys(v)]),
    );
  }
  return value;
};

const banner = [
  '/* eslint-disable */',
  '// ملف مُولَّد آلياً — لا تعدّله يداً.',
  '// المصدر: pricing/pricing-catalog.json',
  '// أعد التوليد بـ: node pricing/validate-catalog.mjs',
  '// المرجع: PRICING_AND_PACKAGING.md §13 · الثابت PRICE-2 · النمط المحظور F40',
  '',
  "import type { PricingCatalog } from './pricing-catalog.types';",
  '',
  'export const PRICING_CATALOG: PricingCatalog = ' + JSON.stringify(stripDocKeys(catalog), null, 2) + ';',
  '',
].join('\n');

const checkOnly = process.argv.includes('--check');
let current = null;
try { current = readFileSync(generatedPath, 'utf8'); } catch { /* غير موجود بعد */ }

if (checkOnly) {
  if (current !== banner) {
    console.error('\n✗ مصدر الباك إند المولَّد قديم أو مفقود.');
    console.error('  شغّل: node pricing/validate-catalog.mjs\n');
    process.exit(1);
  }
} else if (current !== banner) {
  writeFileSync(generatedPath, banner, 'utf8');
  console.log('· أُعيد توليد pricing-catalog.generated.ts');
}

const sellable = products.filter((p) => p.sellOffline !== false).length;
console.log(
  `✓ كتالوج التسعير سليم — ${products.length} منتجاً · ${Object.keys(bands).length} نطاقات × 3 مستويات · ` +
  `${sellableCountries.length} بلداً للبيع · ${sellable} منتجاً يُباع أوفلاين · إصدار ${catalog.version}`
);
