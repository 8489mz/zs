import { lockAccountingPeriod } from '../accounting-period-lock';
import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../accounting-posting.service';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../engines/money-minor-units.engine';

export interface WithholdingTaxRecord {
  id: number;
  tenant_id: string;
  direction: 'payable' | 'receivable';
  source_type: string;
  source_id: number | null;
  invoice_number: string;
  invoice_date: string;
  partner_type: string;
  partner_id: number | null;
  partner_name: string;
  tax_id_number: string | null;
  file_number: string | null;
  tax_office_code: string | null;
  partner_address: string | null;
  wht_type: string;
  wht_rate: number;
  base_amount: number;
  tax_amount: number;
  quarter: string;
  tax_year: number;
  status: string;
  payment_reference: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface Form41SummaryResponse {
  tax_year: number;
  quarter: string;
  direction: 'payable' | 'receivable';
  total_count: number;
  total_base_amount: number;
  total_tax_amount: number;
  breakdown: {
    goods: { count: number; base_amount: number; tax_amount: number; rate: number };
    services: { count: number; base_amount: number; tax_amount: number; rate: number };
    professional: { count: number; base_amount: number; tax_amount: number; rate: number };
    custom: { count: number; base_amount: number; tax_amount: number };
  };
  transactions: WithholdingTaxRecord[];
}

export interface CreateWhtTransactionDto {
  direction?: 'payable' | 'receivable';
  source_type?: string;
  source_id?: number;
  invoice_number: string;
  invoice_date: string;
  partner_type?: string;
  partner_id?: number;
  partner_name: string;
  tax_id_number?: string;
  file_number?: string;
  tax_office_code?: string;
  partner_address?: string;
  wht_type: 'goods' | 'services' | 'professional' | 'custom';
  wht_rate?: number;
  base_amount: number;
  quarter?: string;
  tax_year?: number;
  notes?: string;
}

export interface ExtractFromPurchasesDto {
  fromDate: string;
  toDate: string;
  defaultWhtRate?: number;
  defaultWhtType?: 'goods' | 'services' | 'professional';
}

@Injectable()
export class WithholdingTaxService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPostingService: AccountingPostingService,
  ) {}

  private toMoney(value: unknown): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
  }

  /**
   * Stored-amount rounding: round once with the canonical engine at
   * the tenant's book digits. Kept separate from toMoney (2dp display
   * shaping for report/return records) so stored creation and
   * subledger amounts can never silently fall back to two decimals.
   */
  private toBookMoney(value: unknown, digits: MoneyDigits): number {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) throw new BadRequestException('قيمة الضريبة يجب أن تكون رقمًا صالحًا.');
    return roundMoney(n, digits);
  }

  private formatDate(date: any): string {
    if (!date) return '';
    if (typeof date === 'string') return date.substring(0, 10);
    if (date instanceof Date) return date.toISOString().substring(0, 10);
    return String(date).substring(0, 10);
  }

  private determineQuarterAndYear(dateStr: string): { quarter: string; year: number } {
    const d = new Date(dateStr);
    const month = d.getMonth() + 1; // 1-12
    const year = d.getFullYear();
    let quarter = 'Q1';
    if (month >= 1 && month <= 3) quarter = 'Q1';
    else if (month >= 4 && month <= 6) quarter = 'Q2';
    else if (month >= 7 && month <= 9) quarter = 'Q3';
    else quarter = 'Q4';
    return { quarter, year };
  }

  /**
   * Get official Egyptian Form 41 Withholding Tax declaration summary & transactions
   */
  async getForm41Report(
    auth: AuthContext,
    params: { year?: number; quarter?: string; direction?: 'payable' | 'receivable' },
  ): Promise<Form41SummaryResponse> {
    const tenantId = String(auth.tenantId || '');
    const now = new Date();
    const currentQ = this.determineQuarterAndYear(now.toISOString().substring(0, 10));
    const taxYear = params.year ? Number(params.year) : currentQ.year;
    const quarter = params.quarter || currentQ.quarter;
    const direction = params.direction || 'payable';

    const rawRows = await (this.db as any)
      .selectFrom('withholding_tax_transactions')
      .where('tenant_id', '=', tenantId)
      .where('tax_year', '=', taxYear)
      .where('quarter', '=', quarter)
      .where('direction', '=', direction)
      .selectAll()
      .orderBy('invoice_date', 'asc')
      .orderBy('id', 'asc')
      .execute();

    const transactions: WithholdingTaxRecord[] = rawRows.map((r: any) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      direction: r.direction,
      source_type: r.source_type,
      source_id: r.source_id,
      invoice_number: r.invoice_number,
      invoice_date: this.formatDate(r.invoice_date),
      partner_type: r.partner_type,
      partner_id: r.partner_id,
      partner_name: r.partner_name,
      tax_id_number: r.tax_id_number,
      file_number: r.file_number,
      tax_office_code: r.tax_office_code,
      partner_address: r.partner_address,
      wht_type: r.wht_type,
      wht_rate: Number(r.wht_rate),
      base_amount: this.toMoney(r.base_amount),
      tax_amount: this.toMoney(r.tax_amount),
      quarter: r.quarter,
      tax_year: r.tax_year,
      status: r.status,
      payment_reference: r.payment_reference,
      notes: r.notes,
      created_by: r.created_by,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    }));

    let totalBase = 0;
    let totalTax = 0;
    const breakdown = {
      goods: { count: 0, base_amount: 0, tax_amount: 0, rate: 1 },
      services: { count: 0, base_amount: 0, tax_amount: 0, rate: 3 },
      professional: { count: 0, base_amount: 0, tax_amount: 0, rate: 5 },
      custom: { count: 0, base_amount: 0, tax_amount: 0 },
    };

    for (const t of transactions) {
      totalBase = this.toMoney(totalBase + t.base_amount);
      totalTax = this.toMoney(totalTax + t.tax_amount);

      if (t.wht_type === 'goods') {
        breakdown.goods.count += 1;
        breakdown.goods.base_amount = this.toMoney(breakdown.goods.base_amount + t.base_amount);
        breakdown.goods.tax_amount = this.toMoney(breakdown.goods.tax_amount + t.tax_amount);
      } else if (t.wht_type === 'services') {
        breakdown.services.count += 1;
        breakdown.services.base_amount = this.toMoney(breakdown.services.base_amount + t.base_amount);
        breakdown.services.tax_amount = this.toMoney(breakdown.services.tax_amount + t.tax_amount);
      } else if (t.wht_type === 'professional') {
        breakdown.professional.count += 1;
        breakdown.professional.base_amount = this.toMoney(breakdown.professional.base_amount + t.base_amount);
        breakdown.professional.tax_amount = this.toMoney(breakdown.professional.tax_amount + t.tax_amount);
      } else {
        breakdown.custom.count += 1;
        breakdown.custom.base_amount = this.toMoney(breakdown.custom.base_amount + t.base_amount);
        breakdown.custom.tax_amount = this.toMoney(breakdown.custom.tax_amount + t.tax_amount);
      }
    }

    return {
      tax_year: taxYear,
      quarter,
      direction,
      total_count: transactions.length,
      total_base_amount: totalBase,
      total_tax_amount: totalTax,
      breakdown,
      transactions,
    };
  }

  /**
   * Create a single withholding tax transaction manually or from an invoice
   */
  async createTransaction(auth: AuthContext, dto: CreateWhtTransactionDto): Promise<WithholdingTaxRecord> {
    const tenantId = String(auth.tenantId || '');

    if (!dto.partner_name || !dto.partner_name.trim()) {
      throw new BadRequestException('اسم المورد أو العميل مطلوب');
    }
    if (!dto.invoice_number || !dto.invoice_number.trim()) {
      throw new BadRequestException('رقم الفاتورة مطلوب');
    }
    if (!dto.invoice_date) {
      throw new BadRequestException('تاريخ الفاتورة مطلوب');
    }
    const baseAmount = Number(dto.base_amount);
    if (!baseAmount || baseAmount <= 0) {
      throw new BadRequestException('قيمة وعاء المعاملة يجب أن تكون أكبر من الصفر');
    }

    // Determine rate based on Egyptian law standard if not provided
    let rate = Number(dto.wht_rate);
    if (rate === undefined || isNaN(rate)) {
      if (dto.wht_type === 'goods') rate = 1.00;
      else if (dto.wht_type === 'services') rate = 3.00;
      else if (dto.wht_type === 'professional') rate = 5.00;
      else rate = 1.00;
    }

    const period = this.determineQuarterAndYear(dto.invoice_date);
    const quarter = dto.quarter || period.quarter;
    const taxYear = dto.tax_year || period.year;

    // Stored amounts round once at the tenant's book digits, resolved
    // on the transaction handle with the P2 pattern
    // (tenantBaseCurrency + currencyMoneyDigits), fail closed on a
    // base-currency/rate mismatch exactly like the posting boundary
    // (P0-1/P0-2/P0-3). Creation previously ran on the pool handle
    // with a hardcoded 2dp helper, so a KWD 10.001 of withholding
    // was truncated to 10.00 before the widened columns could hold it.
    return this.db.transaction().execute(async (trx) => {
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      const bookBaseAmount = this.toBookMoney(baseAmount, digits);
      const taxAmount = this.toBookMoney(bookBaseAmount * (rate / 100), digits);

      const inserted = await (trx as any)
        .insertInto('withholding_tax_transactions')
        .values({
          tenant_id: tenantId,
          direction: dto.direction || 'payable',
          source_type: dto.source_type || 'manual',
          source_id: dto.source_id || null,
          invoice_number: dto.invoice_number.trim(),
          invoice_date: dto.invoice_date,
          partner_type: dto.partner_type || (dto.direction === 'receivable' ? 'customer' : 'supplier'),
          partner_id: dto.partner_id || null,
          partner_name: dto.partner_name.trim(),
          tax_id_number: dto.tax_id_number?.trim() || null,
          file_number: dto.file_number?.trim() || null,
          tax_office_code: dto.tax_office_code?.trim() || null,
          partner_address: dto.partner_address?.trim() || null,
          wht_type: dto.wht_type || 'goods',
          wht_rate: rate,
          base_amount: bookBaseAmount,
          tax_amount: taxAmount,
          quarter,
          tax_year: taxYear,
          status: 'draft',
          notes: dto.notes?.trim() || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        id: inserted.id,
        tenant_id: inserted.tenant_id,
        direction: inserted.direction,
        source_type: inserted.source_type,
        source_id: inserted.source_id,
        invoice_number: inserted.invoice_number,
        invoice_date: this.formatDate(inserted.invoice_date),
        partner_type: inserted.partner_type,
        partner_id: inserted.partner_id,
        partner_name: inserted.partner_name,
        tax_id_number: inserted.tax_id_number,
        file_number: inserted.file_number,
        tax_office_code: inserted.tax_office_code,
        partner_address: inserted.partner_address,
        wht_type: inserted.wht_type,
        wht_rate: Number(inserted.wht_rate),
        base_amount: this.toMoney(inserted.base_amount),
        tax_amount: this.toMoney(inserted.tax_amount),
        quarter: inserted.quarter,
        tax_year: inserted.tax_year,
        status: inserted.status,
        payment_reference: inserted.payment_reference,
        notes: inserted.notes,
        created_by: inserted.created_by,
        created_at: inserted.created_at ? new Date(inserted.created_at).toISOString() : '',
        updated_at: inserted.updated_at ? new Date(inserted.updated_at).toISOString() : '',
      };
    });
  }

  /**
   * Smart automatic extraction from purchases bills into Form 41
   */
  async extractFromPurchases(
    auth: AuthContext,
    dto: ExtractFromPurchasesDto,
  ): Promise<{ extracted_count: number; total_tax_added: number; message: string }> {
    const tenantId = String(auth.tenantId || '');
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      const fromDate = dto.fromDate;
      const toDate = dto.toDate;
      const whtType = dto.defaultWhtType || 'goods';
      const rate = dto.defaultWhtRate !== undefined ? Number(dto.defaultWhtRate) : 1.00;

      if (!Number.isFinite(rate) || rate <= 0 || rate > 100) throw new BadRequestException('نسبة الخصم غير صالحة.');

      // INV-WHT-BASE-EXCLUDES-VAT: the withholding base is the
      // pre-VAT amount. A tax-inclusive bill stores its VAT inside
      // subtotal, so the stored tax_amount is removed for inclusive
      // bills; exclusive bills already store subtotal pre-VAT.
      // Amounts round at the tenant's book digits, never a
      // hard-coded 2 (a KWD 0.001 of withholding survives).
      const currencyRow = await (trx as any)
        .selectFrom('settings')
        .select('value')
        .where('tenant_id', '=', tenantId)
        .where('key', '=', 'currency')
        .executeTakeFirst();
      const bookDigits = currencyMoneyDigits(currencyRow?.value ?? '');
      const toBookMoney = (value: number): number => roundMoney(value, bookDigits);

      // Fetch purchases that exceed 300 EGP and are not cancelled
      const purchases = await (trx as any)
        .selectFrom('purchases as p')
        .leftJoin('suppliers as s', (join: any) => join.onRef('s.id', '=', 'p.supplier_id').onRef('s.tenant_id', '=', 'p.tenant_id'))
        .where('p.tenant_id', '=', tenantId)
        .where('p.status', '=', 'posted')
        .where(sql<boolean>`p.created_at >= ${fromDate}::date AND p.created_at < (${toDate}::date + interval '1 day')`)
        .where('p.subtotal', '>=', 300) // Egyptian legal minimum threshold for Form 41
        .select([
          'p.id as purchase_id',
          'p.doc_no',
          'p.subtotal',
          'p.discount',
          'p.tax_amount',
          'p.prices_include_tax',
          'p.created_at',
          'p.supplier_id',
          's.id as owned_supplier_id',
          's.name as supplier_name',
          sql<string>`s.metadata->>'companyName'`.as('company_name'),
          sql<string>`s.metadata->>'taxNumber'`.as('tax_number'),
        ])
        .execute();

      if (purchases.length === 0) {
        return { extracted_count: 0, total_tax_added: 0, message: 'لا توجد فواتير شراء خاضعة للخصم والإضافة في هذه الفترة' };
      }

      if (purchases.some((purchase: any) => purchase.supplier_id && !purchase.owned_supplier_id)) throw new BadRequestException('توجد فاتورة بمورد خارج المنشأة؛ يلزم مطابقتها قبل استخراج الضريبة.');

      // Check existing extracted purchases to avoid duplication
      const purchaseIds = purchases.map((p: any) => p.purchase_id);
      const existing = await (trx as any)
        .selectFrom('withholding_tax_transactions')
        .where('tenant_id', '=', tenantId)
        .where('source_type', '=', 'purchase')
        .where('source_id', 'in', purchaseIds)
        .select(['source_id'])
        .execute();

      const existingSet = new Set(existing.map((e: any) => String(e.source_id)));
      let addedCount = 0;
      let addedTax = 0;

      for (const p of purchases) {
        if (existingSet.has(String(p.purchase_id))) continue;

        const dateStr = this.formatDate(p.created_at);
        const period = this.determineQuarterAndYear(dateStr);
        const storedTax = Number(p.tax_amount || 0);
        const baseAmount = toBookMoney(
          Number(p.subtotal || 0) - Number(p.discount || 0) - (p.prices_include_tax ? storedTax : 0),
        );
        if (baseAmount < 300) continue;

        const taxAmount = toBookMoney(baseAmount * (rate / 100));
        const partnerName = p.company_name || p.supplier_name || `مورد رقم ${p.supplier_id || ''}`;

        await (trx as any)
          .insertInto('withholding_tax_transactions')
          .values({
            tenant_id: tenantId,
            direction: 'payable',
            source_type: 'purchase',
            source_id: p.purchase_id,
            extraction_key: `purchase:${p.purchase_id}`,
            invoice_number: p.doc_no || `PUR-${p.purchase_id}`,
            invoice_date: dateStr,
            partner_type: 'supplier',
            partner_id: p.supplier_id,
            partner_name: partnerName,
            tax_id_number: p.tax_number || null,
            wht_type: whtType,
            wht_rate: rate,
            base_amount: baseAmount,
            tax_amount: taxAmount,
            quarter: period.quarter,
            tax_year: period.year,
            status: 'draft',
            notes: `استيراد آلي من فاتورة الشراء رقم ${p.doc_no || p.purchase_id}`,
            created_by: auth.userId ? Number(auth.userId) : null,
          })
          .execute();

        addedCount++;
        addedTax = toBookMoney(addedTax + taxAmount);
      }

      return {
        extracted_count: addedCount,
        total_tax_added: addedTax,
        message: `تم استيراد ${addedCount} معاملة بنجاح بإجمالي ضريبة خصم ${addedTax} ج.م`,
      };
    });
  }

  /**
   * Update transaction status (draft -> declared / paid)
   */
  async updateStatus(
    auth: AuthContext,
    id: number,
    dto: { status: 'draft' | 'declared' | 'paid'; payment_reference?: string },
  ): Promise<WithholdingTaxRecord> {
    const tenantId = String(auth.tenantId || '');

    return this.db.transaction().execute(async (trx: any) => {
      const existing = await trx
        .selectFrom('withholding_tax_transactions')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .selectAll()
        .forUpdate()
        .executeTakeFirst();

      if (!existing) {
        throw new NotFoundException('معاملة الخصم والإضافة غير موجودة');
      }

      // A remittance creates immutable posted ledger entries. Reopening the tax record
      // as a draft would allow deleting its evidence while leaving those entries behind.
      if (existing.status === 'paid' && dto.status !== 'paid') {
        throw new BadRequestException('لا يمكن إعادة معاملة ضريبية مسددة إلى مسودة دون إجراء عكسي معتمد');
      }
      if (existing.status === 'paid' && dto.payment_reference && dto.payment_reference !== existing.payment_reference) {
        throw new BadRequestException('لا يمكن تعديل مرجع سداد معاملة ضريبية مرحلة');
      }

      let paymentRef = dto.payment_reference || existing.payment_reference;

      // When transitioning to 'paid', post remittance journal entry
      if (dto.status === 'paid' && existing.status !== 'paid') {
        const postRes = await this.accountingPostingService.postWithholdingTaxRemittance(
          trx,
          id,
          'bank',
          auth,
        );
        if (!postRes.journalEntryId) throw new BadRequestException('تعذر ترحيل قيد سداد ضريبة الاستقطاع.');
        paymentRef = paymentRef || `JE-${postRes.journalEntryId}`;
        if (postRes.posted && existing.partner_id) {
          await this.syncPartnerSubLedger(trx, auth, existing);
        }
      }

      const updated = await trx
        .updateTable('withholding_tax_transactions')
        .set({
          status: dto.status,
          payment_reference: paymentRef,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        id: updated.id,
        tenant_id: updated.tenant_id,
        direction: updated.direction,
        source_type: updated.source_type,
        source_id: updated.source_id,
        invoice_number: updated.invoice_number,
        invoice_date: this.formatDate(updated.invoice_date),
        partner_type: updated.partner_type,
        partner_id: updated.partner_id,
        partner_name: updated.partner_name,
        tax_id_number: updated.tax_id_number,
        file_number: updated.file_number,
        tax_office_code: updated.tax_office_code,
        partner_address: updated.partner_address,
        wht_type: updated.wht_type,
        wht_rate: Number(updated.wht_rate),
        base_amount: this.toMoney(updated.base_amount),
        tax_amount: this.toMoney(updated.tax_amount),
        quarter: updated.quarter,
        tax_year: updated.tax_year,
        status: updated.status,
        payment_reference: updated.payment_reference,
        notes: updated.notes,
        created_by: updated.created_by,
        created_at: updated.created_at ? new Date(updated.created_at).toISOString() : '',
        updated_at: updated.updated_at ? new Date(updated.updated_at).toISOString() : '',
      };
    });
  }

  private async syncPartnerSubLedger(trx: any, auth: AuthContext, tx: any): Promise<void> {
    const tenantId = String(auth.tenantId || '');
    const accountId = String(auth.accountId || tenantId);
    // The stored tax_amount is re-rounded at the tenant's book digits
    // resolved on THIS transaction handle — the same settings row the
    // remittance posting reads on the same trx, so GL and subledger
    // always agree exactly. The old 2dp helper moved the partner
    // balance by 10.00 while the journal posted 10.001. The snapshot
    // is the exact returned balance (partner-subledger.ts precedent),
    // never re-rounded: ledger balance_after columns already hold
    // scale 3 after the minor-unit widening migrations.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
    const amount = -this.toBookMoney(tx.tax_amount, digits);
    const partnerId = Number(tx.partner_id);
    const isSupplier = tx.direction === 'payable';
    const table = isSupplier ? 'suppliers' : 'customers';
    const updated = await trx.updateTable(table)
      .set({ balance: sql`COALESCE(balance, 0) + ${amount}`, updated_at: sql`NOW()` })
      .where('id', '=', partnerId).where('tenant_id', '=', tenantId)
      .returning(['balance']).executeTakeFirst();
    if (!updated) throw new BadRequestException('الشريك المرتبط بمعاملة الخصم والإضافة غير موجود.');
    await trx.insertInto(isSupplier ? 'supplier_ledger' : 'customer_ledger').values({
      [isSupplier ? 'supplier_id' : 'customer_id']: partnerId,
      entry_type: 'withholding_tax',
      amount,
      balance_after: Number(updated.balance),
      note: `ضريبة خصم وإضافة - فاتورة #${tx.invoice_number}`,
      reference_type: 'withholding_tax',
      reference_id: Number(tx.id),
      created_by: auth.userId ? Number(auth.userId) : null,
      branch_id: null,
      location_id: null,
      tenant_id: tenantId,
      account_id: accountId,
    }).execute();
  }

  /**
   * Delete transaction
   */
  async deleteTransaction(auth: AuthContext, id: number): Promise<{ success: boolean }> {
    const tenantId = String(auth.tenantId || '');

    return this.db.transaction().execute(async (trx: any) => {
      const existing = await trx
        .selectFrom('withholding_tax_transactions')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .selectAll()
        .forUpdate()
        .executeTakeFirst();

      if (!existing) {
        throw new NotFoundException('المعاملة غير موجودة');
      }

      const remittance = await trx
        .selectFrom('journal_entries')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('source_type', '=', 'withholding_tax_remittance')
        .where('source_id', '=', id)
        .executeTakeFirst();
      if (existing.status === 'paid' || remittance) {
        throw new BadRequestException('لا يمكن حذف معاملة ضريبية لها قيد سداد مرحل؛ يلزم إجراء عكسي معتمد');
      }

      await trx
        .deleteFrom('withholding_tax_transactions')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .execute();

      return { success: true };
    });
  }
}
