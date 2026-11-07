/* Copilot top sellers + empty state (INV-COPILOT-TOP-SELLER-EMPTY-STATE):
 * the agent modal never calls the legacy ask() that owns the only
 * top-seller query, so top-5 questions had no real data and the LLM
 * invented product names; a zero-match product lookup fell through to
 * the unrelated daily summary. This spec drives AiAgentService.chat()
 * with no API key (deterministic local fallback, no network).
 *
 * Seed math: قهوة عربي qty 10 + شاي أخضر qty 3 in the last 30 days;
 * a cancelled sale (قهوة عربي qty 100) and a 40-day-old sale (شاي
 * أخضر qty 50) are both excluded -> top list is قهوة عربي 10 first,
 * شاي أخضر 3 second. Stock: قهوة عربي 20, شاي أخضر 15; no
 * 'سماعات بلوتوث' product exists anywhere in the fixture.
 *
 * Honest limit: this spec pins the deterministic local fallback only;
 * the LLM prompt rule ("never invent product names") is verified by
 * inspection/grep, not executed without an API key.
 */
import assert from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { AiAgentService } from '../../src/modules/ai-copilot/services/ai-agent.service';

const TENANT = 't1';
const ACTOR: any = {
  userId: 1,
  sessionId: 's1',
  username: 'admin',
  role: 'admin',
  permissions: ['*'],
  tenantId: TENANT,
  accountId: 'a1',
};

