import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { type Kysely, Selectable } from '../../../database/kysely';
import { type Database, GoodsReceiptLineTable, PurchaseOrderItemTable } from '../../../database/database.types';
import { type AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { VerifyThreeWayMatchDto } from '../dto/goods-receipt.dto';
import { computeThreeWayMatch, ThreeWayMatchInput } from '../three-way-match.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';

/**
 * GoodsReceiptThreeWayMatchService — slice S4 of the goods-receipt split.
 * Pure move of the three-way-match flow from the goods-receipt
 * service. No behavior change: the body is byte-identical; the
 * facade keeps a thin public delegate with the same name and
 * signature. This slice reaches the kernel helper only through a
 * bound dep — it never imports another slice service.
 */

export interface GoodsReceiptThreeWayMatchDeps {
  db: Kysely<Database>;
  // Bound kernel helper (stays in the facade; passed bound so the moved
  // body stays byte-identical).
  tenantPredicate: (auth: AuthContext, alias?: string) => any;
}

@Injectable()
export class GoodsReceiptThreeWayMatchService {
  private readonly db: Kysely<Database>;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => any;

  constructor(deps: GoodsReceiptThreeWayMatchDeps) {
    this.db = deps.db;
    this.tenantPredicate = deps.tenantPredicate;
  }

  async verifyPurchaseThreeWayMatch(purchaseId: number, dto: VerifyThreeWayMatchDto, auth: AuthContext): Promise<any> {
    const scope = requireTenantScope(auth);

    const matchResult = await this.db.transaction().execute(async (trx) => {
      const purchase = await trx
        .selectFrom('purchases')
        .where('id', '=', purchaseId)
        .where('tenant_id', '=', scope.tenantId)
        .selectAll()
        .forUpdate()
        .executeTakeFirst();

      if (!purchase) {
        throw new NotFoundException(`فاتورة المشتريات رقم ${purchaseId} غير موجودة.`);
      }
      if (purchase.status === 'cancelled') {
        throw new BadRequestException('لا يمكن اعتماد مطابقة فاتورة مشتريات ملغاة.');
      }
      if (dto.allowOverride && (!purchase.created_by || Number(purchase.created_by) === Number(auth.userId))) {
        throw new BadRequestException('يجب أن يعتمد تجاوز المطابقة مستخدم غير منشئ الفاتورة ومعروف الهوية.');
      }
      const configuredTolerance = await trx
        .selectFrom('settings')
        .select('value')
        .where('tenant_id', '=', scope.tenantId)
        .where('key', '=', 'purchaseThreeWayTolerancePercent')
        .executeTakeFirst();
      let tolerance = 2;
      if (configuredTolerance) {
        try {
          tolerance = Number(JSON.parse(configuredTolerance.value));
        } catch {
          tolerance = Number(configuredTolerance.value);
        }
      }
      if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) {
        throw new BadRequestException('نسبة التسامح المسجلة للمنشأة غير صالحة.');
      }
      if (dto.tolerancePercentage !== undefined && dto.tolerancePercentage > tolerance) {
        throw new BadRequestException('لا يجوز رفع نسبة التسامح التعاقدية من طلب الاعتماد.');
      }
      const linkedPoId = purchase.po_id ? Number(purchase.po_id) : null;
      if (!linkedPoId && !purchase.grn_id) {
        throw new BadRequestException('المطابقة الثلاثية مخصصة للفواتير المرتبطة بأمر شراء أو محضر استلام.');
      }
      if (linkedPoId) {
        const order = await trx
          .selectFrom('purchase_orders')
          .select(['id', 'supplier_id'])
          .where('id', '=', linkedPoId)
          .where('tenant_id', '=', scope.tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (!order || Number(order.supplier_id) !== Number(purchase.supplier_id)) {
          throw new BadRequestException('أمر الشراء لا يتبع المورد المحدد في الفاتورة.');
        }
      }

      const purchaseItems = await trx
        .selectFrom('purchase_items')
        .where('purchase_id', '=', purchaseId)
        .where('tenant_id', '=', scope.tenantId)
        .selectAll()
        .execute();

      const products = await trx
        .selectFrom('products')
        .select(['id', 'item_type'])
        .where('tenant_id', '=', scope.tenantId)
        .where(
          'id',
          'in',
          purchaseItems.map((item) => Number(item.product_id)),
        )
        .execute();
      const productTypes = new Map(products.map((product) => [Number(product.id), product.item_type]));
      if (purchaseItems.some((item) => !productTypes.has(Number(item.product_id)))) {
        throw new BadRequestException('أحد أصناف الفاتورة غير موجود في المنشأة.');
      }
      const allServices =
        purchaseItems.length > 0 &&
        purchaseItems.every((item) => productTypes.get(Number(item.product_id)) === 'service');
      if (dto.isServiceItem && !allServices) {
        throw new BadRequestException('لا يمكن تجاوز الاستلام المخزني لصنف غير خدمي.');
      }

      // Fetch PO items if purchase is linked to a PO.
      // purchases.po_id is added by migration 113; before it existed this was always undefined and the
      // price-variance leg of the match could never fire.
      let poItems: Selectable<PurchaseOrderItemTable>[] = [];
      if (linkedPoId) {
        poItems = await trx
          .selectFrom('purchase_order_items')
          .where('purchase_order_id', '=', linkedPoId)
          .where('tenant_id', '=', scope.tenantId)
          .selectAll()
          .execute();
      }

      // Fetch GRN lines if purchase is linked to GRN or PO
      let grnLines: Selectable<GoodsReceiptLineTable>[] = [];
      if (purchase.grn_id) {
        const header = await trx
          .selectFrom('goods_receipt_notes')
          .select(['id', 'purchase_order_id', 'supplier_id', 'status'])
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', Number(purchase.grn_id))
          .forUpdate()
          .executeTakeFirst();
        if (
          !header ||
          header.status !== 'posted' ||
          Number(header.supplier_id) !== Number(purchase.supplier_id) ||
          Number(header.purchase_order_id || 0) !== Number(linkedPoId || 0)
        ) {
          throw new BadRequestException('محضر الاستلام غير منشور أو لا يتبع المورد وأمر الشراء في الفاتورة.');
        }
        grnLines = await trx
          .selectFrom('goods_receipt_lines')
          .where('grn_id', '=', purchase.grn_id)
          .where('tenant_id', '=', scope.tenantId)
          .selectAll()
          .execute();
      } else if (linkedPoId) {
        const grns = await trx
          .selectFrom('goods_receipt_notes')
          .select('id')
          .where('purchase_order_id', '=', linkedPoId)
          .where('supplier_id', '=', Number(purchase.supplier_id))
          .where('status', '=', 'posted')
          .where(this.tenantPredicate(auth))
          .execute();
        const grnIds = grns.map((g) => Number(g.id));
        if (grnIds.length > 0) {
          grnLines = await trx
            .selectFrom('goods_receipt_lines')
            .where('grn_id', 'in', grnIds)
            .where(this.tenantPredicate(auth))
            .selectAll()
            .execute();
        }
      }

      // MATCH-1 requires the quantities already invoiced against this PO/GRN by OTHER purchase
      // invoices. Without it priorQty was always 0, so the same delivery could be billed and paid
      // an unlimited number of times — the precise fraud this invariant exists to prevent.
      let historicalInvoicedLines: Array<{ poItemId?: number; productId: number; qty: number }> = [];
      if (linkedPoId || purchase.grn_id) {
        let histQuery = trx
          .selectFrom('purchase_items as pi')
          .innerJoin('purchases as p', (join) =>
            join.onRef('p.id', '=', 'pi.purchase_id').onRef('p.tenant_id', '=', 'pi.tenant_id'),
          )
          .select(['pi.po_item_id', 'pi.product_id', 'pi.qty'])
          .where('p.tenant_id', '=', scope.tenantId)
          .where('p.id', '!=', purchaseId)
          .where('p.status', '!=', 'cancelled');

        histQuery = linkedPoId
          ? histQuery.where('p.po_id', '=', linkedPoId)
          : histQuery.where('p.grn_id', '=', Number(purchase.grn_id));

        const histRows = await histQuery.execute();
        historicalInvoicedLines = histRows.map((r) => ({
          poItemId: r.po_item_id ? Number(r.po_item_id) : undefined,
          productId: Number(r.product_id),
          qty: Number(r.qty || 0),
        }));
      }

      // Separation of duties: the person keying the invoice cannot clear their own block.
      // A full override (accepting goods never received) requires elevated authority.
      const requestedScope = dto.overrideScope === 'full' ? 'full' : 'price_only';
      if (dto.allowOverride) {
        const role = String(auth.role || '').trim();
        const canOverridePrice = ['admin', 'super_admin', 'manager', 'accountant'].includes(role);
        const canOverrideFull = ['admin', 'super_admin'].includes(role);
        if (!canOverridePrice || (requestedScope === 'full' && !canOverrideFull)) {
          throw new BadRequestException(
            'صلاحيتك لا تسمح بتجاوز نتيجة المطابقة الثلاثية بهذا النطاق. تجاوز فروق الكميات يتطلب اعتماد الإدارة.',
          );
        }
        if (!String(dto.overrideReason || '').trim()) {
          throw new BadRequestException('يجب توثيق سبب لتجاوز المطابقة الثلاثية.');
        }
      }

      // Build ThreeWayMatchInput
      const input: ThreeWayMatchInput = {
        historicalInvoicedLines,
        overrideScope: requestedScope,
        poItems: poItems.map((poi) => ({
          id: Number(poi.id),
          productId: Number(poi.product_id),
          qty: Number(poi.quantity || 0),
          unitCost: Number(poi.unit_cost || 0),
          isService: productTypes.get(Number(poi.product_id)) === 'service',
        })),
        grnLines: grnLines.map((gl) => ({
          id: Number(gl.id),
          grnId: Number(gl.grn_id),
          poItemId: gl.purchase_order_item_id ? Number(gl.purchase_order_item_id) : undefined,
          productId: Number(gl.product_id),
          receivedQty: Number(gl.received_qty || 0),
          acceptedQty: Number(gl.accepted_qty || 0),
          rejectedQty: Number(gl.rejected_qty || 0),
          unitCost: Number(gl.unit_cost || 0),
        })),
        invoiceItems: purchaseItems.map((pi) => ({
          id: Number(pi.id),
          poItemId: pi.po_item_id ? Number(pi.po_item_id) : undefined,
          grnLineId: pi.grn_line_id ? Number(pi.grn_line_id) : undefined,
          productId: Number(pi.product_id),
          qty: Number(pi.qty || 0),
          unitCost: Number(pi.unit_cost || 0),
        })),
        tolerancePercentage: dto.tolerancePercentage ?? tolerance,
        // The gate verifies the BILL's own VAT: its stored tax_rate
        // (percent) converted to the engine's fraction, and its
        // prices_include_tax flag so tax-inclusive lines extract VAT
        // instead of stacking a second VAT on top. The old call passed
        // no rate at all, so every bill was verified at the engine's
        // hardcoded 14% default.
        vatRate: Number(purchase.tax_rate || 0) / 100,
        pricesIncludeTax: Boolean(purchase.prices_include_tax),
        // The verification gate rounds to book precision; defaulting to 2 here
        // would reintroduce the GRNI loss inside the check that is supposed to
        // catch it. The engine throws on any other value.
        minorUnits: currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId)),
        isServiceItem: allServices,
        serviceCompletionRef: dto.serviceCompletionRef,
        allowOverride: dto.allowOverride,
        overrideReason: dto.overrideReason,
      };

      const computedMatch = computeThreeWayMatch(input);

      // Real quantity variance instead of the hardcoded 0 that previously misrepresented every record.
      const qtyVariance = Number(
        computedMatch.lines
          .reduce((sum, l) => sum + Math.max(0, l.cumulativeInvoicedQty - l.acceptedGrnQty), 0)
          .toFixed(4),
      );

      // Both writes in one transaction: previously a failure between them left the match table and
      // the purchase header disagreeing about whether the invoice was matched.
      await trx
        .insertInto('purchase_three_way_matches')
        .values({
          tenant_id: scope.tenantId,
          purchase_id: purchaseId,
          purchase_order_id: linkedPoId,
          grn_id: purchase.grn_id || null,
          match_status: computedMatch.overallStatus,
          price_variance_amount: computedMatch.totalPpv,
          qty_variance_amount: qtyVariance,
          tolerance_percentage: computedMatch.tolerancePercentage,
          is_service_item: allServices,
          service_completion_ref: dto.serviceCompletionRef || null,
          override_approved_by: dto.allowOverride ? auth.userId : null,
          override_reason: dto.overrideReason || null,
          override_scope: dto.allowOverride ? requestedScope : null,
          blocking_codes: computedMatch.blockingCodes,
          reconciliation_discrepancy: computedMatch.reconciliationDiscrepancy,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'purchase_id']).doUpdateSet({
            purchase_order_id: linkedPoId,
            match_status: computedMatch.overallStatus,
            price_variance_amount: computedMatch.totalPpv,
            qty_variance_amount: qtyVariance,
            override_approved_by: dto.allowOverride ? auth.userId : null,
            override_reason: dto.overrideReason || null,
            override_scope: dto.allowOverride ? requestedScope : null,
            blocking_codes: computedMatch.blockingCodes,
            reconciliation_discrepancy: computedMatch.reconciliationDiscrepancy,
            updated_at: new Date(),
          }),
        )
        .execute();

      await trx
        .updateTable('purchases')
        .set({ three_way_match_status: computedMatch.overallStatus })
        .where('id', '=', purchaseId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      return computedMatch;
    });
    if (!matchResult.isValidForPosting) {
      throw new UnprocessableEntityException({
        message: 'لم تجتز الفاتورة المطابقة الثلاثية.',
        blockingCodes: matchResult.blockingCodes,
        blockingReasons: matchResult.blockingReasons,
      });
    }
    return matchResult;
  }
}
