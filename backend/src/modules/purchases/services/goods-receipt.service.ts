import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
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
  private readonly helpersService: GoodsReceiptHelpersService;
  private readonly create: GoodsReceiptCreateService;
  private readonly post: GoodsReceiptPostService;
  private readonly bill: GoodsReceiptBillService;
  private readonly threeWayMatch: GoodsReceiptThreeWayMatchService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
    private readonly purchasesFinance: PurchasesFinanceService,
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
    return this.post.postGoodsReceipt(id, auth);
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
