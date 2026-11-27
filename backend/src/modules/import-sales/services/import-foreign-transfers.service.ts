import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { Kysely, sql, Transaction } from 'kysely';
import { Database } from '../../../database/database.types';
import { RecordForeignTransferDto } from '../dto/import-sales.dto';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { resolveFxRate } from '../../accounting/fx-rate-resolution';
import { isPaymentMethod, validatePaymentEvidence } from '../engines/import-payment-method.engine';

/**
 * ImportForeignTransfersService — slice S10 of the import-sales split.
 * Pure move of 2 methods from ImportSalesService
 * (listForeignTransfers, recordForeignTransfer). No behavior change:
 * the bodies are byte-identical; the facade keeps thin delegates with
 * the same names and signatures. This slice is kernel-only: it calls
 * no other slice. recordForeignTransfer is a POSTING method (bank ↔
 * forex gain/loss): the posting fallback (accountingPosting ?? new
 * AccountingPostingService(...)) is preserved verbatim — accountingPosting
 * arrives as an OPTIONAL bound dep, so specs constructing
 * new ImportSalesService(db, undefined) keep working. The FX
 * threshold-rate site (resolveFxRate, L3091 in the facade) travels
 * with recordForeignTransfer; the guard's FX pin (>= 1 in the facade)
 * still holds at 4 after this move — the guard extension to slice
 * files is S11's merge job, not this slice's. Date handling travels
 * verbatim: payment_date resolves through resolveBusinessDateKey
 * (tenant day); entryDate is a server-instant-as-evidence, never a
 * pg DATE key. Both methods are public in the facade, so there is NO
 * visibility change in this slice. The INV comments travel with the
 * methods (INV-IMPORT-SUPPLIER-CREDIT-TRANSFER-REGISTER,
 * INV-IMPORT-PAYMENT-METHODS). The directMutationAllowList holds
 * only the stock ledger (INV-DIRECT-MUTATION-ALLOWLIST-LEDGER-ONLY)
 * and no entry for the facade: the forbidden stock_qty pattern
 * matches nowhere in the facade on this base, and this slice
 * introduces none.
 */

export interface ImportForeignTransfersDeps {
  db: Kysely<any>;
  // Optional posting service (same fallback as the facade: the moved
  // recordForeignTransfer builds its own AccountingPostingService
  // when this is undefined — the specs constructing
  // new ImportSalesService(db, undefined) depend on that).
  accountingPosting?: AccountingPostingService;
  // Bound facade members (same names as the facade members, so the
  // moved bodies are byte-identical). resolveTenantAccount +
  // verifyAndConsumeApprovalRequest are the shared kernel helpers
  // (stay in the facade forever).
  resolveTenantAccount: (...args: any[]) => any;
  verifyAndConsumeApprovalRequest: (...args: any[]) => any;
}

@Injectable()
export class ImportForeignTransfersService {
  private readonly db: Kysely<any>;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly resolveTenantAccount: (...args: any[]) => any;
  private readonly verifyAndConsumeApprovalRequest: (...args: any[]) => any;

  constructor(deps: ImportForeignTransfersDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.resolveTenantAccount = deps.resolveTenantAccount;
    this.verifyAndConsumeApprovalRequest = deps.verifyAndConsumeApprovalRequest;
  }

