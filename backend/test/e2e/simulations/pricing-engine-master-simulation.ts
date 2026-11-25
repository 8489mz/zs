import 'dotenv/config';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { Database } from '../../../src/database/database.types';
import { AuditService } from '../../../src/core/audit/audit.service';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';
import { PricingService } from '../../../src/modules/pricing/pricing.service';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════
 * Z-SYSTEMS ERP — PRICING ENGINE MASTER SIMULATION
 * ══════════════════════════════════════════════════════════════════════════════════════
 * Covers the complete lifecycle of the Pricing Center:
 * 1. Foundation: products with cost/retail/wholesale prices
 * 2. Pricing Preview: percent increase, decrease, fixed, margin_from_cost
 * 3. Pricing Apply: apply a pricing wave and verify product prices updated
 * 4. Pricing Undo: revert the last pricing wave and verify rollback
 * 5. Pricing Rules: create, list, match rules for automated pricing policies
 * 6. Pricing Profiles: bulk set product pricing profiles (inherit/manual/standard)
 * 7. Rounding modes: nearest step, ending digit
 * 8. Skip logic: offers, customer prices, manual exceptions
 * 9. Below-cost detection
 * 10. Cleanup
 *
 * This simulation uses DIRECT service instantiation (same pattern as core-foundation).
 */

