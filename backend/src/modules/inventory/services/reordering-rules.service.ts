import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { randomUUID } from 'node:crypto';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import {
  evaluateReorderingRule,
  groupReorderItemsBySupplier,
  type BreachedReorderItem,
} from '../engines/reordering-rule.engine';
import {
  CreateReorderingRuleDto,
  UpdateReorderingRuleDto,
  RunReorderingEvaluationDto,
} from '../dto/reordering-rule.dto';

/**
 * Pipeline statuses whose unreceived remainder counts as incoming stock.
 * A draft is not a committed order: it cannot be received or converted
 * until confirmOrder moves it to pending_approval or confirmed, so it
 * contributes nothing here (see INV-REORDER-EVALUATION-PIPELINE for the
 * draft quench that keeps generation from duplicating an open draft).
 * A received order contributes quantity minus received_quantity, which is
 * zero once the Slice 3 P5 advance has run, so it needs no listing.
 */
const REORDER_INCOMING_STATUSES: string[] = ['pending_approval', 'confirmed', 'partially_received'];

@Injectable()
export class ReorderingRulesService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Lists all reordering rules enriched with real-time stock levels,
   * incoming pipeline quantities, and automated breach evaluations.
   */
  /**
   * Evaluates every rule against real-time stock and the committed
   * pipeline, on the given handle (pool for reads, transaction for
   * generation, so the generation snapshot cannot drift mid-run).
   */
  private async evaluateRules(
    executor: Kysely<Database> | Transaction<Database>,
    query: { warehouseId?: number; status?: 'all' | 'breached' | 'normal'; q?: string },
    auth: AuthContext,
  ): Promise<{
    rules: any[];
    summary: {
      totalRules: number;
      activeRules: number;
      breachedCount: number;
      generatedOrdersCount: number;
    };
  }> {
    const scope = requireTenantScope(auth);

    let baseQuery = executor
      .selectFrom('reordering_rules as r')
      .leftJoin('products as p', (join: any) =>
        join.onRef('p.id', '=', 'r.product_id').on('p.tenant_id', '=', scope.tenantId),
      )
      .leftJoin('suppliers as s', (join: any) =>
        join.onRef('s.id', '=', 'r.preferred_supplier_id').on('s.tenant_id', '=', scope.tenantId),
      )
      .leftJoin('stock_locations as loc', (join: any) =>
        join.onRef('loc.id', '=', 'r.warehouse_id').on('loc.tenant_id', '=', scope.tenantId),
      )
      .leftJoin('branches as b', (join: any) =>
        join.onRef('b.id', '=', 'r.branch_id').on('b.tenant_id', '=', scope.tenantId),
      )
      .select([
        'r.id',
        'r.tenant_id',
        'r.account_id',
        'r.product_id',
        'r.warehouse_id',
        'r.branch_id',
        'r.min_qty',
        'r.max_qty',
        'r.qty_multiple',
        'r.preferred_supplier_id',
        'r.action_mode',
        'r.is_active',
        'r.last_run_at',
        'r.last_trigger_status',
        'r.last_generated_po_id',
        'r.notes',
        'r.created_at',
        'r.updated_at',
        'p.name as product_name',
        'p.barcode as product_barcode',
        'p.cost_price as product_cost_price',
        'p.stock_qty as product_global_stock',
        'p.reserved_qty as product_global_reserved',
        's.name as preferred_supplier_name',
        's.phone as preferred_supplier_phone',
        'loc.name as warehouse_name',
        'b.name as branch_name',
      ])
      .where('r.tenant_id', '=', scope.tenantId);

    if (query.warehouseId) {
      baseQuery = baseQuery.where('r.warehouse_id', '=', query.warehouseId);
    }

    if (query.q && query.q.trim()) {
      const term = `%${normalizeArabicSearch(query.q.trim())}%`;
      baseQuery = baseQuery.where(sql<boolean>`(
        TRANSLATE(LOWER(COALESCE(p.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
        OR LOWER(COALESCE(p.barcode, '')) LIKE ${term}
        OR TRANSLATE(LOWER(COALESCE(s.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
      )`);
    }

    const rows: any[] = await baseQuery.orderBy('r.id', 'desc').execute();

    // Fetch incoming PO quantities in transit
    const incomingPoRows: any[] = await executor
      .selectFrom('purchase_order_items as poi')
      .innerJoin('purchase_orders as po', (join: any) =>
        join.onRef('po.id', '=', 'poi.purchase_order_id').on('po.tenant_id', '=', scope.tenantId),
      )
      .select([
        'poi.product_id',
        'po.warehouse_id',
        sql<number>`COALESCE(SUM(CAST(poi.quantity AS numeric) - CAST(poi.received_quantity AS numeric)), 0)`.as('incoming_qty'),
      ])
      .where('po.tenant_id', '=', scope.tenantId)
      .where('po.status', 'in', REORDER_INCOMING_STATUSES)
      .groupBy(['poi.product_id', 'po.warehouse_id'])
      .execute();

    const incomingMap = new Map<string, number>();
    for (const row of incomingPoRows) {
      const key = `${row.product_id}__${row.warehouse_id || 'all'}`;
      incomingMap.set(key, Number(row.incoming_qty || 0));
    }

    // Fetch specific warehouse stocks and reserved allocations
    const locationStocks: any[] = await executor
      .selectFrom('product_location_stock')
      .select(['product_id', 'location_id', 'qty', 'reserved_qty'])
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    const locationStockMap = new Map<string, { onHand: number; reserved: number }>();
    for (const ls of locationStocks) {
      locationStockMap.set(`${ls.product_id}__${ls.location_id}`, {
        onHand: Number(ls.qty || 0),
        reserved: Number(ls.reserved_qty || 0),
      });
    }

    let activeRulesCount = 0;
    let breachedCount = 0;
    let generatedOrdersCount = 0;

    const evaluatedRules = rows.map((r: any) => {
      if (r.is_active) activeRulesCount++;
      if (r.last_generated_po_id) generatedOrdersCount++;

      let onHand = Number(r.product_global_stock || 0);
      let reservedQty = Number(r.product_global_reserved || 0);

      if (r.warehouse_id) {
        const specificStock = locationStockMap.get(`${r.product_id}__${r.warehouse_id}`);
        if (specificStock !== undefined) {
          onHand = specificStock.onHand;
          reservedQty = specificStock.reserved;
        }
      }

      const specificIncoming = incomingMap.get(`${r.product_id}__${r.warehouse_id || 'all'}`);
      const generalIncoming = incomingMap.get(`${r.product_id}__all`);
      const incomingQty = specificIncoming !== undefined ? specificIncoming : (generalIncoming || 0);

      const decision = evaluateReorderingRule({
        productId: r.product_id,
        minQty: Number(r.min_qty || 0),
        maxQty: Number(r.max_qty || 0),
        qtyMultiple: Number(r.qty_multiple || 1),
        onHandQty: onHand,
        incomingQty,
        outgoingQty: reservedQty,
      });

      if (decision.isBreached) breachedCount++;

      return {
        ...r,
        onHandQty: onHand,
        incomingQty,
        reservedQty,
        forecastedQty: decision.forecastedQty,
        isBreached: decision.isBreached,
        shortageQty: decision.shortageQty,
        suggestedOrderQty: decision.suggestedOrderQty,
        decisionReason: decision.reason,
      };
    });

    return {
      rules: evaluatedRules,
      summary: {
        totalRules: rows.length,
        activeRules: activeRulesCount,
        breachedCount,
        generatedOrdersCount,
      },
    };
  }

  /**
   * Lists all reordering rules enriched with real-time stock levels,
   * incoming pipeline quantities, and automated breach evaluations.
   */
  async listRules(
    query: { warehouseId?: number; status?: 'all' | 'breached' | 'normal'; q?: string },
    auth: AuthContext,
  ): Promise<{
    rules: any[];
    summary: {
      totalRules: number;
      activeRules: number;
      breachedCount: number;
      generatedOrdersCount: number;
    };
  }> {
    const { rules: evaluatedRules, summary } = await this.evaluateRules(this.db, query, auth);

    let finalRules = evaluatedRules;
    if (query.status === 'breached') {
      finalRules = evaluatedRules.filter((r: any) => r.isBreached);
    } else if (query.status === 'normal') {
      finalRules = evaluatedRules.filter((r: any) => !r.isBreached);
    }

    return { rules: finalRules, summary };
  }

  /**
   * Creates a new automated reordering rule.
   */
  async createRule(dto: CreateReorderingRuleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);

    if (Number(dto.minQty) < 0) {
      throw new BadRequestException('الحد الأدنى للأمان يجب أن يكون صفرًا أو أكبر');
    }
    if (Number(dto.maxQty) < Number(dto.minQty)) {
      throw new BadRequestException('الحد الأقصى للمخزون يجب أن يكون أكبر من أو مساوياً للحد الأدنى');
    }

    const inserted = await this.db
      .insertInto('reordering_rules')
      .values({
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        product_id: dto.productId,
        warehouse_id: dto.warehouseId || null,
        branch_id: dto.branchId || null,
        min_qty: dto.minQty,
        max_qty: dto.maxQty,
        qty_multiple: dto.qtyMultiple || 1,
        preferred_supplier_id: dto.preferredSupplierId || null,
        action_mode: dto.actionMode || 'auto_draft_po',
        is_active: dto.isActive !== undefined ? dto.isActive : true,
        notes: dto.notes || null,
        created_by: auth.userId ? Number(auth.userId) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.log(
      'إنشاء قاعدة إعادة طلب للمخزون',
      JSON.stringify({ ruleId: inserted.id, productId: dto.productId, min: dto.minQty, max: dto.maxQty }),
      auth,
    );

    return inserted;
  }

  /**
   * Updates an existing reordering rule.
   */
  async updateRule(
    id: number,
    dto: UpdateReorderingRuleDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);

    const existing = await this.db
      .selectFrom('reordering_rules')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('قاعدة إعادة الطلب غير موجودة');
    }

    const minQty = dto.minQty !== undefined ? Number(dto.minQty) : Number(existing.min_qty);
    const maxQty = dto.maxQty !== undefined ? Number(dto.maxQty) : Number(existing.max_qty);

    if (minQty < 0 || maxQty < minQty) {
      throw new BadRequestException('الحد الأقصى للمخزون يجب أن يكون أكبر من أو مساوياً للحد الأدنى');
    }

    const updated = await this.db
      .updateTable('reordering_rules')
      .set({
        warehouse_id: dto.warehouseId !== undefined ? dto.warehouseId : existing.warehouse_id,
        branch_id: dto.branchId !== undefined ? dto.branchId : existing.branch_id,
        min_qty: minQty,
        max_qty: maxQty,
        qty_multiple: dto.qtyMultiple !== undefined ? dto.qtyMultiple : existing.qty_multiple,
        preferred_supplier_id:
          dto.preferredSupplierId !== undefined ? dto.preferredSupplierId : existing.preferred_supplier_id,
        action_mode: dto.actionMode !== undefined ? dto.actionMode : existing.action_mode,
        is_active: dto.isActive !== undefined ? dto.isActive : existing.is_active,
        notes: dto.notes !== undefined ? dto.notes : existing.notes,
        updated_at: sql`now()`,
      })
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.log('تعديل قاعدة إعادة طلب', JSON.stringify({ ruleId: id, min: minQty, max: maxQty }), auth);

    return updated;
  }

  /**
   * Deletes a reordering rule.
   */
  async deleteRule(id: number, auth: AuthContext): Promise<{ ok: boolean }> {
    const scope = requireTenantScope(auth);

    const result = await this.db
      .deleteFrom('reordering_rules')
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (Number(result.numDeletedRows || 0) === 0) {
      throw new NotFoundException('قاعدة إعادة الطلب غير موجودة');
    }

    await this.audit.log('حذف قاعدة إعادة طلب', JSON.stringify({ ruleId: id }), auth);
    return { ok: true };
  }

  /**
   * Evaluates all active reordering rules and automatically generates consolidated Draft Purchase Orders (PO-YYMMDD-XXXX)
   * grouped by preferred supplier and warehouse. The whole evaluation runs in one transaction under the per-tenant
   * reorder-evaluation advisory lock, so the scheduler and manual runs serialise (see INV-REORDER-EVALUATION-PIPELINE).
   * breachedRulesCount counts every breached rule evaluated, including manual_review rules and rules suppressed by an
   * open draft; generatedOrdersCount counts only the orders actually generated.
   */
  async runEvaluation(
    dto: RunReorderingEvaluationDto,
    auth: AuthContext,
  ): Promise<{
    ok: boolean;
    evaluatedRulesCount: number;
    breachedRulesCount: number;
    generatedOrdersCount: number;
    generatedOrders: any[];
  }> {
    const scope = requireTenantScope(auth);
    const result = await this.db.transaction().execute(async (trx) => {
      // Serialise scheduler and manual evaluations for this tenant: the
      // advisory lock is held for the transaction (the storefront/hr
      // pattern), and the rule-row locks give a stable snapshot even
      // where an advisory lock is unavailable.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'reorder-evaluation:' + scope.tenantId}))`.execute(trx);
      await trx
        .selectFrom('reordering_rules')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('is_active', '=', true)
        .orderBy('id')
        .forUpdate()
        .execute();

      const { rules } = await this.evaluateRules(trx, { warehouseId: dto.warehouseId }, auth);
      const activeRules = rules.filter((r: any) => r.is_active);

      // Draft quench: a draft order is uncommitted intent, so it counts
      // nothing as incoming — but while a draft holding this product at
      // this warehouse (or with no warehouse) is still open, generating
      // again would duplicate it on every run. A cancelled or deleted
      // draft is gone from this query, so the suppression lifts on its
      // own; confirming the draft moves it into the committed statuses
      // above, and its remainder then counts as incoming.
      const draftRows: any[] = await trx
        .selectFrom('purchase_order_items as poi')
        .innerJoin('purchase_orders as po', (join: any) =>
          join.onRef('po.id', '=', 'poi.purchase_order_id').on('po.tenant_id', '=', scope.tenantId),
        )
        .select(['poi.product_id', 'po.warehouse_id'])
        .where('po.tenant_id', '=', scope.tenantId)
        .where('po.status', '=', 'draft')
        .execute();
      const draftKeys = new Set(
        draftRows.map((row: any) => `${row.product_id}__${row.warehouse_id ?? '*'}`),
      );
      const hasOpenDraft = (rule: any): boolean =>
        draftKeys.has(`${rule.product_id}__*`) ||
        (rule.warehouse_id != null && draftKeys.has(`${rule.product_id}__${rule.warehouse_id}`));

      const breachedRules = activeRules.filter(
        (r: any) => (!dto.productId || r.product_id === dto.productId) && r.isBreached,
      );
      const breachedItems: BreachedReorderItem[] = [];

      for (const rule of breachedRules) {
        // manual_review rules are evaluated and reported, never generated.
        if (rule.action_mode === 'manual_review') continue;
        if (hasOpenDraft(rule)) continue;

        if (rule.suggestedOrderQty > 0) {
          breachedItems.push({
            ruleId: rule.id,
            productId: rule.product_id,
            productName: rule.product_name || `صنف #${rule.product_id}`,
            unitCost: Number(rule.product_cost_price || 0),
            supplierId: rule.preferred_supplier_id,
            supplierName: rule.preferred_supplier_name,
            supplierPhone: rule.preferred_supplier_phone,
            warehouseId: rule.warehouse_id,
            warehouseName: rule.warehouse_name,
            branchId: rule.branch_id,
            onHandQty: rule.onHandQty,
            incomingQty: rule.incomingQty,
            forecastedQty: rule.forecastedQty,
            minQty: Number(rule.min_qty),
            maxQty: Number(rule.max_qty),
            qtyMultiple: Number(rule.qty_multiple || 1),
            suggestedOrderQty: rule.suggestedOrderQty,
            estimatedCost: Number((rule.suggestedOrderQty * Number(rule.product_cost_price || 0)).toFixed(3)),
          });
        }
      }

      if (dto.autoCreateOrders === false || breachedItems.length === 0) {
        return {
          ok: true,
          evaluatedRulesCount: activeRules.length,
          breachedRulesCount: breachedRules.length,
          generatedOrdersCount: 0,
          generatedOrders: [],
        };
      }

      // Group breached items into unified supplier PO plans
      const supplierPlans = groupReorderItemsBySupplier(breachedItems);
      const generatedOrders: any[] = [];

      for (const plan of supplierPlans) {
        // Create Draft Purchase Order
        const insertedOrder: any = await trx
          .insertInto('purchase_orders')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            order_number: `PO-TMP-${randomUUID()}`,
            supplier_id: plan.supplierId || null,
            supplier_name: plan.supplierName,
            supplier_phone: plan.supplierPhone || null,
            warehouse_id: plan.warehouseId || null,
            warehouse_name: plan.warehouseName,
            subtotal: plan.subtotal,
            tax_amount: 0,
            discount_amount: 0,
            total_amount: plan.totalAmount,
            status: 'draft',
            notes: 'أمر شراء تم توليده آلياً بواسطة محرك قواعد إعادة الطلب التلقائي (نواقص المخزون)',
            created_by: auth.userId ? Number(auth.userId) : null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        // The number derives from the inserted row id, exactly as
        // createOrder numbers a purchase order: never from a row count.
        const orderNumber = formatDailyDocumentNumber('PO', Number(insertedOrder.id));
        await trx
          .updateTable('purchase_orders')
          .set({ order_number: orderNumber })
          .where('id', '=', Number(insertedOrder.id))
          .where('tenant_id', '=', scope.tenantId)
          .execute();
        insertedOrder.order_number = orderNumber;

        // Insert Purchase Order Items
        for (const item of plan.items) {
          await trx
            .insertInto('purchase_order_items')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              purchase_order_id: insertedOrder.id,
              product_id: item.productId,
              product_name: item.productName,
              quantity: item.quantity,
              received_quantity: 0,
              unit_cost: item.unitCost,
              tax_rate: 0,
              discount: 0,
              total: item.total,
              notes: 'طلب تلقائي استناداً لحد الأمان وإعادة الطلب',
            })
            .execute();

          // Update the reordering rule with last run and generated PO ID
          await trx
            .updateTable('reordering_rules')
            .set({
              last_run_at: sql`now()`,
              last_trigger_status: 'po_generated',
              last_generated_po_id: insertedOrder.id,
              updated_at: sql`now()`,
            })
            .where('id', '=', item.ruleId)
            .where('tenant_id', '=', scope.tenantId)
            .execute();
        }

        generatedOrders.push(insertedOrder);
      }

      return {
        ok: true,
        evaluatedRulesCount: activeRules.length,
        breachedRulesCount: breachedRules.length,
        generatedOrdersCount: generatedOrders.length,
        generatedOrders,
      };
    });

    if (result.generatedOrdersCount > 0) {
      await this.audit.log(
        'تشغيل محرك إعادة الطلب وتوليد أوامر الشراء',
        JSON.stringify({
          evaluated: result.evaluatedRulesCount,
          breached: result.breachedRulesCount,
          ordersCreated: result.generatedOrdersCount,
          orderNumbers: result.generatedOrders.map((o: any) => o.order_number),
        }),
        auth,
      );
    }

    return result;
  }
}