  async listForeignTransfers(tenantId: string) {
    // INV-IMPORT-SUPPLIER-CREDIT-TRANSFER-REGISTER: the register is the
    // supplier-credit screen's history of posted supplier payments, and
    // it must list EVERY posted supplier payment for the tenant — not
    // only the ones recorded through this screen. The old
    // `doc_no LIKE 'FT-%'` filter silently hid every payment posted
    // through the canonical purchases path, which numbers its rows
    // `ZPV-YYMMDD-NNNN` (live re-test 2026-11-09 R5: the register read
    // "0 حوالة مسجلة" while ZPV-261108-000004 / JE-00015028 existed).
    // FT- vs ZPV- is a numbering artifact of the recording screen,
    // not a property of the payment, so the doc_no prefix must never
    // decide visibility. Tenant scoping is the only filter.
    const rows = await this.db
      .selectFrom('supplier_payments')
      .leftJoin('suppliers', 'suppliers.id', 'supplier_payments.supplier_id')
      .select([
        'supplier_payments.id',
        'supplier_payments.doc_no',
        'supplier_payments.amount',
        'supplier_payments.amount_foreign',
        'supplier_payments.currency',
        'supplier_payments.exchange_rate',
        'supplier_payments.payment_date',
        'supplier_payments.note',
        'supplier_payments.created_at',
        'suppliers.name as supplier_name',
      ])
      .where('supplier_payments.tenant_id', '=', tenantId)
      .orderBy('supplier_payments.created_at', 'desc')
      .orderBy('supplier_payments.id', 'desc')
      .execute();

    return rows.map((r) => {
      const foreignAmount = r.amount_foreign != null ? Number(r.amount_foreign) : null;
      // The two recording paths store opposite signs in `amount`:
      // recordForeignTransfer stores -contractValue (EGP), the
      // purchases path stores a positive EGP amount. The register
      // renders a payment magnitude, so normalise to the absolute
      // value — otherwise every FT row renders its EGP column as
      // '—' (the screen only renders egpAmount > 0) and the row
      // looks amount-less.
      const egpAmount = Math.abs(Number(r.amount));
      const effectiveRate = r.exchange_rate
        ? Number(r.exchange_rate)
        : foreignAmount && foreignAmount > 0
          ? Number((egpAmount / foreignAmount).toFixed(2))
          : null;
      const dateVal = r.payment_date || r.created_at;

      return {
        id: r.id,
        docNo: r.doc_no,
        doc_no: r.doc_no,
        amountForeign: foreignAmount,
        amount_foreign: foreignAmount,
        amountEgp: egpAmount,
        amount_egp: egpAmount,
        amount: foreignAmount != null ? foreignAmount : egpAmount,
        currency: r.currency || 'USD',
        exchangeRate: effectiveRate,
        exchange_rate: effectiveRate,
        paymentDate: dateVal,
        payment_date: dateVal,
        requiresLegacyReconciliation: foreignAmount == null,
        supplierName: r.supplier_name || '—',
        supplier_name: r.supplier_name || '—',
        notes: r.note || '',
        note: r.note || '',
        createdAt: r.created_at,
        created_at: r.created_at,
      };
    });
  }

