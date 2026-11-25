import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { Kysely, sql, Transaction } from 'kysely';
import { Database } from '../../../database/database.types';
import { RecordContainerDepositDto, RecordContainerReturnRefundDto } from '../dto/import-sales.dto';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { resolveFxRate } from '../../accounting/fx-rate-resolution';

/**
 * ImportContainerDepositsService — slice S11 of the import-sales split.
 * Pure move of 5 methods from ImportSalesService (deposits (4) +
 * getContainerAutopsySheet). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures. The I6-E comment block above
 * replayContainerDepositOrThrow travels with that method (it documents
 * the replay-or-fail-closed rule).
 * Kernel helpers are bound from the facade (they stay there forever):
 * resolveTenantAccount, isUniqueViolation, dateKey (used by the replay
 * for the tenant-day key comparison — the clock-b5 §D pin reads
 * dateKey in the FACADE, which still holds it, so no spec repoint),
 * eligibleRoleAccountIds (autopsy inventory accounts).
 * The posting fallback (accountingPosting ?? new
 * AccountingPostingService(...)) is preserved verbatim in
 * recordContainerDeposit + recordContainerReturnAndRefund —
 * accountingPosting arrives as an OPTIONAL bound dep, so specs
 * constructing new ImportSalesService(db, undefined) keep working.
 * FX: getContainerAutopsySheet resolves the USD rate live through
 * resolveFxRate (no fallback) — this is the LAST resolveFxRate site
 * in the facade, so the guard's facade FX pin drops to 0 at this
 * slice's merge; extending the guard to count across the slice files
 * is merge-owned, not part of this patch.
 * Money note: the refund JE posts the settled total rounded at the
 * tenant base currency's book digits (credit: callSettled) and the
 * rounded totals persist to the deposit row and the refund event;
 * the autopsy sheet's money sites round at the same tenant digits.
 * On a 2dp tenant the figures are identical to the old hardcoded
 * 2dp rounding; on a 3dp tenant the journal, the deposit row and
 * the event all carry the third decimal (the deposit columns were
 * widened to scale 3 first, so nothing is truncated on write).
 * The ROI percentage stays at 2dp: it is a percentage, not money.
 * replayContainerDepositOrThrow is public here (private in the facade
 * delegate) — the facade, a different class, cannot call a private
 * slice method (tsc TS2341); the facade delegate stays private, so
 * the facade public surface is unchanged. Its only caller
 * (recordContainerDeposit) moves with it.
 */

export interface ImportContainerDepositsDeps {
  db: Kysely<any>;
  // Optional posting service (same fallback as the facade: the moved
  // recordContainerDeposit / recordContainerReturnAndRefund build their
  // own AccountingPostingService when this is undefined — specs
  // constructing new ImportSalesService(db, undefined) depend on that).
  accountingPosting?: AccountingPostingService;
  // Bound facade members (same names as the facade members, so the
  // moved bodies are byte-identical). resolveTenantAccount +
  // isUniqueViolation + dateKey + eligibleRoleAccountIds are the shared
  // kernel helpers (stay in the facade forever).
  resolveTenantAccount: (...args: any[]) => any;
  isUniqueViolation: (...args: any[]) => any;
  dateKey: (...args: any[]) => any;
  eligibleRoleAccountIds: (...args: any[]) => any;
}

@Injectable()
export class ImportContainerDepositsService {
  private readonly db: Kysely<any>;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly resolveTenantAccount: (...args: any[]) => any;
  private readonly isUniqueViolation: (...args: any[]) => any;
  private readonly dateKey: (...args: any[]) => any;
  private readonly eligibleRoleAccountIds: (...args: any[]) => any;

  constructor(deps: ImportContainerDepositsDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.resolveTenantAccount = deps.resolveTenantAccount;
    this.isUniqueViolation = deps.isUniqueViolation;
    this.dateKey = deps.dateKey;
    this.eligibleRoleAccountIds = deps.eligibleRoleAccountIds;
  }

