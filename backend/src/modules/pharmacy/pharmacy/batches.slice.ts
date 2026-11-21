import { sql } from 'kysely';
import { Kysely } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { AppError } from '../../../common/errors/app-error';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { UpsertBatchDto } from '../dto/upsert-batch.dto';
import { pharmacyExpiryText, isValidPharmacyExpiry, isPastPharmacyExpiry, PHARMACY_BATCH_STATUSES } from './pharmacy-helpers.slice';

export class BatchesSlice {
  constructor(private readonly db: Kysely<Database>) {}

  // -------------------------------------------------------------
  // 4. BATCHES & EXPIRY DATES
  // -------------------------------------------------------------
  async listBatches(
    auth: AuthContext,
    filters?: {
      status?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const scope = requireTenantScope(auth);
    let query = this.db
      .selectFrom('pharmacy_batches as pb')
      .leftJoin('products as p', (join) => join.onRef('p.id', '=', 'pb.product_id').onRef('p.tenant_id', '=', 'pb.tenant_id'))
      .where(sql<boolean>`pb.tenant_id = ${scope.tenantId}`);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('pb.status', '=', filters.status);
    }

    if (filters?.q && filters.q.trim()) {
      const term = `%${normalizeArabicSearch(filters.q)}%`;
      query = query.where(sql<boolean>`(
        lower(pb.batch_number) like ${term}
        OR lower(coalesce(pb.supplier_name, '')) like ${term}
        OR lower(coalesce(pb.notes, '')) like ${term}
        OR lower(coalesce(p.name, '')) like ${term}
        OR lower(coalesce(p.barcode, '')) like ${term}
      )`);
    }

    const totalRes = await query.select((eb) => eb.fn.count('pb.id').as('count')).executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filters?.pageSize || 25)));
    const offset = (page - 1) * pageSize;

    const batches = await query
      .select([
        'pb.id',
        'pb.tenant_id',
        'pb.account_id',
        'pb.product_id',
        'pb.drug_id',
        'pb.batch_number',
        'pb.expiry_date',
        'pb.quantity',
        'pb.unit_cost',
        'pb.location_id',
        'pb.supplier_name',
        'pb.status',
        'pb.notes',
        'pb.created_at',
        'pb.updated_at',
        'p.name as product_name',
        'p.barcode as product_barcode',
      ])
      .orderBy('pb.id', 'desc')
      .limit(pageSize)
      .offset(offset)
      .execute();

    return {
      batches,
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async upsertBatch(auth: AuthContext, dto: UpsertBatchDto) {
    const scope = requireTenantScope(auth);
    const todayKey = await resolveBusinessDateKey(this.db, scope.tenantId, new Date());
    // Batch quantities and WAC are physical and monetary ledgers, NOT metadata.
    // Stock intake must go through the canonical purchase/GRN transaction.
    return this.db.transaction().execute(async (trx) => {
      const quantity = Number(dto.quantity ?? 0);
      const unitCost = Number(dto.unitCost ?? 0);
      if (![quantity, unitCost].every(Number.isFinite) || quantity < 0 || unitCost < 0) {
        throw new AppError('Invalid pharmacy batch balance', 'PHARMACY_BATCH_BALANCE_INVALID', 422);
      }
      if (dto.id) {
        const old = await trx.selectFrom('pharmacy_batches').selectAll()
          .where('tenant_id', '=', scope.tenantId).where('id', '=', dto.id)
          .forUpdate().executeTakeFirst();
        if (!old) throw new AppError('Batch not found', 'PHARMACY_BATCH_NOT_FOUND', 404);
        // INV-PHARMACY-BATCH-FROZEN: expiry is identity, frozen at
        // creation. Repeating the stored value (or omitting it) is a
        // no-op and stays allowed; any change is rejected outright,
        // so an expired batch can never be re-admitted by moving
        // its expiry forward.
        if (dto.expiryDate !== undefined) {
          const newExpiry = pharmacyExpiryText(dto.expiryDate);
          if (newExpiry !== pharmacyExpiryText(old.expiry_date)) {
            throw new AppError('Batch expiry date cannot be changed after creation', 'PHARMACY_BATCH_EXPIRY_FROZEN', 409);
          }
        }
        // Status comes from a closed list, and 'expired' is terminal:
        // neither a batch already marked expired nor one whose
        // expiry has passed may be flipped back to 'active'. Only
        // an explicit activation is gated -- a notes-only update on
        // a batch whose expiry passed with time is not blocked.
        if (dto.status !== undefined && dto.status !== old.status) {
          if (!PHARMACY_BATCH_STATUSES.includes(dto.status)) {
            throw new AppError('Invalid pharmacy batch status', 'PHARMACY_BATCH_STATUS_INVALID', 422);
          }
          const oldExpiry = pharmacyExpiryText(old.expiry_date);
          if (dto.status === 'active' && (old.status === 'expired' || (oldExpiry != null && isPastPharmacyExpiry(oldExpiry, todayKey)))) {
            throw new AppError('An expired batch cannot be returned to active status', 'PHARMACY_BATCH_REACTIVATION_FORBIDDEN', 409);
          }
        }
        if ((dto.quantity !== undefined && quantity !== Number(old.quantity)) ||
            (dto.unitCost !== undefined && unitCost !== Number(old.unit_cost)) ||
            (dto.productId !== undefined && dto.productId !== old.product_id) ||
            (dto.drugId !== undefined && dto.drugId !== old.drug_id) ||
            (dto.locationId !== undefined && dto.locationId !== old.location_id) ||
            dto.batchNumber !== old.batch_number) {
          throw new AppError('Stock and valuation may only change through purchase/GRN/return documents',
            'PHARMACY_BATCH_FINANCIAL_EDIT_FORBIDDEN', 409);
        }
        return trx.updateTable('pharmacy_batches')
          .set({
            expiry_date: dto.expiryDate,
            supplier_name: dto.supplierName ?? old.supplier_name,
            status: dto.status ?? old.status,
            notes: dto.notes ?? old.notes,
            updated_at: sql`now()`,
          })
          .where('tenant_id', '=', scope.tenantId).where('id', '=', dto.id)
          .returningAll().executeTakeFirstOrThrow();
      }
      if (quantity !== 0 || unitCost !== 0) {
        throw new AppError('Create stock via a supplier purchase, not direct batch entry',
          'PHARMACY_BATCH_PURCHASE_REQUIRED', 422);
      }
      // INV-PHARMACY-BATCH-FROZEN: a batch is born with a real expiry
      // and a listed status. An already-expired batch cannot be born
      // 'active' -- it must be recorded 'expired'.
      const createStatus = dto.status ?? 'active';
      if (!PHARMACY_BATCH_STATUSES.includes(createStatus)) {
        throw new AppError('Invalid pharmacy batch status', 'PHARMACY_BATCH_STATUS_INVALID', 422);
      }
      const createExpiry = (dto.expiryDate as unknown) instanceof Date
        ? (dto.expiryDate as unknown as Date).toISOString().slice(0, 10)
        : String(dto.expiryDate ?? '').trim();
      if (!isValidPharmacyExpiry(createExpiry)) {
        throw new AppError('Batch expiry date must be a real calendar date (YYYY-MM-DD) or month (YYYY-MM)', 'PHARMACY_BATCH_EXPIRY_INVALID', 422);
      }
      if (createStatus === 'active' && isPastPharmacyExpiry(createExpiry, todayKey)) {
        throw new AppError('An expired batch cannot be created with active status', 'PHARMACY_BATCH_EXPIRY_INVALID', 422);
      }
      return trx.insertInto('pharmacy_batches').values({
        tenant_id: scope.tenantId, account_id: scope.accountId,
        product_id: dto.productId ?? null, drug_id: dto.drugId ?? null,
        batch_number: dto.batchNumber, expiry_date: dto.expiryDate,
        quantity: 0, unit_cost: 0, location_id: dto.locationId ?? null,
        supplier_name: dto.supplierName ?? null, status: createStatus,
        notes: dto.notes ?? null,
      }).returningAll().executeTakeFirstOrThrow();
    });
  }

  /**
   * FEFO (First Expired, First Out) Batch Allocation Engine
   * Retrieves batches ordered by ascending expiry date (earliest expiry first)
   * to ensure perishable pharmaceuticals are dispensed before shelf life expires.
   */
  async getBatchesFEFO(
    auth: AuthContext,
    params: {
      drugId?: number;
      productId?: number;
      excludeExpired?: boolean;
      minQuantity?: number;
    },
  ) {
    const scope = requireTenantScope(auth);
    let query = this.db
      .selectFrom('pharmacy_batches')
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'active');

    if (params.drugId) {
      query = query.where('drug_id', '=', params.drugId);
    }
    if (params.productId) {
      query = query.where('product_id', '=', params.productId);
    }
    if (params.minQuantity !== undefined) {
      query = query.where('quantity', '>=', params.minQuantity);
    } else {
      query = query.where('quantity', '>', 0);
    }

    if (params.excludeExpired) {
      const todayYm = (await resolveBusinessDateKey(this.db, scope.tenantId, new Date())).slice(0, 7); // YYYY-MM, tenant-local
      query = query.where('expiry_date', '>=', todayYm);
    }

    return await query
      .selectAll()
      .orderBy('expiry_date', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
}