  async recordForeignTransfer(tenantId: string, userId: number, dto: RecordForeignTransferDto) {
    const {
      supplierId,
      amountEgp,
      amountForeign,
      currency,
      exchangeRateContract,
      proformaInvoiceId,
      notes,
      projectId,
      bankAccountId: reqBankAccountId,
      approvalRequestId,
    } = dto;
    const sId = Number(supplierId);

    const cleanEgp = Number(amountEgp);
    const cleanForeign = Number(amountForeign);
    const requestKey = (dto.idempotencyKey || '').trim();

    if (!requestKey || requestKey.length > 128) {
      throw new BadRequestException('مفتاح عدم تكرار الحوالة (Idempotency Key) إلزامي ويجب ألا يتجاوز 128 حرفًا.');
    }

    if (!Number.isFinite(cleanEgp) || cleanEgp <= 0 || !Number.isFinite(cleanForeign) || cleanForeign <= 0) {
      throw new BadRequestException('مبالغ الحوالة بالجنيه والعملة الأجنبية يجب أن تكون أكبر من الصفر.');
    }

    // Payment method (INV-IMPORT-PAYMENT-METHODS): a caller that
    // supplies no method is recorded as a bank transfer, the
    // historical behaviour, and no new evidence is demanded of
    // legacy callers. A caller that DOES supply a method must
    // supply that method's evidence, validated by the pure engine
    // before any write. Cash-carried money must name its custody
    // account explicitly: the settings default bank account is
    // never silently treated as cash in hand. The chart of
    // accounts carries no cash-vs-bank distinction beyond
    // is_cash_bank, so the method is recorded with the explicit
    // account rather than inferred from it.
    const explicitPaymentMethod =
      typeof dto.paymentMethod === 'string' && dto.paymentMethod.trim() ? dto.paymentMethod.trim() : null;
    if (explicitPaymentMethod && !isPaymentMethod(explicitPaymentMethod)) {
      throw new BadRequestException(
        `طريقة الدفع '${explicitPaymentMethod}' غير مدعومة. [IMPORT_PAYMENT_METHOD_UNKNOWN]`,
      );
    }
    const effectivePaymentMethod = explicitPaymentMethod ?? 'bank_transfer';
    if (explicitPaymentMethod) {
      try {
        validatePaymentEvidence(explicitPaymentMethod, {
          paymentReference: dto.paymentReference,
          bankSwiftCode: dto.bankSwiftCode,
          form4Number: dto.form4Number,
          form4Date: dto.form4Date,
          carrierName: dto.carrierName,
          travelDate: dto.travelDate,
          handoverReceiptNo: dto.handoverReceiptNo,
          lcNumber: dto.lcNumber,
          lcIssuingBank: dto.lcIssuingBank,
          lcExpiryDate: dto.lcExpiryDate,
          lcDocuments: dto.lcDocuments,
          cadHandoverProof: dto.cadHandoverProof,
          paymentTerms: dto.paymentTerms,
          paymentDueDate: dto.paymentDueDate,
        });
      } catch (err: any) {
        throw new BadRequestException(err?.message || 'دليل طريقة الدفع ناقص.');
      }
    }
    if (effectivePaymentMethod === 'cash_carried' && !reqBankAccountId) {
      throw new BadRequestException('الدفع النقدي المحمول يتطلب تحديد حساب العهدة النقدية صراحة (bankAccountId).');
    }

    return await this.db.transaction().execute(async (trx) => {
      // The threshold is normalised to the tenant base currency through
      // the single FX resolver: 100,000 JPY is not a large transfer,
      // 100,000 USD is. An unregistered currency fails closed here
      // (resolveFxRate) instead of silently classifying by foreign units.
      // When an approval token is supplied the classification is moot
      // and the token itself is bound below, so no rate is resolved.
      const transferCurrency = (currency || 'USD').toUpperCase();
      let isLargeTransfer = false;
      if (!approvalRequestId) {
        const thresholdRate = await resolveFxRate(trx as any, tenantId, transferCurrency);
        isLargeTransfer = cleanForeign * thresholdRate >= 100000;
      }

      // Read-only binding data for the approval token: the PI row is
      // re-read with its integrity checks below; this read applies no
      // update, so a rejected approval still rolls the transaction back
      // with no PI mutation.
      let piContractRate: number | null = null;
      let piProjectId: string | null = null;
      if (proformaInvoiceId) {
        const bindingPi = await trx
          .selectFrom('import_proforma_invoices')
          .select(['project_id', 'currency', 'exchange_rate_contract'])
          .where('id', '=', proformaInvoiceId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (bindingPi) {
          piProjectId = bindingPi.project_id;
          piContractRate =
            (bindingPi.currency || 'USD').toUpperCase() === 'EGP' ? 1 : Number(bindingPi.exchange_rate_contract);
        }
      }

      // Maker-Checker approval check, bound to supplier, proforma,
      // project, amount ceiling and currency: an approval for one
      // proforma/amount must never authorize a different one.
      if (approvalRequestId || isLargeTransfer) {
        if (!approvalRequestId && isLargeTransfer) {
          throw new BadRequestException(
            'الحوالات الكبرى (ما يعادل 100,000 بعملة الأساس فأكثر) تتطلب اعتماداً ثنائياً مسبقاً (Maker-Checker).',
          );
        }
        await this.verifyAndConsumeApprovalRequest(trx, tenantId, 'large_transfer', String(sId), approvalRequestId, {
          amount: cleanForeign,
          currency: transferCurrency,
          supplierId: String(sId),
          proformaInvoiceId: proformaInvoiceId ? String(proformaInvoiceId) : undefined,
          projectId: projectId || piProjectId ? String(projectId || piProjectId) : undefined,
          paymentMethod: explicitPaymentMethod ? effectivePaymentMethod : undefined,
        });
      }

      const supplier = await trx
        .selectFrom('suppliers')
        .select(['id', 'name', 'account_id', 'balance'])
        .where('id', '=', sId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // 1. Proforma Invoice Integrity Checks (Supplier, Project, Currency, Overpayment, Duplicate)
      if (proformaInvoiceId) {
        const pi = await trx
          .selectFrom('import_proforma_invoices')
          .selectAll()
          .where('id', '=', proformaInvoiceId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!pi) {
          throw new BadRequestException('الفاتورة المبدئية المحددة غير موجودة أو لا تنتمي لهذه المنشأة.');
        }

        if (Number(pi.supplier_id) !== sId) {
          throw new BadRequestException(`الفاتورة المبدئية (${pi.pi_number}) تخص مورداً آخر وليست للمورد المحدد.`);
        }

        if (projectId && pi.project_id && projectId !== pi.project_id) {
          throw new BadRequestException(`الفاتورة المبدئية (${pi.pi_number}) مرتبطة بمشروع استيراد آخر.`);
        }

        const piCurrency = (pi.currency || 'USD').toUpperCase();
        const transferCurrency = (currency || 'USD').toUpperCase();
        if (piCurrency !== transferCurrency) {
          throw new BadRequestException(
            `عملة الحوالة (${transferCurrency}) لا تطابق عملة الفاتورة المبدئية (${piCurrency}).`,
          );
        }

        if (
          pi.payment_status === 'paid' &&
          Number(pi.paid_amount_foreign || 0) >= Number(pi.total_amount_foreign || 0)
        ) {
          throw new BadRequestException(
            `الفاتورة المبدئية (${pi.pi_number}) مسددة بالكامل بالفعل ولا يمكن سداد دفعات إضافية عليها.`,
          );
        }

        const totalForeign = Number(pi.total_amount_foreign || 0);
        const alreadyPaidForeign = Number(pi.paid_amount_foreign || 0);
        const remainingForeign = Math.max(0, totalForeign - alreadyPaidForeign);
        if (cleanForeign > remainingForeign + 0.0001) {
          throw new BadRequestException(
            `مبلغ الحوالة (${cleanForeign.toFixed(2)} ${transferCurrency}) يتجاوز المتبقي غير المسدد للفاتورة المبدئية (${remainingForeign.toFixed(2)} ${transferCurrency}).`,
          );
        }

        const newPaid = alreadyPaidForeign + cleanForeign;
        const newStatus = newPaid >= totalForeign - 0.0001 ? 'paid' : 'partially_paid';

        await trx
          .updateTable('import_proforma_invoices')
          .set({ paid_amount_foreign: newPaid, payment_status: newStatus })
          .where('id', '=', proformaInvoiceId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // 2. Database-Backed Idempotency Protection
      const existingPayment = await trx
        .selectFrom('supplier_payments')
        .select(['id', 'doc_no', 'created_at'])
        .where('tenant_id', '=', tenantId)
        .where('idempotency_key', '=', requestKey)
        .executeTakeFirst();

      if (existingPayment) {
        throw new ConflictException(
          `تم تنفيذ هذا الطلب مسبقاً برقم (${existingPayment.doc_no})؛ تم منع إعادة التنفيذ بواسطة مفتاح عدم التكرار (Idempotency Key).`,
        );
      }

      // 3. Resolve Real Accounts from Chart of Accounts / Accounting Settings
      const supplierApAccountId = await this.resolveTenantAccount(trx, tenantId, 'payable');
      const bankAccountId = await this.resolveTenantAccount(trx, tenantId, 'bank', reqBankAccountId);
      const bankScope = await trx
        .selectFrom('accounting_accounts')
        .select('account_id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bankAccountId)
        .executeTakeFirstOrThrow();

      // 4. Exact Base Currency (EGP) Accounting Entries without mixing foreign units
      // No invented rate: the contract rate comes from the caller or
      // from the proforma's own contract rate. Deriving it from the
      // amounts themselves (cleanEgp / cleanForeign) made the forex
      // variance identically zero on every transfer without a caller
      // rate. With neither source, fail closed.
      const effectiveRateContract =
        exchangeRateContract && exchangeRateContract > 0
          ? exchangeRateContract
          : piContractRate !== null && Number.isFinite(piContractRate) && piContractRate > 0
            ? piContractRate
            : null;
      if (effectiveRateContract === null) {
        throw new BadRequestException(
          'لا يمكن تنفيذ الحوالة بلا سعر صرف تعاقدي صالح؛ حدد سعر الصرف التعاقدي على الفاتورة المبدئية أو في الحوالة. [IMPORT_EXCHANGE_RATE_REQUIRED]',
        );
      }
      const contractValue = Number((cleanForeign * effectiveRateContract).toFixed(2));
      const actualEgp = Number(cleanEgp.toFixed(2));
      const forexVarianceEgp = Number((actualEgp - contractValue).toFixed(2));

      let paymentInsert;
      try {
        paymentInsert = await trx
          .insertInto('supplier_payments')
          .values({
            tenant_id: tenantId,
            account_id: supplier.account_id || tenantId,
            supplier_id: supplier.id,
            amount: -contractValue,
            amount_foreign: cleanForeign,
            note: `حوالة استيراد خارجية${notes ? ' - ' + notes : ''} [تدبير عملة: ${actualEgp} ج.م]`,
            created_by: userId,
            payment_date:
              dto.transferDate || (await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date())),
            currency: currency || 'USD',
            exchange_rate: actualEgp / cleanForeign,
            forex_variance_egp: forexVarianceEgp,
            proforma_invoice_id: proformaInvoiceId || null,
            idempotency_key: requestKey,
            payment_method: effectivePaymentMethod,
            payment_reference: dto.paymentReference || null,
            bank_swift_code: dto.bankSwiftCode || null,
            form4_number: dto.form4Number || null,
            form4_date: dto.form4Date || null,
            evidence_carrier_name: dto.carrierName || null,
            evidence_travel_date: dto.travelDate || null,
            evidence_handover_receipt: dto.handoverReceiptNo || null,
            evidence_lc_number: dto.lcNumber || null,
            evidence_lc_issuing_bank: dto.lcIssuingBank || null,
            evidence_lc_expiry: dto.lcExpiryDate || null,
            evidence_lc_documents: dto.lcDocuments || null,
            evidence_cad_proof: dto.cadHandoverProof || null,
            evidence_payment_terms: dto.paymentTerms || null,
            evidence_payment_due_date: dto.paymentDueDate || null,
          } as any)
          .returning('id')
          .executeTakeFirstOrThrow();
      } catch (err: any) {
        if (err?.code === '23505' || String(err?.message || '').includes('idx_supplier_payments_tenant_idempotency')) {
          throw new ConflictException('تم تنفيذ حوالة متزامنة بنفس مفتاح عدم التكرار (Idempotency Key).');
        }
        throw err;
      }

      const paymentId = paymentInsert.id;

      await trx
        .updateTable('supplier_payments')
        .set({ doc_no: `FT-${paymentId}` })
        .where('id', '=', paymentId)
        .where('tenant_id', '=', tenantId)
        .execute();

      await trx
        .insertInto('treasury_transactions')
        .values({
          tenant_id: tenantId,
          account_id: bankScope.account_id,
          txn_type: 'supplier_payment',
          amount: -actualEgp,
          note:
            `تدبير عملة: حوالة خارجية إلى ${supplier.name} (${cleanForeign} ${currency || 'USD'}) [طريقة الدفع: ${effectivePaymentMethod}]` +
            (forexVarianceEgp !== 0 ? ` [فروق صرف: ${forexVarianceEgp.toFixed(2)} ج.م]` : ''),
          reference_type: 'supplier_payment',
          reference_id: paymentId,
          created_by: userId,
        })
        .execute();

      // The shared supplier ledger and suppliers.balance are BASE-CURRENCY EGP.
      // The original foreign-currency units belong only in amount_foreign / Proforma.
      const currentSupplierBalance = Number(supplier.balance || 0);
      const newSupplierBalance = currentSupplierBalance - contractValue;

      await trx
        .insertInto('supplier_ledger')
        .values({
          tenant_id: tenantId,
          account_id: supplier.account_id ? String(supplier.account_id) : tenantId,
          supplier_id: supplier.id,
          entry_type: 'payment',
          amount: -contractValue,
          balance_after: newSupplierBalance,
          note:
            `حوالة خارجية FT-${paymentId} (${cleanForeign} ${currency || 'USD'})` +
            (forexVarianceEgp !== 0 ? ` [فروق صرف: ${forexVarianceEgp.toFixed(2)} ج.م]` : ''),
          reference_type: 'supplier_payment',
          reference_id: paymentId,
          return_document_id: null,
          branch_id: null,
          location_id: null,
          created_by: userId,
        })
        .execute();

      await trx
        .updateTable('suppliers')
        .set((eb) => ({
          balance: sql`${eb.ref('balance')} - ${contractValue}`,
        }))
        .where('id', '=', sId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const postingService =
        this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const lines: any[] = [
        // Line 1: Debit Supplier Accounts Payable in EGP (relieve debt at contract rate)
        {
          accountId: supplierApAccountId,
          description: `سداد مديونية مورد خارجي - ${supplier.name} (${cleanForeign} ${currency || 'USD'})`,
          debit: contractValue,
          credit: 0,
          partnerType: 'supplier',
          partnerId: supplier.id,
          branchId: null,
          locationId: null,
        },
      ];

      // Line 2: Realized Forex Variance in EGP (Debit if Loss, Credit if Gain)
      // Resolved dynamically only if variance actually exists
      if (forexVarianceEgp > 0.001) {
        lines.push({
          accountId: await this.resolveTenantAccount(trx, tenantId, 'forex_loss'),
          description: `فروق سعر صرف محققة (خسارة) على حوالة FT-${paymentId}`,
          debit: forexVarianceEgp,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      } else if (forexVarianceEgp < -0.001) {
        lines.push({
          accountId: await this.resolveTenantAccount(trx, tenantId, 'forex_gain'),
          description: `فروق سعر صرف محققة (أرباح) على حوالة FT-${paymentId}`,
          debit: 0,
          credit: Math.abs(forexVarianceEgp),
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }

      // Line 3: Credit Bank account for actual cash paid in base currency (EGP)
      lines.push({
        accountId: bankAccountId,
        description: `تدبير عملة وخروج نقدية بنكية لحوالة FT-${paymentId}`,
        debit: 0,
        credit: actualEgp,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });

      const jeId = await postingService.postDomainJournal(trx, {
        sourceType: 'supplier_payment',
        sourceId: paymentId,
        tenantId,
        accountId: supplier.account_id || tenantId,
        entryDate: new Date(),
        description: `سداد مورد خارجي وحوالة أجنبية FT-${paymentId} - ${supplier.name} (${cleanForeign} ${currency || 'USD'})`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines,
      });

      return {
        success: true,
        paymentId,
        docNo: `FT-${paymentId}`,
        forexVarianceEgp,
        journalEntryId: jeId,
        bankAccountId,
        supplierApAccountId,
        paymentMethod: effectivePaymentMethod,
      };
    });
  }
}
