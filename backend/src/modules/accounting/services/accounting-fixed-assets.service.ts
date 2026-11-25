import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../engines/money-minor-units.engine';
import { BadRequestException, Injectable } from '@nestjs/common';
import { sql, Kysely } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AccountingPostingService } from '../accounting-posting.service';
import { calculateAssetDepreciation, validateFixedAssetTerms } from '../engines/fixed-asset-depreciation.engine';
import { readJournalEntryNo } from '../engines/journal-number.engine';

/**
 * AccountingFixedAssetsService — slice S7 of the accounting split.
 * Pure move of 8 methods from AccountingService (fixed assets &
 * depreciation: the asset project list + the depreciation engine).
 * No behavior change: the bodies are byte-identical; the facade
 * keeps thin delegates with the same names and signatures for the
 * 7 public methods. ensureDepreciationAccounts is private and stays
 * private inside this slice (its only caller, depreciateFixedAsset,
 * is in-slice). Deps are kernel only (db + the optional posting dep
 * + the bound toMoney helper) — this slice never imports another
 * slice service. depreciateFixedAsset posts a real journal via the
 * optional accountingPosting dep with the fail-closed guard carried
 * byte-identical (if (!posting) throw ...). It has NO driving spec
 * (recorded in the prep, not a blocker); the merge proof is the
 * critical run + ci-fast. Date handling travels verbatim:
 * createFixedAsset carries the purchase-date default + future-date
 * guard (new Date() x3), depreciateFixedAsset carries entryDate =
 * new Date() + the start-of-month guard (new Date() x3) — no instant
 * comparison, no UTC-slice normalizer.
 */

export interface AccountingFixedAssetsDeps {
  db: Kysely<Database>;
  accountingPosting?: AccountingPostingService;
  // Bound kernel helper (stays in the facade; passed bound so the moved
  // bodies stay byte-identical).
  toMoney: (value: unknown, digits: MoneyDigits) => number;
}

