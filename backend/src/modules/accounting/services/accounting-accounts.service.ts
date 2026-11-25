import { assertHierarchyParent } from '../accounting-boundaries';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { CreateAccountDto, UpdateAccountDto } from '../dto/accounting.dto';
import { lockAccountingPeriod } from '../accounting-period-lock';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';

/**
 * AccountingAccountsService — slice S3 of the accounting split.
 * Pure move of 5 methods from AccountingService (accounts CRUD +
 * code generation + the accounts list). No behavior change: the
 * bodies are byte-identical except for 16 pre-existing trailing-
 * whitespace blank lines, normalized to empty lines (see below);
 * the facade keeps thin delegates with the same names and
 * signatures. This slice calls the facade's kernel helpers only
 * (assertAccountingAccess, orientAccountBalance, tenantPredicate)
 * through bound deps — it never imports another slice service and
 * it does not post journals (no accountingPosting dep).
 * Trailing whitespace: the pristine file carries 16 blank lines
 * with indentation spaces inside generateNextAccountCode (7) and
 * deleteAccount (9); moving them byte-identically would fail
 * `git diff --check` on the patch, so the slice normalizes them
 * to empty lines. The verify script proves these 16 are the only
 * differing lines (WS-normalized byte-identity).
 */

export interface AccountingAccountsDeps {
  db: Kysely<Database>;
  accountingTenantFoundation: AccountingTenantFoundationService;
  // Bound kernel helpers (stay in the facade; passed bound so the moved
  // bodies stay byte-identical).
  assertAccountingAccess: (auth: AuthContext) => void;
  orientAccountBalance: (normalBalance: string, totals?: { debit: number; credit: number }) => number;
  tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
}

@Injectable()
export class AccountingAccountsService {
  private readonly db: Kysely<Database>;
  private readonly accountingTenantFoundation: AccountingTenantFoundationService;
  private readonly assertAccountingAccess: (auth: AuthContext) => void;
  private readonly orientAccountBalance: (normalBalance: string, totals?: { debit: number; credit: number }) => number;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;

  constructor(deps: AccountingAccountsDeps) {
    this.db = deps.db;
    this.accountingTenantFoundation = deps.accountingTenantFoundation;
    this.assertAccountingAccess = deps.assertAccountingAccess;
    this.orientAccountBalance = deps.orientAccountBalance;
    this.tenantPredicate = deps.tenantPredicate;
  }

  async listAccounts(auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);
    const rows = await this.db
      .selectFrom('accounting_accounts')
      .select([
        'id',
        'code',
        'name_ar',
        'name_en',
        'account_type',
        'account_group',
        'parent_id',
        'normal_balance',
        'is_active',
        'is_system',
        'allow_manual_entries',
        'is_control_account',
        'is_cash_bank',
        'is_receivable',
        'is_payable',
        'is_inventory',
        'is_tax',
        'is_monetary',
        'revaluation_currency',
        'sort_order',
      ])
      .where(this.tenantPredicate(auth))
      .orderBy('code', 'asc')
      .execute();

