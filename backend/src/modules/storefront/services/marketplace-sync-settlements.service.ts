/**
 * MarketplaceSyncSettlementsService — slice S6 of the marketplace-sync split.
 * Pure move of 4 methods from MarketplaceSyncService (marketplace payout
 * settlement reads + the reconcile/posting flow). No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the same
 * names and signatures (resolveAccountingAccount is private with in-slice
 * callers only, so it stays private in the slice with NO delegate).
 * Deps are db + audit + accountingPosting + the bound kernel helper
 * getSettingJson (S10 form). NOTE: setSettingJson is NOT a dep — no moved
 * method calls it (prep §3 K-column correction, ground-proven). No logger
 * in the span (prep §4 holds for S6 — ground grep 0, unlike S3).
 * Types come from ./marketplace-sync.types (S0). PINNED: reconcileSettlement
 * (the settlement book-digits pin — the book-digits gate + the
 * gross-vs-parts identity, checked inside the transaction once the base
 * currency is known). Clock travels verbatim: the settlement entry date is
 * the tenant-local business day via resolveBusinessDateKey
 * (the tenant-local business-day rule); the reconcile transaction is
 * trx-threaded (getSettingJson(..., trx) + postDomainJournal(trx, ...)).
 * No instant comparison, no UTC normalizer.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { lockAccountingPeriod } from '../../accounting/accounting-period-lock';
import type {
  MarketplaceSettlementInput,
  MarketplaceSettlementRecord,
  SettlementAccountItem,
} from './marketplace-sync.types';

export interface MarketplaceSyncSettlementsDeps {
  db: Kysely<Database>;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  // Bound kernel helper (same name as the facade member, so the moved
  // bodies are byte-identical). getSettingJson stays in the facade
  // forever (kernel); it is called with the trx executor inside the
  // reconcile transaction (threaded BY DESIGN).
  getSettingJson: <T>(key: string, tenantId: string, defaultValue: T, executor?: Kysely<Database>) => Promise<T>;
}

@Injectable()
export class MarketplaceSyncSettlementsService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly getSettingJson: <T>(
    key: string,
    tenantId: string,
    defaultValue: T,
    executor?: Kysely<Database>,
  ) => Promise<T>;

  constructor(deps: MarketplaceSyncSettlementsDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.getSettingJson = deps.getSettingJson;
  }

  async getSettlements(auth: AuthContext): Promise<MarketplaceSettlementRecord[]> {
    const scope = requireTenantScope(auth);
    const [legacy, posted] = await Promise.all([
      this.getSettingJson<MarketplaceSettlementRecord[]>('marketplace_settlements', scope.tenantId, []),
      sql<{
        payload: MarketplaceSettlementRecord;
      }>`select payload from accounting_marketplace_settlements where tenant_id = ${scope.tenantId} and journal_entry_id is not null order by id desc`.execute(
        this.db,
      ),
    ]);
    return [...posted.rows.map((row) => row.payload), ...legacy];
  }

  async getSettlementAccounts(auth: AuthContext): Promise<{
    bankAccounts: SettlementAccountItem[];
    expenseAccounts: SettlementAccountItem[];
    revenueAccounts: SettlementAccountItem[];
  }> {
    const scope = requireTenantScope(auth);
    const accounts = await this.db
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'name_ar', 'name_en', 'account_type', 'is_cash_bank'])
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .where('is_active', '=', true)
      .orderBy('code', 'asc')
      .execute();

    const bankAccounts: SettlementAccountItem[] = [];
    const expenseAccounts: SettlementAccountItem[] = [];
    const revenueAccounts: SettlementAccountItem[] = [];

    for (const a of accounts) {
      const item: SettlementAccountItem = {
        id: Number(a.id),
        code: a.code,
        name: a.name_ar || a.name_en || a.code,
        accountType: a.account_type,
        isCashBank: Boolean(a.is_cash_bank),
      };
      if (a.is_cash_bank) {
        bankAccounts.push(item);
      }
      if (a.account_type === 'expense') {
        expenseAccounts.push(item);
      }
      if (a.account_type === 'revenue') {
        revenueAccounts.push(item);
      }
    }

    return { bankAccounts, expenseAccounts, revenueAccounts };
  }

  private async resolveAccountingAccount(
    tenantId: string,
    configuredId?: number,
    fallbackCodes: string[] = [],
    fallbackType?: string,
  ): Promise<number> {
    let query = this.db
      .selectFrom('accounting_accounts')
      .select(['id', 'is_cash_bank'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .where('allow_manual_entries', '=', true);
    if (fallbackType) query = query.where('account_type', '=', fallbackType as any);
    if (configuredId) query = query.where('id', '=', configuredId);
    else query = query.where('code', 'in', fallbackCodes);
    const row = await query.orderBy('code').executeTakeFirst();
    if (!row || (fallbackType === 'asset' && !row.is_cash_bank))
      throw new BadRequestException('يجب ضبط حساب ترحيل نشط وصحيح النوع للتسوية.');
    return Number(row.id);
  }

  async reconcileSettlement(
    input: MarketplaceSettlementInput,
    auth: AuthContext,
  ): Promise<{ ok: boolean; journalEntryId: number; journalEntryNo: string; settlement: MarketplaceSettlementRecord }> {
    const scope = requireTenantScope(auth);
    if (!input.settlementId?.trim() || !['amazon', 'noon'].includes(input.marketplace))
      throw new BadRequestException('معرف الكشف والمنصة مطلوبان.');
    const amounts = [
      input.grossSales,
      input.referralFees || 0,
      input.fulfillmentFees || 0,
      input.refunds || 0,
      input.storageOrOtherFees || 0,
      input.netPayout,
    ].map(Number);
    if (amounts.some((value) => !Number.isFinite(value) || value < 0) || amounts[0] <= 0)
      throw new BadRequestException('مبالغ الكشف يجب أن تكون موجبة.');
    const [gross, referral, fulfillment, refunds, other, net] = amounts;
    const bankId = await this.resolveAccountingAccount(scope.tenantId, input.bankAccountId, ['1120', '1110'], 'asset');
    const referralId = await this.resolveAccountingAccount(
      scope.tenantId,
      input.referralFeesAccountId,
      ['6400', '6700'],
      'expense',
    );
    const fulfillmentId = await this.resolveAccountingAccount(
      scope.tenantId,
      input.fulfillmentFeesAccountId,
      ['6400', '6700'],
      'expense',
    );
    const revenueId = await this.resolveAccountingAccount(
      scope.tenantId,
      input.salesAccountId,
      ['4100', '4200'],
      'revenue',
    );
    // The settlement entry date is the tenant-local business day: a
    // supplied periodEnd passes through untouched (it is already a
    // calendar day), while the "today" fallback resolves in the
    // tenant's timezone instead of the UTC slice of "now"
    // (INV-BUSINESS-DATE-TENANT-LOCAL).
    const entryDate = new Date(await resolveBusinessDateKey(this.db, scope.tenantId, input.periodEnd || new Date()));
    if (!Number.isFinite(entryDate.getTime())) throw new BadRequestException('تاريخ الكشف غير صالح.');
    const result = await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      const base = await tenantBaseCurrency(trx, scope.tenantId);
      if (input.currency && input.currency !== base)
        throw new BadRequestException('يجب تسوية الكشف بقيم عملة الأساس؛ لا يجوز خلط العملات دون مستند تحويل.');
      // INV-MARKETPLACE-SETTLEMENT-BOOK-DIGITS: the precision
      // gate and the gross-vs-parts identity are checked at the
      // tenant's book digits (3 for KWD/OMR/BHD/JOD/TND/IQD/LYD,
      // 2 otherwise), inside the transaction once the base
      // currency is known. A hardcoded 2-decimal gate rejected
      // every 3-decimal settlement outright.
      const digits = currencyMoneyDigits(base);
      const scale = 10 ** digits;
      if (amounts.some((value) => Math.abs(value * scale - Math.round(value * scale)) > 0.000001))
        throw new BadRequestException('مبالغ الكشف يجب أن تكون بدقة عملة الأساس.');
      if (Math.round(gross * scale) !== Math.round((referral + fulfillment + refunds + other + net) * scale))
        throw new BadRequestException('إجمالي المبيعات لا يطابق صافي التحويل والرسوم والمرتجعات.');
      const prior = await sql<{
        payload: MarketplaceSettlementRecord;
      }>`select payload from accounting_marketplace_settlements
        where tenant_id = ${scope.tenantId} and marketplace = ${input.marketplace} and settlement_key = ${input.settlementId} for update`.execute(
        trx,
      );
      if (prior.rows[0]) {
        const record = prior.rows[0].payload;
        if (
          ['grossSales', 'referralFees', 'fulfillmentFees', 'refunds', 'storageOrOtherFees', 'netPayout'].some(
            (key) => Number((record as any)[key] || 0) !== Number((input as any)[key] || 0),
          ) ||
          record.periodEnd !== input.periodEnd
        )
          throw new BadRequestException('نفس معرف الكشف استُخدم ببيانات مالية مختلفة.');
        return {
          ok: true,
          journalEntryId: Number(record.journalEntryId),
          journalEntryNo: String(record.journalEntryNo),
          settlement: record,
        };
      }
      // Legacy settlements remain immutable; never repost an already-reconciled key.
      const legacy = await this.getSettingJson<MarketplaceSettlementRecord[]>(
        'marketplace_settlements',
        scope.tenantId,
        [],
        trx,
      );
      if (
        legacy.some(
          (record) =>
            record.settlementId === input.settlementId &&
            record.marketplace === input.marketplace &&
            record.journalEntryId,
        )
      )
        throw new BadRequestException('الكشف مرحل سابقاً؛ يلزم مراجعته دون إعادة ترحيله.');
      const document = await sql<{
        id: number;
      }>`insert into accounting_marketplace_settlements (tenant_id, marketplace, settlement_key, payload)
        values (${scope.tenantId}, ${input.marketplace}, ${input.settlementId}, '{}'::jsonb) returning id`.execute(trx);
      const description = `تسوية كشف ${input.marketplace} رقم ${input.settlementId}`;
      const lines = [
        { accountId: bankId, description, debit: net, credit: 0 },
        { accountId: referralId, description: 'عمولات ورسوم منصة', debit: referral + other, credit: 0 },
        { accountId: fulfillmentId, description: 'رسوم شحن وتخزين', debit: fulfillment, credit: 0 },
        { accountId: revenueId, description: 'مردودات مبيعات منصة', debit: refunds, credit: 0 },
        { accountId: revenueId, description: 'إجمالي مبيعات منصة', debit: 0, credit: gross },
      ].filter((line) => line.debit > 0 || line.credit > 0);
      const journalEntryId = await this.accountingPosting.postDomainJournal(trx, {
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        sourceType: 'marketplace_settlement',
        sourceId: Number(document.rows[0].id),
        entryDate,
        description,
        createdBy: auth.userId || null,
        lines: lines.map((line) => ({ ...line, partnerType: 'none' as const, partnerId: null })),
      });
      const entry = await trx
        .selectFrom('journal_entries')
        .select('entry_no')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', journalEntryId)
        .executeTakeFirstOrThrow();
      const record: MarketplaceSettlementRecord = {
        ...input,
        id: String(document.rows[0].id),
        status: 'reconciled',
        journalEntryId,
        journalEntryNo: entry.entry_no,
        createdAt: new Date().toISOString(),
        reconciledAt: new Date().toISOString(),
      };
      await sql`update accounting_marketplace_settlements set payload = ${JSON.stringify(record)}::jsonb, journal_entry_id = ${journalEntryId}
        where tenant_id = ${scope.tenantId} and id = ${document.rows[0].id}`.execute(trx);
      return { ok: true, journalEntryId, journalEntryNo: entry.entry_no, settlement: record };
    });
    await this.audit.log(
      'تسوية كشف حساب منصات',
      `تمت تسوية كشف ${input.settlementId} بالقيد ${result.journalEntryNo}`,
      auth,
    );
    return result;
  }
}
