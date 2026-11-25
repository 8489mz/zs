import { tenantBaseCurrency } from '../../accounting-currency';
import { getTenantTimezone } from '../../../../common/utils/tenant-timezone.util';
import { currencyMoneyDigits, type MoneyDigits } from '../../engines/money-minor-units.engine';
import { Kysely } from 'kysely';
import { Database } from '../../../../database/database.types';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { PdcChequeRecord, PdcChequesFilter } from './pdc-cheques.types';

export type ListChequesBoundDeps = {
  toMoney(value: unknown, digits: MoneyDigits): number;
  formatDate(date: any): string;
};

export class ListChequesSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: ListChequesBoundDeps,
  ) {}

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private formatDate(date: any): string {
    return this.bound.formatDate(date);
  }

  /**
   * List cheques with comprehensive filtering and pagination
   */
  async listCheques(
    authContext: AuthContext,
    filters: PdcChequesFilter = {},
  ): Promise<{
    data: PdcChequeRecord[];
    total: number;
    page: number;
    limit: number;
    serverTime: string;
    serverTimezone: string;
  }> {
    const tenantId = String(authContext.tenantId || '');
    // P8 (RC-7): the PDC page's action-date default comes from the server
    // clock — the list response carries it, the HR attendance list precedent.
    const tenantTimezone = await getTenantTimezone(this.db, tenantId);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const page = Math.max(1, Number(filters.page || 1));
    const limit = Math.min(100, Math.max(1, Number(filters.limit || 25)));
    const offset = (page - 1) * limit;

    let baseQuery = (this.db as any).selectFrom('accounting_cheques').where('tenant_id', '=', tenantId);

    if (filters.type) {
      baseQuery = baseQuery.where('type', '=', filters.type);
    }

    if (filters.status) {
      baseQuery = baseQuery.where('status', '=', filters.status);
    }

    if (filters.search && filters.search.trim()) {
      const term = `%${filters.search.trim()}%`;
      baseQuery = baseQuery.where((eb: any) =>
        eb.or([
          eb('cheque_number', 'ilike', term),
          eb('partner_name', 'ilike', term),
          eb('bank_name', 'ilike', term),
          eb('drawer_name', 'ilike', term),
        ]),
      );
    }

    if (filters.dueFrom) {
      baseQuery = baseQuery.where('due_date', '>=', filters.dueFrom);
    }

    if (filters.dueTo) {
      baseQuery = baseQuery.where('due_date', '<=', filters.dueTo);
    }

    if (filters.partnerId) {
      baseQuery = baseQuery.where('partner_id', '=', filters.partnerId);
    }

    if (filters.bankName) {
      baseQuery = baseQuery.where('bank_name', '=', filters.bankName);
    }

    // Count total
    const countResult = await baseQuery.select((eb: any) => eb.fn.count('id').as('count')).executeTakeFirst();
    const total = Number(countResult?.count || 0);

    // Fetch records
    const rawRows = await baseQuery
      .selectAll()
      .orderBy('due_date', 'asc')
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    const data: PdcChequeRecord[] = rawRows.map((r: any) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      account_id: r.account_id,
      type: r.type,
      cheque_number: r.cheque_number,
      bank_name: r.bank_name,
      branch_name: r.branch_name,
      drawer_name: r.drawer_name,
      partner_type: r.partner_type,
      partner_id: r.partner_id,
      partner_name: r.partner_name,
      amount: this.toMoney(r.amount, currencyMoneyDigits(r.currency || 'EGP')),
      currency: r.currency || 'EGP',
      issue_date: this.formatDate(r.issue_date),
      due_date: this.formatDate(r.due_date),
      status: r.status,
      deposit_bank_id: r.deposit_bank_id,
      deposit_date: r.deposit_date ? this.formatDate(r.deposit_date) : null,
      cleared_date: r.cleared_date ? this.formatDate(r.cleared_date) : null,
      bounced_date: r.bounced_date ? this.formatDate(r.bounced_date) : null,
      bounced_reason: r.bounced_reason,
      bounced_fee: this.toMoney(r.bounced_fee, bookDigits),
      flagged_rate_variance: Boolean(r.flagged_rate_variance),
      registered_exchange_rate: r.registered_exchange_rate == null ? null : Number(r.registered_exchange_rate),
      endorsed_to_supplier_id: r.endorsed_to_supplier_id,
      endorsed_to_supplier_name: r.endorsed_to_supplier_name,
      journal_entry_id: r.journal_entry_id,
      notes: r.notes,
      created_by: r.created_by,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    }));

    return {
      data,
      total,
      page,
      limit,
      // P8 (RC-7): the PDC page's action-date default comes from the server clock.
      serverTime: new Date().toISOString(),
      serverTimezone: tenantTimezone,
    };
  }
}
