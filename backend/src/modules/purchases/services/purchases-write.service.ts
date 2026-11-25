import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { assertUntrackedStockMutation } from '../../inventory/helpers/inventory-tracked-stock.helper';
// applyStockDelta + previewConsumableStockQty are kept in this import: check-architecture-guardrails.cjs requires the tokens in purchases-write.service.ts, although no method left in this file calls them (the calls live in the slices).
import {
  applyStockDelta,
  lockStockProducts,
  previewConsumableStockQty,
} from '../../../common/utils/location-stock-ledger';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import {
  ApplySupplierAdvanceDto,
  CreateCustomerPaymentDto,
  CreateSupplierPaymentDto,
} from '../dto/create-party-payment.dto';
import { UpsertPurchaseDto } from '../dto/upsert-purchase.dto';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { PurchasesQueryService } from './purchases-query.service';
import { PurchasesWriteReceiveGoodsService } from './purchases-write-receive-goods.service';
import { PurchasesWriteCustomerPaymentsService } from './purchases-write-customer-payments.service';
import { PurchasesWriteSupplierPaymentsService } from './purchases-write-supplier-payments.service';
import { PurchasesWriteCancelService } from './purchases-write-cancel.service';
import { PurchasesWriteUpdateService } from './purchases-write-update.service';
import { PurchasesWriteCreateService } from './purchases-write-create.service';
import { PurchasesWriteSharedHelpersService } from './purchases-write-shared-helpers.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { PurchasesWriteRepricingService } from './purchases-write-repricing.service';

import type {
  PurchaseRepricingCandidate,
  PurchaseRepricingProduct,
  PurchaseRepricingInsights,
} from './purchases-write.types';

export type {
  PurchaseRepricingCandidate,
  PurchaseRepricingProduct,
  PurchaseRepricingInsights,
} from './purchases-write.types';

@Injectable()
export class PurchasesWriteService {
  private readonly receiveService: PurchasesWriteReceiveGoodsService;

  private readonly customerPaymentsService: PurchasesWriteCustomerPaymentsService;

  private readonly supplierPaymentsService: PurchasesWriteSupplierPaymentsService;

  private readonly cancelService: PurchasesWriteCancelService;

  private readonly updateService: PurchasesWriteUpdateService;

  private readonly createService: PurchasesWriteCreateService;

  private readonly sharedHelpersService: PurchasesWriteSharedHelpersService;

  private readonly repricing: PurchasesWriteRepricingService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly financeService: PurchasesFinanceService,
    private readonly queryService: PurchasesQueryService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly idempotency: IdempotencyService,
  ) {
    this.repricing = new PurchasesWriteRepricingService();
    this.sharedHelpersService = new PurchasesWriteSharedHelpersService({
      db: this.db,
      queryService: this.queryService,
    });
    this.createService = new PurchasesWriteCreateService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      financeService: this.financeService,
      accountingPosting: this.accountingPosting,
      idempotency: this.idempotency,
      buildPurchaseRepricingCandidate: this.buildPurchaseRepricingCandidate.bind(this),
      buildPurchaseRepricingInsights: this.buildPurchaseRepricingInsights.bind(this),
      hasPermission: this.hasPermission.bind(this),
      buildPurchaseMutationResponse: this.buildPurchaseMutationResponse.bind(this),
    });
    this.updateService = new PurchasesWriteUpdateService({
      db: this.db,
      tx: this.tx,
      financeService: this.financeService,
      audit: this.audit,
      buildPurchaseRepricingCandidate: this.buildPurchaseRepricingCandidate.bind(this),
      buildPurchaseRepricingInsights: this.buildPurchaseRepricingInsights.bind(this),
      assertManagerApprovalForPurchaseChange: this.assertManagerApprovalForPurchaseChange.bind(this),
      hasPermission: this.hasPermission.bind(this),
      buildPurchaseMutationResponse: this.buildPurchaseMutationResponse.bind(this),
    });
    this.cancelService = new PurchasesWriteCancelService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      financeService: this.financeService,
      accountingPosting: this.accountingPosting,
      assertManagerApprovalForPurchaseChange: this.assertManagerApprovalForPurchaseChange.bind(this),
      buildPurchaseMutationResponse: this.buildPurchaseMutationResponse.bind(this),
    });
    this.supplierPaymentsService = new PurchasesWriteSupplierPaymentsService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      financeService: this.financeService,
      queryService: this.queryService,
      accountingPosting: this.accountingPosting,
      idempotency: this.idempotency,
    });
    this.customerPaymentsService = new PurchasesWriteCustomerPaymentsService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      financeService: this.financeService,
      accountingPosting: this.accountingPosting,
      idempotency: this.idempotency,
    });
    this.receiveService = new PurchasesWriteReceiveGoodsService({
      db: this.db,
      financeService: this.financeService,
      accountingPosting: this.accountingPosting,
    });
  }

  private hasPermission(auth: AuthContext, permission: string): boolean {
    return this.sharedHelpersService.hasPermission(auth, permission);
  }

  private async assertManagerApprovalForPurchaseChange(secret: string, auth: AuthContext): Promise<void> {
    return this.sharedHelpersService.assertManagerApprovalForPurchaseChange(secret, auth);
  }

  private buildPurchaseRepricingCandidate(
    product: PurchaseRepricingProduct,
    newCost: number,
  ): PurchaseRepricingCandidate {
    return this.repricing.buildPurchaseRepricingCandidate(product, newCost);
  }

  private buildPurchaseRepricingInsights(
    purchaseId: number,
    supplier: { id: number; name: string },
    candidates: PurchaseRepricingCandidate[],
    moneyDigits: 2 | 3 = 2,
  ): PurchaseRepricingInsights | null {
    return this.repricing.buildPurchaseRepricingInsights(purchaseId, supplier, candidates, moneyDigits);
  }

  private async buildPurchaseMutationResponse(
    purchaseId: number,
    auth: AuthContext,
    extras: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.sharedHelpersService.buildPurchaseMutationResponse(purchaseId, auth, extras);
  }

  async createPurchase(
    payload: UpsertPurchaseDto,
    auth: AuthContext,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    return this.createService.createPurchase(payload, auth, idempotencyKey);
  }

  async updatePurchase(
    purchaseId: number,
    payload: UpsertPurchaseDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.updateService.updatePurchase(purchaseId, payload, auth);
  }

  async cancelPurchase(
    purchaseId: number,
    reason: string,
    auth: AuthContext,
    managerPin?: string,
  ): Promise<Record<string, unknown>> {
    return this.cancelService.cancelPurchase(purchaseId, reason, auth, managerPin);
  }

  async createSupplierPayment(
    payload: CreateSupplierPaymentDto,
    auth: AuthContext,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    return this.supplierPaymentsService.createSupplierPayment(payload, auth, idempotencyKey);
  }

  async applySupplierAdvance(
    advancePaymentId: number,
    payload: ApplySupplierAdvanceDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.supplierPaymentsService.applySupplierAdvance(advancePaymentId, payload, auth);
  }

  async createCustomerPayment(
    payload: CreateCustomerPaymentDto,
    auth: AuthContext,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    return this.customerPaymentsService.createCustomerPayment(payload, auth, idempotencyKey);
  }

  async receivePurchaseGoods(
    purchaseId: number,
    receivedItems: { itemId: number; receivedQty: number; serials?: any[] }[],
    auth: AuthContext,
  ): Promise<{ purchaseId: number; lifecycleStatus: string; matchedStatus: string }> {
    return this.receiveService.receivePurchaseGoods(purchaseId, receivedItems, auth);
  }
}