async function main() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });

  await sql`CREATE TABLE settings (tenant_id VARCHAR(50) PRIMARY KEY, currency VARCHAR(10) NOT NULL DEFAULT 'EGP', business_timezone TEXT NOT NULL DEFAULT 'Africa/Cairo')`.execute(db);
  await sql`CREATE TABLE products (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, name_en TEXT, stock_qty NUMERIC(14,3) NOT NULL DEFAULT 0, min_stock_qty NUMERIC(14,3) NOT NULL DEFAULT 0, retail_price NUMERIC(14,2) NOT NULL DEFAULT 0, cost_price NUMERIC(14,2) NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, category_id INTEGER)`.execute(db);
  await sql`CREATE TABLE product_categories (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, name TEXT NOT NULL)`.execute(db);
  await sql`CREATE TABLE customers (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, name TEXT NOT NULL, phone TEXT, balance NUMERIC(14,2) NOT NULL DEFAULT 0)`.execute(db);
  await sql`CREATE TABLE suppliers (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, name TEXT NOT NULL, phone TEXT, balance NUMERIC(14,2) NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true)`.execute(db);
  await sql`CREATE TABLE supplier_ledger (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id INTEGER NOT NULL DEFAULT 1, supplier_id INTEGER NOT NULL, entry_type VARCHAR(30) NOT NULL DEFAULT 'purchase', amount NUMERIC(14,2) NOT NULL DEFAULT 0, balance_after NUMERIC(14,2), note TEXT, reference_type TEXT, reference_id INTEGER, return_document_id INTEGER, branch_id INTEGER, location_id INTEGER, created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);
  await sql`CREATE TABLE sales (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id INTEGER NOT NULL DEFAULT 1, doc_no TEXT, customer_id INTEGER, status TEXT NOT NULL DEFAULT 'posted', total NUMERIC(14,2) NOT NULL DEFAULT 0, paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0, store_credit_used NUMERIC(14,2) NOT NULL DEFAULT 0, discount NUMERIC(14,2) NOT NULL DEFAULT 0, tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0, subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, prices_include_tax BOOLEAN NOT NULL DEFAULT false, payment_type TEXT NOT NULL DEFAULT 'cash', payment_channel TEXT NOT NULL DEFAULT 'cash', branch_id INTEGER, location_id INTEGER, created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), exchange_return_id INTEGER)`.execute(db);
  await sql`CREATE TABLE sale_items (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id INTEGER NOT NULL DEFAULT 1, sale_id INTEGER NOT NULL, product_id INTEGER, product_name TEXT NOT NULL, qty NUMERIC(14,3) NOT NULL DEFAULT 0, unit_price NUMERIC(14,2) NOT NULL DEFAULT 0, line_total NUMERIC(14,2) NOT NULL DEFAULT 0, unit_name TEXT NOT NULL DEFAULT '', unit_multiplier NUMERIC(14,3) NOT NULL DEFAULT 1, cost_price NUMERIC(14,2) NOT NULL DEFAULT 0, price_type TEXT NOT NULL DEFAULT 'retail')`.execute(db);
  await sql`CREATE TABLE sale_payments (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id INTEGER NOT NULL DEFAULT 1, sale_id INTEGER NOT NULL, payment_channel TEXT NOT NULL DEFAULT 'cash', amount NUMERIC(14,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);
  await sql`CREATE TABLE treasury_transactions (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id INTEGER NOT NULL DEFAULT 1, txn_type TEXT NOT NULL DEFAULT 'deposit', amount NUMERIC(14,2) NOT NULL DEFAULT 0, note TEXT, reference_type TEXT, reference_id INTEGER, return_document_id INTEGER, branch_id INTEGER, location_id INTEGER, created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);
  await sql`CREATE TABLE ai_chat_sessions (id VARCHAR(64) PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, user_id INTEGER, title VARCHAR(255) NOT NULL DEFAULT 'محادثة جديدة', is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`.execute(db);
  await sql`CREATE TABLE ai_chat_messages (id SERIAL PRIMARY KEY, session_id VARCHAR(64) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE, tenant_id VARCHAR(50) NOT NULL, role VARCHAR(20) NOT NULL, content TEXT NOT NULL, reasoning_steps JSONB DEFAULT '[]'::jsonb, tool_calls JSONB DEFAULT '[]'::jsonb, suggested_questions JSONB DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT now())`.execute(db);

  await db.insertInto('settings').values({ tenant_id: TENANT, currency: 'EGP', business_timezone: 'Africa/Cairo' }).execute();
  await db.insertInto('product_categories').values({ id: 1, tenant_id: TENANT, name: 'مشروبات' }).execute();
  await db
    .insertInto('products')
    .values([
      { id: 1, tenant_id: TENANT, account_id: 1, name: 'قهوة عربي', name_en: 'Arabic Coffee', stock_qty: 20, min_stock_qty: 5, retail_price: 150, cost_price: 100, is_active: true, category_id: 1 },
      { id: 2, tenant_id: TENANT, account_id: 1, name: 'شاي أخضر', name_en: 'Green Tea', stock_qty: 15, min_stock_qty: 5, retail_price: 80, cost_price: 50, is_active: true, category_id: 1 },
    ])
    .execute();
  await db.insertInto('customers').values({ id: 1, tenant_id: TENANT, name: 'عميل نقدي', phone: '01000000000', balance: 0 }).execute();
  const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await db
    .insertInto('sales')
    .values([
      { id: 1, tenant_id: TENANT, account_id: 1, doc_no: 'S-1', customer_id: 1, status: 'posted', total: 1500, paid_amount: 1500, subtotal: 1500, payment_type: 'cash', payment_channel: 'cash', created_by: 1 },
      { id: 2, tenant_id: TENANT, account_id: 1, doc_no: 'S-2', customer_id: 1, status: 'posted', total: 240, paid_amount: 240, subtotal: 240, payment_type: 'cash', payment_channel: 'cash', created_by: 1 },
      { id: 3, tenant_id: TENANT, account_id: 1, doc_no: 'S-3', customer_id: 1, status: 'cancelled', total: 15000, paid_amount: 15000, subtotal: 15000, payment_type: 'cash', payment_channel: 'cash', created_by: 1 },
      { id: 4, tenant_id: TENANT, account_id: 1, doc_no: 'S-4', customer_id: 1, status: 'posted', total: 4000, paid_amount: 4000, subtotal: 4000, payment_type: 'cash', payment_channel: 'cash', created_by: 1, created_at: fortyDaysAgo },
    ])
    .execute();
  await db
    .insertInto('sale_items')
    .values([
      { tenant_id: TENANT, account_id: 1, sale_id: 1, product_id: 1, product_name: 'قهوة عربي', qty: 10, unit_price: 150, line_total: 1500, unit_name: 'قطعة', unit_multiplier: 1, cost_price: 100, price_type: 'retail' },
      { tenant_id: TENANT, account_id: 1, sale_id: 2, product_id: 2, product_name: 'شاي أخضر', qty: 3, unit_price: 80, line_total: 240, unit_name: 'قطعة', unit_multiplier: 1, cost_price: 50, price_type: 'retail' },
      { tenant_id: TENANT, account_id: 1, sale_id: 3, product_id: 1, product_name: 'قهوة عربي', qty: 100, unit_price: 150, line_total: 15000, unit_name: 'قطعة', unit_multiplier: 1, cost_price: 100, price_type: 'retail' },
      { tenant_id: TENANT, account_id: 1, sale_id: 4, product_id: 2, product_name: 'شاي أخضر', qty: 50, unit_price: 80, line_total: 4000, unit_name: 'قطعة', unit_multiplier: 1, cost_price: 50, price_type: 'retail' },
    ])
    .execute();

  const service = new AiAgentService(db as never, { searchKnowledge: async () => [] } as never);
  const freshSession = () => `sess_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

  // (1) Top sellers: real 30-day ranking, cancelled + >30-day excluded,
  // and no invented product name ever appears.
  const top = await service.chat('أكتر 5 منتجات مبيعاً', freshSession(), ACTOR);
  assert.ok(top.answer.includes('قهوة عربي'), `top seller A missing: ${top.answer}`);
  assert.ok(top.answer.includes('شاي أخضر'), `top seller B missing: ${top.answer}`);
  assert.ok(top.answer.indexOf('قهوة عربي') < top.answer.indexOf('شاي أخضر'), `A (qty 10) must rank before B (qty 3): ${top.answer}`);
  assert.ok(top.answer.includes('10'), `A quantity should be 10: ${top.answer}`);
  assert.ok(!top.answer.includes('100'), `cancelled sale qty 100 must be excluded: ${top.answer}`);
  assert.ok(!top.answer.includes('50'), `40-day-old sale qty 50 must be excluded: ${top.answer}`);
  assert.ok(!top.answer.includes('بلوتوث'), `phantom product must never be named: ${top.answer}`);
  assert.ok(!top.answer.includes('سماعات'), `phantom product must never be named: ${top.answer}`);

  // (2) Zero sales in 30 days: explicit empty answer, names no product.
  await db.deleteFrom('sale_items').execute();
  await db.deleteFrom('sales').execute();
  const empty = await service.chat('أكتر 5 منتجات مبيعاً', freshSession(), ACTOR);
  assert.ok(empty.answer.includes('لا توجد مبيعات'), `empty top-seller answer expected: ${empty.answer}`);
  assert.ok(!empty.answer.includes('قهوة عربي'), `empty answer must name no product: ${empty.answer}`);
  assert.ok(!empty.answer.includes('شاي أخضر'), `empty answer must name no product: ${empty.answer}`);
  assert.ok(!empty.answer.includes('بلوتوث'), `empty answer must name no product: ${empty.answer}`);

  // (3) Unknown product: not-found answer naming the term, never the
  // daily summary snapshot.
  const missing = await service.chat('سماعات بلوتوث مخزونها كام؟', freshSession(), ACTOR);
  assert.ok(missing.answer.includes('لا يوجد صنف باسم'), `not-found wording expected: ${missing.answer}`);
  assert.ok(missing.answer.includes('سماعات بلوتوث'), `not-found answer must name the searched term: ${missing.answer}`);
  assert.ok(!missing.answer.includes('الموقف التشغيلي'), `not-found answer must not paste the daily snapshot: ${missing.answer}`);

  // (4) Batch 3 regression: an existing product still returns its real stock.
  const prod = await service.chat('قهوة عربي مخزونها كام؟', freshSession(), ACTOR);
  assert.ok(prod.answer.includes('قهوة عربي'), `product name missing: ${prod.answer}`);
  assert.ok(prod.answer.includes('**20**'), `product stock should be 20, got: ${prod.answer}`);
  assert.ok(!prod.answer.includes('الموقف التشغيلي'), `product answer must not paste the daily snapshot: ${prod.answer}`);

  await db.destroy();
  console.log('copilot-top-seller: PASS (4 cases)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
