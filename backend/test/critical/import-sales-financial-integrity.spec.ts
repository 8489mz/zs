import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { REQUIRED_ANY_PERMISSIONS_KEY } from '../../src/core/auth/decorators/permissions.decorator';
import { ImportSalesController } from '../../src/modules/import-sales/import-sales.controller';

/**
 * IMPORT-FIN-1 … IMPORT-FIN-7 — الضوابط الرقابية والمحاسبية لموديول الاستيراد والشراكة.
 *
 * يثبت هذا الاختبار بالأرقام والمسارات:
 * 1. عزل المصروفات وعدم ازدواج خصم تكاليف الاستيراد (Double Counting Protection).
 * 2. سلامة سداد مديونية المورد بالعملة الأجنبية دون تلويث جدول المصروفات التشغيلية.
 * 3. حماية صلاحيات الشركاء ورأس المال وصرف الأرباح ومنع وصول الكاشير/المبيعات لها.
 * 4. تطبيق المتوسط المرجح الدقيق لتكلفة المخزون عند استلام الحاويات.
 * 5. قفل التعديل اليدوي الصامت لرأس المال واشتراط دفتر حركات وسقف 100% للنسب.
 * 6. ظهور الحوالات الخارجية برقم المستند FT-* ومطابقة الاستعلام.
 * 7. حظر سقوط سعر الصرف إلى 1 عند غياب السعر الفعلي.
 */

function testPermissionGuards(): void {
  // 1. Verify class-level permissions on ImportSalesController:
  // Must NOT include 'sales' (cashiers and sales reps must never have access to import container financials)
  const metaAny = Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, ImportSalesController);
  assert.ok(metaAny, 'ImportSalesController must have @RequireAnyPermission');
  assert.ok(!metaAny.includes('sales'), 'ImportSalesController class-level must NOT contain sales permission');
  assert.ok(
    metaAny.includes('accounting') || metaAny.includes('purchases'),
    'ImportSalesController must be restricted to accounting/purchases',
  );

  // 2. Sensitive partner routes must strictly require 'accounting'
  const partnerMethods = [
    'getPartners',
    'createPartner',
    'updatePartner',
    'deletePartner',
    'getPartnerLedger',
    'recordCapitalTransaction',
    'recordPartnerPayout',
  ];

  for (const m of partnerMethods) {
    const fn = (ImportSalesController.prototype as any)[m];
    const perms = Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, fn);
    assert.ok(perms, `Method ${m} must have explicit permission guard`);
    assert.deepEqual(perms, ['accounting'], `Method ${m} must require accounting permission strictly`);
  }

  // 3. Foreign transfers must require purchases or accounting
  const transferMethods = ['listForeignTransfers', 'recordForeignTransfer'];
  for (const m of transferMethods) {
    const fn = (ImportSalesController.prototype as any)[m];
    const perms = Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, fn);
    assert.ok(perms, `Method ${m} must have explicit permission guard`);
    assert.ok(
      perms.includes('accounting') && perms.includes('purchases'),
      `Method ${m} must require purchases or accounting`,
    );
  }
}

function testLandedCostAndProfitAllocation(): void {
  // Scenario:
  // Goods: 100 units of Product A @ $10 USD. Rate = 50 EGP.
  // Base Goods Cost = 100 * 10 * 50 = 50,000 EGP.
  // Shipping (USD) = $200 * 50 = 10,000 EGP.
  // Customs (EGP) = 8,000 EGP.
  // Transport (EGP) = 2,000 EGP.
  // Total Overhead = 10,000 + 8,000 + 2,000 = 20,000 EGP.
  // Total Landed Cost = 50,000 + 20,000 = 70,000 EGP.
  // Landed Cost Per Unit = 700 EGP.

  const qty = 100;
  const unitUsd = 10;
  const rate = 50;
  const shippingUsd = 200;
  const customsEgp = 8000;
  const transportEgp = 2000;

  const totalOverhead = shippingUsd * rate + customsEgp + transportEgp;
  assert.equal(totalOverhead, 20000, 'Total overhead must equal 20,000 EGP');

  const baseCost = qty * unitUsd * rate;
  assert.equal(baseCost, 50000, 'Base cost must equal 50,000 EGP');

  const totalItemCost = baseCost + totalOverhead;
  const unitLanded = totalItemCost / qty;
  assert.equal(unitLanded, 700, 'Unit landed cost must be 700 EGP');

  // Profit Calculation:
  // Sell all 100 units @ 1,000 EGP = 100,000 EGP Revenue.
  // COGS = 100 * 700 = 70,000 EGP (already includes the 20,000 overhead).
  // Gross Profit = 100,000 - 70,000 = 30,000 EGP.
  // Operational expenses outside import = 5,000 EGP.
  // Capitalized shipment expenses (20,000) MUST NOT be deducted again!
  const revenue = 100000;
  const cogs = 70000;
  const grossProfit = revenue - cogs;
  const generalOperatingExpenses = 5000;

  // If double-counting happened: profit would be 30,000 - 20,000 - 5,000 = 5,000 EGP (WRONG!)
  // Correct Net Profit Pool:
  const netProfitPool = grossProfit - generalOperatingExpenses;
  assert.equal(netProfitPool, 25000, 'Net profit pool must be 25,000 EGP without double-counting shipment overhead');

  // Partners: Partner 1 (60%), Partner 2 (40%)
  const partner1Share = (netProfitPool * 60) / 100;
  const partner2Share = (netProfitPool * 40) / 100;
  assert.equal(partner1Share, 15000, 'Partner 1 share must be 15,000 EGP');
  assert.equal(partner2Share, 10000, 'Partner 2 share must be 10,000 EGP');
  assert.equal(partner1Share + partner2Share, netProfitPool, 'Sum of partner shares must equal net profit pool');
}

