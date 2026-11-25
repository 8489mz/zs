import { exchangeStoreCreditAmount } from './engines/exchange-store-credit.engine';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney as roundBookMoney } from '../accounting/engines/money-minor-units.engine';
import { Injectable } from '@nestjs/common';
import { Kysely, Transaction } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { type TenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { normalizeReturnItems } from './helpers/return-payload.helper';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { CreateReturnDto } from './dto/create-return.dto';
import { IdempotencyService } from '../../core/idempotency/idempotency.service';
import { idempotencyStorage } from '../../core/idempotency/idempotency.context';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { allocateRefundTenders, type RefundTender } from './engines/refund-tender.engine';
import { settlePosExchange } from '../sales/engines/pos-exchange.engine';
import { type ExchangeReturnContext, type ReturnInputItem } from './returns.types';

export interface ReturnsCreateDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  idempotency: IdempotencyService;
  whatsappService?: WhatsAppGatewayService;
  scope: (auth: AuthContext) => TenantScope;
  verifyManagerAuthorization: (trx: Kysely<Database>, secret: string, auth: AuthContext) => Promise<string>;
  getLargeCashRefundThreshold: (
    auth: AuthContext,
    executor?: Kysely<Database> | Transaction<Database>,
  ) => Promise<number>;
  addTreasuryTransaction: (
    trx: Kysely<Database>,
    txnType: string,
    amount: number,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
    cashRefund?: boolean,
  ) => Promise<void>;
  addStoreCredit: (trx: Kysely<Database>, customerId: number, amount: number, auth: AuthContext) => Promise<void>;
  createSaleReturn: (
    trx: Transaction<Database>,
    payload: CreateReturnDto,
    items: ReturnInputItem[],
    auth: AuthContext,
    approvedByName?: string,
    exchangePrepared?: (context: ExchangeReturnContext) => void,
    approvalRequest?: { secret: string; threshold: number },
  ) => Promise<number[]>;
  createPurchaseReturn: (
    trx: Transaction<Database>,
    payload: CreateReturnDto,
    items: ReturnInputItem[],
    auth: AuthContext,
    approvalRequest?: { secret: string; threshold: number },
  ) => Promise<number[]>;
}

