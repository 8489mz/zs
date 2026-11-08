import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { ForbiddenException } from '@nestjs/common';
import { REQUIRED_PERMISSIONS_KEY } from '../../src/core/auth/decorators/permissions.decorator';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { PermissionsGuard } from '../../src/core/auth/guards/permissions.guard';
import { CatalogController } from '../../src/modules/catalog/catalog.controller';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';

type ProductRow = {
  id: number;
  name: string;
  barcode: string | null;
  sku?: string | null;
  item_kind: 'standard' | 'fashion';
  style_code: string | null;
  color: string | null;
  size: string | null;
  category_id: number | null;
  retail_price: number;
  wholesale_price: number;
  stock_qty: number;
  min_stock_qty: number;
  is_active: boolean;
};

type UnitRow = {
  id: number;
  product_id: number;
  name: string;
  multiplier: number;
  barcode: string | null;
  is_base_unit: boolean;
  is_sale_unit_default: boolean;
  is_purchase_unit_default: boolean;
};

const cashier: AuthContext = {
  userId: 10,
  sessionId: 'session-pos',
  username: 'cashier',
  role: 'cashier',
  permissions: ['sales'],
  tenantId: 'tenant-a',
  accountId: 'account-a',
};

class FakeSelectBuilder {
  private filters: Array<{ column: string; op: string; value: unknown; lower?: boolean }> = [];
  private hasExpressionFilter = false;
  private rowLimit = 1000;

  constructor(private readonly table: string, private readonly db: FakeDb) {}

  select(): this { return this; }
  leftJoin(): this { return this; }
  innerJoin(): this { return this; }
  orderBy(): this { return this; }

  where(columnOrExpression: unknown, op?: string, value?: unknown): this {
    if (typeof columnOrExpression === 'string') {
      this.filters.push({ column: columnOrExpression, op: String(op || ''), value });
      return this;
    }
    // Kysely sql`LOWER(<column>) = ${value}` templates (INV-POS-BARCODE-DASH):
    // production compares barcodes/SKUs case-insensitively, so model that by
    // extracting the column and the bound value from the template node. Any
    // other template (tenant predicate, search expression) stays an opaque
    // expression filter exactly as before.
    const node = (columnOrExpression as any)?.toOperationNode?.();
    const fragments: string[] = node?.sqlFragments || [];
    const parameters: Array<{ value?: unknown }> = node?.parameters || [];
    const lowerMatch = fragments.join(' ').match(/LOWER\(\s*(p\.barcode|p\.sku|pu\.barcode)\s*\)/i);
    if (lowerMatch && parameters.length > 0) {
      this.filters.push({ column: lowerMatch[1].toLowerCase(), op: '=', value: parameters[0]?.value, lower: true });
      return this;
    }
    this.hasExpressionFilter = true;
    return this;
  }

  limit(value: number): this {
    this.rowLimit = value;
    if (this.table === 'products as p') this.db.lastProductQueryLimit = value;
    return this;
  }

  async execute(): Promise<Array<Record<string, unknown>>> {
    if (this.table === 'products as p') return this.executeProductLookup();
    if (this.table === 'product_units as pu') return this.executeUnitBarcodeLookup();
    if (this.table === 'product_units') return this.executeUnitList();
    if (this.table === 'product_location_stock as pls') return [];
    return [];
  }

  private executeProductLookup(): Array<Record<string, unknown>> {
    const barcodeFilter = this.filters.find((filter) => filter.column === 'p.barcode' && filter.op === '=');
    let rows = this.db.products.filter((product) => product.is_active);
    if (barcodeFilter) {
      rows = rows.filter((product) => barcodeFilter.lower
        ? String(product.barcode || '').toLowerCase() === String(barcodeFilter.value || '').toLowerCase()
        : product.barcode === barcodeFilter.value);
    }
    const skuFilter = this.filters.find((filter) => filter.column === 'p.sku' && filter.op === '=');
    if (skuFilter) {
      rows = rows.filter((product) => skuFilter.lower
        ? String(product.sku || '').toLowerCase() === String(skuFilter.value || '').toLowerCase()
        : product.sku === skuFilter.value);
    }
    const categoryFilter = this.filters.find((filter) => filter.column === 'p.category_id' && filter.op === '=');
    if (categoryFilter) {
      rows = rows.filter((product) => Number(product.category_id) === Number(categoryFilter.value));
    }
    if (!barcodeFilter && this.hasExpressionFilter && this.db.searchNeedle) {
      const needle = this.db.searchNeedle.toLowerCase();
      rows = rows.filter((product) => {
        const unitHaystack = this.db.productUnits
          .filter((unit) => unit.product_id === product.id)
          .flatMap((unit) => [unit.name, unit.barcode || ''])
          .join(' ')
          .toLowerCase();
        const haystack = [
          product.name,
          product.barcode || '',
          product.style_code || '',
          unitHaystack,
        ].join(' ').toLowerCase();
        return haystack.includes(needle);
      });
    }
    return rows.slice(0, this.rowLimit).map(({ is_active: _isActive, ...product }) => product);
  }

