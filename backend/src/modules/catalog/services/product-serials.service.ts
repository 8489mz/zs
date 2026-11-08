import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';

export interface ProductSerialItemInput {
  serialNumber: string;
  imei2?: string | null;
  costPrice?: number;
  branchId?: number | null;
  locationId?: number | null;
  purchaseId?: number | null;
  purchaseItemId?: number | null;
  warrantyEndDate?: string | null;
  notes?: string | null;
}

@Injectable()
export class ProductSerialsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  private scope(actor: AuthContext) {
    return requireTenantScope(actor);
  }

  private tenantPredicate(actor: AuthContext, alias?: string) {
    const { tenantId, accountId } = this.scope(actor);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId} AND (${sql.ref(`${alias}.account_id`)} = ${accountId} OR ${sql.ref(`${alias}.account_id`)} = ${tenantId} OR ${sql.ref(`${alias}.account_id`)} IS NULL)`
      : sql<boolean>`tenant_id = ${tenantId} AND (account_id = ${accountId} OR account_id = ${tenantId} OR account_id IS NULL)`;
  }

  async listSerials(
    productId: number,
    query: { status?: string; search?: string; locationId?: number; branchId?: number },
    actor: AuthContext,
  ) {
    const scope = this.scope(actor);
    let q = this.db
      .selectFrom('product_serials as ps')
      .leftJoin('stock_locations as sl', 'sl.id', 'ps.location_id')
      .leftJoin('branches as b', 'b.id', 'ps.branch_id')
      .select([
        'ps.id',
        'ps.product_id',
        'ps.serial_number',
        'ps.imei_2',
        'ps.status',
        'ps.branch_id',
        'ps.location_id',
        'ps.cost_price',
        'ps.purchase_id',
        'ps.purchase_item_id',
        'ps.sale_id',
        'ps.sale_item_id',
        'ps.warranty_end_date',
        'ps.notes',
        'ps.created_at',
        'sl.name as location_name',
        'b.name as branch_name',
      ])
      .where('ps.product_id', '=', productId)
      .where(this.tenantPredicate(actor, 'ps'));

    if (query.status) {
      q = q.where('ps.status', '=', query.status as any);
    }

    if (query.locationId) {
      q = q.where('ps.location_id', '=', query.locationId);
    }

    if (query.branchId) {
      q = q.where('ps.branch_id', '=', query.branchId);
    }

    if (query.search) {
      const searchTerm = `%${query.search.trim().toLowerCase()}%`;
      q = q.where((eb) =>
        eb.or([
          sql<boolean>`LOWER(ps.serial_number) LIKE ${searchTerm}`,
          sql<boolean>`LOWER(ps.imei_2) LIKE ${searchTerm}`,
          sql<boolean>`LOWER(ps.notes) LIKE ${searchTerm}`,
        ]),
      );
    }

    const rows = await q.orderBy('ps.id', 'desc').execute();

    return {
      serials: rows.map((r) => ({
        id: String(r.id),
        productId: String(r.product_id),
        serialNumber: r.serial_number,
        imei2: r.imei_2 || '',
        status: r.status,
        branchId: r.branch_id ? String(r.branch_id) : null,
        branchName: r.branch_name || '',
        locationId: r.location_id ? String(r.location_id) : null,
        locationName: r.location_name || '',
        costPrice: Number(r.cost_price || 0),
        purchaseId: r.purchase_id ? String(r.purchase_id) : null,
        saleId: r.sale_id ? String(r.sale_id) : null,
        warrantyEndDate: r.warranty_end_date || null,
        notes: r.notes || '',
        createdAt: r.created_at,
      })),
    };
  }

  async lookupSerial(serialOrImei: string, actor: AuthContext) {
    const cleanSerial = serialOrImei.trim();
    // LF-P4: the response key is `item`, not `serial`. The only frontend
    // consumer (frontend/src/features/products/api/product-serials.api.ts)
    // reads `res?.item`, so the old `serial` key never reached the IMEI
    // history page: serialItem was always null and the header could never
    // show the price / branch / warranty the query already selected.
    if (!cleanSerial) return { found: false, item: null };

    const row = await this.db
      .selectFrom('product_serials as ps')
      .innerJoin('products as p', 'p.id', 'ps.product_id')
      .leftJoin('stock_locations as sl', 'sl.id', 'ps.location_id')
      .leftJoin('branches as b', 'b.id', 'ps.branch_id')
      // R2-A: the sale/purchase document details the IMEI header reads.
      // ps.sale_id is stamped by markSerialsSold, ps.purchase_id by the
      // purchase intake; the doc numbers and partner names live on the
      // joined rows (sales.doc_no, purchases.doc_no, suppliers.name).
      // Customer name/phone: the sale row itself carries the sale-time
      // snapshot (sales.customer_name / customer_phone) and the customers
      // table carries the canonical record — snapshot wins, table is the
      // fallback, exactly the dual-source pattern of
      // sales-query.service.ts (s.customer_name + c.name as
      // customer_name_ref). Nothing is invented: a missing join leaves
      // null and the page keeps its honest fallback text.
      .leftJoin('sales as s', 's.id', 'ps.sale_id')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .leftJoin('purchases as pu', 'pu.id', 'ps.purchase_id')
      .leftJoin('suppliers as sup', 'sup.id', 'pu.supplier_id')
      .select([
        'ps.id',
        'ps.product_id',
        'ps.serial_number',
        'ps.imei_2',
        'ps.status',
        'ps.branch_id',
        'ps.location_id',
        'ps.cost_price',
        'ps.warranty_end_date',
        'ps.notes',
        'ps.sale_id',
        'ps.purchase_id',
        'p.name as product_name',
        'p.barcode as product_barcode',
        'p.retail_price as product_retail_price',
        'p.wholesale_price as product_wholesale_price',
        'sl.name as location_name',
        'b.name as branch_name',
        's.doc_no as sale_doc_no',
        's.customer_name as sale_customer_name',
        's.customer_phone as sale_customer_phone',
        'c.name as customer_name_ref',
        'c.phone as customer_phone_ref',
        'pu.doc_no as purchase_doc_no',
        'sup.name as supplier_name',
      ])
      .where(this.tenantPredicate(actor, 'ps'))
      .where((eb) =>
        eb.or([
          sql<boolean>`LOWER(ps.serial_number) = ${cleanSerial.toLowerCase()}`,
          sql<boolean>`LOWER(ps.imei_2) = ${cleanSerial.toLowerCase()}`,
        ]),
      )
      .executeTakeFirst();

    if (!row) {
      return { found: false, item: null };
    }

    return {
      found: true,
      // LF-P4: `item` is the key the frontend lookup client reads.
      // branchName / locationName stay honestly empty when the serial row
      // has no branch/location (trade-in intake records none, and its
      // stock lands in the unassigned balance, so no stock-location
      // fallback could recover a real one — never invent one here).
      item: {
        id: String(row.id),
        productId: String(row.product_id),
        productName: row.product_name,
        productBarcode: row.product_barcode || '',
        productRetailPrice: Number(row.product_retail_price || 0),
        productWholesalePrice: Number(row.product_wholesale_price || 0),
        serialNumber: row.serial_number,
        imei2: row.imei_2 || '',
        status: row.status,
        branchId: row.branch_id ? String(row.branch_id) : null,
        branchName: row.branch_name || '',
        locationId: row.location_id ? String(row.location_id) : null,
        locationName: row.location_name || '',
        costPrice: Number(row.cost_price || 0),
        warrantyEndDate: row.warranty_end_date || null,
        notes: row.notes || '',
        // R2-A: sale/purchase document details for the IMEI header
        // (frontend/src/features/products/pages/ImeiHistoryPage.tsx reads
        // exactly these fields; the type already declares them). Unsold
        // serials keep saleDocNo null so the page keeps showing
        // "لم يتم بيعه بعد"; a purchase with no doc/supplier keeps nulls
        // so the page keeps its tradeins[0] waiver fallback. The Z-<id>
        // fallback for a sale whose doc_no is null mirrors
        // sales-query.service.ts: `docNo: sale.doc_no || \`Z-${sale.id}\``
        // — derived from the real sale row, never invented.
        saleId: row.sale_id ? String(row.sale_id) : null,
        saleDocNo:
          row.sale_doc_no || (row.sale_id ? `Z-${row.sale_id}` : null),
        purchaseId: row.purchase_id ? String(row.purchase_id) : null,
        purchaseDocNo: row.purchase_doc_no || null,
        customerName:
          row.sale_customer_name || row.customer_name_ref || null,
        customerPhone:
          row.sale_customer_phone || row.customer_phone_ref || null,
        supplierName: row.supplier_name || null,
      },
    };
  }

  async addSerials(
    productId: number,
    items: ProductSerialItemInput[],
    actor: AuthContext,
    trx?: Kysely<Database>,
  ) {
    const scope = this.scope(actor);
    const db = trx || this.db;

    if (!items || items.length === 0) return { count: 0 };

    // Check for duplicates in the payload
    const serialSet = new Set<string>();
    for (const item of items) {
      const s = item.serialNumber.trim();
      if (!s) throw new AppError('Serial number / IMEI cannot be empty', 'SERIAL_EMPTY', 400);
      if (serialSet.has(s.toLowerCase())) {
        throw new AppError(`Duplicate serial number in input: ${s}`, 'SERIAL_DUPLICATE_IN_INPUT', 400);
      }
      serialSet.add(s.toLowerCase());
    }

    // Check for existing serials in DB
    const existing = await db
      .selectFrom('product_serials')
      .select(['serial_number', 'status'])
      .where(this.tenantPredicate(actor))
      .where(sql<boolean>`LOWER(serial_number) in (${sql.join(Array.from(serialSet))})`)
      .execute();

    if (existing.length > 0) {
      const existingSerials = existing.map((e) => e.serial_number).join(', ');
      throw new AppError(`Serial number(s) already exist in database: ${existingSerials}`, 'SERIAL_ALREADY_EXISTS', 400);
    }

    const rowsToInsert = items.map((item) => ({
      tenant_id: scope.tenantId,
      account_id: scope.accountId,
      product_id: productId,
      serial_number: item.serialNumber.trim(),
      imei_2: item.imei2?.trim() || null,
      status: 'in_stock' as const,
      branch_id: item.branchId || null,
      location_id: item.locationId || null,
      cost_price: Number(item.costPrice || 0),
      purchase_id: item.purchaseId || null,
      purchase_item_id: item.purchaseItemId || null,
      warranty_end_date: item.warrantyEndDate || null,
      notes: item.notes || null,
    }));

    await db.insertInto('product_serials').values(rowsToInsert as any).execute();

    await this.audit.log(
      'إضافة سريالات أجهزة',
      `تم تسجيل ${items.length} رقم سريال/IMEI للمنتج #${productId} بواسطة ${actor.username}`,
      actor,
    );

    return { count: items.length };
  }

  async markSerialsSold(
    saleId: number,
    saleItemId: number,
    productId: number,
    serialNumbers: string[],
    actor: AuthContext,
    trx?: Kysely<Database>,
  ) {
    if (!serialNumbers || serialNumbers.length === 0) return;
    const db = trx || this.db;
    const cleanSerials = serialNumbers.map((s) => s.trim().toLowerCase());

    const result = await db
      .updateTable('product_serials')
      .set({
        status: 'sold',
        sale_id: saleId,
        sale_item_id: saleItemId,
        updated_at: sql`NOW()`,
      })
      .where(this.tenantPredicate(actor))
      .where('product_id', '=', productId)
      .where(sql<boolean>`LOWER(serial_number) in (${sql.join(cleanSerials)})`)
      .executeTakeFirst();

    return result;
  }

  async markSerialsReturned(
    returnItemId: number,
    serialNumbers: string[],
    actor: AuthContext,
    trx?: Kysely<Database>,
  ) {
    if (!serialNumbers || serialNumbers.length === 0) return;
    const db = trx || this.db;
    const cleanSerials = serialNumbers.map((s) => s.trim().toLowerCase());

    const result = await db
      .updateTable('product_serials')
      .set({
        status: 'in_stock',
        sale_id: null,
        sale_item_id: null,
        updated_at: sql`NOW()`,
      })
      .where(this.tenantPredicate(actor))
      .where(sql<boolean>`LOWER(serial_number) in (${sql.join(cleanSerials)})`)
      .executeTakeFirst();

    return result;
  }
}