  // I6-E: replay-or-fail-closed for a duplicate deposit write. The
  // insert runs inside one transaction with the treasury row and
  // the JE, so a 23505 means nothing was written and the existing
  // row (if any) is the complete record. Same key + same payload
  // is a retry: return the existing deposit (no second JE, no
  // second treasury row). Same key + different payload is a key
  // collision: fail closed with a named conflict. No row under
  // the key means the 23505 came from the (tenant, shipment,
  // container) unique constraint instead — one deposit per
  // container per shipment is the standing rule — also a named
  // conflict, never a raw violation.
  async replayContainerDepositOrThrow(
    tenantId: string,
    dto: RecordContainerDepositDto,
    effectiveKey: string,
    originalError: any,
  ): Promise<any> {
    const existing: any = await this.db
      .selectFrom('import_container_deposits')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('idempotency_key', '=', effectiveKey)
      .executeTakeFirst();
    if (existing) {
      const samePayload =
        Number(existing.deposit_amount_egp) === Number(dto.depositAmountEgp) &&
        String(existing.shipping_line) === String(dto.shippingLine) &&
        String(existing.container_no) === String(dto.containerNo) &&
        String(existing.shipment_id) === String(dto.shipmentId) &&
        this.dateKey(existing.expected_return_date) === this.dateKey(dto.expectedReturnDate);
      if (samePayload) return existing;
      throw new ConflictException(
        'يوجد تأمين حاوية مسجل بنفس مفتاح عدم التكرار لكن ببيانات مختلفة؛ راجع التأمينات المسجلة قبل إعادة الإرسال. [IMPORT_CONTAINER_DEPOSIT_DUPLICATE_KEY]',
      );
    }
    const sameContainer: any = await this.db
      .selectFrom('import_container_deposits')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', dto.shipmentId)
      .where('container_no', '=', dto.containerNo)
      .executeTakeFirst();
    if (sameContainer) {
      throw new ConflictException(
        'تم تسجيل تأمين لهذه الحاوية في هذه الشحنة بالفعل؛ لا يمكن تسجيل تأمين ثانٍ لنفس الحاوية. [IMPORT_CONTAINER_DEPOSIT_ALREADY_RECORDED]',
      );
    }
    throw originalError;
  }

