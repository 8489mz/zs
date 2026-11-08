import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export interface MarginProtectionItem {
  productId: number;
  productName: string;
  barcode: string;
  previousCost: number;
  newCost: number;
  costChangePercent: number;
  currentRetailPrice: number;
  currentWholesalePrice: number;
  currentMarginPercent: number;
  previousMarginPercent: number;
  targetMarginPercent: number;
  recommendedRetailPrice: number;
  recommendedWholesalePrice: number;
  isLossMaking: boolean;
  isMarginCompressed: boolean;
}

export interface MarginProtectionAnalysisResponse {
  purchaseId: number;
  docNo: string;
  supplierName: string;
  totalAffectedItems: number;
  lossMakingCount: number;
  marginCompressedCount: number;
  defaultTargetMargin: number;
  items: MarginProtectionItem[];
}

export interface ApplyRepricingPayload {
  items: Array<{
    productId: number;
    newRetailPrice: number;
    newWholesalePrice?: number;
  }>;
  notifyOwner?: boolean;
}

interface RawPurchaseItemRow {
  product_id: number;
  product_name: string;
  barcode?: string | null;
  current_product_cost?: number | string | null;
  retail_price?: number | string | null;
  wholesale_price?: number | string | null;
  unit_cost?: number | string | null;
  total_cost?: number | string | null;
  quantity?: number | string | null;
}

@Injectable()
export class MarginProtectionService {
  private readonly logger = new Logger(MarginProtectionService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {}

  private toBookMoney(val: number, digits: MoneyDigits): number {
    const n = Number(val || 0);
    return Number.isFinite(n) ? roundMoney(n, digits) : 0;
  }

  async analyzePurchaseMargins(purchaseId: number, targetMargin = 25, auth: AuthContext): Promise<MarginProtectionAnalysisResponse> {
    const scope = requireTenantScope(auth);

    const purchase = await this.db
      .selectFrom('purchases as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .select([
        'p.id',
        'p.doc_no',
        's.name as supplier_name',
      ])
      .where('p.id', '=', purchaseId)
      .where('p.tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!purchase) {
      throw new NotFoundException('فاتورة المشتريات غير موجودة');
    }

    const items: RawPurchaseItemRow[] = (await this.db
      .selectFrom('purchase_items as pi')
      .innerJoin('products as pr', 'pr.id', 'pi.product_id')
      .select([
        'pr.id as product_id',
        'pr.name as product_name',
        'pr.barcode',
        'pr.cost_price as current_product_cost',
        'pr.retail_price',
        'pr.wholesale_price',
        'pi.unit_cost',
        'pi.total_cost',
        'pi.quantity',
      ] as any)
      .where('pi.purchase_id', '=', purchaseId)
      .where('pi.tenant_id', '=', scope.tenantId)
      .execute()) as any;

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const analysisItems: MarginProtectionItem[] = [];
    let lossMakingCount = 0;
    let marginCompressedCount = 0;

    for (const row of items) {
      const productId = Number(row.product_id);
      const newCost = Number(row.unit_cost || 0);
      const previousCost = Number(row.current_product_cost || 0);
      const currentRetailPrice = Number(row.retail_price || 0);
      const currentWholesalePrice = Number(row.wholesale_price || 0);

      // We focus on items where cost increased or current retail yields low/negative margin
      const costChangePercent = previousCost > 0
        ? Number((((newCost - previousCost) / previousCost) * 100).toFixed(1))
        : (newCost > 0 ? 100 : 0);

      const currentMarginPercent = currentRetailPrice > 0
        ? Number((((currentRetailPrice - newCost) / currentRetailPrice) * 100).toFixed(1))
        : 0;

      const previousMarginPercent = currentRetailPrice > 0 && previousCost > 0
        ? Number((((currentRetailPrice - previousCost) / currentRetailPrice) * 100).toFixed(1))
        : 0;

      const isLossMaking = currentRetailPrice <= newCost;
      const isMarginCompressed = currentMarginPercent < 15;

      if (isLossMaking) lossMakingCount++;
      if (isMarginCompressed) marginCompressedCount++;

      // Recommended price to achieve target margin %: Cost / (1 - Margin%)
      const safeTargetMargin = Math.min(80, Math.max(5, targetMargin));
      const recommendedRetailPrice = this.toBookMoney(newCost / (1 - (safeTargetMargin / 100)), bookDigits);

      // Recommended wholesale margin is typically around 60% of retail margin
      const wholesaleTargetMargin = Math.min(50, Math.max(3, safeTargetMargin * 0.6));
      const recommendedWholesalePrice = this.toBookMoney(newCost / (1 - (wholesaleTargetMargin / 100)), bookDigits);

      analysisItems.push({
        productId,
        productName: row.product_name || `صنف #${productId}`,
        barcode: row.barcode || '',
        previousCost: this.toBookMoney(previousCost, bookDigits),
        newCost: this.toBookMoney(newCost, bookDigits),
        costChangePercent,
        currentRetailPrice: this.toBookMoney(currentRetailPrice, bookDigits),
        currentWholesalePrice: this.toBookMoney(currentWholesalePrice, bookDigits),
        currentMarginPercent,
        previousMarginPercent,
        targetMarginPercent: safeTargetMargin,
        recommendedRetailPrice,
        recommendedWholesalePrice,
        isLossMaking,
        isMarginCompressed,
      });
    }

    return {
      purchaseId,
      docNo: purchase.doc_no || `#${purchase.id}`,
      supplierName: purchase.supplier_name || 'مورد عام',
      totalAffectedItems: analysisItems.length,
      lossMakingCount,
      marginCompressedCount,
      defaultTargetMargin: targetMargin,
      items: analysisItems,
    };
  }

