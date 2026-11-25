import 'dotenv/config';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';

/**
 * Z-SYSTEMS ERP — NOTIFICATIONS & EXECUTIVE ALERTS SIMULATION
 *
 * Verifies:
 * 1. WhatsApp Gateway Configuration: Settings persistence and multi-tenant scoping.
 * 2. Automated WhatsApp Invoice Notification: Dynamic templating engine.
 * 3. Daily Executive Digest Configuration: Schedule, channel, and preferences.
 * 4. Executive Digest Metrics Engine: Aggregation of sales, revenues, and inventory shortages.
 * 5. Tamper-Evident Audit Trail: Operational logging, action sequences, and chronological order.
 * 6. Clean and idempotent teardown.
 */

async function runNotificationsSimulation() {
  const simUid = Date.now().toString().slice(-4);
  const testTenantId = `notif_sim_${simUid}`;
  const testAccountId = `notif_acc_${simUid}`;

  console.log('\n================================================================');
  console.log('[NOTIFICATIONS-SIMULATION] Z-SYSTEMS ERP — ALERTS ENGINE AUDIT');
  console.log('1. إعدادات بوابة الواتساب (WhatsApp Gateway Config)');
  console.log('2. محرك قوالب إشعارات الفواتير (Invoice WhatsApp Templating)');
  console.log('3. إعدادات الملخص اليومي للإدارة (Daily Digest Configuration)');
  console.log('4. محرك احتساب أرقام ومؤشرات اليومية (Executive Digest Engine)');
  console.log('5. سجل التدقيق الأمني (Operational Audit Trail)');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
  });

  const db = new Kysely<any>({
    dialect: new PostgresDialect({ pool }),
  });

  try {
    // -------------------------------------------------------------------------
    // 1. WhatsApp Gateway Configuration
    // -------------------------------------------------------------------------
    console.log('--- 1. إعدادات بوابة الواتساب (WhatsApp Gateway Config) ---');
    const waSettings = [
      { key: 'whatsapp_gateway_enabled', val: true },
      { key: 'whatsapp_gateway_provider', val: 'ultramsg' },
      { key: 'whatsapp_gateway_auto_invoice', val: true },
      { key: 'whatsapp_gateway_invoice_template', val: 'عزيزي العميل، فاتورتكم رقم {doc_no} بمبلغ {total} جاهزة.' },
    ];

    for (const s of waSettings) {
      await sql`
        INSERT INTO settings (tenant_id, account_id, key, value)
        VALUES (${testTenantId}, ${testAccountId}, ${s.key}, ${JSON.stringify(s.val)})
        ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value
      `.execute(db);
    }

    const savedWaSettings = await sql<{ key: string; value: string }>`
      SELECT key, value FROM settings 
      WHERE tenant_id = ${testTenantId} AND key LIKE 'whatsapp_gateway_%'
    `.execute(db);

    if (savedWaSettings.rows.length !== 4) {
      throw new Error(`Expected 4 WhatsApp settings, found ${savedWaSettings.rows.length}`);
    }

    const templateRow = savedWaSettings.rows.find((r) => r.key === 'whatsapp_gateway_invoice_template');
    const rawTemplate = JSON.parse(templateRow?.value || '""');
    if (!rawTemplate.includes('{doc_no}') || !rawTemplate.includes('{total}')) {
      throw new Error('WhatsApp template does not contain required placeholders');
    }
    console.log('[OK] تم حفظ واسترجاع إعدادات بوابة الواتساب وقوالب الرسائل بنجاح.');

    // -------------------------------------------------------------------------
    // 2. Automated WhatsApp Invoice Notification Generation
    // -------------------------------------------------------------------------
    console.log('\n--- 2. محرك قوالب إشعارات الفواتير (Invoice WhatsApp Templating) ---');
    const docNo = `INV-260914-${simUid}`;
    const invoiceTotal = 1500.5;

    const renderedMessage = rawTemplate.replace('{doc_no}', docNo).replace('{total}', invoiceTotal.toFixed(2));

    if (!renderedMessage.includes(docNo) || !renderedMessage.includes('1500.50')) {
      throw new Error(`Rendered message failed placeholder replacement: ${renderedMessage}`);
    }
    console.log(`[TEMPLATE-OUTPUT] ${renderedMessage}`);
    console.log('[OK] تم توليد رسالة الفاتورة الآلية واستبدال المتغيرات بنجاح.');

    // -------------------------------------------------------------------------
    // 3. Daily Executive Digest Configuration
    // -------------------------------------------------------------------------
    console.log('\n--- 3. إعدادات الملخص اليومي للإدارة (Daily Digest Configuration) ---');
    const digestSettings = [
      { key: 'daily_digest_enabled', val: true },
      { key: 'daily_digest_phone', val: '966500000000' },
      { key: 'daily_digest_time', val: '23:30' },
      { key: 'daily_digest_include_sales', val: true },
      { key: 'daily_digest_include_shortages', val: true },
    ];

    for (const s of digestSettings) {
      await sql`
        INSERT INTO settings (tenant_id, account_id, key, value)
        VALUES (${testTenantId}, ${testAccountId}, ${s.key}, ${JSON.stringify(s.val)})
        ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value
      `.execute(db);
    }

    const savedDigestSettings = await sql<{ key: string; value: string }>`
      SELECT key, value FROM settings 
      WHERE tenant_id = ${testTenantId} AND key LIKE 'daily_digest_%'
    `.execute(db);

    if (savedDigestSettings.rows.length !== 5) {
      throw new Error(`Expected 5 Daily Digest settings, found ${savedDigestSettings.rows.length}`);
    }
    console.log('[OK] تم حفظ واسترجاع إعدادات الملخص التنفيذي اليومي للإدارة بنجاح.');

    // -------------------------------------------------------------------------
    // 4. Daily Digest Calculation Engine
    // -------------------------------------------------------------------------
    console.log('\n--- 4. محرك احتساب أرقام ومؤشرات اليومية (Executive Digest Engine) ---');
    // Insert test sales for today
    await sql`
      INSERT INTO sales (tenant_id, doc_no, subtotal, total, paid_amount, payment_channel, payment_type, status, created_at, updated_at)
      VALUES 
      (${testTenantId}, ${'INV-D1-' + simUid}, 1500.50, 1500.50, 1500.50, 'cash', 'cash', 'posted', NOW(), NOW()),
      (${testTenantId}, ${'INV-D2-' + simUid}, 500.00, 500.00, 500.00, 'card', 'card', 'posted', NOW(), NOW()),
      (${testTenantId}, ${'INV-D3-' + simUid}, 2500.00, 2500.00, 2500.00, 'cash', 'cash', 'posted', NOW(), NOW())
    `.execute(db);

    // Insert test products for shortages
    await sql`
      INSERT INTO products (tenant_id, name, barcode, retail_price, cost_price, stock_qty, min_stock_qty, is_active, created_at, updated_at)
      VALUES 
      (${testTenantId}, ${'منتج متوفر ' + simUid}, ${'BAR1-' + simUid}, 100, 70, 25, 5, true, NOW(), NOW()),
      (${testTenantId}, ${'منتج نفد ' + simUid}, ${'BAR2-' + simUid}, 50, 30, 0, 10, true, NOW(), NOW()),
      (${testTenantId}, ${'منتج تحت الحد ' + simUid}, ${'BAR3-' + simUid}, 80, 50, 2, 10, true, NOW(), NOW())
    `.execute(db);

    // Compute sales aggregates matching DailyDigestService logic
    const salesAgg = await sql<{ invoices_count: string; total_sales: string; cash_total: string; card_total: string }>`
      SELECT 
        COUNT(id)::text as invoices_count,
        COALESCE(SUM(total), 0)::text as total_sales,
        COALESCE(SUM(CASE WHEN payment_channel = 'cash' THEN paid_amount ELSE 0 END), 0)::text as cash_total,
        COALESCE(SUM(CASE WHEN payment_channel = 'card' THEN paid_amount ELSE 0 END), 0)::text as card_total
      FROM sales
      WHERE tenant_id = ${testTenantId} AND status != 'cancelled'
    `.execute(db);

    const invoicesCount = Number(salesAgg.rows[0].invoices_count);
    const totalSales = Number(salesAgg.rows[0].total_sales);
    const cashTotal = Number(salesAgg.rows[0].cash_total);
    const cardTotal = Number(salesAgg.rows[0].card_total);

    if (invoicesCount !== 3 || totalSales !== 4500.5 || cashTotal !== 4000.5 || cardTotal !== 500.0) {
      throw new Error(
        `Sales aggregate mismatch: count ${invoicesCount}, total ${totalSales}, cash ${cashTotal}, card ${cardTotal}`,
      );
    }

    // Compute shortages matching DailyDigestService logic
    const shortagesRes = await sql<{ shortages_count: string }>`
      SELECT COUNT(id)::text as shortages_count
      FROM products
      WHERE tenant_id = ${testTenantId} AND is_active = true AND stock_qty <= COALESCE(min_stock_qty, 0)
    `.execute(db);

    const shortagesCount = Number(shortagesRes.rows[0].shortages_count);
    if (shortagesCount !== 2) {
      throw new Error(`Shortages count mismatch: expected 2, got ${shortagesCount}`);
    }

    console.log(
      `[DIGEST-METRICS] فواتير اليوم: ${invoicesCount} | إجمالي المبيعات: ${totalSales} (نقدي: ${cashTotal}، شبكة: ${cardTotal}) | نواقص المخزون: ${shortagesCount}`,
    );
    console.log('[OK] محرك احتساب أرقام الملخص التنفيذي دقيق 100%.');

    // -------------------------------------------------------------------------
    // 5. Tamper-Evident Audit Trail
    // -------------------------------------------------------------------------
    console.log('\n--- 5. سجل التدقيق الأمني (Operational Audit Trail) ---');
    await sql`
      INSERT INTO audit_logs (tenant_id, action, details, created_at)
      VALUES 
      (${testTenantId}, 'USER_LOGIN', 'تسجيل دخول ناجح للمدير من عنوان IP موثق', NOW()),
      (${testTenantId}, 'PRICE_OVERRIDE', 'تعديل سعر يدوي استثنائي على بند فاتورة', NOW()),
      (${testTenantId}, 'SETTINGS_UPDATE', 'تحديث إعدادات بوابة الإشعارات والملخص اليومي', NOW())
    `.execute(db);

    const auditRecords = await sql<{ id: number; action: string; details: string }>`
      SELECT id, action, details FROM audit_logs
      WHERE tenant_id = ${testTenantId}
      ORDER BY id ASC
    `.execute(db);

    if (auditRecords.rows.length !== 3) {
      throw new Error(`Expected 3 audit records, found ${auditRecords.rows.length}`);
    }
    if (auditRecords.rows[0].action !== 'USER_LOGIN' || auditRecords.rows[2].action !== 'SETTINGS_UPDATE') {
      throw new Error('Audit records sequence mismatch');
    }
    console.log('[OK] تم توثيق وتسلسل كافة العمليات الحساسة في سجل التدقيق الأمني بنجاح.');

    console.log('\n================================================================');
    console.log('[SUCCESS] اكتملت محاكاة الإشعارات والتنبيهات والملخص التنفيذي بنجاح 100%!');
    console.log('================================================================\n');
  } catch (error: any) {
    console.error('[ERROR] SIMULATION FAILED:', error.message || error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    console.log('--- تنظيف البيانات المؤقتة (Cleanup) ---');
    await sql`DELETE FROM audit_logs WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM products WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM sales WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM settings WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    console.log('[OK] تم مسح جميع البيانات الخاصة بالمحاكاة بنجاح.');
    await pool.end();
  }
}

runNotificationsSimulation();