  async recordContainerDeposit(tenantId: string, userId: number, dto: RecordContainerDepositDto) {
    if (!Number.isFinite(Number(dto.depositAmountEgp)) || Number(dto.depositAmountEgp) <= 0) {
      throw new BadRequestException('تأمين الحاوية يجب أن يكون مبلغاً موجباً.');
    }
    // I6-E — idempotency contract (decision recorded in the
    // migration header and the DTO): the key is OPTIONAL on the
    // DTO. A caller that sends idempotencyKey owns the retry
    // identity; a caller that does not (the live form sends
    // exactly the DTO fields and no key, after I3-D8 removed the
    // dead field) gets a server-derived key from the natural key
    // (shipment + container), which migration 0238 already makes
    // unique per tenant. Requiring a client key would break the
    // live form until a frontend package wires it; deriving it
    // server-side makes every retry safe today, and the optional
    // client key is the forward contract for per-submit keys.
    const suppliedKey = typeof dto.idempotencyKey === 'string' ? dto.idempotencyKey.trim() : '';
    if (dto.idempotencyKey !== undefined && (!suppliedKey || suppliedKey.length > 128)) {
      throw new BadRequestException(
        'مفتاح عدم تكرار التأمين يجب أن يكون نصاً غير فارغ لا يتجاوز 128 حرفاً. [IMPORT_CONTAINER_DEPOSIT_KEY_INVALID]',
      );
    }
    const effectiveKey = suppliedKey || `deposit:${dto.shipmentId}:${dto.containerNo}`;
    try {
      return await this.db.transaction().execute(async (trx) => {
        const shipment = await trx
          .selectFrom('import_shipments')
          .select('project_id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', dto.shipmentId)
          .executeTakeFirst();
        if (dto.projectId) {
          const project = await trx
            .selectFrom('import_projects')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('id', '=', dto.projectId)
            .executeTakeFirst();
          if (!project) throw new BadRequestException('مشروع تأمين الحاوية غير تابع للمنشأة.');
        }
        if (!shipment || (dto.projectId && shipment.project_id && shipment.project_id !== dto.projectId)) {
          throw new BadRequestException('حاوية التأمين لا تتبع مشروع الاستيراد المحدد في المنشأة.');
        }
        const deposit = await trx
          .insertInto('import_container_deposits')
          .values({
            tenant_id: tenantId,
            project_id: dto.projectId ?? null,
            shipment_id: dto.shipmentId,
            container_no: dto.containerNo,
            shipping_line: dto.shippingLine,
            deposit_amount_egp: dto.depositAmountEgp,
            payment_date:
              dto.paymentDate || (await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date())),
            expected_return_date: dto.expectedReturnDate,
            refund_status: 'pending',
            refunded_amount_egp: 0,
            deductions_amount_egp: 0,
            treasury_account_id: dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null,
            notes: dto.notes || null,
            idempotency_key: effectiveKey,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        {
          const depositAssetAccId = await this.resolveTenantAccount(trx, tenantId, 'container_deposit');
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
              txn_type: 'import_container_deposit',
              amount: -Number(dto.depositAmountEgp),
              note: `تأمين حاوية ${dto.containerNo} للخط الملاحي ${dto.shippingLine}`,
              reference_type: 'import_container_deposit',
              reference_id: Number(deposit.serial_id),
              created_by: userId,
            })
            .execute();
          const posting =
            this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
          await posting.postDomainJournal(trx, {
            sourceType: 'import_container_deposit',
            sourceId: Number(deposit.serial_id),
            tenantId,
            accountId: tenantId,
            entryDate: deposit.payment_date ? new Date(deposit.payment_date as any) : new Date(),
            description: `سداد تأمين حاوية #${dto.containerNo} للخط الملاحي ${dto.shippingLine}`,
            branchId: null,
            locationId: null,
            createdBy: userId,
            postedBy: userId,
            lines: [
              {
                accountId: depositAssetAccId,
                debit: Number(dto.depositAmountEgp),
                credit: 0,
                description: `تأمين حاوية مسترد - #${dto.containerNo}`,
                partnerType: 'none',
                partnerId: null,
                branchId: null,
                locationId: null,
              },
              {
                accountId: bankAccId,
                debit: 0,
                credit: Number(dto.depositAmountEgp),
                description: `صرف تأمين حاوية للتوكيل الملاحي`,
                partnerType: 'none',
                partnerId: null,
                branchId: null,
                locationId: null,
              },
            ],
          });
        }

        return deposit;
      });
    } catch (err: any) {
      if (this.isUniqueViolation(err)) {
        return await this.replayContainerDepositOrThrow(tenantId, dto, effectiveKey, err);
      }
      throw err;
    }
  }

  async recordContainerReturnAndRefund(
    tenantId: string,
    userId: number,
    depositId: string,
    dto: RecordContainerReturnRefundDto,
  ) {
    return await this.db.transaction().execute(async (trx) => {
      const deposit = await trx
        .selectFrom('import_container_deposits')
        .selectAll()
        .where('id', '=', depositId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const requestKey = String(dto.idempotencyKey || '').trim();
      if (!requestKey || requestKey.length > 128) throw new BadRequestException('مفتاح عدم التكرار للاسترداد إلزامي.');
      const previousEvent = await trx
        .selectFrom('import_container_refund_events')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('deposit_id', '=', depositId)
        .where('idempotency_key', '=', requestKey)
        .executeTakeFirst();
      if (previousEvent) throw new ConflictException('طلب استرداد التأمين بنفس المفتاح تم تسجيله مسبقًا.');
      const prevRefunded = Number(deposit.refunded_amount_egp || 0);
      const prevDeductions = Number(deposit.deductions_amount_egp || 0);
      const totalDeposit = Number(deposit.deposit_amount_egp);
      // Book digits: the refund settles at the tenant base
      // currency's digits, resolved fail-closed on this trx handle
      // (a settings / rates mismatch throws before any write), so a
      // 3dp tenant's journal, deposit row and refund event all carry
      // the third decimal instead of the old hardcoded 2dp cut.
      // This slice's db is Kysely<any> (the facade passes its own
      // untyped handle); the cast to the typed executor is the same
      // shape the profit-report slice uses for its executor, and
      // the trx still runs the settings/rates reads inside the
      // refund transaction.
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx as unknown as Kysely<Database>, tenantId));
      const remainingDeposit = roundMoney(totalDeposit - prevRefunded - prevDeductions, digits);

      if (deposit.refund_status === 'refunded' || deposit.refund_status === 'forfeited' || remainingDeposit <= 0.001) {
        throw new BadRequestException('تمت تسوية واسترداد تأمين هذه الحاوية بالكامل مسبقاً، ولا يمكن تكرار الاسترداد.');
      }

      const currentRefund = Number(dto.refundedAmountEgp);
      const currentDeductions = Number(dto.deductionsAmountEgp || 0);
      const callSettled = roundMoney(currentRefund + currentDeductions, digits);

      if (callSettled <= 0) {
        throw new BadRequestException('يجب تحديد مبلغ استرداد أو خصم أكبر من الصفر لتسوية التأمين.');
      }

      if (callSettled > remainingDeposit + 0.01) {
        throw new BadRequestException(
          `مجموع الاسترداد والخصومات (${callSettled.toFixed(digits)}) يتجاوز الرصيد المتبقي من التأمين الأصلي (${remainingDeposit.toFixed(digits)}).`,
        );
      }

      const newTotalRefunded = roundMoney(prevRefunded + currentRefund, digits);
      const newTotalDeductions = roundMoney(prevDeductions + currentDeductions, digits);
      const newRemaining = roundMoney(totalDeposit - newTotalRefunded - newTotalDeductions, digits);

      let newStatus = 'partially_refunded';
      if (newRemaining <= 0.01) {
        newStatus = newTotalRefunded > 0 ? 'refunded' : 'forfeited';
      }

      const refundEvent = await trx
        .insertInto('import_container_refund_events')
        .values({
          tenant_id: tenantId,
          deposit_id: depositId,
          idempotency_key: requestKey,
          refunded_amount_egp: currentRefund,
          deductions_amount_egp: currentDeductions,
          treasury_account_id: dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null,
          created_by: userId,
          journal_entry_id: null,
        })
        .returning(['id', 'serial_id'])
        .executeTakeFirstOrThrow();

      const updated = await trx
        .updateTable('import_container_deposits')
        .set({
          actual_return_date: dto.actualReturnDate,
          refund_status: newStatus,
          refunded_amount_egp: newTotalRefunded,
          deductions_amount_egp: newTotalDeductions,
          deduction_reason: dto.deductionReason || deposit.deduction_reason || null,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', depositId)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('import_shipments')
        .set({
          container_status: 'empty_returned',
          empty_returned_date: dto.actualReturnDate,
        })
        .where('id', '=', deposit.shipment_id)
        .where('tenant_id', '=', tenantId)
        .execute();

      const depositAssetAccId = await this.resolveTenantAccount(trx, tenantId, 'container_deposit');
      const bankAccId = await this.resolveTenantAccount(
        trx,
        tenantId,
        'bank',
        dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null,
      );
      const expenseAccId = await this.resolveTenantAccount(trx, tenantId, 'cogs');

      if (currentRefund > 0) {
        // Record actual receipt in treasury as well as the balanced GL journal; never create cash for penalties alone.
        const cashScope = await trx
          .selectFrom('accounting_accounts')
          .select('account_id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', bankAccId)
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('treasury_transactions')
          .values({
            tenant_id: tenantId,
            account_id: cashScope.account_id,
            txn_type: 'import_container_refund',
            amount: currentRefund,
            note: `استرداد تأمين حاوية #${deposit.container_no}`,
            reference_type: 'import_container_refund',
            reference_id: Number(refundEvent.serial_id),
            return_document_id: null,
            branch_id: null,
            location_id: null,
            created_by: userId,
          })
          .execute();
      }

      const lines: any[] = [];
      if (currentRefund > 0) {
        lines.push({
          accountId: bankAccId,
          debit: currentRefund,
          credit: 0,
          description: `استرداد نقدي/بنكي لتأمين حاوية #${deposit.container_no}`,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }
      if (currentDeductions > 0) {
        lines.push({
          accountId: expenseAccId,
          debit: currentDeductions,
          credit: 0,
          description: `غرامات تأخير/أضرار حاوية #${deposit.container_no} مخصومة من التأمين`,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }
      if (callSettled > 0) {
        lines.push({
          accountId: depositAssetAccId,
          debit: 0,
          credit: callSettled,
          description: `تسوية وإقفال تأمين حاوية مستردة #${deposit.container_no}`,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }

      const postingService =
        this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const refundJournalEntryId = await postingService.postDomainJournal(trx, {
        sourceType: 'import_container_refund',
        sourceId: Number(refundEvent.serial_id),
        tenantId,
        accountId: tenantId,
        entryDate: new Date(dto.actualReturnDate as any),
        description: `تسوية واسترداد تأمين حاوية #${deposit.container_no} من الخط الملاحي (مبلغ مسوى: ${callSettled})`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines,
      });
      await trx
        .updateTable('import_container_refund_events')
        .set({ journal_entry_id: refundJournalEntryId })
        .where('id', '=', refundEvent.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      return updated;
    });
  }

  async listContainerDeposits(tenantId: string, shipmentId?: string) {
    let q = this.db.selectFrom('import_container_deposits').selectAll().where('tenant_id', '=', tenantId);
    if (shipmentId) q = q.where('shipment_id', '=', shipmentId);
    return await q.orderBy('created_at', 'desc').execute();
  }

  async getContainerAutopsySheet(tenantId: string, shipmentId: string) {
    const shipment = await this.db
      .selectFrom('import_shipments as s')
      .leftJoin('import_projects as p', 'p.id', 's.project_id')
      .leftJoin('suppliers as sup', 'sup.id', 's.supplier_id')
      .selectAll('s')
      .select(['p.title as project_title', 'p.project_no', 'sup.name as supplier_name'])
      .where('s.id', '=', shipmentId)
      .where('s.tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();

    const items = await this.db
      .selectFrom('import_shipment_items as i')
      .leftJoin('products as pr', 'pr.id', 'i.product_id')
      .selectAll('i')
      .select(['pr.name as product_name', 'pr.sku', 'pr.barcode'])
      .where('i.shipment_id', '=', shipmentId)
      .where('i.tenant_id', '=', tenantId)
      .execute();

    const preorders = await this.db
      .selectFrom('import_container_preorders as po')
      .leftJoin('customers as c', 'c.id', 'po.customer_id')
      .selectAll('po')
      .select(['c.name as customer_name'])
      .where('po.shipment_id', '=', shipmentId)
      .where('po.tenant_id', '=', tenantId)
      .execute();

    const lots = await this.db
      .selectFrom('import_inventory_lots')
      .selectAll()
      .where('shipment_id', '=', shipmentId)
      .where('tenant_id', '=', tenantId)
      .execute();

    const brokerExpenses = await this.db
      .selectFrom('import_broker_expenses')
      .selectAll()
      .where('shipment_id', '=', shipmentId)
      .where('tenant_id', '=', tenantId)
      .execute();

    const deposits = await this.db
      .selectFrom('import_container_deposits')
      .selectAll()
      .where('shipment_id', '=', shipmentId)
      .where('tenant_id', '=', tenantId)
      .execute();

    // Exchange rate (INV-IMPORT-FX-RESOLVER, F1): the arrival rate is
    // authoritative, then the pricing rate. When neither is recorded,
    // the rate resolves live through resolveFxRate for USD — the
    // denomination of the factory/shipping figures below — and fails
    // closed when no rate is registered, instead of inventing 50.
    // The source is labelled (exchangeRateSource) so every EGP
    // figure below is visibly live-resolved when no shipment rate
    // exists (INV-IMPORT-PROFIT-HONESTY).
    const arrivalRate = Number(shipment.exchange_rate_at_arrival);
    const pricingRate = Number(shipment.pricing_exchange_rate);
    const exchangeRateSource =
      Number.isFinite(arrivalRate) && arrivalRate > 0
        ? 'arrival'
        : Number.isFinite(pricingRate) && pricingRate > 0
          ? 'pricing'
          : 'live';
    const exRate =
      exchangeRateSource === 'arrival'
        ? arrivalRate
        : exchangeRateSource === 'pricing'
          ? pricingRate
          : await resolveFxRate(this.db, tenantId, 'USD');
    // Nothing is assumed anymore: the rate is either recorded on the
    // shipment or live-registered. The flag stays in the response so
    // existing consumers keep their shape.
    const exchangeRateAssumed = false;
    // Book digits for the sheet below: every money figure on this
    // sheet rounds at the tenant base currency's digits (the same
    // canonical wiring as the refund path above), never a hardcoded
    // 2dp — the architecture guard dispositions every hardcoded 2dp
    // rounding site in this file.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const factoryTotalUsd = items.reduce((acc, i) => acc + Number(i.quantity) * Number(i.factory_unit_price_usd), 0);
    const factoryTotalEgp = factoryTotalUsd * exRate;
    // Factory cost on the B/L (ordered) quantity is what the
    // shipment fields describe; the received-quantity basis is
    // the cost of the goods that physically arrived, and the two
    // differ exactly by the shortage. Both are reported, labelled.
    const factoryTotalReceivedUsd = items.reduce(
      (acc, i) => acc + Number(i.received_quantity ?? i.quantity) * Number(i.factory_unit_price_usd),
      0,
    );
    const factoryTotalReceivedEgp = factoryTotalReceivedUsd * exRate;
    const shippingEgp = Number(shipment.shipping_cost_usd || 0) * exRate;
    const customsEgp = Number(shipment.customs_cost_egp || 0);
    const transportEgp = Number(shipment.internal_transport_cost_egp || 0);
    const demurrageEgp = Number(shipment.actual_demurrage_fees || 0);
    const lateExpensesEgp = Number(shipment.late_expenses_total_egp || 0);
    // INV-IMPORT-LANDED-COST-DUTY-VAT: the open estimate must carry
    // the same duty/VAT breakdown as the receipt — duty on CIF
    // (goods + freight + insurance at the arrival rate), VAT on
    // (CIF + duty), intermediates unrounded, exactly like the
    // landed-cost engine. Without them the sheet contradicted its
    // own posted value for any shipment with rates (estimate
    // 900.00 vs posted 1,107.60 for the trial goods). Rates and
    // insurance default to 0, so unrated shipments are unchanged.
    const insuranceEgp = Number(shipment.insurance_cost_usd || 0) * exRate;
    const cifEgp = factoryTotalEgp + shippingEgp + insuranceEgp;
    const dutyEgp = cifEgp * (Number(shipment.customs_duty_rate_percent || 0) / 100);
    const vatEgp = (cifEgp + dutyEgp) * (Number(shipment.vat_rate_percent || 0) / 100);

    const totalLandedCostEgp =
      factoryTotalEgp +
      shippingEgp +
      customsEgp +
      transportEgp +
      demurrageEgp +
      lateExpensesEgp +
      insuranceEgp +
      dutyEgp +
      vatEgp;

    // Frozen vs open figures (INV-IMPORT-PROFIT-HONESTY). The
    // posted receipt journal is frozen evidence: its inventory
    // line is the landed value that actually reached the GL. The
    // shipment-field total above is an open estimate until the
    // receipt posts. Broker expenses are broken down by the path
    // each one took, so a capitalised cost is never presented as
    // a period expense and an expensed cost is never presented
    // as landed cost.
    const postedReceipt = await this.db
      .selectFrom('import_inventory_receipts')
      .select(['id', 'state'])
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipmentId)
      .where('state', '=', 'posted')
      .executeTakeFirst();
    let postedLandedValueEgp: number | null = null;
    if (postedReceipt) {
      // Receipt ids are BIGSERIAL in production (migration 0230);
      // a non-numeric id can never match a journal source_id.
      const receiptIdNum = Number(postedReceipt.id);
      const receiptJournal: any = Number.isFinite(receiptIdNum)
        ? await this.db
            .selectFrom('journal_entries')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('source_type', '=', 'import_inventory_receipt')
            .where('source_id', '=', receiptIdNum)
            .where('status', '=', 'posted')
            .executeTakeFirst()
        : undefined;
      if (receiptJournal) {
        // Read-path set sum (same acceptance set as the posting
        // resolver): a missing inventory role account leaves the
        // frozen value null instead of breaking the sheet.
        const inventoryAccountIds = await this.eligibleRoleAccountIds(this.db as any, tenantId, 'inventory');
        const invLines: any[] = inventoryAccountIds.length
          ? await this.db
              .selectFrom('journal_entry_lines')
              .select(['debit', 'credit'])
              .where('journal_entry_id', '=', Number(receiptJournal.id))
              .where('account_id', 'in', inventoryAccountIds)
              .execute()
          : [];
        postedLandedValueEgp = roundMoney(
          invLines.reduce((sum, l) => sum + Number(l.debit || 0) - Number(l.credit || 0), 0),
          digits,
        );
      }
    }
    const brokerByState = new Map<string, { count: number; amountEgp: number }>();
    let brokerVerifiedCount = 0;
    let brokerUnverifiedCount = 0;
    for (const e of brokerExpenses) {
      const state = String((e as any).capitalization_state || 'unknown');
      const slot = brokerByState.get(state) || { count: 0, amountEgp: 0 };
      slot.count += 1;
      slot.amountEgp = roundMoney(slot.amountEgp + Number((e as any).amount_egp || 0), digits);
      brokerByState.set(state, slot);
      if ((e as any).is_verified) brokerVerifiedCount += 1;
      else brokerUnverifiedCount += 1;
    }
    const brokerLinks: any[] = await this.db
      .selectFrom('import_broker_capitalizations')
      .select(['state', 'amount_egp'])
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipmentId)
      .execute();
    const brokerCapitalisedInLandedEgp = roundMoney(
      brokerLinks
        .filter((l) => ['folded', 'consumed', 'revalued'].includes(String(l.state)))
        .reduce((sum, l) => sum + Number(l.amount_egp || 0), 0),
      digits,
    );
    const brokerExpensedEgp = roundMoney(brokerByState.get('expensed')?.amountEgp || 0, digits);

    const allocations = await this.db
      .selectFrom('import_sale_allocations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipmentId)
      .execute();

    let actualInvoicedSalesEgp = 0;
    let actualAllocatedCogsEgp = 0;
    let actualAllocatedUnits = 0;

    for (const alloc of allocations) {
      const q = Number(alloc.quantity);
      const isNegative =
        alloc.allocation_type === 'reversal' ||
        alloc.allocation_type === 'return' ||
        alloc.allocation_type === 'cancellation';
      const absQty = Math.abs(q);
      const effectiveQty = isNegative ? -absQty : absQty;
      const unitSalePrice = Number(alloc.unit_sale_price_egp || 0);
      const unitCost = Number(alloc.unit_cost_egp || 0);

      actualAllocatedUnits += effectiveQty;
      actualInvoicedSalesEgp += effectiveQty * unitSalePrice;
      actualAllocatedCogsEgp += effectiveQty * unitCost;
    }

    // Invoiced bookings are already included in invoiced sales. Refunded deposits are
    // not liabilities, and cancelled/refunded bookings must not inflate cash held.
    const openBookings = preorders.filter((p) => p.status === 'reserved' || p.status === 'allocated');
    const preordersTotalRevenue = openBookings.reduce((acc, p) => acc + Number(p.total_price_egp), 0);
    const preordersDepositsCollected = openBookings.reduce(
      (acc, p) => acc + Math.max(0, Number(p.deposit_amount_egp) - Number(p.refunded_amount_egp || 0)),
      0,
    );
    const preordersDepositsRefunded = preorders.reduce((acc, p) => acc + Number(p.refunded_amount_egp || 0), 0);

    let totalUnitsShipped = 0;
    let totalUnitsReceived = 0;
    for (const item of items) {
      totalUnitsShipped += Number(item.quantity);
      totalUnitsReceived += Number(item.received_quantity ?? item.quantity);
    }

    const totalRemainingUnits = lots.reduce((acc, l) => acc + Number(l.remaining_quantity), 0);
    const totalSoldUnits =
      actualAllocatedUnits > 0 ? actualAllocatedUnits : Math.max(0, totalUnitsReceived - totalRemainingUnits);

    const unsoldStockLandedValueEgp = lots.reduce(
      (acc, l) => acc + Number(l.remaining_quantity) * Number(l.unit_landed_cost_egp),
      0,
    );

    const avgCostPerUnit = totalUnitsReceived > 0 ? totalLandedCostEgp / totalUnitsReceived : 0;
    const cogsSoldUnitsEgp = actualAllocatedCogsEgp > 0 ? actualAllocatedCogsEgp : totalSoldUnits * avgCostPerUnit;
    // Gross trading margin, never "net profit": operating costs,
    // expensed broker costs, FX variance, shortage expense and
    // deposit deductions are all excluded from this figure. The
    // project profit report (INV-IMPORT-PROFIT-HONESTY) is the
    // place those posted costs land.
    const realizedGrossTradingMarginEgp = actualInvoicedSalesEgp > 0 ? actualInvoicedSalesEgp - cogsSoldUnitsEgp : 0;
    const roiPercentage = totalLandedCostEgp > 0 ? (realizedGrossTradingMarginEgp / totalLandedCostEgp) * 100 : 0;

    const pendingDeposits = deposits.filter((d) => d.refund_status === 'pending');
    const totalPendingDepositEgp = pendingDeposits.reduce((acc, d) => acc + Number(d.deposit_amount_egp), 0);

    // I2-D6: the lots row must NOT divide by quantity again.
    // import_shipment_items.landed_cost_egp stores the PER-UNIT
    // landed cost (the landed-cost engine's landedCostEgp =
    // totalItemLandedCostEgp / effectiveQty; the receipt lots and
    // every other consumer read it as the unit cost). The modal
    // used to divide it by the received quantity a second time
    // and show the stored value as the line total, so the trial
    // container read 9.00 / 90.00 instead of 90.00 / 900.00.
    // The autopsy therefore carries both figures explicitly: the
    // stored per-unit value, and the line total on the RECEIVED
    // quantity (unit x received — the landed value of the goods
    // that physically arrived). The stored value is untouched.
    const autopsyItems = items.map((item) => {
      const receivedQty = Number(item.received_quantity ?? item.quantity);
      const unitLandedCostEgp = Number(item.landed_cost_egp || 0);
      return {
        ...item,
        unit_landed_cost_egp: unitLandedCostEgp,
        total_landed_cost_egp: roundMoney(unitLandedCostEgp * receivedQty, digits),
      };
    });

    // I2-D6: the P&L status reads the container's ACTUAL status.
    // Real container_status values (migration 2040000000238):
    // on_water, port_arrived, customs_cleared,
    // warehouse_received, empty_returned.
    // I8-E (R6): container_status is never updated when the
    // shipment status moves — the only writer sets
    // 'empty_returned', so the column keeps its 'on_water'
    // default for a container that has already arrived, and the
    // sheet read "في البحر" for MSCU-TEST-001 although the
    // shipment status is Arrived (list: تم الوصول للمخزن).
    // The shipment status is the authoritative arrival state,
    // so a NON-INFORMATIVE container_status — NULL, the
    // 'on_water' default, or the legacy 'arrived' fallback —
    // is resolved from it. An explicit value
    // (warehouse_received, port_arrived, customs_cleared,
    // empty_returned) — or an unknown one, which keeps the
    // honest fallback below (D6) — is never overridden.
    const containerStatusLabels: Record<string, string> = {
      on_water: 'في البحر',
      port_arrived: 'وصلت إلى الميناء',
      customs_cleared: 'تم التخليص الجمركي',
      warehouse_received: 'تم الوصول للمخزن',
      empty_returned: 'تم تسليم الفارغ والمطابقة',
      arrived: 'تم الوصول',
    };
    const statusDerivedContainerStatus: Record<string, string> = {
      Arrived: 'warehouse_received',
      'In Customs': 'port_arrived',
      Pending: 'on_water',
    };
    const rawContainerStatus = shipment.container_status as string | null | undefined;
    const containerStatus =
      rawContainerStatus && !['on_water', 'arrived'].includes(rawContainerStatus)
        ? rawContainerStatus
        : statusDerivedContainerStatus[shipment.status as string] || rawContainerStatus || 'arrived';
    const containerStatusLabel = containerStatusLabels[containerStatus] || 'حالة غير معروفة';

    return {
      basis: {
        exchangeRateSource,
        exchangeRateAssumed,
        factoryTotalBasis: 'bill_of_lading_quantity',
        landedCostBasis: postedLandedValueEgp !== null ? 'posted_receipt_journal' : 'shipment_field_estimates',
        postedReceipt: postedReceipt !== undefined && postedReceipt !== null,
        marginBasis:
          'gross_trading_margin_excluding_operating_costs_broker_expensed_fx_variance_shortage_and_deposit_deductions',
        liabilityBasis: 'deposits_held_for_open_bookings_net_of_refunds',
      },
      operational: {
        shipmentId,
        containerNumber: shipment.container_number,
        billOfLading: shipment.bill_of_lading,
        carrierName: shipment.carrier_name,
        containerSize: shipment.container_size,
        freightType: shipment.freight_type,
        portOfLoading: shipment.port_of_loading,
        portOfDischarge: shipment.port_of_discharge,
        containerStatus,
        containerStatusLabel,
        arrivalDate: shipment.arrival_date,
        unstuffingDate: shipment.unstuffing_date,
        emptyReturnedDate: shipment.empty_returned_date,
        projectTitle: shipment.project_title,
        projectNo: shipment.project_no,
        supplierName: shipment.supplier_name,
        totalUnitsShipped,
        totalUnitsReceived,
        totalSoldUnits,
        totalRemainingUnits,
      },
      landedCosts: {
        exchangeRate: exRate,
        exchangeRateSource,
        exchangeRateAssumed,
        factoryTotalUsd: roundMoney(factoryTotalUsd, digits),
        factoryTotalEgp: roundMoney(factoryTotalEgp, digits),
        factoryTotalBasis: 'bill_of_lading_quantity',
        factoryTotalReceivedUsd: roundMoney(factoryTotalReceivedUsd, digits),
        factoryTotalReceivedEgp: roundMoney(factoryTotalReceivedEgp, digits),
        shippingEgp: roundMoney(shippingEgp, digits),
        customsEgp: roundMoney(customsEgp, digits),
        transportEgp: roundMoney(transportEgp, digits),
        demurrageEgp: roundMoney(demurrageEgp, digits),
        lateExpensesEgp: roundMoney(lateExpensesEgp, digits),
        insuranceEgp: roundMoney(insuranceEgp, digits),
        dutyEgp: roundMoney(dutyEgp, digits),
        vatEgp: roundMoney(vatEgp, digits),
        totalLandedCostEgp: roundMoney(totalLandedCostEgp, digits),
        landedCostBasis: postedLandedValueEgp !== null ? 'posted_receipt_journal' : 'shipment_field_estimates',
        postedLandedValueEgp,
        avgCostPerUnitEgp: Number(avgCostPerUnit.toFixed(4)),
      },
      salesAndInventory: {
        invoicedSalesEgp: roundMoney(actualInvoicedSalesEgp, digits),
        grossSalesEgp: roundMoney(actualInvoicedSalesEgp, digits),
        inTransitPreordersRevenue: roundMoney(preordersTotalRevenue, digits),
        depositsCollectedEgp: roundMoney(preordersDepositsCollected, digits),
        refundedPreorderDepositsEgp: roundMoney(preordersDepositsRefunded, digits),
        unearnedPreorderLiabilityEgp: roundMoney(preordersDepositsCollected, digits),
        liabilityBasis: 'deposits_held_for_open_bookings_net_of_refunds',
        unsoldStockLandedValueEgp: roundMoney(unsoldStockLandedValueEgp, digits),
        lotsCount: lots.length,
      },
      profitability: {
        cogsSoldUnitsEgp: roundMoney(cogsSoldUnitsEgp, digits),
        realizedGrossTradingMarginEgp: roundMoney(realizedGrossTradingMarginEgp, digits),
        marginBasis:
          'gross_trading_margin_excluding_operating_costs_broker_expensed_fx_variance_shortage_and_deposit_deductions',
        roiPercentage: Number(roiPercentage.toFixed(2)),
        roiBasis: 'gross_trading_margin_divided_by_estimated_total_landed_cost',
      },
      inTransitPreorders: {
        totalBookingsEgp: roundMoney(preordersTotalRevenue, digits),
        depositsCollectedEgp: roundMoney(preordersDepositsCollected, digits),
        unearnedLiabilityEgp: roundMoney(preordersDepositsCollected, digits),
        preordersCount: preorders.length,
      },
      liabilities: {
        pendingContainerDepositsCount: pendingDeposits.length,
        totalPendingDepositEgp: roundMoney(totalPendingDepositEgp, digits),
        brokerExpensesCount: brokerExpenses.length,
        brokerExpensesByState: Object.fromEntries(brokerByState),
        brokerVerifiedCount,
        brokerUnverifiedCount,
        brokerCapitalisedInLandedEgp,
        brokerExpensedEgp,
      },
      items: autopsyItems,
      lots,
      preorders,
    };
  }
}