  async applyRepricing(purchaseId: number, payload: ApplyRepricingPayload, auth: AuthContext): Promise<{ ok: boolean; updatedCount: number; message: string }> {
    const scope = requireTenantScope(auth);
    if (!payload.items || !payload.items.length) {
      return { ok: true, updatedCount: 0, message: 'لم يتم تحديد أصناف لتحديث أسعارها' };
    }

    const updatedProductNames: string[] = [];

    await this.db.transaction().execute(async (trx) => {
      for (const it of payload.items) {
        const pid = Number(it.productId);
        const newRetail = Number(it.newRetailPrice);
        if (!pid || newRetail <= 0) continue;

        const updateObj: Record<string, any> = {
          retail_price: newRetail,
          updated_at: sql`NOW()`,
        };

        if (it.newWholesalePrice && Number(it.newWholesalePrice) > 0) {
          updateObj.wholesale_price = Number(it.newWholesalePrice);
        }

        const res = await trx
          .updateTable('products')
          .set(updateObj)
          .where('id', '=', pid)
          .where('tenant_id', '=', scope.tenantId)
          .returning('name')
          .executeTakeFirst();

        if (res?.name) {
          updatedProductNames.push(res.name);
        }
      }

      await this.audit.log(
        'حماية هامش الربح - تحديث أسعار البيع بعد غلاء التكلفة',
        `تم تحديث أسعار ${updatedProductNames.length} صنفاً في الكاشير لحماية هامش الربح استناداً لفاتورة مشتريات #${purchaseId} بواسطة ${auth.username}`,
        auth,
      );
    });

    // Send WhatsApp notification to owner if enabled or requested
    if (payload.notifyOwner !== false && this.whatsappService && updatedProductNames.length > 0) {
      try {
        const tenant = await this.db
          .selectFrom('tenants')
          .select(['business_name', 'owner_phone'])
          .where('id', '=', scope.tenantId)
          .executeTakeFirst();

        if (tenant?.owner_phone) {
          const sampleList = updatedProductNames.slice(0, 4).map((n) => `  • ${n}`).join('\n');
          const moreCount = updatedProductNames.length > 4 ? `\n  _وغيرها (${updatedProductNames.length - 4} صنفاً آخر)_` : '';

          const text = `📈 *تنبيه حماية هامش الربح وتحديث الأسعار*\n` +
            `🏢 *${tenant.business_name || 'إدارة المتجر'}*\n` +
            `تم بنجاح تحديث أسعار البيع في الكاشير لـ *${updatedProductNames.length} صنفاً* لحماية أرباحك بعد ارتفاع تكلفة المورد في فاتورة #${purchaseId}:\n` +
            sampleList + moreCount + `\n\n` +
            `_تم التحديث آلياً عبر منظومة Z-Systems المؤسسية_`;

          await this.whatsappService.sendRawMessage(scope.tenantId, tenant.owner_phone, text);
        }
      } catch (e: any) {
        this.logger.warn(`Failed to send margin protection WhatsApp alert: ${e?.message}`);
      }
    }

    return {
      ok: true,
      updatedCount: updatedProductNames.length,
      message: `تم تحديث أسعار ${updatedProductNames.length} صنفاً في الكاشير بنجاح وحماية هامش الربح`,
    };
  }
}