@Injectable()
export class ReturnsCreateService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly idempotency: IdempotencyService;
  private readonly whatsappService?: WhatsAppGatewayService;
  private readonly scope: (auth: AuthContext) => TenantScope;
  private readonly verifyManagerAuthorization: (
    trx: Kysely<Database>,
    secret: string,
    auth: AuthContext,
  ) => Promise<string>;
  private readonly getLargeCashRefundThreshold: (
    auth: AuthContext,
    executor?: Kysely<Database> | Transaction<Database>,
  ) => Promise<number>;
  private readonly addTreasuryTransaction: (
    trx: Kysely<Database>,
    txnType: string,
    amount: number,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
    cashRefund?: boolean,
  ) => Promise<void>;
  private readonly addStoreCredit: (
    trx: Kysely<Database>,
    customerId: number,
    amount: number,
    auth: AuthContext,
  ) => Promise<void>;
  private readonly createSaleReturn: (
    trx: Transaction<Database>,
    payload: CreateReturnDto,
    items: ReturnInputItem[],
    auth: AuthContext,
    approvedByName?: string,
    exchangePrepared?: (context: ExchangeReturnContext) => void,
    approvalRequest?: { secret: string; threshold: number },
  ) => Promise<number[]>;
  private readonly createPurchaseReturn: (
    trx: Transaction<Database>,
    payload: CreateReturnDto,
    items: ReturnInputItem[],
    auth: AuthContext,
    approvalRequest?: { secret: string; threshold: number },
  ) => Promise<number[]>;

  constructor(deps: ReturnsCreateDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.idempotency = deps.idempotency;
    this.whatsappService = deps.whatsappService;
    this.scope = deps.scope;
    this.verifyManagerAuthorization = deps.verifyManagerAuthorization;
    this.getLargeCashRefundThreshold = deps.getLargeCashRefundThreshold;
    this.addTreasuryTransaction = deps.addTreasuryTransaction;
    this.addStoreCredit = deps.addStoreCredit;
    this.createSaleReturn = deps.createSaleReturn;
    this.createPurchaseReturn = deps.createPurchaseReturn;
  }

  async createReturn(payload: CreateReturnDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(auth);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const idemCtx = idempotencyStorage.getStore();

    // The approval decision is deferred into the transaction, where
    // the real cash-refund amount is known: manager PIN/password is
    // required only for a LARGE cash refund (see
    // INV-SPIRIT-LARGE-CASH-REFUND). Small returns proceed with the
    // recorded reason and no approval credential. A refund-override
    // still always needs manager approval (unchanged).
    // The threshold gate binds canDirectReturn holders too: the
    // permission no longer bypasses the gate — below the threshold
    // the gate never fires, so small returns still need no approval,
    // but at or above the threshold a privileged cashier must still
    // present a manager PIN/password. Only the admin/super_admin
    // roles bypass the gate entirely.
    const isAdminRole = auth.role === 'super_admin' || auth.role === 'admin';
    let approvedByName: string | undefined;
    const overrideRequested = Boolean(String(payload.refundOverrideReason || '').trim());

    if (overrideRequested && !['admin', 'super_admin'].includes(auth.role)) {
      approvedByName = await this.verifyManagerAuthorization(this.db, payload.managerPin || '', auth);
    }
    const approvalRequest =
      !isAdminRole && approvedByName === undefined
        ? { secret: payload.managerPin || '', threshold: await this.getLargeCashRefundThreshold(auth) }
        : undefined;

    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const normalizedItems = normalizeReturnItems(payload);
      const returnIds =
        payload.type === 'sale'
          ? await this.createSaleReturn(trx, payload, normalizedItems, auth, approvedByName, undefined, approvalRequest)
          : await this.createPurchaseReturn(trx, payload, normalizedItems, auth, approvalRequest);

      // T10-D: the create response carries the refund the backend
      // actually pays (goods + relief, as stored on the document),
      // so the dialog never has to guess it from the lines total.
      // Read inside this same transaction so the idempotent replay
      // stores the same figures.
      // INV-SALE-RETURN-CASH-ONLY: the create response carries the
      // refund the backend actually pays — a single cash leg for
      // the full refund (a split-paid sale refunds 70 cash, never
      // 35 cash + 35 card). The dialog shows the cash the cashier
      // hands over from the drawer (live trial: 35 cash + 35 card
      // returned as "70.00 cash" was RIGHT; the books posting only
      // 35 cash out were wrong, drawer 35 short).
      const createdDoc = await trx
        .selectFrom('return_documents')
        .select(['total', 'tip_relief', 'courier_relief', 'refund_method', 'refund_allocations'])
        .where('id', '=', returnIds[0])
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      const goodsTotal = Number(createdDoc?.total || 0);
      const tipRelief = Number(createdDoc?.tip_relief || 0);
      const courierRelief = Number(createdDoc?.courier_relief || 0);
      const refundAllocations = (() => {
        const raw: unknown = createdDoc?.refund_allocations;
        if (raw == null) return [];
        try {
          const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();
      const res = {
        ok: true,
        createdIds: returnIds,
        id: returnIds[0],
        returnDocumentId: returnIds[0],
        goodsTotal,
        tipRelief,
        courierRelief,
        totalRelief: roundBookMoney(tipRelief + courierRelief, moneyDigits),
        refundTotal: roundBookMoney(goodsTotal + tipRelief + courierRelief, moneyDigits),
        refundMethod: String(createdDoc?.refund_method || ''),
        refundAllocations,
      };

      // Idempotency: commit inside the EXACT SAME business transaction (CORE-004)
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          {
            tenantId: scope.tenantId,
            accountId: idemCtx.accountId || scope.accountId,
            idempotencyKey: idemCtx.idempotencyKey,
            operationType: idemCtx.operationType,
          },
          res,
          String(returnIds[0]),
        );
      }

      return res;
    });

    const returnIds = result.createdIds;
    const label = payload.type === 'purchase' ? 'purchase return' : 'sale return';
    // The document row exists only after the commit above, so it is read
    // here — before the audit entry — and not after it: the entry must
    // name the real document number and total, never a bare sentence.
    const doc = returnIds[0]
      ? await this.db
          .selectFrom('return_documents')
          .select(['doc_no', 'total'])
          .where('id', '=', returnIds[0])
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst()
      : undefined;
    const totalText = doc ? Number(doc.total || 0).toFixed(moneyDigits) : '';
    const docPart = doc?.doc_no ? ` (${doc.doc_no})` : '';
    const auditText = approvedByName
      ? `Created ${label} #${returnIds[0]}${docPart} — ${totalText} by ${auth.username} (Approved by: ${approvedByName})`
      : `Created ${label} #${returnIds[0]}${docPart} — ${totalText} by ${auth.username}`;
    await this.audit.log('إنشاء مرتجع', auditText, auth);

    // WhatsApp refund notification to owner (post-commit reliable notification)
    if (payload.type === 'sale' && this.whatsappService && returnIds[0]) {
      void (async () => {
        try {
          if (doc) {
            void this.whatsappService
              ?.sendRefundNotification(
                doc.doc_no || String(returnIds[0]),
                Number(doc.total || 0),
                payload.note || '',
                scope.tenantId,
                auth.username,
              )
              .catch(() => undefined);
          }
        } catch {}
      })();
    }

    return result;
  }

  async prepareExchangeReturn(
    trx: Transaction<Database>,
    payload: CreateReturnDto,
    auth: AuthContext,
  ): Promise<ExchangeReturnContext> {
    const cleanPin = String(payload.managerPin || '').trim();
    const isAdminRole = auth.role === 'admin' || auth.role === 'super_admin';
    const approved = cleanPin
      ? await this.verifyManagerAuthorization(trx, cleanPin, auth)
      : isAdminRole
        ? auth.username || 'المدير'
        : undefined;
    let context: ExchangeReturnContext | undefined;
    await this.createSaleReturn(
      trx,
      { ...payload, settlementMode: 'store_credit' },
      normalizeReturnItems(payload),
      auth,
      approved,
      (result) => {
        context = result;
      },
    );
    if (!context) throw new AppError('تعذر تجهيز المرتجع الذري', 'EXCHANGE_RETURN_MISSING', 500);
    return context;
  }

  async settleExchangeReturn(
    trx: Transaction<Database>,
    context: ExchangeReturnContext,
    saleTotal: number,
    requested: 'cash' | 'card' | 'store_credit',
    auth: AuthContext,
    managerPin?: string,
  ): Promise<ReturnType<typeof settlePosExchange>> {
    const exchangeDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, this.scope(auth).tenantId));
    const settlement = settlePosExchange(context.total, saleTotal, exchangeDigits);
    // INV-SALE-RETURN-CASH-ONLY: an exchange remainder refunds in
    // full in cash too — a requested 'card' is ignored, exactly as
    // in createSaleReturn below. Only store_credit (the settlement
    // mode) passes through; there is no card-reversal path.
    const cashOnlyRequested = requested === 'store_credit' ? 'store_credit' : 'cash';
    const remainder =
      settlement.refundAmount > 0
        ? allocateRefundTenders({
            ...context.refundBase,
            amount: settlement.refundAmount,
            requested: cashOnlyRequested,
            digits: exchangeDigits,
          })
        : [];
    const cashRefundOut = remainder
      .filter((line) => line.tender === 'cash')
      .reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const isAdminRole = auth.role === 'admin' || auth.role === 'super_admin';
    const cleanPin = String(managerPin || '').trim();
    if (!isAdminRole && cashRefundOut > 0 && cashRefundOut >= (await this.getLargeCashRefundThreshold(auth, trx))) {
      await this.verifyManagerAuthorization(trx, cleanPin, auth);
    }
    const allocations: Array<{ tender: RefundTender; amount: number }> = [];
    const retainedCredit =
      settlement.appliedCredit +
      remainder.filter((line) => line.tender === 'store_credit').reduce((sum, line) => sum + line.amount, 0);
    if (retainedCredit > 0)
      allocations.push({ tender: 'store_credit', amount: exchangeStoreCreditAmount(retainedCredit, exchangeDigits) });
    for (const line of remainder) {
      if (line.tender === 'store_credit') continue;
      if (line.tender === 'receivable')
        throw new AppError('يجب تسوية مديونية الفاتورة قبل الاستبدال', 'EXCHANGE_UNPAID_SOURCE', 422);
      allocations.push(line);
      await this.addStoreCredit(trx, context.customerId, -line.amount, auth);
      if (line.tender === 'cash') {
        await this.addTreasuryTransaction(
          trx,
          'sale_return_refund',
          -line.amount,
          `صافي استرداد استبدال ${context.returnId}`,
          context.returnId,
          auth,
          context.branchId,
          context.locationId,
          true,
        );
      }
    }
    await trx
      .updateTable('return_documents')
      .set({
        settlement_mode: requested === 'store_credit' ? 'store_credit' : 'refund',
        refund_method: allocations.length === 1 ? allocations[0].tender : 'mixed',
        refund_allocations: JSON.stringify(allocations),
      })
      .where('tenant_id', '=', this.scope(auth).tenantId)
      .where('id', '=', context.returnId)
      .execute();
    return settlement;
  }
}