@Injectable()
export class AccountingFixedAssetsService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly toMoney: (value: unknown, digits: MoneyDigits) => number;

  constructor(deps: AccountingFixedAssetsDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.toMoney = deps.toMoney;
  }

  async listProjects(actor: AuthContext): Promise<Record<string, unknown>> {
    const records = await this.db
      .selectFrom('projects')
      .selectAll()
      .where('tenant_id', '=', requireTenantScope(actor).tenantId)
      .execute();
    return { ok: true, projects: records };
  }

  private async ensureDepreciationAccounts(
    trx: any,
    tenantId: string,
    accountId: string,
  ): Promise<{ deprExpenseAccountId: number; accumDeprAccountId: number }> {
    const accumRow = await trx
      .selectFrom('accounting_accounts')
      .select(['id', 'code'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', '1290')
      .executeTakeFirst();

    let accumDeprAccountId: number;
    if (accumRow) {
      accumDeprAccountId = Number(accumRow.id);
    } else {
      const parentRow = await trx
        .selectFrom('accounting_accounts')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('code', 'in', ['1200', '1000'])
        .orderBy('code', 'desc')
        .executeTakeFirst();

      const created = await trx
        .insertInto('accounting_accounts')
        .values({
          code: '1290',
          name_ar: 'مجمع الإهلاك',
          name_en: 'Accumulated Depreciation',
          account_type: 'contra_asset',
          normal_balance: 'credit',
          sort_order: 1290,
          parent_id: parentRow ? Number(parentRow.id) : null,
          account_group: 'fixed_assets',
          allow_manual_entries: true,
          is_control_account: false,
          is_cash_bank: false,
          is_receivable: false,
          is_payable: false,
          is_inventory: false,
          is_tax: false,
          is_active: true,
          is_system: false,
          tenant_id: tenantId,
          description_ar: 'مجمع إهلاك الأصول الثابتة',
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();
      accumDeprAccountId = Number(created.id);
    }

    const expenseRow = await trx
      .selectFrom('accounting_accounts')
      .select(['id', 'code'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([eb('code', '=', '6960'), eb('name_ar', 'like', '%إهلاك%').and('account_type', '=', 'expense')]),
      )
      .executeTakeFirst();

    let deprExpenseAccountId: number;
    if (expenseRow) {
      deprExpenseAccountId = Number(expenseRow.id);
    } else {
      const parentRow = await trx
        .selectFrom('accounting_accounts')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('code', 'in', ['6000', '6900'])
        .orderBy('code', 'asc')
        .executeTakeFirst();

      const created = await trx
        .insertInto('accounting_accounts')
        .values({
          code: '6960',
          name_ar: 'مصروف إهلاك الأصول الثابتة',
          name_en: 'Depreciation Expense',
          account_type: 'expense',
          normal_balance: 'debit',
          sort_order: 6960,
          parent_id: parentRow ? Number(parentRow.id) : null,
          account_group: 'operating_expenses',
          allow_manual_entries: true,
          is_control_account: false,
          is_cash_bank: false,
          is_receivable: false,
          is_payable: false,
          is_inventory: false,
          is_tax: false,
          is_active: true,
          is_system: false,
          tenant_id: tenantId,
          description_ar: 'مصروف إهلاك الأصول الثابتة الدوري',
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();
      deprExpenseAccountId = Number(created.id);
    }

    return { deprExpenseAccountId, accumDeprAccountId };
  }

  async listFixedAssets(actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor);
    const rows = await this.db
      .selectFrom('fixed_assets')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('created_at', 'desc')
      .execute();

    const assets = rows.map((a) => {
      const cost = Number(a.purchase_cost || 0);
      const accum = Number(a.accumulated_depreciation || 0);
      const salvage = Number(a.salvage_value || 0);
      const bookValue = Math.max(0, cost - accum);
      return {
        ...a,
        purchase_cost: cost,
        accumulated_depreciation: accum,
        salvage_value: salvage,
        book_value: bookValue,
      };
    });

    return { ok: true, assets };
  }

  async createFixedAsset(
    body: {
      code: string;
      name: string;
      category?: string;
      purchaseCost: number;
      salvageValue?: number;
      usefulLifeMonths?: number;
      depreciationMethod?: 'straight_line' | 'declining_balance';
      purchaseDate?: string;
    },
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor);
    const code = String(body.code || '').trim();
    const name = String(body.name || '').trim();
    const purchaseCost = Number(body.purchaseCost);
    const salvageValue = Number(body.salvageValue ?? 0);
    const usefulLifeMonths = Number(body.usefulLifeMonths ?? 60);
    const purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : new Date();
    const depreciationMethod = body.depreciationMethod === 'declining_balance' ? 'declining_balance' : 'straight_line';

    if (!code || !name || purchaseCost <= 0) {
      throw new BadRequestException('بيانات الأصل غير مكتملة (الكود، الاسم، وتكلفة الشراء مطلوبة).');
    }
    try {
      validateFixedAssetTerms(purchaseCost, salvageValue, usefulLifeMonths);
    } catch {
      throw new BadRequestException('تكلفة الأصل أو قيمة الخردة أو العمر الإنتاجي غير صالح.');
    }
    if (Number.isNaN(purchaseDate.getTime()) || purchaseDate > new Date()) {
      throw new BadRequestException('تاريخ شراء الأصل غير صالح أو يقع في المستقبل.');
    }

    const inserted = await this.db
      .insertInto('fixed_assets')
      .values({
        code,
        name,
        category: body.category || 'general',
        purchase_cost: purchaseCost,
        salvage_value: salvageValue,
        useful_life_months: usefulLifeMonths,
        depreciation_method: depreciationMethod,
        accumulated_depreciation: 0,
        status: 'active',
        purchase_date: purchaseDate,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { ok: true, asset: inserted };
  }

  async depreciateFixedAsset(
    id: number,
    body: { months?: number; note?: string },
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor);
    const posting = this.accountingPosting;
    if (!posting) throw new Error('Accounting posting service is required for depreciation');

    return await this.db.transaction().execute(async (trx) => {
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const asset = await trx
        .selectFrom('fixed_assets')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!asset) {
        throw new BadRequestException('الأصل الثابت غير موجود.');
      }

      if (asset.status === 'retired') {
        throw new BadRequestException('هذا الأصل متقاعد أو مستبعد ولا يمكن إهلاكه.');
      }

      const cost = Number(asset.purchase_cost || 0);
      const salvage = Number(asset.salvage_value || 0);
      const usefulLife = Number(asset.useful_life_months);
      const currentAccumulated = Number(asset.accumulated_depreciation || 0);
      const method = asset.depreciation_method || 'straight_line';
      const months = Number(body.months ?? 1);
      const entryDate = new Date();
      let depreciationAmount: number;
      try {
        depreciationAmount = calculateAssetDepreciation({
          cost,
          salvage,
          usefulLifeMonths: usefulLife,
          accumulated: currentAccumulated,
          purchaseDate: new Date(asset.purchase_date),
          postingDate: entryDate,
          months,
          method,
        });
      } catch {
        throw new BadRequestException('بيانات الأصل أو عدد أشهر الإهلاك أو تاريخ الشراء غير صالح.');
      }

      const depreciableBase = cost - salvage;

      if (depreciationAmount <= 0) {
        throw new BadRequestException('لا يوجد إهلاك مستحق لهذا الأصل حتى تاريخ الترحيل أو وصل إلى قيمة الخردة.');
      }

      const newAccumulated = this.toMoney(currentAccumulated + depreciationAmount, digits);
      const newBookValue = this.toMoney(Math.max(0, cost - newAccumulated), digits);
      const isFullyDepreciated = newAccumulated >= depreciableBase;

      // 1. Resolve Accounts
      const accounts = await this.ensureDepreciationAccounts(trx, scope.tenantId, scope.accountId);

      // Check if already depreciated in the same month to prevent duplicate posting (ZS-056)
      const startOfMonth = new Date(Date.UTC(entryDate.getUTCFullYear(), entryDate.getUTCMonth(), 1));
      const existingInMonth = await trx
        .selectFrom('asset_depreciation_logs')
        .select(['id', 'period_date', 'depreciation_amount'])
        .where('tenant_id', '=', scope.tenantId)
        .where('asset_id', '=', id)
        .where('period_date', '>=', startOfMonth)
        .executeTakeFirst();

      if (existingInMonth) {
        throw new BadRequestException(
          `تم بالفعل إهلاك هذا الأصل خلال هذا الشهر (${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}).`,
        );
      }

      // 2. Insert Balanced Journal Entry (ZS-055)
      const entryDesc = body.note
        ? `إهلاك الأصل ${asset.name} (${asset.code}): ${body.note}`
        : `إهلاك الأصل ${asset.name} (${asset.code}) - ${method === 'declining_balance' ? 'قسط متناقص' : 'قسط ثابت'}`;

      const journalEntryId = await posting.postDomainJournal(trx, {
        sourceType: 'depreciation',
        sourceId: id,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate,
        description: entryDesc,
        createdBy: actor.userId,
        lines: [
          {
            accountId: accounts.deprExpenseAccountId,
            description: `مصروف إهلاك الأصل - ${asset.name}`,
            debit: depreciationAmount,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
          {
            accountId: accounts.accumDeprAccountId,
            description: `مجمع إهلاك الأصل - ${asset.name}`,
            debit: 0,
            credit: depreciationAmount,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
        ],
      });
      // Gapless numbering (INV-JE-NUMBERING-GAP): the number no longer
      // equals the identity id -- read the stored number back instead of
      // deriving it. A missing row here is an internal inconsistency:
      // fail closed rather than reporting a fabricated number.
      const postedEntryNo = await readJournalEntryNo(trx, scope.tenantId, journalEntryId);
      if (!postedEntryNo) throw new Error('Depreciation journal entry number is missing after posting');
      const finalEntryNo = postedEntryNo;

      // 4. Update Fixed Asset Record
      await trx
        .updateTable('fixed_assets')
        .set({
          accumulated_depreciation: newAccumulated,
          status: isFullyDepreciated ? 'fully_depreciated' : 'active',
          updated_at: sql`NOW()`,
        })
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      // 5. Insert Log with Journal Entry ID
      const log = await trx
        .insertInto('asset_depreciation_logs')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          asset_id: id,
          period_date: entryDate,
          depreciation_amount: depreciationAmount,
          accumulated_amount: newAccumulated,
          book_value: newBookValue,
          journal_entry_id: journalEntryId,
          note:
            body.note ||
            (method === 'declining_balance'
              ? `إهلاك دوري لعدد ${months} شهر بطريقة القسط المتناقص`
              : `إهلاك دوري لعدد ${months} شهر بطريقة القسط الثابت`),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        ok: true,
        depreciationAmount,
        accumulatedDepreciation: newAccumulated,
        bookValue: newBookValue,
        isFullyDepreciated,
        journalEntryId,
        entryNo: finalEntryNo,
        log,
      };
    });
  }

  async depreciateAllFixedAssets(
    body: { months?: number; note?: string },
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const activeAssets = await this.db
      .selectFrom('fixed_assets')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'active')
      .execute();

    let processedCount = 0;
    let totalDepreciation = 0;
    const results: any[] = [];

    for (const asset of activeAssets) {
      const cost = Number(asset.purchase_cost || 0);
      const salvage = Number(asset.salvage_value || 0);
      const currentAccum = Number(asset.accumulated_depreciation || 0);
      if (currentAccum >= cost - salvage) {
        continue;
      }
      try {
        const res = await this.depreciateFixedAsset(Number(asset.id), body, actor);
        processedCount++;
        totalDepreciation = this.toMoney(totalDepreciation + Number(res.depreciationAmount || 0), digits);
        results.push({
          id: asset.id,
          name: asset.name,
          code: asset.code,
          amount: res.depreciationAmount,
          entryNo: res.entryNo,
        });
      } catch (e: any) {
        results.push({ id: asset.id, name: asset.name, code: asset.code, error: e?.message || 'Failed' });
      }
    }

    return {
      ok: true,
      processedCount,
      totalDepreciation,
      results,
    };
  }

  async listAssetDepreciationLogs(assetId?: number, actor?: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor!);
    let query = this.db
      .selectFrom('asset_depreciation_logs as l')
      .leftJoin('journal_entries as j', (join) =>
        join.onRef('j.id', '=', 'l.journal_entry_id').onRef('j.tenant_id', '=', 'l.tenant_id'),
      )
      .leftJoin('fixed_assets as a', (join) =>
        join.onRef('a.id', '=', 'l.asset_id').onRef('a.tenant_id', '=', 'l.tenant_id'),
      )
      .select([
        'l.id',
        'l.asset_id',
        'l.period_date',
        'l.depreciation_amount',
        'l.accumulated_amount',
        'l.book_value',
        'l.journal_entry_id',
        'l.note',
        'l.created_at',
        'j.entry_no as journal_entry_no',
        'a.name as asset_name',
        'a.code as asset_code',
      ])
      .where('l.tenant_id', '=', scope.tenantId);

    if (assetId && assetId > 0) {
      query = query.where('l.asset_id', '=', assetId);
    }

    const logs = await query.orderBy('l.created_at', 'desc').execute();
    return { ok: true, logs };
  }

  async deleteFixedAsset(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor);
    const logsCountRow = await this.db
      .selectFrom('asset_depreciation_logs')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('asset_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    const count = Number(logsCountRow?.count || 0);
    if (count > 0) {
      // Mark as retired instead of deleting historical financial audit logs
      await this.db
        .updateTable('fixed_assets')
        .set({ status: 'retired', updated_at: sql`NOW()` })
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      return {
        ok: true,
        retired: true,
        message: 'تم إحالة الأصل إلى التقاعد (الاستبعاد) للاحتفاظ بسجل القيود التاريخية.',
      };
    }

    await this.db.deleteFrom('fixed_assets').where('id', '=', id).where('tenant_id', '=', scope.tenantId).execute();

    return { ok: true, deleted: true };
  }
}
