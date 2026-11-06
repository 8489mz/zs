/* Copilot live answers (INV-COPILOT-LIVE-ANSWERS): the copilot must split
 * cash/card from sale_payments (not SUM(paid_amount) as cash), answer
 * supplier and product-by-name questions directly without the daily
 * snapshot, and never claim stock is stable from a tool run that never
 * happened. Drives AiAgentService.chat() with no API key (deterministic
 * local fallback, no network).
 *
 * Seed math: 5 live sales today (100 cash tender / 250 card tender /
 * 300 mixed tender cash 100 + card 200 / 50 cash legacy no tenders /
 * 70 card legacy no tenders) + 1 cancelled 999 (excluded) ->
 * total 770, cash 250, card 520. Suppliers: ledger 200,000 + 152,500
 * = 352,500 while suppliers.balance stays 0 (the tool reads the ledger,
 * not the balance column). Stock: out-of-stock 1 (stock 0), low 2
 * (stock 0 and stock 2 with min 5); 'سماعات بلوتوث' stock 7.
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
  await sql`CREATE TABLE sale_payments (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id INTEGER NOT NULL DEFAULT 1, sale_id INTEGER NOT NULL, payment_channel TEXT NOT NULL DEFAULT 'cash', amount NUMERIC(14,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);
  await sql`CREATE TABLE treasury_transactions (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id INTEGER NOT NULL DEFAULT 1, txn_type TEXT NOT NULL DEFAULT 'deposit', amount NUMERIC(14,2) NOT NULL DEFAULT 0, note TEXT, reference_type TEXT, reference_id INTEGER, return_document_id INTEGER, branch_id INTEGER, location_id INTEGER, created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);
  await sql`CREATE TABLE ai_chat_sessions (id VARCHAR(64) PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, user_id INTEGER, title VARCHAR(255) NOT NULL DEFAULT 'محادثة جديدة', is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`.execute(db);
  await sql`CREATE TABLE ai_chat_messages (id SERIAL PRIMARY KEY, session_id VARCHAR(64) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE, tenant_id VARCHAR(50) NOT NULL, role VARCHAR(20) NOT NULL, content TEXT NOT NULL, reasoning_steps JSONB DEFAULT '[]'::jsonb, tool_calls JSONB DEFAULT '[]'::jsonb, suggested_questions JSONB DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT now())`.execute(db);

  await db.insertInto('settings').values({ tenant_id: TENANT, currency: 'EGP', business_timezone: 'Africa/Cairo' }).execute();
  await db.insertInto('product_categories').values({ id: 1, tenant_id: TENANT, name: 'إلكترونيات' }).execute();
  await db
    .insertInto('products')
    .values([
      { id: 1, tenant_id: TENANT, account_id: 1, name: 'سماعات بلوتوث', name_en: 'Bluetooth Headphones', stock_qty: 7, min_stock_qty: 5, retail_price: 850, cost_price: 600, is_active: true, category_id: 1 },
      { id: 2, tenant_id: TENANT, account_id: 1, name: 'كابل شحن', stock_qty: 0, min_stock_qty: 0, retail_price: 120, cost_price: 80, is_active: true, category_id: 1 },
      { id: 3, tenant_id: TENANT, account_id: 1, name: 'غطاء موبايل', stock_qty: 2, min_stock_qty: 5, retail_price: 60, cost_price: 40, is_active: true, category_id: 1 },
      { id: 4, tenant_id: TENANT, account_id: 1, name: 'شاحن سريع', stock_qty: 50, min_stock_qty: 5, retail_price: 400, cost_price: 300, is_active: true, category_id: 1 },
    ])
    .execute();
  await db.insertInto('customers').values({ id: 1, tenant_id: TENANT, name: 'عميل نقدي', phone: '01000000000', balance: 0 }).execute();
  await db
    .insertInto('suppliers')
    .values([
      { id: 1, tenant_id: TENANT, name: 'المورد الأول', phone: '01111111111', balance: 0, is_active: true },
      { id: 2, tenant_id: TENANT, name: 'المورد الثاني', phone: '01222222222', balance: 0, is_active: true },
    ])
    .execute();
  await db
    .insertInto('supplier_ledger')
    .values([
      { tenant_id: TENANT, account_id: 1, supplier_id: 1, entry_type: 'purchase', amount: 200000, balance_after: 200000 },
      { tenant_id: TENANT, account_id: 1, supplier_id: 2, entry_type: 'purchase', amount: 152500, balance_after: 152500 },
    ])
    .execute();
  await db
    .insertInto('sales')
    .values([
      { id: 1, tenant_id: TENANT, account_id: 1, doc_no: 'S-1', customer_id: 1, status: 'posted', total: 100, paid_amount: 100, subtotal: 100, payment_type: 'cash', payment_channel: 'cash', created_by: 1 },
      { id: 2, tenant_id: TENANT, account_id: 1, doc_no: 'S-2', customer_id: 1, status: 'posted', total: 250, paid_amount: 250, subtotal: 250, payment_type: 'cash', payment_channel: 'card', created_by: 1 },
      { id: 3, tenant_id: TENANT, account_id: 1, doc_no: 'S-3', customer_id: 1, status: 'posted', total: 300, paid_amount: 300, subtotal: 300, payment_type: 'cash', payment_channel: 'mixed', created_by: 1 },
      { id: 4, tenant_id: TENANT, account_id: 1, doc_no: 'S-4', customer_id: 1, status: 'posted', total: 50, paid_amount: 50, subtotal: 50, payment_type: 'cash', payment_channel: 'cash', created_by: 1 },
      { id: 5, tenant_id: TENANT, account_id: 1, doc_no: 'S-5', customer_id: 1, status: 'posted', total: 70, paid_amount: 70, subtotal: 70, payment_type: 'cash', payment_channel: 'card', created_by: 1 },
      { id: 6, tenant_id: TENANT, account_id: 1, doc_no: 'S-6', customer_id: 1, status: 'cancelled', total: 999, paid_amount: 999, subtotal: 999, payment_type: 'cash', payment_channel: 'cash', created_by: 1 },
    ])
    .execute();
  await db
    .insertInto('sale_payments')
    .values([
      { tenant_id: TENANT, account_id: 1, sale_id: 1, payment_channel: 'cash', amount: 100 },
      { tenant_id: TENANT, account_id: 1, sale_id: 2, payment_channel: 'card', amount: 250 },
      { tenant_id: TENANT, account_id: 1, sale_id: 3, payment_channel: 'cash', amount: 100 },
      { tenant_id: TENANT, account_id: 1, sale_id: 3, payment_channel: 'card', amount: 200 },
      { tenant_id: TENANT, account_id: 1, sale_id: 6, payment_channel: 'cash', amount: 999 },
    ])
    .execute();
  await db.insertInto('treasury_transactions').values({ tenant_id: TENANT, account_id: 1, txn_type: 'deposit', amount: 10000 }).execute();

  const service = new AiAgentService(db as never, { searchKnowledge: async () => [] } as never);
  const freshSession = () => `sess_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

  // (أ) Cash/card split: card money must never be reported as cash.
  const daily = await service.chat('مبيعات اليوم كام والنقدية المحصلة؟', freshSession(), ACTOR);
  assert.ok(daily.answer.includes('770 ج.م'), `total sales should be 770, got: ${daily.answer}`);
  assert.ok(daily.answer.includes('النقدية المحصلة: **250 ج.م**'), `cash should be 250, got: ${daily.answer}`);
  assert.ok(daily.answer.includes('البطاقات المحصلة: **520 ج.م**'), `card should be 520, got: ${daily.answer}`);
  assert.ok(!daily.answer.includes('999'), `cancelled sale must not leak into the answer: ${daily.answer}`);

  // (ب1) Supplier question: ledger total + top suppliers, no daily snapshot.
  const supp = await service.chat('مستحقات الموردين كام؟', freshSession(), ACTOR);
  assert.ok(supp.answer.includes('352,500'), `supplier debt should be 352,500, got: ${supp.answer}`);
  assert.ok(supp.answer.includes('المورد الأول'), `top supplier 1 missing: ${supp.answer}`);
  assert.ok(supp.answer.includes('المورد الثاني'), `top supplier 2 missing: ${supp.answer}`);
  assert.ok(!supp.answer.includes('الموقف التشغيلي'), `supplier answer must not paste the daily snapshot: ${supp.answer}`);

  // (ب2) Product-by-name question: the product's actual stock, no snapshot.
  const prod = await service.chat('سماعات بلوتوث مخزونها كام؟', freshSession(), ACTOR);
  assert.ok(prod.answer.includes('سماعات بلوتوث'), `product name missing: ${prod.answer}`);
  assert.ok(prod.answer.includes('**7**'), `product stock should be 7, got: ${prod.answer}`);
  assert.ok(!prod.answer.includes('الموقف التشغيلي'), `product answer must not paste the daily snapshot: ${prod.answer}`);

  // (ج) Same session, two topics: no contradictory stock verdicts.
  const session = freshSession();
  const first = await service.chat('مستحقات الموردين كام؟', session, ACTOR);
  assert.ok(!first.answer.includes('المخزون مستقر'), `supplier question must not claim stock is stable: ${first.answer}`);
  assert.ok(!first.answer.includes('نواقص') && !first.answer.includes('منخفضة'), `supplier question must carry no stock verdict: ${first.answer}`);
  const second = await service.chat('المخزون فيه نواقص؟', session, ACTOR);
  assert.ok(second.answer.includes('منخفضة'), `stock question must warn about low stock: ${second.answer}`);
  assert.ok(second.answer.includes('**2**'), `low-stock count should be 2, got: ${second.answer}`);
  assert.ok(second.answer.includes('نافدة'), `stock question must name the out-of-stock count: ${second.answer}`);
  assert.ok(second.answer.includes('**1**'), `out-of-stock count should be 1, got: ${second.answer}`);

  // (ج2) A question that reaches the default template without the stock
  // tool running ('خزينة' triggers no tool) must carry NO stock sentence
  // at all — the old code claimed 'المخزون مستقر' from an empty list.
  const treasuryOnly = await service.chat('الخزينة فيها كام دلوقتي؟', freshSession(), ACTOR);
  assert.ok(!treasuryOnly.answer.includes('المخزون'), `no stock sentence when the stock tool never ran: ${treasuryOnly.answer}`);
  assert.ok(treasuryOnly.answer.includes('10,000'), `treasury balance should be 10,000: ${treasuryOnly.answer}`);

  await db.destroy();
  console.log('copilot-live-answers: PASS (5 cases)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
