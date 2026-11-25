import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { UpsertDeliveryRepDto } from './dto/upsert-delivery-rep.dto';

import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { SalesFinanceService } from '../sales/services/sales-finance.service';
import { DeliveryRepsAdminService } from './delivery-reps-admin.service';
import { DeliveryRepsReadsService } from './delivery-reps-reads.service';
import { DeliveryRepsSettlementsService } from './delivery-reps-settlements.service';
import { DeliveryRepsDriverAuthService } from './delivery-reps-driver-auth.service';
import { DeliveryRepsDriverOrdersService } from './delivery-reps-driver-orders.service';
import { DeliveryRepsSharedHelpersService } from './delivery-reps-shared-helpers.service';

@Injectable()
export class DeliveryRepsService {
  private readonly admin: DeliveryRepsAdminService;
  private readonly readsService: DeliveryRepsReadsService;
  private readonly settlements: DeliveryRepsSettlementsService;
  private readonly driverAuthService: DeliveryRepsDriverAuthService;
  private readonly driverOrders: DeliveryRepsDriverOrdersService;
  private readonly sharedHelpers: DeliveryRepsSharedHelpersService;

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
    this.sharedHelpers = new DeliveryRepsSharedHelpersService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      tenantPredicate: this.tenantPredicate.bind(this),
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

  private async getDeliveryFeeMode(
    trx: Kysely<Database>,
    actor: AuthContext,
  ): Promise<'freelance_courier' | 'store_fleet'> {
    return this.sharedHelpers.getDeliveryFeeMode(trx, actor);
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

  async listOrders(
    repId: number,
    actor: AuthContext,
    filters?: {
      dateFrom?: string;
      dateTo?: string;
      status?: string;
      discountedOnly?: boolean;
      page?: number;
      pageSize?: number;
    },
  ): Promise<Record<string, unknown>> {
    return this.readsService.listOrders(repId, actor, filters);
  }

  async listSettlements(
    repId: number,
    actor: AuthContext,
    filters?: { dateFrom?: string; dateTo?: string; page?: number; pageSize?: number },
  ): Promise<Record<string, unknown>> {
    return this.readsService.listSettlements(repId, actor, filters);
  }

  async getRepKPIs(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.readsService.getRepKPIs(repId, actor);
  }

  async settleOrder(
    saleId: number,
    actor: AuthContext,
    payload?: {
      signatureDataUrl?: string;
      proofPhotoUrl?: string;
      gpsLat?: number;
      gpsLng?: number;
      notes?: string;
      countedCashAmount?: number;
    },
  ): Promise<Record<string, unknown>> {
    return this.settlements.settleOrder(saleId, actor, payload);
  }

  async settlePartialOrder(
    saleId: number,
    actor: AuthContext,
    payload?: {
      signatureDataUrl?: string;
      proofPhotoUrl?: string;
      gpsLat?: number;
      gpsLng?: number;
      notes?: string;
      countedCashAmount?: number;
    },
  ): Promise<Record<string, unknown>> {
    return this.settlements.settlePartialOrder(saleId, actor, payload);
  }

  private async repOrderCashDue(
    order: {
      id: number;
      delivery_fee_mode: string | null;
      collection_status?: string | null;
      paid_amount?: number | string | null;
    },
    defaultMode: 'freelance_courier' | 'store_fleet',
    moneyDigits: MoneyDigits,
    actor: AuthContext,
  ): Promise<number> {
    return this.sharedHelpers.repOrderCashDue(order, defaultMode, moneyDigits, actor);
  }

  async getRepSummary(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.readsService.getRepSummary(repId, actor);
  }

  async getRepLifetimeReport(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.readsService.getRepLifetimeReport(repId, actor);
  }

  async settleAllOrders(
    repId: number,
    expectedAmount: number,
    actor: AuthContext,
    countedCashAmount?: number,
  ): Promise<Record<string, unknown>> {
    return this.settlements.settleAllOrders(repId, expectedAmount, actor, countedCashAmount);
  }

  async driverLogin(payload: {
    phone: string;
    pinCode: string;
    companyCode?: string;
    tenantId?: string;
  }): Promise<{ token: string; rep: Record<string, unknown>; mustChangePin: boolean }> {
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

  async verifyDriverToken(
    token: string,
  ): Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string }> {
    return this.driverAuthService.verifyDriverToken(token);
  }

  async verifyDriverTokenForSettlement(token: string): Promise<{
    repId: number;
    tenantId: string;
    accountId: string;
    name: string;
    phone: string;
    tenantSuspended: boolean;
  }> {
    return this.driverAuthService.verifyDriverTokenForSettlement(token);
  }

  async driverListOrders(
    repId: number,
    tenantId: string,
    accountId: string,
    filters?: { dateFrom?: string; dateTo?: string; status?: string; page?: number; pageSize?: number },
  ): Promise<Record<string, unknown>> {
    return this.driverOrders.driverListOrders(repId, tenantId, accountId, filters);
  }

  async driverSettleOrder(
    saleId: number,
    repId: number,
    tenantId: string,
    payload?: { signatureDataUrl?: string; proofPhotoUrl?: string; gpsLat?: number; gpsLng?: number; notes?: string },
  ): Promise<Record<string, unknown>> {
    return this.driverOrders.driverSettleOrder(saleId, repId, tenantId, payload);
  }

  async dispatchOrders(
    actor: AuthContext,
    payload: { repId: number; saleIds?: number[]; onlineOrderIds?: number[]; notes?: string },
  ) {
    return this.driverOrders.dispatchOrders(actor, payload);
  }
}
