import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { Kysely, Selectable, sql, Transaction } from 'kysely';
import { Database, ImportInventoryReceiptTable, ImportShipmentTable } from '../../../database/database.types';
import {
  CreateCustomsBrokerDto,
  DisburseBrokerAdvanceDto,
  LiquidateBrokerExpenseDto,
  RecordFxAcquisitionDto,
  VerifyBrokerExpenseDto,
} from '../dto/import-sales.dto';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { resolveFxRate } from '../../accounting/fx-rate-resolution';
import { isPaymentMethod } from '../engines/import-payment-method.engine';
import { resolveBrokerCapitalizationBucket } from '../engines/import-broker-capitalization.engine';
import { hasOtherActiveAdmin, isSoloAdminOverride } from '../../../common/utils/manager-approval';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';

/**
 * ImportTreasuryService — slice S9 of the import-sales split.
 * Pure move of 9 methods from ImportSalesService (customs brokers (7)
 * + FX treasury (2): listCustomsBrokers, createCustomsBroker,
 * updateCustomsBroker, disburseBrokerAdvance, liquidateBrokerExpenses,
 * verifyBrokerExpense, getCustomsBrokerStatement, recordFxAcquisition,
 * getFxPortfolio). No behavior change: the bodies are byte-identical;
 * the facade keeps thin delegates with the same names and signatures.
 * This slice calls one other slice through the facade delegate only:
 * applyImportCostRevaluation (S5 cost-revaluation slice) is bound
 * from the facade — the slice never imports another slice service.
 * The posting fallback (accountingPosting ?? new
 * AccountingPostingService(...)) is preserved verbatim in
 * disburseBrokerAdvance, liquidateBrokerExpenses and
 * recordFxAcquisition — accountingPosting arrives as an OPTIONAL
 * bound dep, so specs constructing new ImportSalesService(db,
 * undefined) keep working. Date handling travels verbatim:
 * payment_date resolves through resolveBusinessDateKey (tenant day);
 * entryDate values are server-instants-as-evidence, never pg DATE
 * keys. The 8 toFixed(2) sites are broker list + statement summary
 * values and advance settled/remaining balances stored on the
 * advance row — the liquidation JE posts dto amounts through the
 * canonical engines. All 9 methods are public — no visibility change.
 * clock-p9 §C follows liquidateBrokerExpenses here (the broker-expense
 * payment_date pin now reads this file, assertion text unchanged).
 */

export interface ImportTreasuryDeps {
  db: Kysely<any>;
  // Optional posting service (same fallback as the facade: the moved
  // disburseBrokerAdvance / liquidateBrokerExpenses / recordFxAcquisition
  // build their own AccountingPostingService when this is undefined —
  // specs constructing new ImportSalesService(db, undefined) depend on
  // that).
  accountingPosting?: AccountingPostingService;
  // Bound facade members (same names as the facade members, so the
  // moved bodies are byte-identical). resolveTenantAccount +
  // lockShipment + verifyAndConsumeApprovalRequest are the shared
  // kernel helpers (stay in the facade forever);
  // applyImportCostRevaluation is the S5 cost-revaluation slice,
  // reached through the facade delegate.
  resolveTenantAccount: (...args: any[]) => any;
  // Typed precisely (not (...args: any[]) => any): liquidateBrokerExpenses
  // narrows lockedShipment to non-null after awaiting this dep, exactly
  // as the facade did — an `any` return would leave the variable
  // `T | null` and TS18047 at its uses below.
  lockShipment: (
    trx: Transaction<Database>,
    tenantId: string,
    shipmentId: string,
  ) => Promise<{
    shipment: Selectable<ImportShipmentTable>;
    receipt: Selectable<ImportInventoryReceiptTable> | undefined;
  }>;
  verifyAndConsumeApprovalRequest: (...args: any[]) => any;
  applyImportCostRevaluation: (...args: any[]) => any;
}

@Injectable()
export class ImportTreasuryService {
  private readonly db: Kysely<any>;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly resolveTenantAccount: (...args: any[]) => any;
  private readonly lockShipment: (
    trx: Transaction<Database>,
    tenantId: string,
    shipmentId: string,
  ) => Promise<{
    shipment: Selectable<ImportShipmentTable>;
    receipt: Selectable<ImportInventoryReceiptTable> | undefined;
  }>;
  private readonly verifyAndConsumeApprovalRequest: (...args: any[]) => any;
  private readonly applyImportCostRevaluation: (...args: any[]) => any;

  constructor(deps: ImportTreasuryDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.resolveTenantAccount = deps.resolveTenantAccount;
    this.lockShipment = deps.lockShipment;
    this.verifyAndConsumeApprovalRequest = deps.verifyAndConsumeApprovalRequest;
    this.applyImportCostRevaluation = deps.applyImportCostRevaluation;
  }

