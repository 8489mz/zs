import { valueStockReceipt } from '../../accounting/inventory-valuation';
import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, Transaction } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { applyStockDelta, lockStockProducts, previewAssignedLocationStockQty } from '../../../common/utils/location-stock-ledger';
import { KYSELY_DB } from '../../../database/database.constants';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { Database } from '../../../database/database.types';
import { CreateBomDto, CreateWorkOrderDto, CompleteWorkOrderDto, UpsertWorkCenterDto, CreateWoOperationDto, CreateUnbuildOrderDto, CreateMtoWorkOrderDto } from '../dto/manufacturing.dto';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { scaledBomOverhead } from '../engines/manufacturing-overhead.engine';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';

@Injectable()
export class ManufacturingService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private async assertBomProductsOwned(trx: Kysely<Database> | Transaction<Database>, payload: CreateBomDto, tenantId: string): Promise<void> {
    const requested = [...new Set([Number(payload.productId), ...payload.lines.map((line) => Number(line.componentProductId))])];
    if (requested.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new AppError('Invalid BOM product', 'BOM_PRODUCT_NOT_FOUND', 404);
    }
    const owned = await trx.selectFrom('products').select('id')
      .where('id', 'in', requested).where('tenant_id', '=', tenantId).execute();
    if (owned.length !== requested.length) {
      throw new AppError('BOM product not found in tenant', 'BOM_PRODUCT_NOT_FOUND', 404);
    }
  }

  private async assertNoCircularDependency(
    trx: Kysely<Database> | Transaction<Database>,
    targetProductId: number,
    componentProductIds: number[],
    tenantId: string,
    visited: Set<number> = new Set(),
  ): Promise<void> {
    if (componentProductIds.some((id) => Number(id) === Number(targetProductId))) {
      throw new AppError('لا يمكن للمنتج أن يكون مكوناً داخلاً في تصنيع نفسه', 'BOM_SELF_REFERENCE_FORBIDDEN', 400);
    }

    const currentVisited = new Set(visited);
    currentVisited.add(targetProductId);

    for (const compId of componentProductIds) {
      if (currentVisited.has(compId)) {
        throw new AppError(`اكتشاف حلقة تكرار دائرية في شجرة التصنيع تشمل المنتج #${compId}`, 'CIRCULAR_BOM_DETECTED', 400);
      }

      const subBom = await trx
        .selectFrom('manufacturing_boms as b')
        .select(['b.id'])
        .where('b.product_id', '=', compId)
        .where('b.is_active', '=', true)
        .where(sql<boolean>`b.tenant_id = ${tenantId}`)
        .executeTakeFirst();

      if (subBom) {
        const subLines = await trx
          .selectFrom('manufacturing_bom_lines')
          .select(['component_product_id'])
          .where('bom_id', 'in', (eb) => eb.selectFrom('manufacturing_boms')
            .select('id').where('id', '=', Number(subBom.id)).where('tenant_id', '=', tenantId))
          .execute();

        const subCompIds = subLines.map((l: any) => Number(l.component_product_id)).filter(Boolean);
        if (subCompIds.length > 0) {
          const nextVisited = new Set(currentVisited);
          nextVisited.add(compId);
          await this.assertNoCircularDependency(trx, targetProductId, subCompIds, tenantId, nextVisited);
        }
      }
    }
  }

  async createBom(payload: CreateBomDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const componentIds = payload.lines.map((l) => Number(l.componentProductId));
    if (componentIds.some((id) => id === Number(payload.productId))) {
      throw new AppError('لا يمكن للمنتج أن يكون مكوناً داخلاً في تصنيع نفسه', 'BOM_SELF_REFERENCE_FORBIDDEN', 400);
    }
    let bomId = 0;

    await this.tx.runInTransaction(this.db, async (trx) => {
      await this.assertBomProductsOwned(trx, payload, scope.tenantId);
      await this.assertNoCircularDependency(trx, Number(payload.productId), componentIds, scope.tenantId);

      const overheadCost = payload.overheadCost || 0;
      const totalExpectedCost = payload.lines.reduce((sum, line) => sum + line.expectedCost * line.quantity, 0) + overheadCost;

      const bom = await trx
        .insertInto('manufacturing_boms')
        .values({
          product_id: payload.productId,
          quantity: payload.quantity,
          expected_cost: totalExpectedCost,
          overhead_cost: overheadCost,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();
      
      bomId = Number(bom.id);

      const lines = payload.lines.map((line) => ({
        bom_id: bomId,
        component_product_id: line.componentProductId,
        quantity: line.quantity,
        unit_name: line.unitName,
        unit_multiplier: line.unitMultiplier,
        expected_cost: line.expectedCost,
        waste_percentage: line.wastePercentage || 0,
      } as any));

      await trx.insertInto('manufacturing_bom_lines').values(lines).execute();
    });

    await this.audit.log('إنشاء قائمة مكونات', `تم إنشاء وصفة جديدة للمنتج #${payload.productId}`, auth);
    return { ok: true, bomId };
  }

  async getBoms(auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const boms = await this.db
      .selectFrom('manufacturing_boms as b')
      .innerJoin('products as p', (join) => join.onRef('p.id', '=', 'b.product_id').onRef('p.tenant_id', '=', 'b.tenant_id'))
      .select(['b.id', 'b.product_id', 'p.name as product_name', 'b.quantity', 'b.expected_cost', 'b.overhead_cost', 'b.is_active', 'b.created_at'])
      .where('b.is_active', '=', true)
      .where(sql<boolean>`b.tenant_id = ${scope.tenantId}`)
      .orderBy('b.id', 'desc')
      .execute();

    const bomIds = boms.map((b) => Number(b.id)).filter(Boolean);
    const allLines = bomIds.length > 0
      ? await this.db.selectFrom('manufacturing_bom_lines')
          .selectAll()
          .where('bom_id', 'in', bomIds)
          .where('bom_id', 'in', (eb) => eb.selectFrom('manufacturing_boms')
            .select('id').where('tenant_id', '=', scope.tenantId))
          .execute()
      : [];

    const linesByBomId = new Map<number, any[]>();
    for (const line of allLines) {
      const bId = Number(line.bom_id);
      if (!linesByBomId.has(bId)) linesByBomId.set(bId, []);
      linesByBomId.get(bId)!.push({
        componentId: line.component_product_id,
        quantity: line.quantity,
        unitName: line.unit_name,
        expectedCost: line.expected_cost,
        wastePercentage: line.waste_percentage,
      });
    }

    for (const bom of boms) {
      (bom as any).lines = linesByBomId.get(Number(bom.id)) || [];
    }

    return { ok: true, boms };
  }

  async updateBom(id: number, payload: CreateBomDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const componentIds = payload.lines.map((l) => Number(l.componentProductId));
    if (componentIds.some((cid) => cid === Number(payload.productId))) {
      throw new AppError('لا يمكن للمنتج أن يكون مكوناً داخلاً في تصنيع نفسه', 'BOM_SELF_REFERENCE_FORBIDDEN', 400);
    }

    await this.tx.runInTransaction(this.db, async (trx) => {
      await this.assertBomProductsOwned(trx, payload, scope.tenantId);
      await this.assertNoCircularDependency(trx, Number(payload.productId), componentIds, scope.tenantId);

      const existingBom = await trx.selectFrom('manufacturing_boms')
        .select(['id'])
        .where('id', '=', id)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (!existingBom) {
        throw new AppError('قائمة المكونات غير موجودة', 'BOM_NOT_FOUND', 404);
      }

      const overheadCost = payload.overheadCost || 0;
      const totalExpectedCost = payload.lines.reduce((sum, line) => sum + line.expectedCost * line.quantity, 0) + overheadCost;

      await trx.updateTable('manufacturing_boms')
        .set({
          product_id: payload.productId,
          quantity: payload.quantity,
          expected_cost: totalExpectedCost,
          overhead_cost: overheadCost,
        } as any)
        .where('id', '=', id)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      await trx.deleteFrom('manufacturing_bom_lines')
        .where('bom_id', 'in', (eb) => eb.selectFrom('manufacturing_boms')
          .select('id').where('id', '=', id).where('tenant_id', '=', scope.tenantId))
        .execute();

      const lines = payload.lines.map((line) => ({
        bom_id: id,
        component_product_id: line.componentProductId,
        quantity: line.quantity,
        unit_name: line.unitName,
        unit_multiplier: line.unitMultiplier,
        expected_cost: line.expectedCost,
        waste_percentage: line.wastePercentage || 0,
      } as any));

      await trx.insertInto('manufacturing_bom_lines').values(lines).execute();
    });

    await this.audit.log('تعديل قائمة مكونات', `تم تعديل تركيبة المنتج #${payload.productId}`, auth);
    return { ok: true };
  }

  async deleteBom(id: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);

    await this.tx.runInTransaction(this.db, async (trx) => {
      const targetBom = await trx.selectFrom('manufacturing_boms')
        .select(['id'])
        .where('id', '=', id)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (!targetBom) {
        throw new AppError('قائمة المكونات غير موجودة', 'BOM_NOT_FOUND', 404);
      }

      const woCount = await trx.selectFrom('manufacturing_work_orders')
        .select(({ fn }) => fn.count('id').as('count'))
        .where('bom_id', '=', id)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      
      if (Number(woCount?.count || 0) > 0) {
        await trx.updateTable('manufacturing_boms')
          .set({ is_active: false })
          .where('id', '=', id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();
      } else {
        await trx.deleteFrom('manufacturing_bom_lines')
          .where('bom_id', 'in', (eb) => eb.selectFrom('manufacturing_boms')
            .select('id').where('id', '=', id).where('tenant_id', '=', scope.tenantId))
          .execute();

        await trx.deleteFrom('manufacturing_boms')
          .where('id', '=', id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();
      }
    });

    await this.audit.log('حذف قائمة مكونات', `تم حذف/إيقاف التركيبة #${id}`, auth);
    return { ok: true };
  }

  async createWorkOrder(payload: CreateWorkOrderDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    let woId = 0;

    await this.tx.runInTransaction(this.db, async (trx) => {
      const bom = await trx
        .selectFrom('manufacturing_boms')
        .select(['expected_cost'])
        .where('id', '=', payload.bomId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      
      if (!bom) throw new AppError('BOM not found', 'NOT_FOUND', 404);

      const totalCost = Number(bom.expected_cost) * Number(payload.quantityToProduce);

      const wo = await trx
        .insertInto('manufacturing_work_orders')
        .values({
          bom_id: payload.bomId,
          quantity_to_produce: payload.quantityToProduce,
          status: 'draft',
          source_location_id: payload.sourceLocationId ?? null,
          destination_location_id: payload.destinationLocationId ?? null,
          total_cost: totalCost,
          note: payload.note || '',
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();
      
      woId = Number(wo.id);
    });

    await this.audit.log('إنشاء أمر إنتاج', `تم إنشاء أمر إنتاج #${woId}`, auth);
    return { ok: true, workOrderId: woId };
  }

  async getWorkOrders(auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const workOrders = await this.db
      .selectFrom('manufacturing_work_orders as wo')
      .innerJoin('manufacturing_boms as b', 'b.id', 'wo.bom_id')
      .innerJoin('products as p', 'p.id', 'b.product_id')
      .select([
        'wo.id',
        'wo.status',
        'wo.quantity_to_produce',
        'wo.produced_quantity',
        'p.name as product_name',
        'wo.created_at',
        'wo.created_by as created_by_id',
      ])
      .where(sql<boolean>`wo.tenant_id = ${scope.tenantId}`)
      .orderBy('wo.id', 'desc')
      .execute();
    return { ok: true, workOrders };
  }

  async completeWorkOrder(id: number, payload: CompleteWorkOrderDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);

    await this.tx.runInTransaction(this.db, async (trx) => {
      const wo = await trx
        .selectFrom('manufacturing_work_orders as wo')
        .innerJoin('manufacturing_boms as b', 'b.id', 'wo.bom_id')
        .select([
          'wo.id', 'wo.status', 'wo.quantity_to_produce', 
          'wo.source_location_id', 'wo.destination_location_id',
          'b.product_id as finished_product_id',
          'wo.bom_id', 'b.quantity as bom_quantity', 'b.overhead_cost'
        ])
        .where('wo.id', '=', id)
        .where(sql<boolean>`wo.tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      
      if (!wo) throw new AppError('Work order not found', 'NOT_FOUND', 404);
      if (wo.status === 'done') throw new AppError('Work order already completed', 'INVALID_STATE', 400);

      const sourceLocation = payload.sourceLocationId ?? wo.source_location_id;
      const destinationLocation = payload.destinationLocationId ?? wo.destination_location_id;
      const qtyToProduce = Number(wo.quantity_to_produce);

      // Get BOM lines
      const lines = await trx
        .selectFrom('manufacturing_bom_lines as l')
        .innerJoin('products as p', 'p.id', 'l.component_product_id')
        .select([
          'l.id', 'l.component_product_id', 'l.quantity', 'l.unit_name', 'l.unit_multiplier', 'l.expected_cost', 'l.waste_percentage',
          'p.name as component_name'
        ])
        .where('l.bom_id', '=', wo.bom_id)
        .execute();

      await lockStockProducts(trx, {
        ...scope,
        productIds: [Number(wo.finished_product_id), ...lines.map((line) => Number(line.component_product_id)), ...(payload.byProducts || []).map((bp) => Number(bp.productId))],
      });

      const valuedProducts = await trx.selectFrom('products').select(['id', 'cost_price']).where('tenant_id', '=', scope.tenantId)
        .where('id', 'in', [Number(wo.finished_product_id), ...lines.map(line => Number(line.component_product_id)), ...(payload.byProducts || []).map(bp => Number(bp.productId))]).execute();
      const costByProduct = new Map(valuedProducts.map(product => [Number(product.id), Number(product.cost_price)]));
      let totalCost = 0;

      const bomQuantity = Number(wo.bom_quantity || 1);

      // Book precision for every cost accumulated below. Quantity precision
      // (toFixed(3) on requiredQty) is untouched — quantities are not money.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));

      // Deduct raw materials
      for (const line of [...lines].sort((a, b) => Number(a.component_product_id) - Number(b.component_product_id))) {
        const wastePct = Math.max(0, Math.min(99.9, Number(line.waste_percentage || 0)));
        const wasteFactor = 1 / (1 - (wastePct / 100));
        const lineMultiplier = Number(line.unit_multiplier || 1);
        const quantityConsumedInSelectedUnit = Number(line.quantity) * wasteFactor * (qtyToProduce / bomQuantity);
        const requiredQty = Number((quantityConsumedInSelectedUnit * lineMultiplier).toFixed(3));
        const actualUnitCost = Number(costByProduct.get(Number(line.component_product_id)));
        if (!Number.isFinite(actualUnitCost) || actualUnitCost < 0) throw new AppError('Invalid material cost', 'MANUFACTURING_COST_INVALID', 409);
        const lineTotalCost = roundMoney(requiredQty * actualUnitCost, moneyDigits);
        totalCost += lineTotalCost;

        await trx.insertInto('manufacturing_wo_consumptions').values({
          work_order_id: wo.id,
          component_product_id: Number(line.component_product_id),
          quantity_consumed: requiredQty,
          unit_cost: actualUnitCost,
          line_total: lineTotalCost,
        }).execute();

        const stockScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(line.component_product_id), branchId: null, locationId: sourceLocation };
        const beforeQty = sourceLocation ? await previewAssignedLocationStockQty(trx, stockScope) : 0;
        
        const stockChange = await applyStockDelta(trx, {
          ...stockScope,
          delta: -requiredQty,
          errorCode: 'INSUFFICIENT_RAW_MATERIAL',
          errorMessage: `لا يوجد رصيد كافٍ من المادة الخام: ${line.component_name}`
        });

        await trx.insertInto('stock_movements').values({
          product_id: Number(line.component_product_id),
          movement_type: 'manufacturing_consumption',
          unit_cost: actualUnitCost, total_cost: lineTotalCost,
          qty: -requiredQty,
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          reason: 'استهلاك تصنيع',
          note: `أمر إنتاج #${wo.id}`,
          reference_type: 'manufacturing_work_order',
          reference_id: wo.id,
          location_id: sourceLocation,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        }).execute();
      }

      // Add overhead cost (single shared formula: scaledBomOverhead).
      const totalOverheadCost = scaledBomOverhead(Number(wo.overhead_cost || 0), qtyToProduce, bomQuantity, moneyDigits);
      totalCost += totalOverheadCost;

      // Add Work Center Operations & Machine Costs
      if (payload.operations && payload.operations.length > 0) {
        for (const op of payload.operations) {
          let hourlyCost = op.hourlyCost;
          if (hourlyCost == null) {
            const wc = await trx
              .selectFrom('manufacturing_work_centers')
              .select(['cost_per_hour'])
              .where('id', '=', op.workCenterId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .executeTakeFirst();
            hourlyCost = Number(wc?.cost_per_hour || 0);
          }
          const opTotalCost = roundMoney(Number(op.durationHours || 0) * Number(hourlyCost || 0), moneyDigits);
          totalCost += opTotalCost;

          await trx.insertInto('manufacturing_wo_operations').values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            work_order_id: wo.id,
            work_center_id: op.workCenterId,
            operation_name: op.operationName,
            sequence: op.sequence || 1,
            duration_hours: op.durationHours,
            hourly_cost: hourlyCost,
            total_cost: opTotalCost,
            status: 'completed',
            notes: op.notes || null,
          } as any).execute();
        }
      }

      let byProductValue = 0;
      for (const bp of payload.byProducts || []) {
        if (Number(bp.productId) === Number(wo.finished_product_id)) throw new AppError('Finished product cannot also be a by-product', 'MANUFACTURING_COST_INVALID', 400);
        const value = roundMoney(Number(bp.quantity) * Number(costByProduct.get(Number(bp.productId))), moneyDigits);
        if (!Number.isFinite(value) || value < 0) throw new AppError('Invalid by-product valuation', 'MANUFACTURING_COST_INVALID', 400);
        byProductValue += value;
      }
      if (byProductValue > totalCost) throw new AppError('By-product value exceeds production cost', 'MANUFACTURING_COST_INVALID', 400);
      totalCost = roundMoney(totalCost, moneyDigits);
      const finishedValue = roundMoney(totalCost - byProductValue, moneyDigits);

      // Add finished product
      const fgStockScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(wo.finished_product_id), branchId: null, locationId: destinationLocation };
      const fgStockChange = await applyStockDelta(trx, {
        ...fgStockScope,
        delta: qtyToProduce,
      });

      await trx.insertInto('stock_movements').values({
        product_id: Number(wo.finished_product_id),
        movement_type: 'manufacturing_production',
        unit_cost: finishedValue / qtyToProduce, total_cost: finishedValue,
        qty: qtyToProduce,
        before_qty: fgStockChange.scopeBefore,
        after_qty: fgStockChange.scopeAfter,
        reason: 'إنتاج تام',
        note: `أمر إنتاج #${wo.id}`,
        reference_type: 'manufacturing_work_order',
        reference_id: wo.id,
        location_id: destinationLocation,
        created_by: auth.userId,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      }).execute();

      // Add by-products if any
      if (payload.byProducts && payload.byProducts.length > 0) {
        for (const bp of [...payload.byProducts].sort((a, b) => Number(a.productId) - Number(b.productId))) {
          const bpQty = Number(bp.quantity || 0);
          if (bpQty <= 0) continue;
          const bpLoc = bp.locationId || destinationLocation;
          const bpStockScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(bp.productId), branchId: null, locationId: bpLoc };
          const bpStockChange = await applyStockDelta(trx, {
            ...bpStockScope,
            delta: bpQty,
          });

          await trx.insertInto('stock_movements').values({
            product_id: Number(bp.productId),
            movement_type: 'manufacturing_byproduct',
            unit_cost: costByProduct.get(Number(bp.productId)), total_cost: roundMoney(bpQty * Number(costByProduct.get(Number(bp.productId))), moneyDigits),
            qty: bpQty,
            before_qty: bpStockChange.scopeBefore,
            after_qty: bpStockChange.scopeAfter,
            reason: 'منتج ثانوي ناتج عن التصنيع',
            note: `أمر إنتاج #${wo.id} - منتج ثانوي`,
            reference_type: 'manufacturing_work_order',
            reference_id: wo.id,
            location_id: bpLoc,
            created_by: auth.userId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).execute();
        }
      }

      await trx.updateTable('manufacturing_work_orders')
        .set({
          status: 'done',
          completed_at: new Date(),
          produced_quantity: qtyToProduce,
          total_cost: totalCost,
          updated_at: sql`NOW()`,
        } as any)
        .where('id', '=', id)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      await valueStockReceipt(trx, scope.tenantId, Number(wo.finished_product_id), fgStockChange.globalAfter, qtyToProduce, finishedValue);

      await this.accountingPosting.postManufacturingWorkOrder(trx, id, auth);
    });

    await this.audit.log('إنهاء أمر إنتاج', `تم إنهاء أمر إنتاج #${id}`, auth);
    return { ok: true };
  }

  async listWorkCenters(auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const workCenters = await this.db
      .selectFrom('manufacturing_work_centers')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .orderBy('code', 'asc')
      .execute();
    return { ok: true, workCenters };
  }

  async upsertWorkCenter(id: number | null, dto: UpsertWorkCenterDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    if (id) {
      const updated = await this.db
        .updateTable('manufacturing_work_centers')
        .set({
          code: dto.code.trim(),
          name: dto.name.trim(),
          cost_per_hour: dto.costPerHour ?? 0,
          capacity: dto.capacity ?? 1,
          time_efficiency: dto.timeEfficiency ?? 100,
          status: dto.status || 'active',
          notes: dto.notes ?? null,
          updated_at: sql`NOW()`,
        } as any)
        .where('id', '=', id)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.log('تعديل مركز عمل', `تم تعديل مركز العمل ${dto.name} (${dto.code})`, auth);
      return { ok: true, workCenter: updated };
    }

    const inserted = await this.db
      .insertInto('manufacturing_work_centers')
      .values({
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        code: dto.code.trim(),
        name: dto.name.trim(),
        cost_per_hour: dto.costPerHour ?? 0,
        capacity: dto.capacity ?? 1,
        time_efficiency: dto.timeEfficiency ?? 100,
        status: dto.status || 'active',
        notes: dto.notes ?? null,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.log('إنشاء مركز عمل', `تم إنشاء مركز العمل ${dto.name} (${dto.code})`, auth);
    return { ok: true, workCenter: inserted };
  }

  async deleteWorkCenter(id: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    await this.db
      .deleteFrom('manufacturing_work_centers')
      .where('id', '=', id)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    await this.audit.log('حذف مركز عمل', `تم حذف مركز العمل #${id}`, auth);
    return { ok: true };
  }

  async getWorkOrderOperations(workOrderId: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const operations = await this.db
      .selectFrom('manufacturing_wo_operations as op')
      .innerJoin('manufacturing_work_centers as wc', 'wc.id', 'op.work_center_id')
      .select([
        'op.id',
        'op.work_order_id',
        'op.work_center_id',
        'op.operation_name',
        'op.sequence',
        'op.duration_hours',
        'op.hourly_cost',
        'op.total_cost',
        'op.status',
        'op.notes',
        'op.created_at',
        'wc.name as work_center_name',
        'wc.code as work_center_code',
      ])
      .where('op.work_order_id', '=', workOrderId)
      .where(sql<boolean>`op.tenant_id = ${scope.tenantId}`)
      .orderBy('op.sequence', 'asc')
      .execute();

    return { ok: true, operations };
  }

  async listUnbuildOrders(auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const rows = await this.db
      .selectFrom('manufacturing_unbuild_orders as u')
      .innerJoin('products as p', 'p.id', 'u.product_id')
      .select([
        'u.id',
        'u.unbuild_number',
        'u.product_id',
        'p.name as product_name',
        'u.bom_id',
        'u.quantity',
        'u.warehouse_id',
        'u.status',
        'u.total_cost',
        'u.notes',
        'u.created_at',
      ])
      .where(sql<boolean>`u.tenant_id = ${scope.tenantId}`)
      .orderBy('u.created_at', 'desc')
      .execute();

    return { ok: true, unbuildOrders: rows };
  }

  async createUnbuildOrder(payload: CreateUnbuildOrderDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    let unbuildNumber = '';
    let unbuildId = 0;

    await this.tx.runInTransaction(this.db, async (trx) => {
      const product = await trx
        .selectFrom('products')
        .select(['id', 'name', 'cost_price', 'default_location_id'])
        .where('id', '=', payload.productId)
        .where('is_active', '=', true)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();

      if (!product) {
        throw new AppError('المنتج المراد تفكيكه غير موجود', 'PRODUCT_NOT_FOUND', 404);
      }

      const bom = await trx
        .selectFrom('manufacturing_boms')
        .selectAll()
        .where('id', '=', payload.bomId)
        .where('is_active', '=', true)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();

      if (!bom) {
        throw new AppError('شجرة المكونات (BOM) غير موجودة', 'BOM_NOT_FOUND', 404);
      }

      // INV-MANUFACTURING-UNBUILD-BOM-BINDING: an unbuild may
      // only use a BOM that belongs to the product being
      // unbuilt. Any active BOM previously satisfied this
      // fetch, so a BOM written for another product silently
      // recovered the wrong components into stock.
      if (Number(bom.product_id) !== Number(payload.productId)) {
        throw new AppError('شجرة المكونات لا تخص المنتج المراد تفكيكه', 'BOM_PRODUCT_MISMATCH', 400);
      }

      const bomLines = await trx
        .selectFrom('manufacturing_bom_lines as l')
        .innerJoin('products as p', 'p.id', 'l.component_product_id')
        .select([
          'l.id',
          'l.component_product_id',
          'l.quantity',
          'l.unit_multiplier',
          'l.expected_cost',
          'p.name as component_name',
          'p.default_location_id as comp_location_id',
        ])
        .where('l.bom_id', '=', payload.bomId)
        .execute();

      if (!bomLines.length) {
        throw new AppError('شجرة المكونات لا تحتوي على بنود صالحة للتفكيك', 'EMPTY_BOM', 400);
      }

      await lockStockProducts(trx, {
        ...scope,
        productIds: [Number(payload.productId), ...bomLines.map((line) => Number(line.component_product_id))],
      });

      // INV-MANUFACTURING-UNBUILD-JOURNAL: both legs are valued at the
      // LIVE weighted-average cost (products.cost_price), the same
      // source completeWorkOrder uses -- never at the BOM line's stale
      // expected_cost, which is a planning estimate frozen at BOM
      // authoring time. Money is rounded once at book digits.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const valuedProducts = await trx.selectFrom('products').select(['id', 'cost_price'])
        .where('tenant_id', '=', scope.tenantId)
        .where('id', 'in', [Number(payload.productId), ...bomLines.map((line) => Number(line.component_product_id))])
        .execute();
      const costByProduct = new Map(valuedProducts.map((row) => [Number(row.id), Number(row.cost_price)]));
      const liveUnitCost = (productId: number): number => {
        const cost = costByProduct.get(Number(productId));
        if (cost == null || !Number.isFinite(cost) || cost < 0) throw new AppError('Invalid manufacturing cost', 'MANUFACTURING_COST_INVALID', 409);
        return cost;
      };

      const locationId = payload.warehouseId || product.default_location_id || null;
      const qtyToUnbuild = Number(payload.quantity);
      const bomQty = Number(bom.quantity || 1);
      const fgUnitCost = liveUnitCost(Number(payload.productId));
      const fgTotalCost = roundMoney(qtyToUnbuild * fgUnitCost, moneyDigits);

      // Insert unbuild order first with temporary number to acquire identity
      const tempUnbuildNumber = `UB-TMP-${Date.now()}`;
      const inserted = await trx
        .insertInto('manufacturing_unbuild_orders')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          unbuild_number: tempUnbuildNumber,
          product_id: payload.productId,
          product_name: product.name,
          bom_id: payload.bomId,
          quantity: qtyToUnbuild,
          warehouse_id: locationId || 0,
          status: 'completed',
          total_cost: 0,
          notes: payload.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      unbuildId = Number(inserted.id);
      unbuildNumber = formatDailyDocumentNumber('UB', unbuildId);

      const fgStockScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(payload.productId), branchId: null, locationId };
      const fgStockChange = await applyStockDelta(trx, {
        ...fgStockScope,
        delta: -qtyToUnbuild,
        errorCode: 'INSUFFICIENT_FINISHED_PRODUCT',
        errorMessage: `لا يتوفر رصيد كافٍ من المنتج التام: ${product.name} للتفكيك`,
      });

      await trx.insertInto('stock_movements').values({
        product_id: Number(payload.productId),
        movement_type: 'manufacturing_unbuild',
        qty: -qtyToUnbuild,
        before_qty: fgStockChange.scopeBefore,
        after_qty: fgStockChange.scopeAfter,
        reason: 'تفكيك منتج تام',
        note: `أمر تفكيك #${unbuildNumber}`,
        reference_type: 'manufacturing_unbuild_order',
        reference_id: unbuildId,
        location_id: locationId,
        created_by: auth.userId,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        unit_cost: fgUnitCost,
        total_cost: fgTotalCost,
      }).execute();

      let totalRecoveredCost = 0;
      for (const line of [...bomLines].sort((a, b) => Number(a.component_product_id) - Number(b.component_product_id))) {
        const lineMultiplier = Number(line.unit_multiplier || 1);
        const returnQty = Number((Number(line.quantity) * (qtyToUnbuild / bomQty) * lineMultiplier).toFixed(3));
        // Live WAC, not the stale BOM expected_cost; rounded once at
        // book digits like every other manufacturing money line.
        const compUnitCost = liveUnitCost(Number(line.component_product_id));
        const lineCost = roundMoney(returnQty * compUnitCost, moneyDigits);
        totalRecoveredCost += lineCost;

        const compLoc = line.comp_location_id || locationId;
        const compScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(line.component_product_id), branchId: null, locationId: compLoc };
        const compStockChange = await applyStockDelta(trx, {
          ...compScope,
          delta: returnQty,
        });

        await trx.insertInto('stock_movements').values({
          product_id: Number(line.component_product_id),
          movement_type: 'manufacturing_unbuild_recovery',
          qty: returnQty,
          before_qty: compStockChange.scopeBefore,
          after_qty: compStockChange.scopeAfter,
          reason: 'استرجاع مواد خام من تفكيك',
          note: `أمر تفكيك #${unbuildNumber} - استرجاع ${line.component_name}`,
          reference_type: 'manufacturing_unbuild_order',
          reference_id: unbuildId,
          location_id: compLoc,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          unit_cost: compUnitCost,
          total_cost: lineCost,
        }).execute();
      }

      await trx
        .updateTable('manufacturing_unbuild_orders')
        .set({
          unbuild_number: unbuildNumber,
          total_cost: roundMoney(totalRecoveredCost, moneyDigits),
          updated_at: sql`NOW()`,
        })
        .where('id', '=', unbuildId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      // The stock move alone used to leave no general-ledger trace.
      // Post the balanced unbuild journal in the SAME transaction, so
      // a missing variance account rolls the whole unbuild back.
      await this.accountingPosting.postManufacturingUnbuildOrder(trx, unbuildId, auth);
    });

    await this.audit.log('أمر تفكيك منتج', `تم تفكيك ${payload.quantity} من المنتج #${payload.productId} بنجاح (${unbuildNumber})`, auth);
    return { ok: true, unbuildId, unbuildNumber, message: 'تم تفكيك المنتج واسترجاع المواد الخام للمخزن بنجاح' };
  }

  async createMtoWorkOrder(payload: CreateMtoWorkOrderDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    let bomId = payload.bomId;

    if (!bomId) {
      const activeBom = await this.db
        .selectFrom('manufacturing_boms')
        .select(['id'])
        .where('product_id', '=', payload.productId)
        .where('is_active', '=', true)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();

      if (!activeBom) {
        throw new AppError('لا توجد شجرة مكونات (BOM) نشطة لهذا الصنف المصنّع', 'BOM_NOT_FOUND', 404);
      }
      bomId = Number(activeBom.id);
    }

    const res = await this.createWorkOrder({
      bomId,
      quantityToProduce: payload.quantityToProduce,
      note: `تصنيع حسب الطلب (MTO) - أمر بيع #${payload.salesOrderId}${payload.notes ? ` - ${payload.notes}` : ''}`,
    }, auth);

    return {
      ok: true,
      workOrderId: res.workOrderId,
      message: 'تم توليد أمر الشغل للتصنيع حسب الطلب بنجاح',
    };
  }
}