  private executeUnitBarcodeLookup(): Array<Record<string, unknown>> {
    const barcodeFilter = this.filters.find((filter) => filter.column === 'pu.barcode' && filter.op === '=');
    const excludedIds = this.filters.find((filter) => filter.column === 'p.id' && filter.op === 'not in')?.value;
    const excluded = Array.isArray(excludedIds) ? excludedIds.map(Number) : [];
    const matchingUnits = this.db.productUnits
      .filter((unit) => !barcodeFilter || (barcodeFilter.lower
        ? String(unit.barcode || '').toLowerCase() === String(barcodeFilter.value || '').toLowerCase()
        : unit.barcode === barcodeFilter.value))
      .filter((unit) => !excluded.includes(Number(unit.product_id)))
      .slice(0, this.rowLimit);

    return matchingUnits.flatMap((unit) => {
      const product = this.db.products.find((entry) => entry.id === unit.product_id && entry.is_active);
      if (!product) return [];
      const { is_active: _isActive, ...productFields } = product;
      return [{
        ...productFields,
        matched_unit_id: unit.id,
        matched_unit_name: unit.name,
        matched_unit_multiplier: unit.multiplier,
        matched_unit_barcode: unit.barcode,
      }];
    });
  }

  private executeUnitList(): Array<Record<string, unknown>> {
    const ids = this.filters.find((filter) => filter.column === 'product_id' && filter.op === 'in')?.value;
    const productIds = Array.isArray(ids) ? ids.map(Number) : [];
    return this.db.productUnits.filter((unit) => productIds.includes(Number(unit.product_id))).slice(0, this.rowLimit);
  }
}

class FakeDb {
  products: ProductRow[] = [
    product(1, 'Milk', '111', 9),
    product(2, 'Coffee', '222', 22),
  ];
  productUnits: UnitRow[] = [
    unit(10, 1, 'قطعة', '111'),
    unit(20, 2, 'كرتونة', 'BOX222'),
  ];
  lastProductQueryLimit = 0;
  searchNeedle = '';

  selectFrom(table: string): FakeSelectBuilder {
    return new FakeSelectBuilder(table, this);
  }
}

function product(id: number, name: string, barcode: string, retailPrice: number, categoryId: number | null = null): ProductRow {
  return {
    id,
    name,
    barcode,
    item_kind: 'standard',
    style_code: `SKU-${id}`,
    color: null,
    size: null,
    category_id: categoryId,
    retail_price: retailPrice,
    wholesale_price: Math.max(1, retailPrice - 2),
    stock_qty: 12,
    min_stock_qty: 2,
    is_active: true,
  };
}

function unit(id: number, productId: number, name: string, barcode: string): UnitRow {
  return {
    id,
    product_id: productId,
    name,
    multiplier: name === 'كرتونة' ? 12 : 1,
    barcode,
    is_base_unit: name === 'قطعة',
    is_sale_unit_default: name === 'قطعة',
    is_purchase_unit_default: name === 'كرتونة',
  };
}

function createService(db = new FakeDb()): { db: FakeDb; service: CatalogProductService } {
  const service = new CatalogProductService(
    db as any,
    {} as any,
    { assertLocationScope: async (locationId: number) => ({ id: locationId, name: 'Main', branchId: 1 }) } as any,
  );
  return { db, service };
}

function productIds(result: Record<string, unknown>): string[] {
  return (result.products as Array<Record<string, unknown>>).map((entry) => String(entry.id));
}

