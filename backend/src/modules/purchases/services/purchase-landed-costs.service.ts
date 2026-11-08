import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { ApplyPurchaseLandedCostsDto } from '../dto/purchase-landed-cost.dto';
import { allocateLandedCosts } from '../engines/landed-cost-allocation.engine';
import { allocateReceiptCostByStockFlow, stockMovementGlobalDelta } from '../engines/landed-cost-wac.engine';
import { lockStockProducts } from '../../../common/utils/location-stock-ledger';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { revalueStockCost } from '../../accounting/inventory-valuation';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { MoneyDigits, currencyMoneyDigits, toMinorUnits, fromMinorUnits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

@Injectable()
export class PurchaseLandedCostsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const scope = requireTenantScope(auth);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${scope.tenantId}`
      : sql<boolean>`tenant_id = ${scope.tenantId}`;
  }

  /**
   * Resolve the COGS account for a landed-cost journal (INV-LANDED-COGS-ACCOUNT):
   * the tenant's configured COGS account, never a hard-coded parallel account.
   * The old code posted the sold portion to a hard-coded 5110 while every
   * sale posts COGS to settings.cogs_account_id (5100 by foundation), so
   * the same cost of goods sold was split across two accounts with
   * different groups (5100: cogs, 5110: expenses) and any report summing
   * 5100 alone understated COGS by the landed sold portion. A tenant
   * that deliberately configured a different COGS account keeps it: the
   * configured account wins whenever it exists and is active, and 5100
   * is only the creation fallback, matching the posting service.
   */
  private async resolveCogsAccount(trx: any, scope: { tenantId: string; accountId: string }, settings: any): Promise<number | null> {
    const configuredId = Number(settings?.cogs_account_id || 0);
    if (configuredId > 0) {
      const configured = await trx
        .selectFrom('accounting_accounts')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', configuredId)
        .where('is_active', '=', true)
        .executeTakeFirst();
      if (configured) return Number(configured.id);
    }
    return this.resolveAccountByCode(trx, scope.tenantId, scope.accountId, '5100');
  }

  /**
   * Resolve a system account by code, creating it when missing.
   * Guarding the journal with `if (account)` silently skipped posting while the perpetual cost had
   * already moved, leaving the ledger and inventory valuation permanently out of step.
   */
  private async resolveAccountByCode(trx: any, tenantId: string, accountId: string, code: string): Promise<number | null> {
    const existing = await trx
      .selectFrom('accounting_accounts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (existing) return Number(existing.id);

    const known: Record<string, { ar: string; en: string; type: string; group: string; balance: string }> = {
      '1140': { ar: 'مخزون بضاعة ومواد خام', en: 'Inventory', type: 'asset', group: 'current_assets', balance: 'debit' },
      '5100': { ar: 'تكلفة بضاعة مباعة', en: 'COGS', type: 'expense', group: 'cogs', balance: 'debit' },
    };
    const spec = known[code];
    if (!spec) return null;

    const [created] = await trx
      .insertInto('accounting_accounts')
      .values({
        tenant_id: tenantId,
        account_id: accountId || tenantId,
        code,
        name_ar: spec.ar,
        name_en: spec.en,
        account_type: spec.type,
        account_group: spec.group,
        normal_balance: spec.balance,
        is_active: true,
        is_system: true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .execute();
    return created ? Number(created.id) : null;
  }

  async getPurchaseLandedCosts(purchaseId: number, auth: AuthContext, queryable: Kysely<Database> = this.db): Promise<any> {
    const scope = requireTenantScope(auth);

    const purchase = await (queryable as any)
      .selectFrom('purchases as p')
      .leftJoin('suppliers as s', (join: any) => join.onRef('s.id', '=', 'p.supplier_id').onRef('s.tenant_id', '=', 'p.tenant_id'))
      .where('p.id', '=', purchaseId)
      .where(this.tenantPredicate(auth, 'p'))
      .select([
        'p.id',
        'p.doc_no',
        'p.supplier_id',
        's.name as supplier_name',
        'p.subtotal',
        'p.total',
        'p.landed_cost_total',
        'p.landed_cost_allocation_method',
        'p.landed_cost_notes',
        'p.landed_cost_applied_at',
        'p.created_at',
      ])
      .executeTakeFirst();

    if (!purchase) {
      throw new NotFoundException('فاتورة المشتريات غير موجودة.');
    }

    const items = await (queryable as any)
      .selectFrom('purchase_items as pi')
      .where('pi.purchase_id', '=', purchaseId)
      .where(this.tenantPredicate(auth, 'pi'))
      .select([
        'pi.id',
        'pi.product_id',
        'pi.product_name',
        'pi.qty',
        'pi.unit_cost',
        'pi.line_total',
        'pi.unit_name',
        'pi.allocated_landed_cost',
        'pi.landed_unit_cost',
      ])
      .orderBy('pi.id', 'asc')
      .execute();

    const landedCosts = await (queryable as any)
      .selectFrom('purchase_landed_costs as plc')
      .where('plc.purchase_id', '=', purchaseId)
      .where(this.tenantPredicate(auth, 'plc'))
      .selectAll()
      .orderBy('plc.id', 'asc')
      .execute();

    return {
      purchase: {
        id: Number(purchase.id),
        docNo: purchase.doc_no,
        supplierId: purchase.supplier_id ? Number(purchase.supplier_id) : null,
        supplierName: purchase.supplier_name || 'مورد عام',
        subtotal: Number(purchase.subtotal || 0),
        total: Number(purchase.total || 0),
        landedCostTotal: Number(purchase.landed_cost_total || 0),
        landedCostAllocationMethod: purchase.landed_cost_allocation_method || 'value',
        landedCostNotes: purchase.landed_cost_notes || '',
        landedCostAppliedAt: purchase.landed_cost_applied_at,
        createdAt: purchase.created_at,
      },
      costs: landedCosts.map((c: any) => ({
        id: Number(c.id),
        costType: c.cost_type,
        description: c.description,
        amount: Number(c.amount || 0),
        vendorId: c.vendor_id ? Number(c.vendor_id) : null,
        allocationMethod: c.allocation_method,
      })),
      items: items.map((it: any) => ({
        id: Number(it.id),
        productId: it.product_id ? Number(it.product_id) : null,
        productName: it.product_name,
        qty: Number(it.qty || 0),
        unitCost: Number(it.unit_cost || 0),
        lineTotal: Number(it.line_total || 0),
        unitName: it.unit_name,
        allocatedLandedCost: Number(it.allocated_landed_cost || 0),
        landedUnitCost: it.landed_unit_cost ? Number(it.landed_unit_cost) : Number(it.unit_cost || 0),
      })),
    };
  }

  private async calculateStockFlowShares(trx: any, purchaseId: number, items: any[],
    allocatedCosts: number[], tenantId: string, accountId: string, minorUnits: MoneyDigits) {
    const productIds = [...new Set(items.map((item) => Number(item.product_id || 0)).filter((id) => id > 0))].sort((a, b) => a - b);
    await lockStockProducts(trx, { tenantId, accountId, productIds });
    const productRows = productIds.length ? await trx.selectFrom('products')
      .select(['id', 'stock_qty', 'cost_price', 'item_type'])
      .where('tenant_id', '=', tenantId).where('id', 'in', productIds).orderBy('id', 'asc').execute() : [];
    const products = new Map<number, any>(productRows.map((row: any) => [Number(row.id), row]));
    const receiptGroups = new Map<number, Array<{ key: number; movementId: number; receivedQty: number; allocatedCost: number }>>();
    const usedAtMovement = new Map<number, number>();
    const splits = new Map<number, { inventory: number; cogs: number }>();
    for (const [index, item] of items.entries()) {
      const allocatedCost = allocatedCosts[index];
      const productId = Number(item.product_id || 0);
      const product = products.get(productId);
      if (!productId || product?.item_type === 'service') {
        splits.set(Number(item.id), { inventory: 0, cogs: allocatedCost });
        continue;
      }
      if (!product) throw new BadRequestException('صنف الفاتورة غير موجود في هذه المنشأة.');
      const receivedQty = Number(item.qty) * Number(item.unit_multiplier || 1);
      if (!Number.isFinite(receivedQty) || receivedQty <= 0) throw new BadRequestException('كمية فاتورة الشراء غير صالحة لتحميل التكلفة.');
      let sourceType = 'purchase';
      let sourceId = purchaseId;
      if (item.grn_line_id) {
        const receiptLine = await trx.selectFrom('goods_receipt_lines')
          .select(['grn_id', 'product_id', 'accepted_qty'])
          .where('tenant_id', '=', tenantId).where('id', '=', Number(item.grn_line_id)).executeTakeFirst();
        if (!receiptLine || Number(receiptLine.product_id) !== productId ||
            Number(receiptLine.accepted_qty) + 0.001 < receivedQty) {
          throw new BadRequestException('بند الفاتورة لا يطابق محضر استلام منشوراً وكمية مقبولة.');
        }
        sourceType = 'goods_receipt';
        sourceId = Number(receiptLine.grn_id);
      }
      const sourceMovements = await trx.selectFrom('stock_movements')
        .select(['id', 'qty']).where('tenant_id', '=', tenantId)
        .where('product_id', '=', productId).where('reference_type', '=', sourceType)
        .where('reference_id', '=', sourceId)
        .where('movement_type', 'in', sourceType === 'purchase' ? ['purchase', 'purchase_receipt'] : ['goods_receipt'])
        .orderBy('id', 'asc').execute();
      const anchor = sourceMovements.find((row: any) =>
        Number(row.qty) - (usedAtMovement.get(Number(row.id)) || 0) + 0.001 >= receivedQty);
      if (!anchor) throw new BadRequestException('لا توجد حركة استلام مخزني كافية يمكن ربط التكلفة الإضافية بها.');
      const movementId = Number(anchor.id);
      usedAtMovement.set(movementId, (usedAtMovement.get(movementId) || 0) + receivedQty);
      const group = receiptGroups.get(productId) || [];
      group.push({ key: Number(item.id), movementId, receivedQty, allocatedCost });
      receiptGroups.set(productId, group);
    }
    for (const [productId, receipts] of receiptGroups) {
      const firstId = Math.min(...receipts.map((receipt) => receipt.movementId));
      const rows = await trx.selectFrom('stock_movements').select(['id', 'movement_type', 'qty'])
        .where('tenant_id', '=', tenantId).where('product_id', '=', productId)
        .where('id', '>=', firstId).orderBy('id', 'asc').execute();
      try {
        const movementFlow = rows.map((row: any) => ({
          id: Number(row.id), globalDelta: stockMovementGlobalDelta(String(row.movement_type), Number(row.qty)),
        }));
        const portions = allocateReceiptCostByStockFlow({
          currentStock: Number(products.get(productId).stock_qty), movements: movementFlow, receipts, minorUnits,
        });
        for (const [key, value] of portions) splits.set(key, value);
      } catch (error) {
        throw new BadRequestException(`تعذر تسوية حركة مخزون الصنف ${productId} لتحميل التكلفة: ${(error as Error).message}`);
      }
    }
    return { products, splits };
  }

  async applyPurchaseLandedCosts(
    purchaseId: number,
    dto: ApplyPurchaseLandedCostsDto,
    auth: AuthContext,
  ): Promise<any> {
    const scope = requireTenantScope(auth);

    return await this.db.transaction().execute(async (trx: any) => {
      const purchase = await trx
        .selectFrom('purchases')
        .where('id', '=', purchaseId)
        .where(this.tenantPredicate(auth))
        .select(['id', 'doc_no', 'subtotal', 'total', 'status', 'supplier_id', 'landed_cost_applied_at', 'created_at'])
        .forUpdate()
        .executeTakeFirst();

      if (!purchase) {
        throw new NotFoundException('فاتورة المشتريات غير موجودة.');
      }

      if (purchase.status !== 'posted') {
        throw new BadRequestException('يجب ترحيل فاتورة المشتريات قبل تحميل تكاليف إضافية عليها.');
      }

      // landed_cost_applied_at was written but never read, so re-running this compounded the cost
      // into products.cost_price without limit and double-posted the capitalisation journal.
      if (purchase.landed_cost_applied_at) {
        // The applied instant is shown as the tenant-local business day
        // it landed on, not its UTC day.
        const appliedDay = await resolveBusinessDateKey(trx, scope.tenantId, purchase.landed_cost_applied_at);
        throw new BadRequestException(
          `سبق تحميل تكاليف إضافية على هذه الفاتورة بتاريخ ${appliedDay}. لإعادة التحميل يلزم عكس التحميل السابق أولاً.`,
        );
      }

      const items = await trx
        .selectFrom('purchase_items')
        .where('purchase_id', '=', purchaseId)
        .where(this.tenantPredicate(auth))
        .selectAll()
        .orderBy('id', 'asc')
        .execute();

      if (!items.length) {
        throw new BadRequestException('الفاتورة لا تحتوي على أي بنود لتحميل التكلفة عليها.');
      }

      const minorUnits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      if (!Array.isArray(dto.costs) || !dto.costs.length) {
        throw new BadRequestException('يجب تحديد التكاليف الإضافية.');
      }
      let totalMinor = 0;
      for (const cost of dto.costs) {
        try {
          const minor = toMinorUnits(Number(cost.amount), minorUnits);
          if (minor <= 0) throw new Error('Non-positive');
          totalMinor += minor;
          if (!Number.isSafeInteger(totalMinor)) throw new Error('Unsafe');
        } catch {
          throw new BadRequestException('مبالغ التكاليف الإضافية لا تطابق دقة عملة الأساس.');
        }
      }
      const totalLandedCost = fromMinorUnits(totalMinor, minorUnits);
      if (dto.costs.some((cost) => cost.vendorId != null &&
          (!Number.isSafeInteger(Number(cost.vendorId)) || Number(cost.vendorId) <= 0))) {
        throw new BadRequestException('معرّف مورد التكلفة الإضافية غير صالح.');
      }
      const vendorIds = [...new Set(dto.costs.map((cost) => Number(cost.vendorId || 0)).filter((id) => id > 0))];
      if (vendorIds.length && (await trx.selectFrom('suppliers').select('id')
        .where('tenant_id', '=', scope.tenantId).where('id', 'in', vendorIds).execute()).length !== vendorIds.length) {
        throw new BadRequestException('أحد موردي التكاليف الإضافية لا يتبع المنشأة.');
      }
      // Split of the allocation between inventory still held and units already sold.
      let totalCapitalisedLandedCost = 0;
      let totalCogsLandedCost = 0;

      // 1. Delete previous landed costs for this purchase
      await trx
        .deleteFrom('purchase_landed_costs')
        .where('purchase_id', '=', purchaseId)
        .where(this.tenantPredicate(auth))
        .execute();

      // 2. Insert new landed costs breakdown
      if (dto.costs.length > 0) {
        const costRows = dto.costs.map((c) => ({
          tenant_id: scope.tenantId,
          purchase_id: purchaseId,
          cost_type: c.costType,
          description: c.description,
          amount: Number(c.amount),
          vendor_id: c.vendorId || null,
          allocation_method: dto.allocationMethod,
        }));
        await trx.insertInto('purchase_landed_costs').values(costRows).execute();
      }

      // 3. Distribute the exact total over items in cents; individual rounding used
      // to silently lose pennies and misclassify residuals as COGS.
      const weights = items.map((item: any) => {
        if (dto.allocationMethod === 'value') return Math.max(0, Number(item.line_total || 0));
        if (dto.allocationMethod === 'qty') return Math.max(0, Number(item.qty || 0) * Number(item.unit_multiplier || 1));
        return 1;
      });
      const allocatedCosts = allocateLandedCosts(totalLandedCost, weights, minorUnits);
      const { products, splits } = await this.calculateStockFlowShares(
        trx, purchaseId, items, allocatedCosts, scope.tenantId, scope.accountId, minorUnits);
      const inventoryAdditionByProduct = new Map<number, number>();
      for (const [index, item] of items.entries()) {
        const itemQty = Number(item.qty || 1);
        const allocatedCost = allocatedCosts[index];
        const baseUnitCost = Number(item.unit_cost || 0);
        const landedUnitCost = Number((baseUnitCost + (itemQty > 0 ? allocatedCost / itemQty : 0)).toFixed(6));

        // Update purchase_item
        await trx
          .updateTable('purchase_items')
          .set({
            allocated_landed_cost: allocatedCost,
            landed_unit_cost: landedUnitCost,
          })
          .where('id', '=', item.id)
          .where(this.tenantPredicate(auth))
          .execute();

        const split = splits.get(Number(item.id));
        if (!split) throw new BadRequestException('تعذر حساب نصيب المخزون من التكلفة الإضافية.');
        totalCapitalisedLandedCost += split.inventory;
        totalCogsLandedCost += split.cogs;
        if (item.product_id && split.inventory > 0) {
          const productId = Number(item.product_id);
          inventoryAdditionByProduct.set(productId,
            (inventoryAdditionByProduct.get(productId) || 0) + split.inventory);
        }
      }
      for (const [productId, capitalised] of inventoryAdditionByProduct) {
        const product = products.get(productId);
        const currentStock = Number(product?.stock_qty || 0);
        const currentCost = Number(product?.cost_price || 0);
        if (currentStock <= 0 || !Number.isFinite(currentCost) || currentCost < 0) {
          throw new BadRequestException('رصيد المخزون أو تكلفته غير صالح لتحميل التكلفة الإضافية.');
        }
        // INV-STOCK-POOL-REVALUATION: the pool revaluation writer
        // spreads the capitalised cost over the stock on hand. The
        // guard above keeps this site's fail-closed message; the
        // writer re-checks the same inputs through the primitive.
        // Products are locked by calculateStockFlowShares above.
        await revalueStockCost(trx, scope.tenantId, productId, currentStock, capitalised);
      }
      if (toMinorUnits(roundMoney(totalCapitalisedLandedCost + totalCogsLandedCost, minorUnits), minorUnits) !== totalMinor) {
        throw new BadRequestException('توزيع التكلفة الإضافية بين المخزون والمباع غير متزن.');
      }

      // 4. Update purchase header
      await trx
        .updateTable('purchases')
        .set({
          landed_cost_total: totalLandedCost,
          landed_cost_allocation_method: dto.allocationMethod,
          landed_cost_notes: dto.notes || null,
          landed_cost_applied_at: new Date(),
        })
        .where('id', '=', purchaseId)
        .where(this.tenantPredicate(auth))
        .execute();

      // The cost is recognised when applied. Posting it on the old purchase date would rewrite
      // a signed-off month; the central journal guard checks both lock dates and monthly periods.
      if (totalLandedCost > 0) {
        if (totalMinor <= 0) {
          throw new BadRequestException('التكاليف الإضافية أقل من أصغر وحدة نقدية؛ تعذر إنشاء القيد المحاسبي.');
        }
        const settings = await trx
          .selectFrom('accounting_settings')
          .selectAll()
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', 1)
          .executeTakeFirst();

        const invAccount = await this.resolveAccountByCode(trx, scope.tenantId, scope.accountId, '1140');
        const cogsAccount = await this.resolveCogsAccount(trx, scope, settings);

        const payableAccountId = Number(settings?.supplier_payable_account_id || 0);
        const payableAccount = payableAccountId > 0 ? await trx.selectFrom('accounting_accounts')
          .select('id').where('tenant_id', '=', scope.tenantId).where('id', '=', payableAccountId)
          .where('is_active', '=', true).executeTakeFirst() : null;

        // Never skip the journal silently: products.cost_price has already been changed above, so
        // a skipped entry leaves the perpetual cost and the general ledger permanently divergent.
        if (!invAccount || !payableAccount || !cogsAccount) {
          throw new BadRequestException(
            'تعذر إثبات التكاليف الإضافية: حساب المخزون (1140) أو حساب الموردين غير مهيأ في شجرة الحسابات.',
          );
        }

        const capitalised = roundMoney(totalCapitalisedLandedCost, minorUnits);
        const toCogs = fromMinorUnits(totalMinor - toMinorUnits(capitalised, minorUnits), minorUnits);
        await this.accountingPosting.postDomainJournal(trx, {
          sourceType: 'purchase_landed_cost', sourceId: purchaseId,
          tenantId: scope.tenantId, accountId: scope.accountId,
          entryDate: new Date(),
          description: `إثبات تكاليف إضافية لفاتورة شراء ${purchase.doc_no || purchaseId}`,
          createdBy: auth.userId,
          lines: [
            ...(capitalised > 0 ? [{ accountId: Number(invAccount), debit: capitalised, credit: 0,
              description: 'تحميل تكاليف إضافية على المخزون', partnerType: 'none' as const,
              partnerId: null, branchId: null, locationId: null }] : []),
            ...(toCogs > 0 ? [{ accountId: Number(cogsAccount), debit: toCogs, credit: 0,
              description: 'نصيب الوحدات المباعة من التكاليف الإضافية', partnerType: 'none' as const,
              partnerId: null, branchId: null, locationId: null }] : []),
            ...Array.from(dto.costs.reduce((vendors, cost) => {
              const vendorId = Number(cost.vendorId || purchase.supplier_id || 0);
              if (!vendorId) throw new BadRequestException('يجب تحديد مورد كل تكلفة إضافية.');
              vendors.set(vendorId, (vendors.get(vendorId) || 0) + toMinorUnits(cost.amount, minorUnits));
              return vendors;
            }, new Map<number, number>()), ([vendorId, amount]) => ({
              accountId: payableAccountId, debit: 0, credit: fromMinorUnits(amount, minorUnits),
              description: 'استحقاق تكاليف الشحن والجمارك', partnerType: 'supplier' as const,
              partnerId: vendorId, branchId: null, locationId: null,
            })),
          ],
        });
      }

      return this.getPurchaseLandedCosts(purchaseId, auth, trx);
    });
  }
}