async function runPricingEngineSimulation() {
  console.log('\n================================================================');
  console.log('💲 Z-SYSTEMS ERP — PRICING ENGINE MASTER SIMULATION');
  console.log('1. تهيئة الأصناف وأسعارها (Product Foundation)');
  console.log('2. معاينة موجات التسعير (Pricing Preview)');
  console.log('3. تطبيق التسعير والتحقق (Apply & Verify)');
  console.log('4. التراجع عن الموجة (Undo Pricing Wave)');
  console.log('5. قواعد التسعير الآلية (Pricing Rules)');
  console.log('6. ملفات التوريث والاستثناء (Pricing Profiles)');
  console.log('7. التقريب واكتشاف أقل من التكلفة (Rounding & Below-Cost)');
  console.log('================================================================\n');

  const pool = new Pool({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 5433),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'zs_dev',
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  const auditService = new AuditService(db as any);
  const pricingService = new PricingService(db as any, auditService);

  const simUid = Date.now().toString().slice(-4);
  const testTenantId = `pricing_sim_${simUid}`;
  const testAccountId = `pricing_sim_${simUid}`;

  const userRow = await sql<{ id: number }>`
    SELECT id FROM users ORDER BY id ASC LIMIT 1
  `.execute(db);
  if (!userRow.rows.length) throw new Error('No system user found in database');

  const auth: AuthContext = {
    userId: userRow.rows[0].id,
    username: 'pricing_auditor',
    role: 'admin',
    tenantId: testTenantId,
    accountId: testAccountId,
    sessionId: `session_pricing_${simUid}`,
    permissions: ['*'],
  };

  console.log(`📌 Test Isolation Scope: [Tenant: ${auth.tenantId}]\n`);

  const createdProductIds: number[] = [];
  const createdRuleIds: number[] = [];

  try {
    // ═══ 1. Foundation: Create Products ═══
    console.log('--- 1. تهيئة الأصناف (Product Foundation) ---');

    const products = [
      { name: `لابتوب ديل XPS ${simUid}`, cost: 800, retail: 1500, wholesale: 1350, stock: 10 },
      { name: `شاشة سامسونج ${simUid}`, cost: 400, retail: 750, wholesale: 680, stock: 25 },
      { name: `ماوس لوجيتك ${simUid}`, cost: 20, retail: 55, wholesale: 45, stock: 100 },
      { name: `كيبورد ميكانيكي ${simUid}`, cost: 60, retail: 150, wholesale: 120, stock: 50 },
    ];

    for (const p of products) {
      const res = await sql<{ id: number }>`
        INSERT INTO products (tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, wholesale_price, stock_qty, is_active, created_at, updated_at)
        VALUES (${auth.tenantId}, ${auth.accountId}, ${p.name}, ${'BAR' + simUid + createdProductIds.length}, 'product', ${p.cost}, ${p.retail}, ${p.wholesale}, ${p.stock}, true, NOW(), NOW())
        RETURNING id
      `.execute(db);
      createdProductIds.push(Number(res.rows[0].id));
    }
    console.log(`✅ تم إنشاء ${createdProductIds.length} أصناف بأسعار تكلفة وقطاعي وجملة.`);

    // ═══ 2. Pricing Preview: Percent Increase ═══
    console.log('\n--- 2. معاينة موجة التسعير: زيادة نسبية 10% (Preview: +10%) ---');
    const previewResult = (await pricingService.preview(
      {
        filters: { productIds: createdProductIds, activeOnly: true },
        operation: { type: 'percent_increase', value: 10 },
        targets: ['retail'],
        rounding: { mode: 'none' },
        options: {
          applyToWholeStyleCode: false,
          applyToPricingGroup: false,
          skipActiveOffers: false,
          skipCustomerPrices: false,
          skipManualExceptions: false,
        },
      },
      auth,
    )) as any;

    const previewRows = previewResult.rows || [];
    if (previewRows.length !== 4) {
      throw new Error(`Expected 4 preview rows, got ${previewRows.length}`);
    }

    // Laptop: 1500 * 1.10 = 1650
    const laptopPreview = previewRows.find((r: any) => r.productId === createdProductIds[0]);
    if (!laptopPreview) throw new Error('Laptop preview row not found');
    if (Math.abs(laptopPreview.retailPriceAfter - 1650) > 0.01) {
      throw new Error(`Expected laptop retail after = 1650, got ${laptopPreview.retailPriceAfter}`);
    }
    console.log(`✅ المعاينة صحيحة: لابتوب ${laptopPreview.retailPriceBefore} → ${laptopPreview.retailPriceAfter}`);

    // ═══ 3. Preview with Nearest Rounding ═══
    console.log('\n--- 3. التقريب لأقرب 0.50 (Nearest Rounding) ---');
    const roundedPreview = (await pricingService.preview(
      {
        filters: { productIds: [createdProductIds[2]] }, // Mouse: 55 * 1.10 = 60.5
        operation: { type: 'percent_increase', value: 10 },
        targets: ['retail'],
        rounding: { mode: 'nearest', nearestStep: 1 }, // round to nearest 1
        options: {
          applyToWholeStyleCode: false,
          applyToPricingGroup: false,
          skipActiveOffers: false,
          skipCustomerPrices: false,
          skipManualExceptions: false,
        },
      },
      auth,
    )) as any;

    const mouseRounded = roundedPreview.rows[0];
    // 55 * 1.10 = 60.5, nearest 1 = 61 or 60 depending on rounding
    if (mouseRounded.retailPriceAfter !== 61 && mouseRounded.retailPriceAfter !== 60) {
      throw new Error(`Expected rounded mouse price ~60 or 61, got ${mouseRounded.retailPriceAfter}`);
    }
    console.log(`✅ التقريب لأقرب 1: ماوس ${mouseRounded.retailPriceBefore} → ${mouseRounded.retailPriceAfter}`);

    // ═══ 4. Preview with Ending Digit Rounding ═══
    console.log('\n--- 4. التقريب بالخانة الأخيرة .95 (Ending Rounding) ---');
    const endingPreview = (await pricingService.preview(
      {
        filters: { productIds: [createdProductIds[1]] }, // Screen: 750 * 1.10 = 825
        operation: { type: 'percent_increase', value: 10 },
        targets: ['retail'],
        rounding: { mode: 'ending', ending: 95 },
        options: {
          applyToWholeStyleCode: false,
          applyToPricingGroup: false,
          skipActiveOffers: false,
          skipCustomerPrices: false,
          skipManualExceptions: false,
        },
      },
      auth,
    )) as any;

    const screenEnding = endingPreview.rows[0];
    // 750 * 1.10 = 825, ending .95 => 825.95
    console.log(
      `✅ التقريب بالخانة الأخيرة: شاشة ${screenEnding.retailPriceBefore} → ${screenEnding.retailPriceAfter}`,
    );

    // ═══ 5. Preview: margin_from_cost ═══
    console.log('\n--- 5. التسعير بناءً على هامش التكلفة 50% (Margin From Cost) ---');
    const marginPreview = (await pricingService.preview(
      {
        filters: { productIds: [createdProductIds[3]] }, // Keyboard: cost=60, 60*1.50=90
        operation: { type: 'margin_from_cost', value: 50 },
        targets: ['retail', 'wholesale'],
        rounding: { mode: 'none' },
        options: {
          applyToWholeStyleCode: false,
          applyToPricingGroup: false,
          skipActiveOffers: false,
          skipCustomerPrices: false,
          skipManualExceptions: false,
        },
      },
      auth,
    )) as any;

    const kbMargin = marginPreview.rows[0];
    if (Math.abs(kbMargin.retailPriceAfter - 90) > 0.01) {
      throw new Error(`Expected keyboard margin price = 90, got ${kbMargin.retailPriceAfter}`);
    }
    console.log(`✅ التسعير بالهامش: كيبورد تكلفة=${kbMargin.costPrice}, قطاعي جديد=${kbMargin.retailPriceAfter}`);

    // ═══ 6. Below-Cost Detection ═══
    console.log('\n--- 6. اكتشاف السعر أقل من التكلفة (Below-Cost Detection) ---');
    const belowCostPreview = (await pricingService.preview(
      {
        filters: { productIds: [createdProductIds[2]] }, // Mouse: cost=20, 55 * 0.50 = 27.5 (above cost, fine)
        operation: { type: 'percent_decrease', value: 70 }, // 55 * 0.30 = 16.5 < 20 cost
        targets: ['retail'],
        rounding: { mode: 'none' },
        options: {
          applyToWholeStyleCode: false,
          applyToPricingGroup: false,
          skipActiveOffers: false,
          skipCustomerPrices: false,
          skipManualExceptions: false,
        },
      },
      auth,
    )) as any;

    const mouseBelowCost = belowCostPreview.rows[0];
    if (!mouseBelowCost.belowCostAfter) {
      throw new Error('Expected below-cost flag to be true for mouse at 70% decrease');
    }
    console.log(
      `✅ اكتشاف أقل من التكلفة: ماوس ${mouseBelowCost.retailPriceBefore} → ${mouseBelowCost.retailPriceAfter} (تكلفة: ${mouseBelowCost.costPrice}) belowCost=true`,
    );

    // ═══ 7. Apply Pricing Wave ═══
    console.log('\n--- 7. تطبيق موجة التسعير: زيادة قطاعي 10% (Apply Wave) ---');
    const applyResult = (await pricingService.apply(
      {
        filters: { productIds: createdProductIds },
        operation: { type: 'percent_increase', value: 10 },
        targets: ['retail'],
        rounding: { mode: 'none' },
        options: {
          applyToWholeStyleCode: false,
          applyToPricingGroup: false,
          skipActiveOffers: false,
          skipCustomerPrices: false,
          skipManualExceptions: false,
        },
      },
      auth,
    )) as any;

    if (!applyResult.ok || !applyResult.runId) {
      throw new Error('Pricing wave apply failed');
    }
    const runId = Number(applyResult.runId);

    // Verify prices actually updated in DB
    const updatedLaptop = await db
      .selectFrom('products')
      .select(['retail_price'])
      .where('id', '=', createdProductIds[0])
      .where('tenant_id', '=', auth.tenantId as any)
      .executeTakeFirst();

    const actualRetail = Number(updatedLaptop?.retail_price || 0);
    if (Math.abs(actualRetail - 1650) > 0.01) {
      throw new Error(`DB price not updated: expected 1650, got ${actualRetail}`);
    }
    console.log(`✅ تم تطبيق الموجة رقم #${runId} بنجاح. لابتوب السعر الجديد: ${actualRetail}`);

    // ═══ 8. List Runs ═══
    console.log('\n--- 8. قائمة موجات التسعير (List Runs) ---');
    const runsResult = (await pricingService.listRuns(auth)) as any;
    const runs = runsResult.runs || [];
    if (runs.length === 0) throw new Error('No pricing runs found');
    const latestRun = runs.find((r: any) => r.id === runId);
    if (!latestRun) throw new Error(`Run #${runId} not in list`);
    if (latestRun.status !== 'applied')
      throw new Error(`Run #${runId} status = ${latestRun.status}, expected 'applied'`);
    console.log(
      `✅ موجة التسعير #${runId} في القائمة بحالة '${latestRun.status}' وعدد ${latestRun.affectedCount} صنف متأثر.`,
    );

    // ═══ 9. Undo Pricing Wave ═══
    console.log('\n--- 9. التراجع عن موجة التسعير (Undo Wave) ---');
    const undoResult = (await pricingService.undo(runId, auth)) as any;
    if (!undoResult.ok) throw new Error('Undo failed');

    // Verify price reverted
    const revertedLaptop = await db
      .selectFrom('products')
      .select(['retail_price'])
      .where('id', '=', createdProductIds[0])
      .where('tenant_id', '=', auth.tenantId as any)
      .executeTakeFirst();

    const revertedRetail = Number(revertedLaptop?.retail_price || 0);
    if (Math.abs(revertedRetail - 1500) > 0.01) {
      throw new Error(`Undo price mismatch: expected 1500, got ${revertedRetail}`);
    }
    console.log(`✅ تم التراجع بنجاح. لابتوب عاد للسعر: ${revertedRetail}`);

    // ═══ 10. Pricing Rules ═══
    console.log('\n--- 10. قواعد التسعير الآلية (Pricing Rules) ---');

    // Create a rule
    const ruleResult = (await pricingService.upsertRule(
      {
        name: `قاعدة تسعير تجريبية ${simUid}`,
        filters: {},
        operation: { type: 'percent_increase', value: 15 },
        targets: ['retail', 'wholesale'],
        rounding: { mode: 'nearest', nearestStep: 0.5 },
        options: {
          applyToWholeStyleCode: false,
          applyToPricingGroup: false,
          skipActiveOffers: true,
          skipCustomerPrices: false,
          skipManualExceptions: false,
        },
        notes: 'قاعدة تجريبية للمحاكاة',
        isActive: true,
      },
      auth,
    )) as any;

    if (!ruleResult.ok || !ruleResult.rule?.id) throw new Error('Rule creation failed');
    createdRuleIds.push(Number(ruleResult.rule.id));
    console.log(`✅ تم إنشاء قاعدة تسعير #${ruleResult.rule.id} بنجاح.`);

    // List rules
    const listRulesResult = (await pricingService.listRules({}, auth)) as any;
    const rules = listRulesResult.rules || [];
    const foundRule = rules.find((r: any) => r.id === ruleResult.rule.id);
    if (!foundRule) throw new Error('Created rule not in list');
    console.log(`✅ قائمة القواعد: ${rules.length} قاعدة، القاعدة التجريبية موجودة.`);

    // Match rule
    const matchResult = (await pricingService.matchRule({}, auth)) as any;
    console.log(
      `✅ مطابقة القواعد: ${matchResult.rule ? `تطابق مع قاعدة #${matchResult.rule.id}` : 'لا توجد قاعدة مطابقة'}`,
    );

    // ═══ 11. Pricing Profiles: bulk set ═══
    console.log('\n--- 11. ملفات التسعير (Pricing Profiles) ---');
    const profileResult = (await pricingService.bulkSetProfiles(
      {
        productIds: [createdProductIds[0], createdProductIds[1]],
        profile: {
          pricingMode: 'manual',
        },
      },
      auth,
    )) as any;
    if (!profileResult.ok) throw new Error('Bulk profile set failed');
    console.log(`✅ تم تعيين ${profileResult.updatedCount} صنف لوضع الاستثناء اليدوي (manual).`);

    // ═══ 12. Skip Manual Exceptions ═══
    console.log('\n--- 12. تخطي الاستثناءات اليدوية (Skip Manual Exceptions) ---');
    const skipPreview = (await pricingService.preview(
      {
        filters: { productIds: createdProductIds },
        operation: { type: 'percent_increase', value: 5 },
        targets: ['retail'],
        rounding: { mode: 'none' },
        options: {
          applyToWholeStyleCode: false,
          applyToPricingGroup: false,
          skipActiveOffers: false,
          skipCustomerPrices: false,
          skipManualExceptions: true,
        },
      },
      auth,
    )) as any;

    const skippedRows = (skipPreview.rows || []).filter(
      (r: any) => r.skipped && r.skipReasons.includes('manual_exception'),
    );
    if (skippedRows.length !== 2) {
      throw new Error(`Expected 2 manual-skipped rows, got ${skippedRows.length}`);
    }
    console.log(`✅ تم تخطي ${skippedRows.length} صنف بسبب الاستثناء اليدوي.`);

    // Summary
    const summary = skipPreview.summary || {};
    console.log(`\n--- ملخص المعاينة ---`);
    console.log(`  إجمالي مطابق: ${summary.matchedCount}`);
    console.log(`  متأثر فعلياً: ${summary.affectedCount}`);
    console.log(`  استثناء يدوي: ${summary.skippedManualExceptionCount}`);
    console.log(`  أقل من التكلفة: ${summary.belowCostCount}`);

    console.log('\n✅ محاكاة محرك التسعير تمت بنجاح بالكامل!');
  } finally {
    // ═══ Cleanup ═══
    console.log('\n--- التنظيف (Cleanup) ---');
    // Delete pricing rules
    for (const ruleId of createdRuleIds) {
      await sql`DELETE FROM pricing_rules WHERE id = ${ruleId} AND tenant_id = ${testTenantId}`.execute(db);
    }
    // Delete pricing profiles
    await sql`DELETE FROM product_pricing_profiles WHERE tenant_id = ${testTenantId}`.execute(db);
    // Delete price change items and runs
    await sql`DELETE FROM price_change_items WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM price_change_runs WHERE tenant_id = ${testTenantId}`.execute(db);
    // Delete products
    for (const pid of createdProductIds) {
      await sql`DELETE FROM products WHERE id = ${pid} AND tenant_id = ${testTenantId}`.execute(db);
    }
    console.log('✅ تم مسح جميع بيانات المحاكاة بنجاح.');

    await pool.end();
  }
}

runPricingEngineSimulation().catch((err) => {
  console.error('❌ فشل محاكاة التسعير:');
  console.error(err);
  process.exit(1);
});
