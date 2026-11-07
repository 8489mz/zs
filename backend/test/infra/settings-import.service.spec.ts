import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { SettingsImportService } from '../../src/modules/settings/services/settings-import.service';

const tenantId = 'tenant-test';
const accountId = 'account-test';

type DbState = {
  customers: Array<Record<string, unknown>>;
  customer_ledger: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
  product_units: Array<Record<string, unknown>>;
  product_categories: Array<Record<string, unknown>>;
  suppliers: Array<Record<string, unknown>>;
  stock_locations: Array<Record<string, unknown>>;
  product_location_stock: Array<Record<string, unknown>>;
  nextCustomerId: number;
  nextProductId: number;
  nextUnitId: number;
  nextCategoryId: number;
  nextSupplierId: number;
  nextLocationId: number;
};

function createState(): DbState {
  return {
    customers: [],
    customer_ledger: [],
    products: [],
    product_units: [],
    product_categories: [],
    suppliers: [],
    stock_locations: [],
    product_location_stock: [],
    nextCustomerId: 1,
    nextProductId: 1,
    nextUnitId: 1,
    nextCategoryId: 1,
    nextSupplierId: 1,
    nextLocationId: 1,
  };
}

class FakeSelectBuilder {
  private conditions: Array<{ column: unknown; value: unknown }> = [];
  constructor(private readonly table: string, private readonly state: DbState) {}
  select(): this { return this; }
  selectAll(): this { return this; }
  orderBy(): this { return this; }
  where(column: unknown, _op?: string, value?: unknown): this { this.conditions.push({ column, value }); return this; }
  async execute() {
    if (this.table === 'stock_locations') {
      return this.state.stock_locations.filter((row) => row.tenant_id === tenantId && row.is_active !== false);
    }
    if (this.table === 'accounting_accounts') {
      return [
        { id: 1140, code: '1140', is_active: true },
        { id: 3100, code: '3100', is_active: true },
      ];
    }
    return [];
  }
  async executeTakeFirst() {
    if (this.table === 'customers') {
      const phone = this.conditions.find((entry) => entry.column === 'phone')?.value;
      const loweredName = this.conditions.find((entry) => typeof entry.column !== 'string')?.value;
      const isActive = this.conditions.some((entry) => entry.column === 'is_active' && entry.value === true);
      return this.state.customers.find((row) => {
        if (row.tenant_id !== tenantId || row.is_active !== isActive) return false;
        if (typeof phone === 'string' && phone) return row.phone === phone;
        if (typeof loweredName === 'string') return String(row.name || '').toLowerCase() === loweredName;
        return false;
      });
    }
    if (this.table === 'products') {
      const barcode = this.conditions.find((entry) => entry.column === 'barcode')?.value;
      const loweredName = this.conditions.find((entry) => typeof entry.column !== 'string')?.value;
      return this.state.products.find((row) => {
        if (row.tenant_id !== tenantId) return false;
        if (typeof barcode === 'string' && barcode) return row.barcode === barcode;
        if (typeof loweredName === 'string') return String(row.name || '').toLowerCase() === loweredName;
        return false;
      });
    }
    if (this.table === 'branches') {
      return { id: 1, name: 'الفرع الرئيسي', default_stock_location_id: 1 };
    }
    return undefined;
  }
}

class FakeDeleteBuilder {
  private conditions: Array<{ column: unknown; value: unknown }> = [];
  constructor(private readonly table: string, private readonly state: DbState) {}
  where(column: unknown, _op?: string, value?: unknown): this { this.conditions.push({ column, value }); return this; }
  async execute() {
    if (this.table === 'product_units') {
      const productId = this.conditions.find((c) => c.column === 'product_id')?.value;
      if (productId != null) {
        this.state.product_units = this.state.product_units.filter((u) => u.product_id !== Number(productId));
      }
    }
  }
}