  async listCustomsBrokers(tenantId: string) {
    const brokers = await this.db
      .selectFrom('import_customs_brokers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('name', 'asc')
      .execute();

    const advances = await this.db
      .selectFrom('import_broker_advances')
      .select(['broker_id', 'amount_egp', 'settled_amount_egp', 'remaining_amount_egp'])
      .where('tenant_id', '=', tenantId)
      .execute();

    const statsByBroker = new Map<string, { total: number; settled: number; remaining: number }>();
    for (const adv of advances) {
      const curr = statsByBroker.get(adv.broker_id) || { total: 0, settled: 0, remaining: 0 };
      curr.total += Number(adv.amount_egp || 0);
      curr.settled += Number(adv.settled_amount_egp || 0);
      curr.remaining += Number(adv.remaining_amount_egp || 0);
      statsByBroker.set(adv.broker_id, curr);
    }

    return brokers.map((b) => {
      const stats = statsByBroker.get(b.id) || { total: 0, settled: 0, remaining: 0 };
      let ports: string[] = [];
      try {
        ports = Array.isArray(b.customs_ports)
          ? b.customs_ports
          : typeof b.customs_ports === 'string'
            ? JSON.parse(b.customs_ports)
            : [];
      } catch {
        ports = [];
      }
      return {
        ...b,
        license_number: b.license_no,
        port_name: Array.isArray(ports) && ports.length > 0 ? ports.join('، ') : 'الإسكندرية / السخنة',
        total_advances_egp: Number(stats.total.toFixed(2)),
        total_liquidated_egp: Number(stats.settled.toFixed(2)),
        unliquidated_balance_egp: Number(stats.remaining.toFixed(2)),
      };
    });
  }

  async createCustomsBroker(tenantId: string, dto: CreateCustomsBrokerDto) {
    return await this.db
      .insertInto('import_customs_brokers')
      .values({
        tenant_id: tenantId,
        name: dto.name,
        license_no: dto.licenseNo || null,
        phone: dto.phone || null,
        email: dto.email || null,
        customs_ports: dto.customsPorts
          ? JSON.stringify(dto.customsPorts)
          : '["Alexandria", "Dekheila", "Ain Sokhna", "Port Said"]',
        tax_number: dto.taxNumber || null,
        commercial_registry: dto.commercialRegistry || null,
        is_active: true,
        notes: dto.notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateCustomsBroker(tenantId: string, id: string, dto: Partial<CreateCustomsBrokerDto>) {
    const updates: any = { updated_at: sql`NOW()` };
    if (dto.name) updates.name = dto.name;
    if (dto.licenseNo !== undefined) updates.license_no = dto.licenseNo;
    if (dto.phone !== undefined) updates.phone = dto.phone;
    if (dto.email !== undefined) updates.email = dto.email;
    if (dto.customsPorts) updates.customs_ports = JSON.stringify(dto.customsPorts);
    if (dto.taxNumber !== undefined) updates.tax_number = dto.taxNumber;
    if (dto.commercialRegistry !== undefined) updates.commercial_registry = dto.commercialRegistry;
    if (dto.notes !== undefined) updates.notes = dto.notes;

    return await this.db
      .updateTable('import_customs_brokers')
      .set(updates)
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async disburseBrokerAdvance(tenantId: string, userId: number, dto: DisburseBrokerAdvanceDto) {
    if (!Number.isFinite(Number(dto.amountEgp)) || Number(dto.amountEgp) <= 0) {
      throw new BadRequestException('مبلغ عهدة المخلص يجب أن يكون رقمًا موجبًا.');
    }
    // Broker payment method (INV-IMPORT-PAYMENT-METHODS): closed
    // enum, defaulting to bank transfer as before when absent.
    if (dto.paymentMethod !== undefined && dto.paymentMethod !== null && !isPaymentMethod(dto.paymentMethod)) {
      throw new BadRequestException(
        `طريقة دفع العهدة '${dto.paymentMethod}' غير مدعومة. [IMPORT_PAYMENT_METHOD_UNKNOWN]`,
      );
    }
    return await this.db.transaction().execute(async (trx) => {
      if (dto.projectId) {
        const project = await trx
          .selectFrom('import_projects')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', dto.projectId)
          .executeTakeFirst();
        if (!project) throw new BadRequestException('مشروع عهدة المخلص غير تابع للمنشأة.');
      }
      if (dto.shipmentId) {
        const shipment = await trx
          .selectFrom('import_shipments')
          .select('project_id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', dto.shipmentId)
          .executeTakeFirst();
        if (!shipment || (dto.projectId && shipment.project_id && shipment.project_id !== dto.projectId)) {
          throw new BadRequestException('شحنة عهدة المخلص لا تطابق مشروع الاستيراد.');
        }
      }
      const broker = await trx
        .selectFrom('import_customs_brokers')
        .selectAll()
        .where('id', '=', dto.brokerId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow();

      const advance = await trx
        .insertInto('import_broker_advances')
        .values({
          tenant_id: tenantId,
          broker_id: dto.brokerId,
          project_id: dto.projectId ?? null,
          shipment_id: dto.shipmentId ?? null,
          advance_no: dto.advanceNo,
          amount_egp: dto.amountEgp,
          disbursement_date:
            dto.disbursementDate || (await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date())),
          payment_method: dto.paymentMethod || 'bank_transfer',
          treasury_account_id: dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null,
          status: 'active',
          settled_amount_egp: 0,
          remaining_amount_egp: dto.amountEgp,
          notes: dto.notes || null,
          created_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      {
        const assetAccId = await this.resolveTenantAccount(trx, tenantId, 'broker_advance');
        const bankAccId = await this.resolveTenantAccount(
          trx,
          tenantId,
          'bank',
          dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null,
        );

        const bankScope = await trx
          .selectFrom('accounting_accounts')
          .select('account_id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', bankAccId)
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('treasury_transactions')
          .values({
            tenant_id: tenantId,
            account_id: bankScope.account_id,
            txn_type: 'import_broker_advance',
            amount: -Number(dto.amountEgp),
            note: `عهدة مخلص جمركي ${broker.name} - #${dto.advanceNo}`,
            reference_type: 'import_broker_advance',
            reference_id: Number(advance.serial_id),
            created_by: userId,
          })
          .execute();
        const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
        await posting.postDomainJournal(trx, {
          sourceType: 'import_broker_advance',
          sourceId: Number(advance.serial_id),
          tenantId,
          accountId: tenantId,
          entryDate: advance.disbursement_date ? new Date(advance.disbursement_date) : new Date(),
          description: `صرف عهدة تخليص جمركي للمخلص ${broker.name} - إذن #${dto.advanceNo}`,
          branchId: null,
          locationId: null,
          createdBy: userId,
          postedBy: userId,
          lines: [
            {
              accountId: assetAccId,
              debit: Number(dto.amountEgp),
              credit: 0,
              description: `عهدة تخليص جمركي - ${broker.name} - إذن #${dto.advanceNo}`,
              partnerType: 'none',
              partnerId: null,
              branchId: null,
              locationId: null,
            },
            {
              accountId: bankAccId,
              debit: 0,
              credit: Number(dto.amountEgp),
              description: `صرف بنكي لعهدة مخلص جمركي #${dto.advanceNo}`,
              partnerType: 'none',
              partnerId: null,
              branchId: null,
              locationId: null,
            },
          ],
        });
      }

      return advance;
    });
  }

  async liquidateBrokerExpenses(tenantId: string, userId: number, dto: LiquidateBrokerExpenseDto) {
    if (!dto.advanceId) throw new BadRequestException('تسوية مصروف مخلص تتطلب عهدة أصلية موثقة.');
    if (!Number.isFinite(Number(dto.amountEgp)) || Number(dto.amountEgp) <= 0) {
      throw new BadRequestException('قيمة إيصال المخلص يجب أن تكون مبلغاً موجباً.');
    }
    return await this.db.transaction().execute(async (trx) => {
      // Serialize receipts for a single broker and reject duplicate evidence.
      const broker = await trx
        .selectFrom('import_customs_brokers')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', dto.brokerId)
        .forUpdate()
        .executeTakeFirst();
      if (!broker) throw new BadRequestException('المخلص الجمركي غير تابع للمنشأة.');
      const repeatedReceipt = await trx
        .selectFrom('import_broker_expenses')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('broker_id', '=', dto.brokerId)
        .where('receipt_no', '=', dto.receiptNo)
        .executeTakeFirst();
      if (repeatedReceipt) throw new ConflictException('تم تسجيل رقم إيصال المخلص مسبقًا.');
      const advanceForValidation = await trx
        .selectFrom('import_broker_advances')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', dto.advanceId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (
        advanceForValidation.broker_id !== dto.brokerId ||
        (advanceForValidation.project_id && dto.projectId && advanceForValidation.project_id !== dto.projectId) ||
        (advanceForValidation.shipment_id && dto.shipmentId && advanceForValidation.shipment_id !== dto.shipmentId)
      ) {
        throw new BadRequestException('العهدة لا تتبع نفس المخلص أو مشروع / شحنة الإيصال.');
      }
      if (Number(dto.amountEgp) > Number(advanceForValidation.remaining_amount_egp || 0) + 0.001) {
        throw new BadRequestException('قيمة تسوية المخلص تتجاوز الرصيد المتبقي من العهدة.');
      }

      // Capitalisation routing (INV-IMPORT-BROKER-CAPITALISATION),
      // decided BEFORE any write. A capitalised expense reaches
      // the GL exactly once: folded into a shipment cost bucket
      // when no receipt has posted, or spread by revaluation when
      // the receipt has posted. A frozen legacy-review receipt
      // blocks both (resolve the review first). Without a
      // shipment there is nowhere to capitalise: fail closed
      // instead of silently expensing a capitalised cost.
      const wantsCapitalize = dto.isCapitalized ?? true;
      const vatAsset = dto.isRefundableVat ?? false;
      const effectiveShipmentId: string | null = dto.shipmentId ?? advanceForValidation.shipment_id ?? null;
      let capitalizationState: 'folded' | 'revalued' | 'expensed' | 'vat_asset';
      let lockedShipment: {
        shipment: Selectable<ImportShipmentTable>;
        receipt: Selectable<ImportInventoryReceiptTable> | undefined;
      } | null = null;
      if (vatAsset) {
        capitalizationState = 'vat_asset';
      } else if (!wantsCapitalize) {
        capitalizationState = 'expensed';
      } else {
        if (!effectiveShipmentId) {
          throw new BadRequestException(
            'مصروف مخلص مرسمل يتطلب شحنة مرتبطة (من الإيصال أو من العهدة)؛ بلا شحنة لا يوجد مكان ترسمل فيه التكلفة. [IMPORT_BROKER_EXPENSE_NO_SHIPMENT]',
          );
        }
        lockedShipment = await this.lockShipment(trx, tenantId, effectiveShipmentId);
        if (lockedShipment.receipt && lockedShipment.receipt.state === 'legacy_review_required') {
          throw new BadRequestException(
            'لا يمكن تسوية مصروف مخلص مرسمل على شحنة استلامها مجمد للمراجعة؛ سوِّ المراجعة المعتمدة أولاً ثم أعد التسوية. [IMPORT_BROKER_EXPENSE_LEGACY_RECEIPT]',
          );
        }
        capitalizationState = lockedShipment.receipt?.state === 'posted' ? 'revalued' : 'folded';
      }
      const expense = await trx
        .insertInto('import_broker_expenses')
        .values({
          tenant_id: tenantId,
          broker_id: dto.brokerId,
          advance_id: dto.advanceId ?? null,
          project_id: dto.projectId ?? advanceForValidation.project_id ?? null,
          shipment_id: dto.shipmentId ?? advanceForValidation.shipment_id ?? null,
          receipt_no: dto.receiptNo,
          expense_date:
            dto.expenseDate || (await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date())),
          // P9 (RC-9): payment_date had NO writer — the DB CURRENT_DATE
          // default filled the database server's day. The default is
          // dropped by migration 0328, so the app supplies the tenant
          // day here (same value as before, correct clock).
          payment_date: await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date()),
          category: dto.category,
          amount_egp: dto.amountEgp,
          is_capitalized: dto.isCapitalized ?? true,
          is_refundable_vat: dto.isRefundableVat ?? false,
          attachment_url: dto.attachmentUrl || null,
          // Maker-checker (INV-IMPORT-BROKER-CAPITALISATION): the
          // liquidator never verifies their own expense. Verification
          // is a separate approval-gated step (verifyBrokerExpense);
          // created_by records the liquidator so that step can
          // enforce the separation.
          is_verified: false,
          verified_by: null,
          verified_at: null,
          notes: dto.notes || null,
          created_by: userId,
          capitalization_state: capitalizationState,
          late_expense_event_id: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (dto.advanceId) {
        const adv = await trx
          .selectFrom('import_broker_advances')
          .selectAll()
          .where('id', '=', dto.advanceId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirstOrThrow();

        const newSettled = Number(adv.settled_amount_egp || 0) + Number(dto.amountEgp);
        const newRemaining = Math.max(0, Number(adv.amount_egp) - newSettled);
        const newStatus = newRemaining <= 0.01 ? 'settled' : 'partially_settled';

        await trx
          .updateTable('import_broker_advances')
          .set({
            settled_amount_egp: Number(newSettled.toFixed(2)),
            remaining_amount_egp: Number(newRemaining.toFixed(2)),
            status: newStatus,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', dto.advanceId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // Path execution: the advance settlement above is bookkeeping
      // only. The GL effect arrives exactly once, through the path
      // decided before the insert. The old lump-sum Dr-inventory
      // journal is gone: it inflated the inventory account without
      // touching any lot, WAC pool or landed cost, and it double-
      // counted whenever the same cost also sat in a shipment
      // cost bucket.
      const advanceAccountId = await this.resolveTenantAccount(trx, tenantId, 'broker_advance');
      if (capitalizationState === 'folded') {
        const bucketDecision = resolveBrokerCapitalizationBucket(dto.category, vatAsset);
        if (!bucketDecision.bucket) {
          throw new BadRequestException(
            `فئة مصروف المخلص (${dto.category}) بلا بند تكلفة شحنة قبل الاستلام؛ سجّلها بعد ترحيل الاستلام لتُرسمل عبر التسوية، أو كأصل ضريبي إن كانت ضريبة مستردة. [IMPORT_BROKER_EXPENSE_NO_BUCKET]`,
          );
        }
        const bucket = bucketDecision.bucket;
        await trx
          .insertInto('import_broker_capitalizations')
          .values({
            tenant_id: tenantId,
            broker_expense_id: expense.id,
            shipment_id: effectiveShipmentId as string,
            cost_bucket: bucket,
            amount_egp: Number(dto.amountEgp),
            state: 'folded',
            late_expense_event_id: null,
            created_by: userId,
          })
          .execute();
        // Fold the amount into the bucket itself: the receipt
        // journal will carry it into landed cost, and the bucket
        // floor in updateShipmentCosts prevents removing it
        // afterwards. The fold creates no expenses row and no
        // journal: the cost reaches the GL once, at receipt.
        await trx
          .updateTable('import_shipments')
          .set((eb) => ({ [bucket]: sql`coalesce(${eb.ref(bucket)}, 0) + ${Number(dto.amountEgp)}` }))
          .where('tenant_id', '=', tenantId)
          .where('id', '=', effectiveShipmentId as string)
          .execute();
      } else if (capitalizationState === 'revalued') {
        const revaluation = await this.applyImportCostRevaluation(
          trx,
          tenantId,
          userId,
          lockedShipment!.shipment,
          lockedShipment!.receipt,
          {
            amount: Number(dto.amountEgp),
            title: `تسوية مخلص (${dto.category}) - إيصال #${dto.receiptNo}`,
            note: dto.notes || null,
            credit: { kind: 'broker_advance', accountId: advanceAccountId },
            brokerExpenseId: expense.id,
          },
        );
        await trx
          .insertInto('import_broker_capitalizations')
          .values({
            tenant_id: tenantId,
            broker_expense_id: expense.id,
            shipment_id: effectiveShipmentId as string,
            cost_bucket: null,
            amount_egp: Number(dto.amountEgp),
            state: 'revalued',
            late_expense_event_id: revaluation.lateExpenseEventId,
            created_by: userId,
          })
          .execute();
        await trx
          .updateTable('import_broker_expenses')
          .set({ late_expense_event_id: revaluation.lateExpenseEventId })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', expense.id)
          .execute();
      } else {
        // Period expense or VAT asset: the money is spent and the
        // advance is relieved now. Capitalised treatment never
        // reaches this branch.
        let debitRole: 'vat_receivable' | 'cogs' = 'cogs';
        if (vatAsset) debitRole = 'vat_receivable';
        const debitAccId = await this.resolveTenantAccount(trx, tenantId, debitRole);

        const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
        await posting.postDomainJournal(trx, {
          sourceType: 'import_broker_expense',
          sourceId: Number(expense.serial_id),
          tenantId,
          accountId: tenantId,
          entryDate: expense.expense_date ? new Date(expense.expense_date) : new Date(),
          description: `تسوية مصروف تخليص جمركي (${dto.category}) بإيصال #${dto.receiptNo}`,
          branchId: null,
          locationId: null,
          createdBy: userId,
          postedBy: userId,
          lines: [
            {
              accountId: debitAccId,
              debit: Number(dto.amountEgp),
              credit: 0,
              description: `تسوية مصاريف تخليص - إيصال #${dto.receiptNo} (${dto.category})`,
              partnerType: 'none',
              partnerId: null,
              branchId: null,
              locationId: null,
            },
            {
              accountId: advanceAccountId,
              debit: 0,
              credit: Number(dto.amountEgp),
              description: `تخفيض عهدة المخلص الجمركي بإيصال #${dto.receiptNo}`,
              partnerType: 'none',
              partnerId: null,
              branchId: null,
              locationId: null,
            },
          ],
        });
      }

      return expense;
    });
  }

  /**
   * Maker-checker verification of a liquidated broker expense
   * (INV-IMPORT-BROKER-CAPITALISATION). The liquidator never
   * verifies their own expense: the consumer must differ from
   * the expense's created_by, and must present a single-use
   * approval token bound to this exact expense id and amount
   * ceiling (the decision-time self-approval block in
   * decideApprovalRequest is the second leg). Verification
   * changes no amount, no journal and no capitalisation: it only
   * attests that a second person reviewed the evidence.
   */
  async verifyBrokerExpense(tenantId: string, userId: number, expenseId: string, dto: VerifyBrokerExpenseDto) {
    if (!dto.approvalRequestId) {
      throw new BadRequestException('التحقق من مصروف مخلص يتطلب موافقة Maker-Checker معتمدة.');
    }
    return await this.db.transaction().execute(async (trx) => {
      const expense = await trx
        .selectFrom('import_broker_expenses')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', expenseId)
        .forUpdate()
        .executeTakeFirst();
      if (!expense) throw new BadRequestException('مصروف المخلص غير تابع للمنشأة.');
      if (expense.is_verified) {
        throw new ConflictException('تم التحقق من مصروف المخلص مسبقاً.');
      }
      // INV-SOLO-ADMIN-BROKER-EXPENSE-OVERRIDE (restored by
      // INV-BROKER-MAKER-CHECKER-RESTORED): a shop with only ONE
      // admin could never verify a broker expense they settled —
      // the old ban refused the settler outright, so the expense sat
      // unverified (blocking project closure) forever with no second
      // admin to verify it. When the verifier is an admin/super_admin
      // AND no other active admin/super_admin exists in the tenant,
      // the settler may verify alone — but never silently: the
      // override is stamped into the expense row's `notes` (the row's
      // free-text field) with settler == verifier; any pre-existing
      // notes are preserved in front of the stamp, and verified_by /
      // verified_at already record who verified and when. This is
      // maker-checker (creator != verifier), a money control — NOT
      // the second-manager rule: no second-manager password or
      // approval is required, and verification by a DIFFERENT admin
      // is never blocked. The two legs are the shared helpers
      // isSoloAdminOverride (role leg, role-only since
      // INV-SECOND-MANAGER-PASSWORD-REMOVED) and hasOtherActiveAdmin
      // (tenant-size leg, same file), consulted lazily, only when a
      // self-verification would otherwise be refused, so a
      // verification by a different admin costs no extra query and
      // behaves byte-identically; a non-admin settler is still
      // refused.
      // The identity comparison is unchanged
      // (`Number(expense.created_by) === userId`): it already
      // coerces, so unlike P7's bare `===` the ban DOES fire against
      // live Postgres (pg returns bigint as string, no setTypeParser
      // anywhere in src — Number("1") === 1), and the override is
      // reached exactly when the ban would have fired. The approved
      // token requirement is untouched: the gate still consumes only
      // an approved token bound to this expense, and the stamp lands
      // only on a successful verification (the update runs after the
      // gate consumes the token).
      let soloOverride = false;
      if (expense.created_by !== null && expense.created_by !== undefined && Number(expense.created_by) === userId) {
        const verifier = await trx
          .selectFrom('users')
          .select('role')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', userId)
          .where('is_active', '=', true)
          .executeTakeFirst();
        soloOverride =
          (await isSoloAdminOverride(trx, tenantId, {
            userId,
            role: verifier?.role,
          } as AuthContext)) && !(await hasOtherActiveAdmin(trx, tenantId, userId));
        if (!soloOverride) {
          throw new BadRequestException(
            'مبدأ الرقابة الثنائية (Maker-Checker): لا يجوز لمن سوّى المصروف التحقق منه بنفسه. [IMPORT_BROKER_EXPENSE_SELF_VERIFICATION]',
          );
        }
      }
      await this.verifyAndConsumeApprovalRequest(
        trx,
        tenantId,
        'broker_expense_verification',
        expenseId,
        dto.approvalRequestId,
        {
          brokerExpenseId: expenseId,
          amount: Number(expense.amount_egp),
        },
      );
      const soloStamp = `تحقق منفرد بقرار إداري — من سوّى المصروف ${userId} تحقق منه بنفسه`;
      return await trx
        .updateTable('import_broker_expenses')
        .set({
          is_verified: true,
          verified_by: userId,
          verified_at: new Date(),
          ...(soloOverride ? { notes: expense.notes ? `${expense.notes} — ${soloStamp}` : soloStamp } : {}),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', expenseId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async getCustomsBrokerStatement(tenantId: string, brokerId: string) {
    const broker = await this.db
      .selectFrom('import_customs_brokers')
      .selectAll()
      .where('id', '=', brokerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();

    const advances = await this.db
      .selectFrom('import_broker_advances')
      .selectAll()
      .where('broker_id', '=', brokerId)
      .where('tenant_id', '=', tenantId)
      .orderBy('disbursement_date', 'asc')
      .execute();

    const expenses = await this.db
      .selectFrom('import_broker_expenses')
      .selectAll()
      .where('broker_id', '=', brokerId)
      .where('tenant_id', '=', tenantId)
      .orderBy('expense_date', 'asc')
      .execute();

    const totalAdvances = advances.reduce((acc, a) => acc + Number(a.amount_egp || 0), 0);
    const totalExpenses = expenses.reduce((acc, e) => acc + Number(e.amount_egp || 0), 0);
    const netBalanceDue = totalAdvances - totalExpenses;

    return {
      broker,
      advances,
      expenses,
      totalAdvances: Number(totalAdvances.toFixed(2)),
      totalExpenses: Number(totalExpenses.toFixed(2)),
      netBalanceDue: Number(netBalanceDue.toFixed(2)),
    };
  }

  async recordFxAcquisition(tenantId: string, userId: number, dto: RecordFxAcquisitionDto) {
    const foreignAmount = Number(dto.foreignAmount);
    if (!Number.isFinite(foreignAmount) || foreignAmount <= 0) {
      throw new BadRequestException('مبالغ تدبير العملة يجب أن تكون أرقاماً موجبة صحيحة.');
    }
    if (dto.egpCost !== undefined && dto.egpCost !== null) {
      const suppliedCost = Number(dto.egpCost);
      if (!Number.isFinite(suppliedCost) || suppliedCost <= 0) {
        throw new BadRequestException('مبالغ تدبير العملة يجب أن تكون أرقاماً موجبة صحيحة.');
      }
    }
    // Currency is stored normalised: 'usd' and 'USD' are one
    // currency, never two portfolio buckets.
    const currency = String(dto.currency || '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException(
        'عملة تدبير العملة يجب أن تكون رمزاً من ثلاثة أحرف (مثال: USD). [IMPORT_FX_CURRENCY_INVALID]',
      );
    }
    const acquisitionDate = dto.acquisitionDate || (await resolveBusinessDateKey(this.db, tenantId, new Date()));
    return await this.db.transaction().execute(async (trx) => {
      // INV-IMPORT-FX-TREASURY-LIVE-RATE (I4-D7): the rate is NEVER
      // derived from the user-entered amounts — it resolves live
      // through the shared resolver (resolveFxRate), failing closed
      // when no rate is registered for the currency. The amounts are
      // the RESULT of the rate: the EGP cost is foreignAmount x live
      // rate, and a caller-supplied cost or rate must agree with the
      // live rate (cost within one piastre, rate within 0.0001) or
      // the acquisition rejects with IMPORT_FX_RATE_MISMATCH.
      const liveRate = await resolveFxRate(trx as any, tenantId, currency);
      const liveRate4dp = Number(liveRate.toFixed(4));
      if (dto.exchangeRate !== undefined && dto.exchangeRate !== null) {
        const supplied = Number(dto.exchangeRate);
        if (!Number.isFinite(supplied) || supplied <= 0 || Math.abs(supplied - liveRate4dp) > 0.0001) {
          throw new BadRequestException(
            `سعر الصرف المرسل (${supplied}) لا يطابق سعر الصرف الحي المسجل (${liveRate4dp})؛ حدّث السعر المسجل أولاً أو صحح السعر. [IMPORT_FX_RATE_MISMATCH]`,
          );
        }
      }
      const expectedEgpCost = roundMoney(foreignAmount * liveRate, currencyMoneyDigits('EGP'));
      const egpCost = expectedEgpCost;
      if (dto.egpCost !== undefined && dto.egpCost !== null) {
        const suppliedCost = Number(dto.egpCost);
        if (Math.abs(suppliedCost - expectedEgpCost) > 0.01) {
          throw new BadRequestException(
            `تكلفة الجنيه المرسلة (${suppliedCost}) لا تطابق السعر الحي المسجل (${liveRate4dp} × ${foreignAmount} = ${expectedEgpCost})؛ صحح المبالغ أو حدّث السعر المسجل. [IMPORT_FX_RATE_MISMATCH]`,
          );
        }
      }
      // Optional transfer link: the transfer must belong to this
      // tenant and its currency must match the acquisition. The
      // link is attribution only — it never settles the transfer.
      let transferId: number | null = null;
      if (dto.transferId !== undefined && dto.transferId !== null) {
        transferId = Number(dto.transferId);
        if (!Number.isSafeInteger(transferId) || transferId <= 0) {
          throw new BadRequestException('معرف الحوالة المرتبطة بتدبير العملة غير صالح.');
        }
        const payment: any = await trx
          .selectFrom('supplier_payments')
          .select(['id', 'currency'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', transferId)
          .executeTakeFirst();
        if (!payment) throw new BadRequestException('الحوالة المرتبطة بتدبير العملة غير تابعة للمنشأة.');
        if (
          String(payment.currency || '')
            .trim()
            .toUpperCase() !== currency
        ) {
          throw new BadRequestException(
            `عملة الحوالة المرتبطة (${payment.currency}) لا تطابق عملة التدبير (${currency}). [IMPORT_FX_TRANSFER_CURRENCY_MISMATCH]`,
          );
        }
      }
      // Destination: the cash/bank account receiving the foreign
      // currency. Source: the EGP account paid from. Both resolve
      // through the bank role (never a silent default account),
      // and moving money from an account to itself is meaningless.
      const destinationAccountId = await this.resolveTenantAccount(
        trx,
        tenantId,
        'bank',
        dto.bankAccountId ? Number(dto.bankAccountId) : null,
      );
      const sourceAccountId = await this.resolveTenantAccount(
        trx,
        tenantId,
        'bank',
        dto.sourceAccountId ? Number(dto.sourceAccountId) : null,
      );
      if (sourceAccountId === destinationAccountId) {
        throw new BadRequestException(
          'حساب مصدر تدبير العملة يجب أن يختلف عن حساب الوجهة؛ حدد حساب المصدر (sourceAccountId) صراحة. [IMPORT_FX_SAME_ACCOUNT]',
        );
      }
      const acquisition: any = await trx
        .insertInto('import_fx_acquisitions')
        .values({
          tenant_id: tenantId,
          currency,
          foreign_amount: dto.foreignAmount,
          egp_cost: egpCost,
          effective_exchange_rate: liveRate4dp,
          acquisition_date: acquisitionDate,
          source: dto.source || 'bank',
          bank_account_id: destinationAccountId,
          notes: dto.notes || null,
          supplier_payment_id: transferId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const serialId = Number(acquisition.serial_id);
      if (!Number.isSafeInteger(serialId)) {
        throw new BadRequestException(
          'تدبير العملة يتطلب تشغيل الترحيل 0287 أولاً (الرقم المسلسل لربط القيد). [IMPORT_FX_SERIAL_MISSING]',
        );
      }
      // Balanced treasury movement: the EGP value leaves the
      // source account and enters the destination account, in
      // the same transaction as the acquisition record.
      const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const journalEntryId = await posting.postDomainJournal(trx, {
        sourceType: 'import_fx_acquisition',
        sourceId: serialId,
        tenantId,
        accountId: tenantId,
        entryDate: new Date(acquisitionDate),
        description: `تدبير عملة ${currency} ${foreignAmount} بسعر ${liveRate4dp} (تكلفة ${egpCost} ج.م)`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines: [
          {
            accountId: destinationAccountId,
            debit: egpCost,
            credit: 0,
            description: `استلام ${currency} ${foreignAmount} - تدبير عملة`,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
          {
            accountId: sourceAccountId,
            debit: 0,
            credit: egpCost,
            description: `سداد تكلفة تدبير ${currency} ${foreignAmount}`,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
        ],
      });
      // Treasury legs mirror the journal in EGP book value, so
      // the cash/bank balances and the GL agree.
      const scopes = await trx
        .selectFrom('accounting_accounts')
        .select(['id', 'account_id'])
        .where('tenant_id', '=', tenantId)
        .where('id', 'in', [sourceAccountId, destinationAccountId])
        .execute();
      const scopeById = new Map(scopes.map((s) => [Number(s.id), s.account_id]));
      await trx
        .insertInto('treasury_transactions')
        .values([
          {
            tenant_id: tenantId,
            account_id: scopeById.get(destinationAccountId) || tenantId,
            txn_type: 'import_fx_acquisition',
            amount: egpCost,
            note: `تدبير عملة: استلام ${foreignAmount} ${currency}`,
            reference_type: 'import_fx_acquisition',
            reference_id: serialId,
            created_by: userId,
          },
          {
            tenant_id: tenantId,
            account_id: scopeById.get(sourceAccountId) || tenantId,
            txn_type: 'import_fx_acquisition',
            amount: -egpCost,
            note: `تدبير عملة: سداد ${egpCost} ج.م مقابل ${foreignAmount} ${currency}`,
            reference_type: 'import_fx_acquisition',
            reference_id: serialId,
            created_by: userId,
          },
        ])
        .execute();
      await trx
        .updateTable('import_fx_acquisitions')
        .set({ journal_entry_id: journalEntryId })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', acquisition.id)
        .execute();
      return { ...acquisition, journal_entry_id: journalEntryId };
    });
  }

  async getFxPortfolio(tenantId: string) {
    const records = await this.db
      .selectFrom('import_fx_acquisitions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('acquisition_date', 'desc')
      .execute();

    const byCurrency: Record<string, { totalForeign: number; totalEgp: number; weightedAvgRate: number }> = {};
    for (const r of records) {
      // Legacy rows may store 'usd' where new rows store 'USD':
      // group case-insensitively so one currency is one bucket.
      const key = String(r.currency || '')
        .trim()
        .toUpperCase();
      if (!byCurrency[key]) {
        byCurrency[key] = { totalForeign: 0, totalEgp: 0, weightedAvgRate: 0 };
      }
      byCurrency[key].totalForeign += Number(r.foreign_amount);
      byCurrency[key].totalEgp += Number(r.egp_cost);
    }

    for (const curr of Object.keys(byCurrency)) {
      const data = byCurrency[curr];
      data.weightedAvgRate = data.totalForeign > 0 ? Number((data.totalEgp / data.totalForeign).toFixed(4)) : 0;
    }

    return {
      portfolio: byCurrency,
      transactions: records,
    };
  }
}
