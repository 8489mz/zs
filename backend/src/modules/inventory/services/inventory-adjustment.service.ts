import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { ensureNonNegativeStock } from '../../../common/utils/financial-integrity';
import { applyStockDelta, previewAssignedLocationStockQty, setScopedStockQty } from '../../../common/utils/location-stock-ledger';
import { KYSELY_DB } from '../../../database/database.constants';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { Database } from '../../../database/database.types';
import { InventoryAdjustmentDto } from '../dto/inventory-adjustment.dto';
import { InventoryCountService } from './inventory-count.service';
import { dispatchTrackedStock } from '../helpers/stock-transfer-trace.helper';
import { recordTrackedStockIncrease } from '../helpers/tracked-stock-increase.helper';
import { InventoryScopeService } from './inventory-scope.service';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { idempotencyStorage } from '../../../core/idempotency/idempotency.context';
import { syncImportLotsOnStockDeduction } from '../../import-sales/helpers/import-lot-allocation.helper';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

@Injectable()
export class InventoryAdjustmentService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly countService: InventoryCountService,
    private readonly scopeService: InventoryScopeService,
    private readonly idempotency: IdempotencyService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  async createInventoryAdjustment(payload: InventoryAdjustmentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const idemCtx = idempotencyStorage.getStore();
    if (idemCtx?.idempotencyKey) {
      const cached = await this.idempotency.check(idemCtx.idempotencyKey, scope);
      if (cached) return cached.response;
    }

    let result: any = { productId: payload.productId, locationId: payload.locationId, beforeQty: 0, afterQty: 0, scopeBefore: 0, scopeAfter: 0, globalBefore: 0, globalAfter: 0 };

    const location = payload.locationId
      ? await this.scopeService.assertLocationScope(payload.locationId, auth, false, 'write') : null;
    if (location && payload.branchId != null && Number(payload.branchId) !== Number(location.branchId)) {
      throw new AppError('الفرع لا يطابق المخزن المختار', 'ADJUSTMENT_BRANCH_LOCATION_MISMATCH', 409);
    }
    if (!location && payload.branchId != null) {
      throw new AppError('المخزن مطلوب عند تحديد الفرع للتسوية', 'LOCATION_REQUIRED_FOR_BRANCH', 400);
    }
    const effectiveBranchId = location ? location.branchId : (payload.branchId ?? null);

    const finalResponse = await this.tx.runInTransaction(this.db, async (trx) => {
      const requestedQty = Number(payload.qty);
      if (!Number.isFinite(requestedQty) || requestedQty < 0
        || Math.abs(requestedQty * 1000 - Math.round(requestedQty * 1000)) > 0.000001) {
        throw new AppError('Quantity must be finite, non-negative and have at most three decimal places', 'INVALID_QTY', 400);
      }
      const product = await trx
        .selectFrom('products')
        .selectAll()
        .where('id', '=', payload.productId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where('account_id', '=', scope.accountId)
        .where('is_active', '=', true)
        .forUpdate()
        .executeTakeFirst();
      if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      const [serialRecord, batchRecord, drugRecord] = await Promise.all([
        trx.selectFrom('product_serials').select('id').where('tenant_id', '=', scope.tenantId).where('product_id', '=', payload.productId).limit(1).executeTakeFirst(),
        trx.selectFrom('pharmacy_batches').select('id').where('tenant_id', '=', scope.tenantId).where('product_id', '=', payload.productId).limit(1).executeTakeFirst(),
        trx.selectFrom('pharmacy_drugs').select('id').where('tenant_id', '=', scope.tenantId).where('product_id', '=', payload.productId).limit(1).executeTakeFirst(),
      ]);
      const tracked = Boolean(product.track_serials || serialRecord || batchRecord || drugRecord);
      if (!tracked && (payload.serials?.length || payload.batchAllocations?.length)) {
        throw new AppError('الصنف غير متتبع؛ لا تقبل بيانات سيريال أو تشغيلة', 'ADJUSTMENT_UNEXPECTED_TRACE', 400);
      }
      const rawCost = Number(product.cost_price || 0);
      const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
      const stockScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: payload.productId, branchId: effectiveBranchId, locationId: payload.locationId };
      const beforeQty = payload.locationId
        ? await previewAssignedLocationStockQty(trx, stockScope)
        : Number(product.stock_qty || 0);
      let afterQty = beforeQty;
      let movementQty = requestedQty;
      let stockChange: { scopeBefore: number; scopeAfter: number; globalBefore: number; globalAfter: number; };

      if (payload.actionType !== 'adjust' && movementQty <= 0) {
        throw new AppError('Quantity must be strictly positive for add and deduct operations', 'INVALID_QTY', 400);
      }

      const deltaRequested = payload.actionType === 'adjust' ? requestedQty - beforeQty
        : payload.actionType === 'add' ? requestedQty : -requestedQty;
      if (tracked) {
        if (!payload.locationId || !Number.isSafeInteger(Number(payload.locationId))) {
          throw new AppError('يجب تحديد المخزن عند تسوية صنف متتبع', 'ADJUSTMENT_TRACKED_LOCATION_REQUIRED', 422);
        }
        if (deltaRequested > 0) {
          // INV-SPIRIT-TRACKED-INCREASE: a documented increase naming
          // the specific serials/batches is recorded directly; no full
          // tracked count is required. Serial/batch uniqueness and
          // duplicate guards stay inside the helper.
          await recordTrackedStockIncrease(trx, scope, {
            productId: Number(payload.productId), qty: deltaRequested, unitCost,
            serials: payload.serials, batchAllocations: payload.batchAllocations,
            reason: payload.reason,
          }, Number(payload.locationId), effectiveBranchId);
        } else if (deltaRequested === 0) {
          throw new AppError('زيادة الأصناف المتتبعة أو تغييرها بدون توثيق الاستلام يتم من خلال الجرد المتتبع',
            'ADJUSTMENT_TRACKED_INCREASE_REQUIRES_COUNT', 409);
        } else {
          await dispatchTrackedStock(trx, scope, {
            productId: Number(payload.productId), qty: -deltaRequested,
            serials: payload.serials,
            batchAllocations: payload.batchAllocations?.map((a) => ({ batchId: Number(a.batchId), qty: Number(a.qty) })),
          }, Number(payload.locationId), effectiveBranchId, null, Number(payload.productId));
        }
      }

      if (payload.actionType === 'adjust') {
        afterQty = requestedQty;
        stockChange = await setScopedStockQty(trx, {
          ...stockScope,
          nextQty: afterQty,
          disableAutoDrain: tracked,
          errorCode: 'INSUFFICIENT_STOCK',
          errorMessage: 'Cannot deduct more than current stock',
        });
      } else if (payload.actionType === 'add') {
        afterQty = beforeQty + Number(payload.qty || 0);
        stockChange = await applyStockDelta(trx, {
          ...stockScope,
          delta: Number(payload.qty || 0),
        });
      } else {
        afterQty = beforeQty - Number(payload.qty || 0);
        ensureNonNegativeStock(afterQty, 'INSUFFICIENT_STOCK', 'Cannot deduct more than current stock');
        stockChange = await applyStockDelta(trx, {
          ...stockScope,
          delta: -Number(payload.qty || 0),
          disableAutoDrain: tracked,
          errorCode: 'INSUFFICIENT_STOCK',
          errorMessage: 'Cannot deduct more than current stock',
        });
      }

      // The actual post-lock delta is authoritative. A physical count may decrease
      // stock even though the requested target quantity itself is positive.
      const signedDelta = Number((stockChange.scopeAfter - stockChange.scopeBefore).toFixed(3));
      movementQty = Math.abs(signedDelta);
      if (movementQty < 0.001) throw new AppError('Adjustment did not change stock', 'STOCK_ADJUSTMENT_NO_CHANGE', 400);
      // Source movement and GL must represent the same tenant-currency minor units.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const totalCost = roundMoney(movementQty * unitCost, moneyDigits);

      const insertedMovement = await trx
        .insertInto('stock_movements')
        .values({
          product_id: payload.productId,
          movement_type: payload.actionType,
          qty: signedDelta,
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          reason: payload.reason,
          note: payload.note || '',
          reference_type: 'inventory_adjustment',
          reference_id: payload.productId,
          branch_id: effectiveBranchId,
          location_id: payload.locationId ?? null,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          unit_cost: unitCost,
          total_cost: totalCost,
        } as any)
        .returning('id')
        .executeTakeFirst();

      if (!insertedMovement?.id) {
         throw new AppError('Failed to capture stock movement ID for accounting', 'MOVEMENT_INSERT_FAILED', 500);
      }

      if (signedDelta < -0.0001) {
        await syncImportLotsOnStockDeduction(trx, {
          tenantId: scope.tenantId,
          productId: Number(payload.productId),
          locationId: payload.locationId ?? null,
          qty: Math.abs(signedDelta),
          reason: payload.reason || 'inventory_adjustment',
        });
      }

      const posting = await this.accountingPosting.postInventoryAdjustment(trx, insertedMovement.id, auth);
      if (posting.hasFinancialImpact && !posting.journalEntryId) {
        throw new AppError(`Inventory adjustment ${insertedMovement.id} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);
      }
      result = { productId: payload.productId, locationId: payload.locationId, beforeQty: stockChange.scopeBefore, afterQty: stockChange.scopeAfter, scopeBefore: stockChange.scopeBefore, scopeAfter: stockChange.scopeAfter, globalBefore: stockChange.globalBefore, globalAfter: stockChange.globalAfter };

      await this.audit.logWithExecutor(trx, 'تعديل مخزون', `تم تعديل مخزون الصنف #${payload.productId} من ${result.beforeQty} إلى ${result.afterQty} بسبب ${payload.reason}`, auth);

      const responsePayload = {
        ok: true,
        adjustment: result,
        products: (await trx.selectFrom('products').select(['id', 'name']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('is_active', '=', true).execute()).map((p) => ({ id: String(p.id), name: p.name })),
        stockMovements: (await this.countService.listStockMovements({}, auth)).stockMovements,
        auditLogs: [],
      };

      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          responsePayload
        );
      }

      return responsePayload;
    });

    return finalResponse;
  }
}
