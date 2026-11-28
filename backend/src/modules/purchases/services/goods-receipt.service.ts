import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { loadAntiTheftSettings } from '../../../common/utils/anti-theft-settings.util';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { CreateGoodsReceiptDto, CreateGrnBillDto, VerifyThreeWayMatchDto } from '../dto/goods-receipt.dto';
import { fromMinorUnits, toMinorUnits } from '../../accounting/engines/money-minor-units.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { GoodsReceiptThreeWayMatchService } from './goods-receipt-three-way-match.service';
import { GoodsReceiptBillService } from './goods-receipt-bill.service';
import { GoodsReceiptPostService } from './goods-receipt-post.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { GoodsReceiptHelpersService } from './goods-receipt-helpers.service';
import { GoodsReceiptCreateService } from './goods-receipt-create.service';

@Injectable()
export class GoodsReceiptService {
  private readonly logger = new Logger(GoodsReceiptService.name);
  private readonly helpersService: GoodsReceiptHelpersService;
  private readonly create: GoodsReceiptCreateService;
  private readonly post: GoodsReceiptPostService;
  private readonly bill: GoodsReceiptBillService;
  private readonly threeWayMatch: GoodsReceiptThreeWayMatchService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
    private readonly purchasesFinance: PurchasesFinanceService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {
    this.helpersService = new GoodsReceiptHelpersService();
    this.create = new GoodsReceiptCreateService({
      db: this.db,
      validateGrnFreight: this.validateGrnFreight.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
    });
    this.post = new GoodsReceiptPostService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      tenantPredicate: this.tenantPredicate.bind(this),
      validateGrnFreight: this.validateGrnFreight.bind(this),
      getGoodsReceipt: this.getGoodsReceipt.bind(this),
      resolveAccountByCode: this.resolveAccountByCode.bind(this),
    });
    this.bill = new GoodsReceiptBillService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      purchasesFinance: this.purchasesFinance,
      resolveAccountByCode: this.resolveAccountByCode.bind(this),
    });
    this.threeWayMatch = new GoodsReceiptThreeWayMatchService({
      db: this.db,
      tenantPredicate: this.tenantPredicate.bind(this),
    });
  }

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const scope = requireTenantScope(auth);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${scope.tenantId}`
      : sql<boolean>`tenant_id = ${scope.tenantId}`;
  }

  private async resolveAccountByCode(
    trx: any,
    tenantId: string,
    accountId: string,
    code: string,
  ): Promise<number | null> {
    return this.helpersService.resolveAccountByCode(trx, tenantId, accountId, code);
  }

  /*
   * INV-SHIPPING-ALLOCATION: freight on a receipt must be a
   * book-digits amount — a sub-minor amount fails closed instead of
   * rounding silently into the WAC. Absent freight is 0 and the
   * receipt posts exactly as before.
   */
  private validateGrnFreight(freight: number | undefined, moneyDigits: 2 | 3): number {
    if (freight == null || freight === 0) return 0;
    try {
      const minor = toMinorUnits(Number(freight), moneyDigits);
      if (minor <= 0) throw new Error('Non-positive');
      return fromMinorUnits(minor, moneyDigits);
    } catch {
      throw new BadRequestException('مبلغ الشحن لا يطابق دقة عملة الأساس.');
    }
  }

  async createGoodsReceipt(dto: CreateGoodsReceiptDto, auth: AuthContext): Promise<any> {
    return this.create.createGoodsReceipt(dto, auth);
  }

  async listGoodsReceipts(
    filter: { supplierId?: number; status?: string; search?: string },
    auth: AuthContext,
  ): Promise<any> {
    return this.create.listGoodsReceipts(filter, auth);
  }

  async getGoodsReceipt(id: number, auth: AuthContext, externalTrx?: any): Promise<any> {
    return this.create.getGoodsReceipt(id, auth, externalTrx);
  }

  async postGoodsReceipt(id: number, auth: AuthContext): Promise<any> {
    const result = await this.post.postGoodsReceipt(id, auth);
    void this.checkPostReceiptDiscrepancyAndAlert(id, auth).catch((err) =>
      this.logger.warn(`GRN discrepancy alert failed: ${err?.message}`),
    );
    return result;
  }

  private async checkPostReceiptDiscrepancyAndAlert(grnId: number, auth: AuthContext): Promise<void> {
    const scope = requireTenantScope(auth);
    const antiTheft = await loadAntiTheftSettings(this.db, scope.tenantId);
    const grn = await this.create.getGoodsReceipt(grnId, auth);
    if (!grn) return;

    const poId = grn.purchaseOrderId ? Number(grn.purchaseOrderId) : null;
    const poItemsMap = new Map<number, { orderedQty: number; receivedTotalQty: number; productName: string }>();
    let poNumber = '';
    if (poId) {
      const po = await this.db
        .selectFrom('purchase_orders')
        .select(['order_number'])
        .where('id', '=', poId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      poNumber = String(po?.order_number || `PO-${poId}`);
      const poItems = await this.db
        .selectFrom('purchase_order_items')
        .select(['id', 'quantity', 'received_quantity', 'product_name'])
        .where('purchase_order_id', '=', poId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      for (const item of poItems) {
        poItemsMap.set(Number(item.id), {
          orderedQty: Number(item.quantity || 0),
          receivedTotalQty: Number(item.received_quantity || 0),
          productName: String(item.product_name || ''),
        });
      }
    }

    const discrepancies: string[] = [];
    let hasRejected = false;
    for (const line of grn.lines || []) {
      const accepted = Number(line.acceptedQty || 0);
      const rejected = Number(line.rejectedQty || 0);
      if (rejected > 0.0001) hasRejected = true;
      const poLine = line.purchaseOrderItemId ? poItemsMap.get(Number(line.purchaseOrderItemId)) : null;
      if (poLine) {
        const diff = Number((poLine.receivedTotalQty - poLine.orderedQty).toFixed(3));
        if (Math.abs(diff) > 0.0001 || rejected > 0.0001) {
          discrepancies.push(
            `- ${line.productName || poLine.productName}: المطلوب ${poLine.orderedQty} | المستلم ${poLine.receivedTotalQty}` +
              (rejected > 0 ? ` | مرفوض ${rejected}` : ''),
          );
        }
      } else if (rejected > 0.0001) {
        discrepancies.push(`- ${line.productName || `#${line.productId}`}: مقبول ${accepted} | مرفوض ${rejected}`);
      }
    }

    if (!discrepancies.length) return;
    if (!antiTheft.enforceBlindPurchaseReceiving && !hasRejected) return;

    if (this.audit) {
      await this.audit.log(
        'فارق استلام بضاعة مورد (GRN)',
        `إذن استلام ${grn.docNo}${poNumber ? ` (أمر شراء ${poNumber})` : ''} | المورد: ${grn.supplierName || '—'} | الفروقات: ${discrepancies.join(' ؛ ')}`,
        auth,
      );
    }

    if (!this.whatsappService) return;
    const tenant = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'owner_phone'])
      .where('id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!tenant?.owner_phone) return;

    const text =
      `*درع منع الخسائر - إنذار فارق في استلام بضاعة مورد*\n` +
      `*${tenant.business_name || 'إدارة المشتريات'}*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `إذن الاستلام: *${grn.docNo}*\n` +
      (poNumber ? `أمر الشراء: *${poNumber}*\n` : '') +
      `المورد: ${grn.supplierName || '—'}\n` +
      `المستلم: ${auth.username}\n\n` +
      `*البنود ذات الفارق:*\n` +
      discrepancies.slice(0, 8).join('\n') +
      `\n\n_يرجى مراجعة مطابقة الفاتورة مع المورد قبل اعتماد الصرف._`;
    await this.whatsappService.sendRawMessage(scope.tenantId, tenant.owner_phone, text);
  }

  async createBillFromReceipts(
    dto: CreateGrnBillDto,
    auth: AuthContext,
  ): Promise<{ purchaseId: number; docNo: string }> {
    return this.bill.createBillFromReceipts(dto, auth);
  }

  async verifyPurchaseThreeWayMatch(purchaseId: number, dto: VerifyThreeWayMatchDto, auth: AuthContext): Promise<any> {
    return this.threeWayMatch.verifyPurchaseThreeWayMatch(purchaseId, dto, auth);
  }
}
