import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import { boundedPage } from '../../common/utils/bounded-page';
import { AppError } from '../../common/errors/app-error';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { UpsertDeliveryRepDto } from './dto/upsert-delivery-rep.dto';
import { assertSecurePasscode } from '../../core/auth/utils/password-policy';

import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { SalesFinanceService } from '../sales/services/sales-finance.service';
import { DeliveryRepsAdminService } from './delivery-reps-admin.service';
import { DeliveryRepsReadsService } from './delivery-reps-reads.service';
import { DeliveryRepsSettlementsService } from './delivery-reps-settlements.service';
import { DeliveryRepsDriverAuthService } from './delivery-reps-driver-auth.service';
import { DeliveryRepsDriverOrdersService } from './delivery-reps-driver-orders.service';

@Injectable()
export class DeliveryRepsService {
  private readonly admin: DeliveryRepsAdminService;
  private readonly readsService: DeliveryRepsReadsService;
  private readonly settlements: DeliveryRepsSettlementsService;
  private readonly driverAuthService: DeliveryRepsDriverAuthService;
  private readonly driverOrders: DeliveryRepsDriverOrdersService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly salesFinance: SalesFinanceService,
    @Optional() private readonly authCache: AuthCacheService = new AuthCacheService(),
  ) {
    this.admin = new DeliveryRepsAdminService({
      db: this.db,
      audit: this.audit,
      tenantPredicate: this.tenantPredicate.bind(this),
      tenantFields: this.tenantFields.bind(this),
    });
    this.readsService = new DeliveryRepsReadsService({
      db: this.db,
      tenantPredicate: this.tenantPredicate.bind(this),
      getDeliveryFeeMode: this.getDeliveryFeeMode.bind(this),
      repOrderCashDue: this.repOrderCashDue.bind(this),
    });
    this.settlements = new DeliveryRepsSettlementsService({
      db: this.db,
      audit: this.audit,
      accountingPosting: this.accountingPosting,
      salesFinance: this.salesFinance,
      tenantPredicate: this.tenantPredicate.bind(this),
      tenantFields: this.tenantFields.bind(this),
      getDeliveryFeeMode: this.getDeliveryFeeMode.bind(this),
    });
    this.driverAuthService = new DeliveryRepsDriverAuthService({
      db: this.db,
      authCache: this.authCache,
    });
    this.driverOrders = new DeliveryRepsDriverOrdersService({
      db: this.db,
      audit: this.audit,
      accountingPosting: this.accountingPosting,
      salesFinance: this.salesFinance,
      tenantPredicate: this.tenantPredicate.bind(this),
      getDeliveryFeeMode: this.getDeliveryFeeMode.bind(this),
      repOrderCashDue: this.repOrderCashDue.bind(this),
    });
  }

  private tenantPredicate(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    return sql<boolean>`tenant_id = ${tenantId}`;
  }

  private tenantFields(actor: AuthContext) {
    const { tenantId, accountId } = requireTenantScope(actor);
    return { tenant_id: tenantId, account_id: accountId };
  }

  private async getDeliveryFeeMode(trx: Kysely<Database>, actor: AuthContext): Promise<'freelance_courier' | 'store_fleet'> {
    const row = await trx
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'deliveryFeeMode')
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!row?.value) return 'freelance_courier';
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return parsed === 'store_fleet' ? 'store_fleet' : 'freelance_courier';
    } catch {
      return String(row.value).includes('store_fleet') ? 'store_fleet' : 'freelance_courier';
    }
  }

  async list(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.admin.list(actor);
  }

  async create(payload: UpsertDeliveryRepDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.admin.create(payload, actor);
  }

  async update(id: number, payload: UpsertDeliveryRepDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.admin.update(id, payload, actor);
  }

  async remove(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.admin.remove(id, actor);
  }

  async listOrders(repId: number, actor: AuthContext, filters?: { dateFrom?: string; dateTo?: string; status?: string; discountedOnly?: boolean; page?: number; pageSize?: number }): Promise<Record<string, unknown>> {
    return this.readsService.listOrders(repId, actor, filters);
  }

  async listSettlements(repId: number, actor: AuthContext, filters?: { dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }): Promise<Record<string, unknown>> {
    return this.readsService.listSettlements(repId, actor, filters);
  }

  async getRepKPIs(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.readsService.getRepKPIs(repId, actor);
  }

  async settleOrder(
    saleId: number,
    actor: AuthContext,
    payload?: { signatureDataUrl?: string; proofPhotoUrl?: string; gpsLat?: number; gpsLng?: number; notes?: string; countedCashAmount?: number }
  ): Promise<Record<string, unknown>> {
    return this.settlements.settleOrder(saleId, actor, payload);
  }

  async settlePartialOrder(
    saleId: number,
    actor: AuthContext,
    payload?: { signatureDataUrl?: string; proofPhotoUrl?: string; gpsLat?: number; gpsLng?: number; notes?: string; countedCashAmount?: number }
  ): Promise<Record<string, unknown>> {
    return this.settlements.settlePartialOrder(saleId, actor, payload);
  }

  /**
   * INV-SF-REP-CUSTODY-NET-RETURNS (D-SF-10): the cash a rep still
   * owes (pending) or has handed over (collected) for ONE order,
   * derived from deliverySettlementBasis — the single source of
   * truth the settle gates and postDeliveryRepSettlement already
   * use — never from gross sales.total. A prior return already
   * reversed part of the receivable (and relieved part of the
   * fee), so the gross total charges the rep for money the
   * customer no longer owes (live divergence 131.60: return
   * ZR-261110-0601 reversed the sale JE while the badge kept
   * 131.60). The formula is settleAllOrders' cashDue exactly:
   * store-fleet owes the remaining receivable; a freelance
   * courier owes it minus the remaining fee, floored at zero.
   *
   * INV-REP-PREPAID-SHIFT-TREASURY (M6/A7): a rep-prepaid order
   * owes the PAID amount, not the remaining receivable — the sale
   * posted as paid at creation, so the remaining receivable is
   * already zero while the rep still holds the cash. The rep hands
   * over the paid amount minus the remaining courier fee (zero for
   * a store-fleet sale: the basis already reports a zero remaining
   * fee for it), floored at zero. The fee still comes from the
   * basis, so a prior return that relieved part of the fee is
   * honoured exactly like the COD formula.
   */
  private async repOrderCashDue(
    order: { id: number; delivery_fee_mode: string | null; collection_status?: string | null; paid_amount?: number | string | null },
    defaultMode: 'freelance_courier' | 'store_fleet',
    moneyDigits: MoneyDigits,
    actor: AuthContext,
  ): Promise<number> {
    const basis = await this.accountingPosting.deliverySettlementBasis(this.db, Number(order.id), actor);
    if (String(order.collection_status || '') === 'prepaid_by_rep') {
      return Math.max(0, roundMoney(Number(order.paid_amount || 0) - basis.remainingFee, moneyDigits));
    }
    return (order.delivery_fee_mode || defaultMode) === 'store_fleet'
      ? basis.remainingReceivable
      : Math.max(0, roundMoney(basis.remainingReceivable - basis.remainingFee, moneyDigits));
  }

  async getRepSummary(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.readsService.getRepSummary(repId, actor);
  }

  async getRepLifetimeReport(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.readsService.getRepLifetimeReport(repId, actor);
  }

  async settleAllOrders(repId: number, expectedAmount: number, actor: AuthContext, countedCashAmount?: number): Promise<Record<string, unknown>> {
    return this.settlements.settleAllOrders(repId, expectedAmount, actor, countedCashAmount);
  }

  async driverLogin(payload: { phone: string; pinCode: string; companyCode?: string; tenantId?: string }): Promise<{ token: string; rep: Record<string, unknown>; mustChangePin: boolean }> {
    return this.driverAuthService.driverLogin(payload);
  }

  async driverChangePin(
    driver: { repId: number; tenantId: string; accountId: string; name: string; phone: string },
    body: { currentPin?: string; newPin?: string },
  ): Promise<{ token: string; rep: Record<string, unknown>; mustChangePin: false }> {
    return this.driverAuthService.driverChangePin(driver, body);
  }

  async assertDriverPinChanged(driver: { repId: number; tenantId: string }): Promise<void> {
    return this.driverAuthService.assertDriverPinChanged(driver);
  }

  async verifyDriverToken(token: string): Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string }> {
    return this.driverAuthService.verifyDriverToken(token);
  }

  async verifyDriverTokenForSettlement(token: string): Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string; tenantSuspended: boolean }> {
    return this.driverAuthService.verifyDriverTokenForSettlement(token);
  }

  async driverListOrders(repId: number, tenantId: string, accountId: string, filters?: { dateFrom?: string; dateTo?: string; status?: string; page?: number; pageSize?: number }): Promise<Record<string, unknown>> {
    return this.driverOrders.driverListOrders(repId, tenantId, accountId, filters);
  }

  async driverSettleOrder(
    saleId: number,
    repId: number,
    tenantId: string,
    payload?: { signatureDataUrl?: string; proofPhotoUrl?: string; gpsLat?: number; gpsLng?: number; notes?: string }
  ): Promise<Record<string, unknown>> {
    return this.driverOrders.driverSettleOrder(saleId, repId, tenantId, payload);
  }

  async dispatchOrders(
    actor: AuthContext,
    payload: { repId: number; saleIds?: number[]; onlineOrderIds?: number[]; notes?: string }
  ) {
    return this.driverOrders.dispatchOrders(actor, payload);
  }
}