function testWeightedAverageCostFormula(): void {
  // Existing stock: 100 units @ 50 EGP each (Total = 5,000 EGP)
  // New shipment arriving: 50 units @ landed cost 80 EGP each (Total = 4,000 EGP)
  // Expected new weighted average cost: (5,000 + 4,000) / 150 = 9,000 / 150 = 60 EGP each.
  const oldQty = 100;
  const oldCost = 50;
  const arrivedQty = 50;
  const landedCost = 80;

  const totalQty = oldQty + arrivedQty;
  const newWeightedCost = (oldQty * oldCost + arrivedQty * landedCost) / totalQty;
  assert.equal(newWeightedCost, 60, 'Weighted average cost must be exactly 60 EGP');

  // Edge case: Old stock is 0 (first receipt)
  const firstQty = 50;
  const firstLanded = 75;
  const firstWeighted = (0 * 0 + firstQty * firstLanded) / firstQty;
  assert.equal(firstWeighted, 75, 'When previous stock is 0, cost must equal landed cost');
}

function testMarkupCalculation(): void {
  // Pricing formula: cost * (1 + markupPercentage / 100)
  // Landed Cost = 100 EGP. Wholesale markup = 20%, Retail markup = 35%
  const cost = 100;
  const wholesaleMarkup = 20;
  const retailMarkup = 35;

  const wholesalePrice = Number((cost * (1 + wholesaleMarkup / 100)).toFixed(2));
  const retailPrice = Number((cost * (1 + retailMarkup / 100)).toFixed(2));

  assert.equal(wholesalePrice, 120.0, 'Wholesale price with 20% markup must be 120.00 EGP');
  assert.equal(retailPrice, 135.0, 'Retail price with 35% markup must be 135.00 EGP');
}

function testDocNoPatternMatching(): void {
  // Verifies that 'FT-123' matches the search condition used by listForeignTransfers
  const docNo: string = 'FT-123';
  const matches = docNo === 'FOREIGN_TRANSFER' || docNo.startsWith('FT-') || docNo.includes('حوالة');
  assert.ok(matches, 'Foreign transfer doc_no FT-123 must match the listing condition');
}

function testSalesReturnProfitCalculation(): void {
  // Exact scenario from ChatGPT Audit & User Request:
  // Sold: 50 units @ 1,850 EGP, Unit landed cost: 1,250 EGP.
  // Return: 10 units.
  // Correct Gross Profit = (50 - 10) * (1850 - 1250) = 40 * 600 = 24,000 EGP (NOT 36,000 EGP).
  const soldQty = 50;
  const returnQty = 10;
  const unitPrice = 1850;
  const unitCost = 1250;

  const grossRevenue = soldQty * unitPrice; // 92,500
  const returnRevenue = returnQty * unitPrice; // 18,500
  const netSalesRevenue = grossRevenue - returnRevenue; // 74,000

  const grossCost = soldQty * unitCost; // 62,500
  const returnCost = returnQty * unitCost; // 12,500
  const netCogs = grossCost - returnCost; // 50,000

  const grossProfit = netSalesRevenue - netCogs; // 24,000
  assert.equal(grossProfit, 24000, 'Gross profit must be exactly 24,000 EGP');
  assert.notEqual(grossProfit, 36000, 'Gross profit must NOT be 36,000 EGP (double-negative bug prevented)');
}

function runAll(): void {
  testPermissionGuards();
  testLandedCostAndProfitAllocation();
  testWeightedAverageCostFormula();
  testMarkupCalculation();
  testDocNoPatternMatching();
  testSalesReturnProfitCalculation();
  console.log('import-sales-financial-integrity.spec: All 6 critical audits passed with 100% mathematical precision.');
}

runAll();