class FakeInsertBuilder {
  private payload: Record<string, unknown> = {};
  constructor(private readonly table: string, private readonly state: DbState, private readonly failOnCustomerNumber: number | null) {}
  values(payload: Record<string, unknown>): this { this.payload = payload; return this; }
  returning(): this { return this; }
  async execute() {
    if (this.table === 'customer_ledger') {
      this.state.customer_ledger.push({ ...this.payload });
    } else if (this.table === 'product_units') {
      const id = this.state.nextUnitId++;
      this.state.product_units.push({ id, ...this.payload });
    } else if (this.table === 'product_location_stock') {
      this.state.product_location_stock.push({ ...this.payload });
    }
  }
  async executeTakeFirstOrThrow() {
    if (this.table === 'customers') {
      const id = this.state.nextCustomerId;
      if (this.failOnCustomerNumber === id) throw new Error(`forced_customer_insert_failure_${id}`);
      this.state.nextCustomerId += 1;
      const row = { id, ...this.payload };
      this.state.customers.push(row);
      return { id };
    }
    if (this.table === 'products') {
      const id = this.state.nextProductId++;
      const row = { id, ...this.payload };
      this.state.products.push(row);
      return { id };
    }
    if (this.table === 'product_categories') {
      const id = this.state.nextCategoryId++;
      return { id };
    }
    if (this.table === 'suppliers') {
      const id = this.state.nextSupplierId++;
      return { id };
    }
    if (this.table === 'stock_locations') {
      const id = this.state.nextLocationId++;
      const row = { id, tenant_id: tenantId, is_active: true, ...this.payload };
      this.state.stock_locations.push(row);
      return { id, branch_id: (row as any).branch_id ?? null };
    }
    throw new Error(`Unsupported insert table: ${this.table}`);
  }
}

class FakeUpdateBuilder {
  private payload: Record<string, unknown> = {};
  private id = 0;
  constructor(private readonly table: string, private readonly state: DbState) {}
  set(payload: Record<string, unknown>): this { this.payload = payload; return this; }
  where(column: unknown, _op?: string, value?: unknown): this { if (column === 'id') this.id = Number(value || 0); return this; }
  async execute() {
    const list = this.table === 'customers' ? this.state.customers : this.state.products;
    const row = list.find((entry) => entry.id === this.id && entry.tenant_id === tenantId);
    if (row) Object.assign(row, this.payload);
  }
}

class FakeDb {
  constructor(public state: DbState, private readonly failOnCustomerNumber: number | null = null) {}
  selectFrom(table: string) { return new FakeSelectBuilder(table, this.state); }
  insertInto(table: string) { return new FakeInsertBuilder(table, this.state, this.failOnCustomerNumber); }
  updateTable(table: string) { return new FakeUpdateBuilder(table, this.state); }
  deleteFrom(table: string) { return new FakeDeleteBuilder(table, this.state); }
  transaction() {
    return { execute: async <T>(work: (trx: FakeDb) => Promise<T>) => {
      const snapshot = JSON.parse(JSON.stringify(this.state)) as DbState;
      const trxDb = new FakeDb(snapshot, this.failOnCustomerNumber);
      const result = await work(trxDb);
      this.state = trxDb.state;
      return result;
    } };
  }
}

function createService(failOnCustomerNumber: number | null = null) {
  const db = new FakeDb(createState(), failOnCustomerNumber);
  const auditCalls: string[] = [];
  const journals: Array<Record<string, any>> = [];
  const postingStub = {
    postDomainJournal: async (_trx: unknown, params: Record<string, any>) => {
      journals.push(params);
      return 999;
    },
  };
  const service = new SettingsImportService(db as any, { log: async (action: string) => { auditCalls.push(action); } } as any, postingStub as any);
  return { db, service, auditCalls, journals };
}

const actor = { userId: 7, username: 'owner', role: 'super_admin', permissions: ['settings'], tenantId, accountId } as any;