    // Posted-lines balances, one query for all accounts: a draft or
    // cancelled entry never moves a balance, so only 'posted' lines count.
    const balanceRows = await this.db
      .selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as je', (join: any) =>
        join.onRef('je.id', '=', 'l.journal_entry_id').onRef('je.tenant_id', '=', 'l.tenant_id'),
      )
      .select([
        'l.account_id as account_id',
        sql<number>`COALESCE(SUM(l.debit), 0)`.as('debit'),
        sql<number>`COALESCE(SUM(l.credit), 0)`.as('credit'),
      ])
      .where('je.status', '=', 'posted')
      .where(this.tenantPredicate(auth, 'je'))
      .where(this.tenantPredicate(auth, 'l'))
      .groupBy('l.account_id')
      .execute();
    const balanceByAccountId = new Map<number, { debit: number; credit: number }>(
      balanceRows.map((row) => [
        Number(row.account_id),
        { debit: Number(row.debit || 0), credit: Number(row.credit || 0) },
      ]),
    );

    const rowsById = new Map(rows.map((row) => [String(row.id), row]));
    const depthById = new Map<string, number>();
    const visiting = new Set<string>();
    const computeDepth = (id: string): number => {
      const cached = depthById.get(id);
      if (typeof cached === 'number') return cached;
      if (visiting.has(id)) throw new BadRequestException('توجد دورة في دليل الحسابات؛ يلزم تصحيح الروابط.');
      visiting.add(id);
      const row = rowsById.get(id);
      if (!row || !row.parent_id) {
        depthById.set(id, 0);
        return 0;
      }
      const parentDepth = computeDepth(String(row.parent_id));
      const depth = parentDepth + 1;
      visiting.delete(id);
      depthById.set(id, depth);
      return depth;
    };
    for (const row of rows) {
      computeDepth(String(row.id));
    }

    return {
      accounts: rows.map((row) => ({
        id: String(row.id),
        code: row.code,
        nameAr: row.name_ar,
        nameEn: row.name_en || '',
        accountType: row.account_type,
        accountGroup: row.account_group || '',
        parentId: row.parent_id ? String(row.parent_id) : '',
        depth: depthById.get(String(row.id)) || 0,
        normalBalance: row.normal_balance,
        balance: this.orientAccountBalance(row.normal_balance, balanceByAccountId.get(Number(row.id))),
        isActive: Boolean(row.is_active),
        isSystem: Boolean(row.is_system),
        allowManualEntries: Boolean(row.allow_manual_entries),
        isControlAccount: Boolean(row.is_control_account),
        isMonetary: Boolean(row.is_monetary),
        revaluationCurrency: row.revaluation_currency || null,
        flags: {
          isCashBank: Boolean(row.is_cash_bank),
          isReceivable: Boolean(row.is_receivable),
          isPayable: Boolean(row.is_payable),
          isInventory: Boolean(row.is_inventory),
          isTax: Boolean(row.is_tax),
        },
        sortOrder: Number(row.sort_order || 0),
      })),
    };
  }

  async generateNextAccountCode(parentId: number, auth: AuthContext): Promise<{ code: string }> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);

    const parent = await this.db
      .selectFrom('accounting_accounts')
      .select(['code'])
      .where('id', '=', parentId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!parent) throw new NotFoundException('Parent account not found');

    const children = await this.db
      .selectFrom('accounting_accounts')
      .select(['code'])
      .where('parent_id', '=', parentId)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    if (children.length === 0) {
      const num = parseInt(parent.code, 10);
      if (!isNaN(num)) {
        return { code: String(num + 1) };
      }
      return { code: parent.code + '01' };
    }

    let maxNum = -1;
    let maxCode = '';
    for (const child of children) {
      const num = parseInt(child.code, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
        maxCode = child.code;
      }
    }

    if (maxNum !== -1) {
      return { code: String(maxNum + 1) };
    }

    return { code: parent.code + '01' };
  }

  async createAccount(dto: CreateAccountDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      await assertHierarchyParent(
        trx,
        'accounting_accounts',
        scope.tenantId,
        null,
        dto.parentId == null ? null : Number(dto.parentId),
      );

      const existing = await trx
        .selectFrom('accounting_accounts')
        .select('id')
        .where('code', '=', dto.code)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (existing) throw new BadRequestException('Account code already exists');

      const parentId = dto.parentId || null;
      let normalBalance = dto.normalBalance;

      if (parentId) {
        const parent = await trx
          .selectFrom('accounting_accounts')
          .select(['id', 'normal_balance'])
          .where('id', '=', parentId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        if (!parent) throw new BadRequestException('Parent account not found');
        normalBalance = parent.normal_balance;
      }

      const result = await trx
        .insertInto('accounting_accounts')
        .values({
          tenant_id: scope.tenantId,
          // INV-ACCOUNT-CREATE-ACCOUNT-ID: account_id is TEXT NOT NULL with
          // no default (tenant-scope migration 20260531000200), so omitting
          // it failed every account creation with 23502. Same scope the
          // rest of this module already stores.
          account_id: scope.accountId,
          code: dto.code,
          name_ar: dto.nameAr,
          name_en: dto.nameEn || '',
          account_type: dto.accountType as any,
          account_group: '',
          parent_id: parentId,
          normal_balance: normalBalance as any,
          is_active: dto.isActive ?? true,
          is_system: false,
          allow_manual_entries: true,
          is_control_account: false,
          is_cash_bank: false,
          is_receivable: false,
          is_payable: false,
          is_inventory: false,
          is_tax: false,
          description_ar: '',
          sort_order: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return { ok: true, accountId: String(result.id) };
    });
  }

  async updateAccount(id: number, dto: UpdateAccountDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      await assertHierarchyParent(
        trx,
        'accounting_accounts',
        scope.tenantId,
        id,
        dto.parentId == null ? null : Number(dto.parentId),
      );

      const existing = await trx
        .selectFrom('accounting_accounts')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();

      if (!existing) throw new NotFoundException('Account not found');

      if (dto.code && dto.code !== existing.code) {
        const codeCheck = await trx
          .selectFrom('accounting_accounts')
          .select('id')
          .where('code', '=', dto.code)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        if (codeCheck) throw new BadRequestException('Account code already exists');
      }

      const hasTransactions = await trx
        .selectFrom('journal_entry_lines')
        .select('id')
        .where('account_id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .limit(1)
        .executeTakeFirst();

      const updateData: any = {};

      if (existing.is_system) {
        if (dto.nameAr) updateData.name_ar = dto.nameAr;
        if (dto.nameEn !== undefined) updateData.name_en = dto.nameEn;
      } else {
        if (dto.nameAr) updateData.name_ar = dto.nameAr;
        if (dto.nameEn !== undefined) updateData.name_en = dto.nameEn;
        if (dto.isActive !== undefined) updateData.is_active = dto.isActive;

        if (hasTransactions) {
          if (dto.code) updateData.code = dto.code;
        } else {
          if (dto.code) updateData.code = dto.code;
          if (dto.accountType) updateData.account_type = dto.accountType;
          if (dto.normalBalance) updateData.normal_balance = dto.normalBalance;
          if (dto.parentId !== undefined) {
            updateData.parent_id = dto.parentId;
            if (dto.parentId) {
              const parent = await trx
                .selectFrom('accounting_accounts')
                .select('normal_balance')
                .where('id', '=', dto.parentId)
                .where('tenant_id', '=', scope.tenantId)
                .executeTakeFirst();
              if (parent) updateData.normal_balance = parent.normal_balance;
            }
          }
        }
      }

      // IAS 21 monetary/revaluation-currency metadata (O1): safe to change regardless of
      // is_system or transaction history — it never touches identity or posted balances,
      // only which accounts forex-revaluation.previewRevaluation() picks up.
      if (dto.isMonetary !== undefined) {
        if (dto.isMonetary && !['asset', 'liability'].includes(existing.account_type)) {
          throw new BadRequestException('إعادة تقييم العملة متاحة للحسابات النقدية من نوع أصل أو التزام فقط.');
        }
        updateData.is_monetary = dto.isMonetary;
        if (!dto.isMonetary) {
          // A non-monetary account can never legitimately carry a revaluation currency.
          updateData.revaluation_currency = null;
        }
      }
      if (dto.revaluationCurrency !== undefined) {
        const cleanCurrency =
          String(dto.revaluationCurrency || '')
            .trim()
            .toUpperCase() || null;
        const willBeMonetary = dto.isMonetary !== undefined ? dto.isMonetary : Boolean(existing.is_monetary);
        if (cleanCurrency && !willBeMonetary) {
          throw new BadRequestException('لا يمكن تحديد عملة إعادة التقييم لحساب غير نقدي (is_monetary = false)');
        }
        if (cleanCurrency && !/^[A-Z]{3}$/.test(cleanCurrency)) {
          throw new BadRequestException('رمز عملة إعادة التقييم يجب أن يتكون من ثلاثة أحرف.');
        }
        updateData.revaluation_currency = cleanCurrency;
      }

      if (Object.keys(updateData).length > 0) {
        await trx
          .updateTable('accounting_accounts')
          .set({ ...updateData, updated_at: sql`NOW()` })
          .where('id', '=', id)
          .where('tenant_id', '=', scope.tenantId)
          .execute();
      }

      return { ok: true };
    });
  }

  async deleteAccount(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);

    const existing = await this.db
      .selectFrom('accounting_accounts')
      .select(['is_system'])
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!existing) throw new NotFoundException('Account not found');

    if (existing.is_system) {
      throw new BadRequestException('لا يمكن حذف الحسابات النظامية الأساسية.');
    }

    const hasTransactions = await this.db
      .selectFrom('journal_entry_lines')
      .select('id')
      .where('account_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .limit(1)
      .executeTakeFirst();

    if (hasTransactions) {
      throw new BadRequestException('لا يمكن حذف حساب تمت عليه قيود محاسبية، يمكنك إيقافه بدلاً من ذلك.');
    }

    const hasChildren = await this.db
      .selectFrom('accounting_accounts')
      .select('id')
      .where('parent_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .limit(1)
      .executeTakeFirst();

    if (hasChildren) {
      throw new BadRequestException('لا يمكن حذف حساب يحتوي على حسابات فرعية.');
    }

    await this.db
      .deleteFrom('accounting_accounts')
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    return { ok: true };
  }
}
