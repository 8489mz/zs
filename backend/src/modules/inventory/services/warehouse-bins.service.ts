import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, Transaction, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { setScopedStockQty } from '../../../common/utils/location-stock-ledger';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';

export interface CreateBinDto {
  locationId: number;
  code: string;
  barcode?: string;
  aisle?: string;
  rack?: string;
  shelf?: string;
  bin?: string;
  capacity?: number;
  notes?: string;
}

export interface UpdateBinDto {
  code?: string;
  barcode?: string;
  aisle?: string;
  rack?: string;
  shelf?: string;
  bin?: string;
  capacity?: number;
  isActive?: boolean;
  notes?: string;
}

export interface QuickReassignDto {
  binId: number;
  productId: number;
  quantity: number;
  isPrimary?: boolean;
}

export interface QuickAuditUpdateDto {
  binId: number;
  productId: number;
  countedQty: number;
  notes?: string;
}

@Injectable()
export class WarehouseBinsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private assertInventoryAccess(auth: AuthContext): void {
    if (auth.role === 'super_admin' || auth.role === 'admin' || auth.permissions.includes('inventory')) {
      return;
    }
    throw new ForbiddenException('Missing required inventory permissions');
  }

  /**
   * INV-BIN-LEDGER-JOURNAL: a bin allocation is a slice of the location
   * stock, never a second stock of its own. Every bin write runs in one
   * transaction, locks products before product_location_stock before the
   * allocation row (canonical lock order), and records a stock_movements
   * row so a bin total can never diverge from location stock without a
   * trace. Quantities are 3dp throughout; only money rounds, at book digits.
   */
  private round3(value: number | string | null | undefined): number {
    return Number((Number(value || 0) + Number.EPSILON).toFixed(3));
  }

  private validateBinQty(value: unknown, label: string): number {
    const qty = Number(value);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new BadRequestException(`${label} must be zero or greater (received ${String(value)})`);
    }
    if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 0.000001) {
      throw new BadRequestException(`${label} must have at most three decimal places (received ${String(value)})`);
    }
    return this.round3(qty);
  }

  private async recordBinMovement(
    trx: Transaction<Database>,
    args: {
      scope: { tenantId: string; accountId: string };
      productId: number;
      movementType: string;
      delta: number;
      beforeQty: number;
      afterQty: number;
      referenceType: string;
      binId: number;
      branchId: number | null;
      locationId: number | null;
      unitCost: number;
      createdBy: number | null;
    },
  ): Promise<number> {
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, args.scope.tenantId));
    const totalCost = roundMoney(Math.abs(args.delta) * args.unitCost, moneyDigits);
    const inserted = await trx
      .insertInto('stock_movements')
      .values({
        product_id: args.productId,
        movement_type: args.movementType,
        qty: args.delta,
        before_qty: args.beforeQty,
        after_qty: args.afterQty,
        reason: args.referenceType,
        note: '',
        reference_type: args.referenceType,
        reference_id: args.binId,
        branch_id: args.branchId,
        location_id: args.locationId,
        created_by: args.createdBy,
        tenant_id: args.scope.tenantId,
        account_id: args.scope.accountId,
        unit_cost: args.unitCost,
        total_cost: totalCost,
      } as any)
      .returning('id')
      .executeTakeFirst();
    if (!inserted?.id) {
      throw new AppError('Failed to capture stock movement ID for bin posting', 'MOVEMENT_INSERT_FAILED', 500);
    }
    return Number(inserted.id);
  }

  private async upsertAllocation(
    trx: Transaction<Database>,
    args: {
      scope: { tenantId: string; accountId: string };
      binId: number;
      productId: number;
      quantity: number;
      isPrimary: boolean;
      existingId: number | null;
    },
  ): Promise<void> {
    if (args.existingId) {
      await trx
        .updateTable('product_bin_allocations')
        .set({
          quantity: args.quantity,
          is_primary: args.isPrimary,
          updated_at: sql`NOW()`,
        } as any)
        .where('id', '=', args.existingId)
        .where('tenant_id', '=', args.scope.tenantId)
        .execute();
    } else {
      await trx
        .insertInto('product_bin_allocations')
        .values({
          tenant_id: args.scope.tenantId,
          account_id: args.scope.accountId,
          bin_id: args.binId,
          product_id: args.productId,
          quantity: args.quantity,
          is_primary: args.isPrimary,
        })
        .execute();
    }
  }

  async listBins(query: { locationId?: number; search?: string }, auth: AuthContext): Promise<any[]> {
    this.assertInventoryAccess(auth);
    const scope = requireTenantScope(auth);

    let dbQuery = this.db
      .selectFrom('warehouse_bins as wb')
      .leftJoin('stock_locations as sl', (join) =>
        join.onRef('sl.id', '=', 'wb.location_id').on('sl.tenant_id', '=', scope.tenantId)
      )
      .leftJoin('product_bin_allocations as pba', (join) =>
        join.onRef('pba.bin_id', '=', 'wb.id').on('pba.tenant_id', '=', scope.tenantId)
      )
      .select([
        'wb.id',
        'wb.location_id as locationId',
        'sl.name as locationName',
        'wb.code',
        'wb.barcode',
        'wb.aisle',
        'wb.rack',
        'wb.shelf',
        'wb.bin',
        'wb.capacity',
        'wb.is_active as isActive',
        'wb.notes',
        'wb.created_at as createdAt',
        sql<number>`COUNT(DISTINCT pba.product_id)`.as('productsCount'),
        sql<number>`COALESCE(SUM(pba.quantity), 0)`.as('totalQuantityStored'),
      ])
      .where('wb.tenant_id', '=', scope.tenantId)
      .groupBy([
        'wb.id',
        'wb.location_id',
        'sl.name',
        'wb.code',
        'wb.barcode',
        'wb.aisle',
        'wb.rack',
        'wb.shelf',
        'wb.bin',
        'wb.capacity',
        'wb.is_active',
        'wb.notes',
        'wb.created_at',
      ]);

    if (query.locationId) {
      dbQuery = dbQuery.where('wb.location_id', '=', query.locationId);
    }

    if (query.search && query.search.trim()) {
      const pattern = `%${query.search.trim()}%`;
      dbQuery = dbQuery.where((eb) =>
        eb.or([
          eb('wb.code', 'ilike', pattern),
          eb('wb.barcode', 'ilike', pattern),
          eb('wb.aisle', 'ilike', pattern),
          eb('wb.rack', 'ilike', pattern),
        ])
      );
    }

    const rows = await dbQuery.orderBy('wb.id', 'desc').execute();

    return rows.map((r) => ({
      id: Number(r.id),
      locationId: Number(r.locationId),
      locationName: r.locationName || '',
      code: r.code,
      barcode: r.barcode,
      aisle: r.aisle || '',
      rack: r.rack || '',
      shelf: r.shelf || '',
      bin: r.bin || '',
      capacity: r.capacity ? Number(r.capacity) : null,
      isActive: Boolean(r.isActive),
      notes: r.notes || '',
      productsCount: Number(r.productsCount || 0),
      totalQuantityStored: Number(r.totalQuantityStored || 0),
      createdAt: r.createdAt,
    }));
  }

  async createBin(dto: CreateBinDto, auth: AuthContext): Promise<any> {
    this.assertInventoryAccess(auth);
    const scope = requireTenantScope(auth);

    const cleanCode = String(dto.code || '').trim().toUpperCase();
    if (!cleanCode) throw new BadRequestException('رمز مكان التخزين (Code) مطلوب');

    const barcode = dto.barcode?.trim() || `BIN-${dto.locationId}-${cleanCode}`;

    // Verify unique code per location
    const existing = await this.db
      .selectFrom('warehouse_bins')
      .select(['id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('location_id', '=', dto.locationId)
      .where('code', '=', cleanCode)
      .executeTakeFirst();

    if (existing) {
      throw new BadRequestException(`مكان التخزين بالرمز ${cleanCode} موجود بالفعل في هذا المستودع`);
    }

    const inserted = await this.db
      .insertInto('warehouse_bins')
      .values({
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        location_id: dto.locationId,
        code: cleanCode,
        barcode,
        aisle: dto.aisle?.trim() || null,
        rack: dto.rack?.trim() || null,
        shelf: dto.shelf?.trim() || null,
        bin: dto.bin?.trim() || null,
        capacity: dto.capacity || null,
        is_active: true,
        notes: dto.notes?.trim() || null,
      })
      .returning(['id', 'code', 'barcode'])
      .executeTakeFirstOrThrow();

    return inserted;
  }

  async updateBin(id: number, dto: UpdateBinDto, auth: AuthContext): Promise<any> {
    this.assertInventoryAccess(auth);
    const scope = requireTenantScope(auth);

    const bin = await this.db
      .selectFrom('warehouse_bins')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!bin) throw new NotFoundException('مكان التخزين غير موجود');

    const updates: any = { updated_at: sql`NOW()` };
    if (dto.code !== undefined) updates.code = dto.code.trim().toUpperCase();
    if (dto.barcode !== undefined) updates.barcode = dto.barcode.trim();
    if (dto.aisle !== undefined) updates.aisle = dto.aisle.trim();
    if (dto.rack !== undefined) updates.rack = dto.rack.trim();
    if (dto.shelf !== undefined) updates.shelf = dto.shelf.trim();
    if (dto.bin !== undefined) updates.bin = dto.bin.trim();
    if (dto.capacity !== undefined) updates.capacity = dto.capacity;
    if (dto.isActive !== undefined) updates.is_active = dto.isActive;
    if (dto.notes !== undefined) updates.notes = dto.notes.trim();

    await this.db
      .updateTable('warehouse_bins')
      .set(updates)
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    return { success: true };
  }

  async deleteBin(id: number, auth: AuthContext): Promise<any> {
    this.assertInventoryAccess(auth);
    const scope = requireTenantScope(auth);

    // Check allocations
    const count = await this.db
      .selectFrom('product_bin_allocations')
      .select(sql<number>`COUNT(*)`.as('count'))
      .where('bin_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (Number(count?.count || 0) > 0) {
      throw new BadRequestException('لا يمكن حذف مكان التخزين لوجود أصناف مخزنة به حالياً');
    }

    await this.db
      .deleteFrom('warehouse_bins')
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    return { success: true };
  }

  async scanAuditBin(barcodeOrCode: string, auth: AuthContext): Promise<any> {
    this.assertInventoryAccess(auth);
    const scope = requireTenantScope(auth);
    const query = String(barcodeOrCode || '').trim();

    if (!query) throw new BadRequestException('الباركود مطلوب');

    // 1. Try finding bin by barcode or code
    const bin = await this.db
      .selectFrom('warehouse_bins as wb')
      .leftJoin('stock_locations as sl', (join) =>
        join.onRef('sl.id', '=', 'wb.location_id').on('sl.tenant_id', '=', scope.tenantId)
      )
      .select([
        'wb.id',
        'wb.location_id as locationId',
        'sl.name as locationName',
        'wb.code',
        'wb.barcode',
        'wb.aisle',
        'wb.rack',
        'wb.shelf',
        'wb.bin',
        'wb.capacity',
        'wb.is_active as isActive',
        'wb.notes',
      ])
      .where('wb.tenant_id', '=', scope.tenantId)
      .where((eb) =>
        eb.or([
          eb('wb.barcode', '=', query),
          eb('wb.code', '=', query.toUpperCase()),
        ])
      )
      .executeTakeFirst();

    if (bin) {
      // Fetch all products stored in this bin
      const items = await this.db
        .selectFrom('product_bin_allocations as pba')
        .innerJoin('products as p', (join) =>
          join.onRef('p.id', '=', 'pba.product_id').on('p.tenant_id', '=', scope.tenantId)
        )
        .select([
          'pba.id as allocationId',
          'pba.product_id as productId',
          'p.name as productName',
          'p.barcode as productBarcode',
          'p.cost_price as costPrice',
          'p.retail_price as retailPrice',
          'pba.quantity',
          'pba.is_primary as isPrimary',
          'pba.updated_at as lastAuditedAt',
        ])
        .where('pba.bin_id', '=', bin.id)
        .where('pba.tenant_id', '=', scope.tenantId)
        .orderBy('pba.id', 'desc')
        .execute();

      return {
        type: 'bin',
        bin: {
          id: Number(bin.id),
          locationId: Number(bin.locationId),
          locationName: bin.locationName || '',
          code: bin.code,
          barcode: bin.barcode,
          aisle: bin.aisle || '',
          rack: bin.rack || '',
          shelf: bin.shelf || '',
          bin: bin.bin || '',
          capacity: bin.capacity ? Number(bin.capacity) : null,
          notes: bin.notes || '',
        },
        items: items.map((i) => ({
          allocationId: Number(i.allocationId),
          productId: Number(i.productId),
          productName: i.productName,
          productBarcode: i.productBarcode || '',
          costPrice: Number(i.costPrice || 0),
          retailPrice: Number(i.retailPrice || 0),
          quantity: Number(i.quantity || 0),
          isPrimary: Boolean(i.isPrimary),
          lastAuditedAt: i.lastAuditedAt,
        })),
      };
    }

    // 2. If not a bin barcode, try finding product by barcode
    const product = await this.db
      .selectFrom('products as p')
      .selectAll()
      .where('p.tenant_id', '=', scope.tenantId)
      .where((eb) => {
        const term = `%${normalizeArabicSearch(query)}%`;
        return eb.or([
          eb('p.barcode', '=', query),
          sql<boolean>`TRANSLATE(LOWER(COALESCE(p.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}`,
        ]);
      })
      .executeTakeFirst();

    if (product) {
      // Find all bins where this product is stored
      const bins = await this.db
        .selectFrom('product_bin_allocations as pba')
        .innerJoin('warehouse_bins as wb', (join) =>
          join.onRef('wb.id', '=', 'pba.bin_id').on('wb.tenant_id', '=', scope.tenantId)
        )
        .leftJoin('stock_locations as sl', (join) =>
          join.onRef('sl.id', '=', 'wb.location_id').on('sl.tenant_id', '=', scope.tenantId)
        )
        .select([
          'wb.id as binId',
          'wb.code as binCode',
          'wb.barcode as binBarcode',
          'sl.name as locationName',
          'wb.aisle',
          'wb.rack',
          'wb.shelf',
          'wb.bin',
          'pba.quantity',
          'pba.is_primary as isPrimary',
        ])
        .where('pba.product_id', '=', Number(product.id))
        .where('pba.tenant_id', '=', scope.tenantId)
        .execute();

      return {
        type: 'product',
        product: {
          id: Number(product.id),
          name: product.name,
          barcode: product.barcode || '',
          stockQty: Number(product.stock_qty || 0),
          binLocation: product.bin_location || '',
          primaryBinId: (product as any).primary_bin_id ? Number((product as any).primary_bin_id) : null,
        },
        allocatedBins: bins.map((b) => ({
          binId: Number(b.binId),
          binCode: b.binCode,
          binBarcode: b.binBarcode,
          locationName: b.locationName || '',
          aisle: b.aisle || '',
          rack: b.rack || '',
          shelf: b.shelf || '',
          bin: b.bin || '',
          quantity: Number(b.quantity || 0),
          isPrimary: Boolean(b.isPrimary),
        })),
      };
    }

    throw new NotFoundException(`لم يتم العثور على رف أو صنف يطابق الباركود: ${query}`);
  }

  /**
   * PURE REALLOCATION: quickReassignProduct only re-slices an unchanged
   * location quantity between bins, so it moves NO location stock and
   * posts NO journal. The bin slice is capped at the location stock
   * minus what other bins in the same location already hold, so the
   * bin total can never exceed the location stock. The slice delta is
   * still recorded as a stock_movements row (bin_reassign) so the
   * audit trail exists. A bin-to-bin move is two calls: shrink the
   * source bin first, then grow the target bin.
   */
  async quickReassignProduct(dto: QuickReassignDto, auth: AuthContext): Promise<any> {
    this.assertInventoryAccess(auth);
    const scope = requireTenantScope(auth);
    const quantity = this.validateBinQty(dto.quantity, 'Bin quantity');

    return this.tx.runInTransaction(this.db, async (trx) => {
      const bin = await trx
        .selectFrom('warehouse_bins')
        .selectAll()
        .where('id', '=', dto.binId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();

      if (!bin) throw new NotFoundException('مكان التخزين غير موجود');

      const locationId = Number(bin.location_id);
      const location = await trx
        .selectFrom('stock_locations')
        .selectAll()
        .where('id', '=', locationId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      const branchId = location?.branch_id == null ? null : Number(location.branch_id);

      // Canonical lock order: products before product_location_stock before allocations.
      const product = await trx
        .selectFrom('products')
        .selectAll()
        .where('id', '=', dto.productId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!product) throw new NotFoundException('الصنف غير موجود');

      const locationStock = await trx
        .selectFrom('product_location_stock')
        .select(['qty'])
        .where('product_id', '=', dto.productId)
        .where('location_id', '=', locationId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();
      const locationQty = this.round3(locationStock?.qty ?? 0);

      const other = await trx
        .selectFrom('product_bin_allocations as pba')
        .innerJoin('warehouse_bins as wb', (join) =>
          join.onRef('wb.id', '=', 'pba.bin_id').on('wb.tenant_id', '=', scope.tenantId),
        )
        .select(sql<number>`COALESCE(SUM(pba.quantity), 0)`.as('total'))
        .where('pba.product_id', '=', dto.productId)
        .where('pba.tenant_id', '=', scope.tenantId)
        .where('wb.location_id', '=', locationId)
        .where('pba.bin_id', '!=', dto.binId)
        .executeTakeFirst();
      const otherBinsQty = this.round3(other?.total ?? 0);
      const maxQty = this.round3(locationQty - otherBinsQty);
      if (quantity > maxQty) {
        throw new BadRequestException(
          `Bin quantity ${quantity} exceeds available location stock ${locationQty} for this product ` +
            `(${otherBinsQty} already allocated to other bins in the same location; at most ${maxQty} can sit in this bin)`,
        );
      }

      const existing = await trx
        .selectFrom('product_bin_allocations')
        .selectAll()
        .where('bin_id', '=', dto.binId)
        .where('product_id', '=', dto.productId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();
      const prevQty = this.round3(existing?.quantity ?? 0);
      const delta = this.round3(quantity - prevQty);

      await this.upsertAllocation(trx, {
        scope,
        binId: dto.binId,
        productId: dto.productId,
        quantity,
        isPrimary: Boolean(dto.isPrimary),
        existingId: existing ? Number(existing.id) : null,
      });

      if (dto.isPrimary) {
        await trx
          .updateTable('products')
          .set({
            primary_bin_id: dto.binId,
            bin_location: bin.code,
            updated_at: sql`NOW()`,
          } as any)
          .where('id', '=', dto.productId)
          .where('tenant_id', '=', scope.tenantId)
          .execute();
      }

      // Reallocation only: a movement row for the trail, no journal —
      // the location stock (and therefore the books) did not move.
      let movementId: number | null = null;
      if (delta !== 0) {
        movementId = await this.recordBinMovement(trx, {
          scope,
          productId: dto.productId,
          movementType: 'bin_reassign',
          delta,
          beforeQty: prevQty,
          afterQty: quantity,
          referenceType: 'bin_reassign',
          binId: dto.binId,
          branchId,
          locationId,
          unitCost: Number(product.cost_price || 0),
          createdBy: auth.userId ?? null,
        });
      }

      return { success: true, previousQty: prevQty, quantity, delta, movementId };
    });
  }

  /**
   * PHYSICAL COUNT: quickAuditUpdate takes the counted bin slice as
   * truth and moves the location stock by exactly the bin delta, in
   * the same transaction as the allocation write, the movement row
   * and the journal. Mirrors the stock-count path: setScopedStockQty
   * (disableAutoDrain) for the location write, the ACTUAL scoped
   * delta for the movement, and the existing adjustment posting
   * (postInventoryAdjustment) for the journal leg — Dr 1140 / Cr 7100
   * on a gain, Dr 5200 / Cr 1140 on a loss, at the movement total.
   * A count that would drive the location stock below zero fails
   * closed: pre-existing shadow stock is corrected with an inventory
   * adjustment first, never by minting negative stock.
   */
  async quickAuditUpdate(dto: QuickAuditUpdateDto, auth: AuthContext): Promise<any> {
    this.assertInventoryAccess(auth);
    const scope = requireTenantScope(auth);
    const countedQty = this.validateBinQty(dto.countedQty, 'Counted quantity');

    return this.tx.runInTransaction(this.db, async (trx) => {
      const bin = await trx
        .selectFrom('warehouse_bins')
        .selectAll()
        .where('id', '=', dto.binId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();

      if (!bin) throw new NotFoundException('مكان التخزين غير موجود');

      const locationId = Number(bin.location_id);
      const location = await trx
        .selectFrom('stock_locations')
        .selectAll()
        .where('id', '=', locationId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      const branchId = location?.branch_id == null ? null : Number(location.branch_id);

      // Canonical lock order: products before product_location_stock before allocations.
      const product = await trx
        .selectFrom('products')
        .selectAll()
        .where('id', '=', dto.productId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!product) throw new NotFoundException('الصنف غير موجود');

      const allocation = await trx
        .selectFrom('product_bin_allocations')
        .selectAll()
        .where('bin_id', '=', dto.binId)
        .where('product_id', '=', dto.productId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();

      const prevQty = this.round3(allocation?.quantity ?? 0);
      const variance = this.round3(countedQty - prevQty);

      const locationStock = await trx
        .selectFrom('product_location_stock')
        .select(['qty'])
        .where('product_id', '=', dto.productId)
        .where('location_id', '=', locationId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();
      const locationBefore = this.round3(locationStock?.qty ?? 0);
      let locationAfter = locationBefore;
      let movementId: number | null = null;
      let journalEntryId: number | null = null;

      if (variance !== 0) {
        const targetQty = this.round3(locationBefore + variance);
        if (targetQty < 0) {
          throw new BadRequestException(
            `Bin audit cannot reduce location stock below zero: bin held ${prevQty}, counted ${countedQty}, ` +
              `location holds ${locationBefore} — correct the location stock with an inventory adjustment first`,
          );
        }
        const stockChange = await setScopedStockQty(trx, {
          productId: dto.productId,
          branchId,
          locationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          nextQty: targetQty,
          disableAutoDrain: true,
          errorCode: 'INSUFFICIENT_STOCK',
          errorMessage: 'Bin audit cannot drive location stock below zero',
        });
        // INV-STOCK-COUNT-ACTUAL-DELTA: the movement, its cost and the
        // journal all follow the ACTUAL scoped delta, not the requested one.
        const actualDelta = this.round3(stockChange.scopeAfter - stockChange.scopeBefore);
        locationAfter = stockChange.scopeAfter;

        await this.upsertAllocation(trx, {
          scope,
          binId: dto.binId,
          productId: dto.productId,
          quantity: countedQty,
          isPrimary: Boolean(allocation?.is_primary ?? false),
          existingId: allocation ? Number(allocation.id) : null,
        });

        if (actualDelta !== 0) {
          movementId = await this.recordBinMovement(trx, {
            scope,
            productId: dto.productId,
            movementType: 'adjust',
            delta: actualDelta,
            beforeQty: stockChange.scopeBefore,
            afterQty: stockChange.scopeAfter,
            referenceType: 'bin_audit',
            binId: dto.binId,
            branchId,
            locationId,
            unitCost: Number(product.cost_price || 0),
            createdBy: auth.userId ?? null,
          });
          const posting = await this.accountingPosting.postInventoryAdjustment(trx, movementId, auth);
          if (posting.hasFinancialImpact && !posting.journalEntryId) {
            throw new AppError(`Bin audit movement ${movementId} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);
          }
          journalEntryId = posting.journalEntryId;
        }
      } else {
        await this.upsertAllocation(trx, {
          scope,
          binId: dto.binId,
          productId: dto.productId,
          quantity: countedQty,
          isPrimary: Boolean(allocation?.is_primary ?? false),
          existingId: allocation ? Number(allocation.id) : null,
        });
      }

      return {
        success: true,
        previousQty: prevQty,
        countedQty,
        variance,
        locationBefore,
        locationAfter,
        movementId,
        journalEntryId,
        message: variance === 0 ? 'الكمية مطابقة تماماً للمسجل في النظام' : `تم تسجيل فروق جرد في الرف بمقدار (${variance > 0 ? '+' : ''}${variance})`,
      };
    });
  }
}