async function run(): Promise<void> {
  {
    const { service } = createService();
    const result = await service.listPosProducts({ barcode: '111' }, cashier);
    assert.deepEqual(productIds(result), ['1']);
    assert.equal((result.products as Array<Record<string, unknown>>)[0].barcode, '111');
  }

  {
    const db = new FakeDb();
    db.products[1].sku = 'BLACK-XL-42';
    const { service } = createService(db);
    const result = await service.listPosProducts({ barcode: 'BLACK-XL-42' }, cashier);
    assert.deepEqual(productIds(result), ['2'], 'Scanner must resolve an exact fashion SKU');
  }

  {
    const { service } = createService();
    const result = await service.listPosProducts({ barcode: 'BOX222' }, cashier);
    const [matched] = result.products as Array<Record<string, unknown>>;
    assert.equal(matched.id, '2');
    assert.deepEqual(matched.matchedUnit, { id: '20', name: 'كرتونة', multiplier: 12, barcode: 'BOX222' });
  }

  {
    const db = new FakeDb();
    db.products = [
      product(1, 'Fresh Milk', 'MILK-1', 9),
      product(2, 'Rice Bag', 'RICE-1', 7),
      product(3, 'Milk Powder', 'MILK-2', 11),
    ];
    db.searchNeedle = 'milk';
    const { service } = createService(db);
    const result = await service.listPosProducts({ q: 'milk', limit: 5 }, cashier);
    assert.deepEqual(productIds(result), ['1', '3']);
    assert.equal(db.lastProductQueryLimit, 5);
  }

  {
    const db = new FakeDb();
    db.products = Array.from({ length: 80 }, (_entry, index) => product(index + 1, `Product ${index + 1}`, `BC-${index + 1}`, index + 1));
    const { service } = createService(db);
    const result = await service.listPosProducts({ q: 'product', limit: 500 }, cashier);
    assert.equal((result.products as Array<Record<string, unknown>>).length, 80);
    assert.equal((result.meta as Record<string, unknown>).limit, 500);
    assert.equal(db.lastProductQueryLimit, 500);
  }

  {
    // INV-POS-CATEGORY-TILE-FILTER: a category tile must return that
    // category's products even when they sit outside the bounded browse
    // window (first 300 by name). The server filter — not the client-side
    // filter over the loaded page — is what makes the tile work.
    const db = new FakeDb();
    db.products = [
      product(1, 'AAA First', 'A-1', 9, 7),
      product(2, 'BBB Second', 'B-2', 9, 8),
      product(3, 'CCC Third', 'C-3', 11, 7),
    ];
    const { service } = createService(db);
    const result = await service.listPosProducts({ categoryId: 7 }, cashier);
    assert.deepEqual(productIds(result), ['1', '3']);
    assert.equal((result.meta as Record<string, unknown>).categoryId, 7);
  }

  {
    const db = new FakeDb();
    db.products = [
      product(1, 'AAA First', 'A-1', 9, 7),
      product(2, 'BBB Second', 'B-2', 9, 8),
    ];
    const { service } = createService(db);
    const result = await service.listPosProducts({}, cashier);
    assert.deepEqual(productIds(result), ['1', '2'], 'no category filter: browse window unchanged');
  }

  {
    // An exact barcode still wins even when its product is in another category.
    const db = new FakeDb();
    db.products = [
      product(1, 'AAA First', 'A-1', 9, 7),
      product(2, 'BBB Second', 'B-2', 9, 8),
    ];
    const { service } = createService(db);
    const result = await service.listPosProducts({ barcode: 'B-2', categoryId: 7 }, cashier);
    assert.deepEqual(productIds(result), ['2']);
  }

  {
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, CatalogController.prototype.listPosProducts), ['sales']);
    const guard = new PermissionsGuard(
      { getAllAndOverride: () => ['sales'] } as any,
      {
        hasAllPermissions: (granted: string[], required: string[]) => required.every((permission) => granted.includes(permission)),
        hasAnyPermission: (granted: string[], required: string[]) => required.some((permission) => granted.includes(permission)),
      } as any,
      { hasFeature: () => true } as any,
      {} as any
    );
    assert.equal(guard.canActivate({ getHandler: () => null, getClass: () => CatalogController, switchToHttp: () => ({ getRequest: () => ({ authContext: cashier }) }) } as any), true);
    assert.throws(
      () => guard.canActivate({ getHandler: () => null, getClass: () => CatalogController, switchToHttp: () => ({ getRequest: () => ({ authContext: { ...cashier, permissions: [] } }) }) } as any),
      ForbiddenException,
    );
  }

  console.log('pos-product-lookup.spec: ok');
}

void run();