async function run(): Promise<void> {
  {
    const { db, service, auditCalls } = createService(2);
    await assert.rejects(() => service.importCustomers([
      { name: 'Alice', phone: '1', openingBalance: 25 },
      { name: 'Bob', phone: '2', openingBalance: 40 },
    ], actor), /forced_customer_insert_failure_2/);
    assert.equal(db.state.customers.length, 0);
    assert.equal(db.state.customer_ledger.length, 0);
    assert.deepEqual(auditCalls, []);
  }

  {
    const { db, service, auditCalls } = createService();
    const result = await service.importCustomers([
      { name: 'Alice', phone: '1', openingBalance: 25 },
      { name: 'Bob', phone: '2', openingBalance: 40 },
    ], actor);
    assert.equal(result.ok, true);
    assert.equal(result.inserted, 2);
    assert.equal(db.state.customers.length, 2);
    assert.equal(db.state.customer_ledger.length, 2);
    assert.equal(db.state.customers[0]?.tenant_id, tenantId);
    assert.equal(db.state.customers[0]?.account_id, accountId);
    assert.equal(db.state.customer_ledger[0]?.tenant_id, tenantId);
    assert.equal(db.state.customer_ledger[0]?.account_id, accountId);
    assert.equal(Number(db.state.customers[0]?.balance), 25);
    assert.equal(Number(db.state.customers[1]?.balance), 40);
    assert.equal(auditCalls.length, 1);
  }

  {
    // Test importCustomers with Van and wholesale metadata
    const { db, service } = createService();
    const result = await service.importCustomers([
      {
        'اسم العميل / المحل (إجباري)': 'سوبرماركت الأمل',
        'كود المحل / العميل': 'CUST-1001',
        'رقم الموبايل': '01012345678',
        'خط السير / مسار التوزيع': 'خط الهرم',
        'الحي / المربع السكني': 'العشرين',
        'العنوان التفصيلي': 'شارع فيصل',
        'يوم الزيارة الأسبوعي': 'الإثنين',
        'أيام الزيارة (إن تعددت)': 'الإثنين، الخميس',
        'ترتيب خط السير': 1,
        'المندوب المسؤول / المخصص': 'أحمد محمود',
        'رابط الموقع / GPS': 'https://maps.google.com/?q=30,31',
        'فئة السعر': 'جملة',
        'نوع النشاط / التصنيف': 'سوبرماركت',
        'نوع العميل (نقدي / آجل)': 'wholesale',
        'الحد الائتماني': 5000,
        'رصيد افتتاحي': 1200,
      },
    ], actor);
    assert.equal(result.ok, true);
    assert.equal(result.inserted, 1);
    assert.equal(db.state.customers.length, 1);
    const cust = db.state.customers[0];
    assert.equal(cust?.name, 'سوبرماركت الأمل');
    assert.equal(cust?.phone, '01012345678');
    assert.equal(cust?.customer_type, 'wholesale');
    assert.equal(Number(cust?.credit_limit), 5000);
    assert.equal(Number(cust?.balance), 1200);
    const meta = JSON.parse(cust?.metadata as string);
    assert.equal(meta.customer_code, 'CUST-1001');
    assert.equal(meta.route, 'خط الهرم');
    assert.equal(meta.district, 'العشرين');
    assert.equal(meta.visit_day, 'الإثنين');
    assert.deepEqual(meta.visit_days, ['الإثنين', 'الخميس']);
    assert.equal(meta.route_sequence, 1);
    assert.equal(meta.assigned_rep_name, 'أحمد محمود');
    assert.equal(meta.price_tier, 'جملة');
    assert.equal(meta.category, 'سوبرماركت');
  }

  {
    // Test importProducts with units (Piece + Carton) from Excel columns
    const { db, service, journals } = createService();
    const result = await service.importProducts([
      {
        'اسم الصنف (إجباري)': 'شاحن سامسونج أصلي',
        'الباركود': '622800800',
        'سعر التكلفة': 500,
        'سعر البيع': 750,
        'سعر الجملة': 600,
        'الكمية': 24,
        'وحدة القياس الأساسية': 'قطعة',
        'وحدة البيع': 'قطعة',
        'وحدة الشراء': 'كرتونة',
        'اسم وحدة إضافية': 'كرتونة',
        'معامل الوحدة الإضافية': 12,
        'باركود الوحدة الإضافية': '622800801',
      },
    ], actor);

    assert.equal(result.ok, true);
    assert.equal(result.inserted, 1);
    assert.equal(db.state.products.length, 1);
    assert.equal(db.state.products[0]?.name, 'شاحن سامسونج أصلي');
    assert.equal(Number(db.state.products[0]?.cost_price), 500);
    assert.equal(Number(db.state.products[0]?.retail_price), 750);
    assert.equal(Number(db.state.products[0]?.wholesale_price), 600);

    // INV-GL-INVENTORY-VALUE: the 24 units at cost 500 above must post
    // the opening-stock journal Dr 1140 / Cr 3100 for 12,000 — the
    // fixture that used to create stock with no journal at all.
    assert.equal(journals.length, 1, 'imported opening stock posts one journal');
    assert.equal(journals[0].sourceType, 'catalog_opening_stock', 'journal source is the product opening stock');
    assert.deepEqual(
      (journals[0].lines as Array<Record<string, unknown>>).map((line) => [line.accountId, line.debit, line.credit]),
      [[1140, 12000, 0], [3100, 0, 12000]],
      '24 units at 500.00 debit 1140 12,000.00 and credit 3100 12,000.00',
    );

    // Verify units created
    assert.equal(db.state.product_units.length, 2);
    const baseUnit = db.state.product_units.find((u) => u.name === 'قطعة');
    assert.ok(baseUnit, 'Base unit قطعة must exist');
    assert.equal(baseUnit.multiplier, 1);
    assert.equal(baseUnit.barcode, '622800800');
    assert.equal(baseUnit.is_base_unit, true);
    assert.equal(baseUnit.is_sale_unit_default, true);
    assert.equal(baseUnit.is_purchase_unit_default, false);

    const extraUnit = db.state.product_units.find((u) => u.name === 'كرتونة');
    assert.ok(extraUnit, 'Extra unit كرتونة must exist');
    assert.equal(extraUnit.multiplier, 12);
    assert.equal(extraUnit.barcode, '622800801');
    assert.equal(extraUnit.is_base_unit, false);
    assert.equal(extraUnit.is_sale_unit_default, false);
    assert.equal(extraUnit.is_purchase_unit_default, true);

    // Test updating existing product with new carton multiplier (e.g. 24)
    const updateResult = await service.importProducts([
      {
        'اسم الصنف': 'شاحن سامسونج أصلي',
        'الباركود': '622800800',
        'سعر التكلفة': 480,
        'وحدة القياس': 'قطعة',
        'وحدة الشراء': 'كرتونة',
        'اسم وحدة إضافية': 'كرتونة',
        'معامل الوحدة الإضافية': 24,
      },
    ], actor);

    assert.equal(updateResult.ok, true);
    assert.equal(updateResult.updated, 1);
    assert.equal(db.state.products.length, 1);
    assert.equal(Number(db.state.products[0]?.cost_price), 480);

    // Verify units updated
    assert.equal(db.state.product_units.length, 2);
    const updatedExtraUnit = db.state.product_units.find((u) => u.name === 'كرتونة');
    assert.ok(updatedExtraUnit);
    assert.equal(updatedExtraUnit.multiplier, 24);
    assert.equal(updatedExtraUnit.is_purchase_unit_default, true);
    // The existing-product update posts no new journal.
    assert.equal(journals.length, 1, 'updating an existing product posts no journal');

    // Test location alias: When tenant has "رصيد الفرع الرئيسي", importing with "المخزن الرئيسي" maps to it without duplicate location
    db.state.stock_locations = [
      { id: 1, name: 'رصيد الفرع الرئيسي', branch_id: 1, tenant_id: tenantId, location_type: 'branch_stock', is_active: true }
    ];
    db.state.nextLocationId = 2;

    const locImportResult = await service.importProducts([
      {
        'اسم الصنف': 'ماوس لاسلكي',
        'الباركود': '622999001',
        'الكمية': 15,
        'المخزن': 'المخزن الرئيسي',
      },
    ], actor);

    assert.equal(locImportResult.ok, true);
    assert.equal(locImportResult.inserted, 1);
    // The zero-cost mouse posts no opening-stock journal.
    assert.equal(journals.length, 1, 'zero-cost import posts no journal');
    // Assert no second location was created!
    assert.equal(db.state.stock_locations.length, 1, 'Must NOT create duplicate location when alias or single location matches');
    assert.equal(db.state.stock_locations[0]?.name, 'رصيد الفرع الرئيسي');

    // Verify product_location_stock is mapped to location 1
    const locStock = db.state.product_location_stock.find((s) => s.location_id === 1 && s.qty === 15);
    assert.ok(locStock, 'Stock must be placed in primary location 1');
  }

  {
    // INV-IMPORT-CHUNKED-1000: one request carries at most 1,000 rows — a
    // single-shot 10,000-row call must fail closed instead of running one
    // minutes-long transaction that the edge answers with a 504.
    const { service } = createService();
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({ name: `Product ${i}`, barcode: `B${i}` }));
    try {
      await service.importProducts(tooMany, actor);
      assert.fail('expected the 1000-row cap to reject');
    } catch (error) {
      assert.equal((error as { code?: string }).code, 'IMPORT_ROWS_TOO_MANY');
    }
    // The same cap guards the other import routes.
    try {
      await service.importCustomers(tooMany, actor);
      assert.fail('expected the 1000-row cap to reject');
    } catch (error) {
      assert.equal((error as { code?: string }).code, 'IMPORT_ROWS_TOO_MANY');
    }
  }

  {
    // INV-IMPORT-CHUNKED-1000: nameless rows are counted as skipped instead of
    // silently dropped, so the chunked summary stays honest.
    const { db, service } = createService();
    const result = await service.importProducts([
      { name: '', barcode: '' },
      { name: 'Real Product', barcode: 'REAL-1', 'سعر البيع': 10 },
    ], actor);
    assert.equal(result.ok, true);
    assert.equal(result.inserted, 1);
    assert.equal(result.skipped, 1);
    assert.equal(db.state.products.length, 1);

    const customerResult = await service.importCustomers([
      { name: '', phone: '' },
      { name: 'Alice', phone: '1' },
    ], actor);
    assert.equal(customerResult.ok, true);
    assert.equal(customerResult.inserted, 1);
    assert.equal(customerResult.skipped, 1);
    assert.equal(db.state.customers.length, 1);
  }

  console.log('settings-import.service.spec: ok');
}

void run();
