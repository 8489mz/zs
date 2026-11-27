import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';

export class ImportAccountResolversSlice {
  /**
   * Resolves a real tenant account from Chart of Accounts / Accounting Settings.
   * Eliminates hardcoded account IDs (2110, 1110, 5201, 1130, 5101).
   * Follows the "No Silent Skips" architectural invariant.
   */
  async resolveTenantAccount(
    trx: any,
    tenantId: string,
    role:
      | 'cogs'
      | 'inventory'
      | 'payable'
      | 'receivable'
      | 'sales_revenue'
      | 'bank'
      | 'forex_loss'
      | 'forex_gain'
      | 'broker_advance'
      | 'container_deposit'
      | 'customer_advance'
      | 'vat_receivable'
      | 'clearing'
      | 'equity',
    preferredAccountId?: number | null,
  ): Promise<number> {
    const roleExpectedTypes: Record<string, { type: string; label: string }> = {
      bank: { type: 'asset', label: 'الأصول/النقدية والبنك' },
      payable: { type: 'liability', label: 'الخصوم/الموردين' },
      receivable: { type: 'asset', label: 'الأصول المتداولة/العملاء والمدينون' },
      sales_revenue: { type: 'revenue', label: 'الإيرادات/إيرادات المبيعات' },
      inventory: { type: 'asset', label: 'الأصول/المخزون' },
      cogs: { type: 'expense', label: 'المصروفات/تكلفة المبيعات' },
      forex_loss: { type: 'expense', label: 'المصروفات/خسائر فروق العملة' },
      forex_gain: { type: 'revenue', label: 'الإيرادات/أرباح فروق العملة' },
      broker_advance: { type: 'asset', label: 'الأصول المتداولة/عهد المخلصين الجمركيين' },
      container_deposit: { type: 'asset', label: 'الأصول المتداولة/تأمينات الحاويات المستردة' },
      customer_advance: { type: 'liability', label: 'الخصوم المتداولة/دفعات العملاء المقدمة والعربونات' },
      vat_receivable: { type: 'asset', label: 'الأصول المتداولة/ضريبة القيمة المضافة المستردة' },
      equity: { type: 'equity', label: 'حقوق الملكية/رأس مال الشركاء' },
    };

    const roleInfo = roleExpectedTypes[role];

    const accountIsEligible = (account: any): boolean => {
      if (!account || !account.is_active) return false;
      // INV-IMPORT-SUPPLIER-ATTRIBUTION: the clearing/suspense
      // account is tenant-designated only (accounting_settings
      // .clearing_account_id, no COA-code fallback below) and must
      // be a plain asset/liability account: never a flagged control
      // account and never code 1130/2110, because the partner
      // subledger sync reads every line on a flagged or 1130/2110
      // account and throws on a partner-less line — a clearing
      // line is partner-less by definition, so designating a
      // control account as the clearing account must fail closed
      // here, at resolve time, with a clear message.
      if (role === 'clearing') {
        if (['1130', '2110'].includes(account.code)) return false;
        if (account.is_cash_bank || account.is_inventory || account.is_payable || account.is_receivable) return false;
        return account.account_type === 'asset' || account.account_type === 'liability';
      }
      if (role === 'receivable') {
        if (account.is_cash_bank || account.is_inventory || account.is_payable) return false;
        return account.account_type === 'asset' || account.is_receivable === true;
      }
      if (roleInfo && account.account_type !== roleInfo.type) return false;
      if (role === 'bank' && account.is_cash_bank === false) return false;
      if (role === 'inventory' && account.is_inventory === false) return false;
      if (role === 'payable' && account.is_payable === false) return false;
      // Strict Architectural Isolation:
      // customer_advance MUST NOT be a supplier payable account (AP 2110)
      if (role === 'customer_advance') {
        if (account.is_payable === true || account.code === '2110') return false;
      }
      // broker_advance MUST NOT be cash/bank, inventory, or generic current assets
      // INV-IMPORT-BROKER-ADVANCE-ACCOUNT: it must NEVER be the
      // Customers control account either. Live trial phase 2
      // (JE-00015026/JE-00015027) posted a broker custody advance
      // and its settlement through 1130 "العملاء" because the
      // candidate list below started with 1130 and the seeded COA
      // has no 1181/1230 row: the first candidate always won.
      // 1130 is a receivable control account (is_receivable,
      // is_control_account); broker custody is not a customer
      // receivable, and a partner-less broker leg on it pollutes
      // the customer subledger. Reject any receivable account
      // and code 1130 here so even a settings-designated or
      // caller-preferred 1130 fails closed instead of posting.
      if (role === 'broker_advance') {
        if (account.is_cash_bank || account.is_inventory || account.is_payable || account.is_receivable) return false;
        if (['1110', '1120', '1130', '1140', '1100'].includes(account.code)) return false;
      }
      // container_deposit MUST NOT be cash/bank, inventory, or generic current assets
      if (role === 'container_deposit') {
        if (account.is_cash_bank || account.is_inventory || account.is_payable) return false;
        if (['1110', '1120', '1140', '1100'].includes(account.code)) return false;
      }
      return true;
    };

    const accountById = async (id: number) => {
      return await trx
        .selectFrom('accounting_accounts')
        .select([
          'id',
          'account_id',
          'code',
          'account_type',
          'is_active',
          'is_cash_bank',
          'is_inventory',
          'is_payable',
          'is_receivable',
        ])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst();
    };

    if (preferredAccountId !== undefined && preferredAccountId !== null) {
      const id = Number(preferredAccountId);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new BadRequestException('معرف الحساب المحاسبي يجب أن يكون رقمًا صحيحًا موجبًا.');
      }
      const preferred = await accountById(id);
      if (!preferred) {
        throw new BadRequestException(`الحساب المحاسبي المحدد (${id}) غير موجود في دليل حسابات المنشأة.`);
      }
      if (!accountIsEligible(preferred)) {
        throw new BadRequestException(
          `الحساب المحاسبي المحدد (${id}) غير صالح لدور (${role}) أو معطل. راجع نوع الحساب وعلامة وظيفته المحاسبية.`,
        );
      }
      return Number(preferred.id);
    }

    // Fallback 1: Check accounting_settings
    const settings = await trx
      .selectFrom('accounting_settings')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    let settingsAccountId: number | null = null;
    if (settings) {
      if (role === 'cogs') settingsAccountId = settings.cogs_account_id;
      else if (role === 'inventory') settingsAccountId = settings.inventory_account_id;
      else if (role === 'payable') settingsAccountId = settings.supplier_payable_account_id;
      else if (role === 'receivable') settingsAccountId = settings.customer_receivable_account_id;
      else if (role === 'sales_revenue') settingsAccountId = settings.sales_revenue_account_id;
      else if (role === 'clearing') settingsAccountId = settings.clearing_account_id;
      else if (role === 'bank') settingsAccountId = settings.bank_account_id || settings.cash_account_id;
    }

    if (settingsAccountId && Number(settingsAccountId) > 0) {
      const fromSettings = await accountById(Number(settingsAccountId));
      if (fromSettings && accountIsEligible(fromSettings)) {
        return Number(fromSettings.id);
      }
    }

    // Fallback 2: Check candidate COA codes matching the required specific role
    const candidateCodes: Record<string, string[]> = {
      cogs: ['5110', '5101', '5100'],
      inventory: ['1140', '1141', '1200'],
      payable: ['2110'],
      receivable: ['1131', '1125', '1130', '2130'],
      sales_revenue: ['4110', '4100', '4000', '4201'],
      bank: ['1120', '1110'],
      forex_loss: ['5201', '5190'],
      forex_gain: ['4201', '4190'],
      // INV-IMPORT-BROKER-ADVANCE-ACCOUNT: 1130 (Customers) was
      // the first candidate here and always won on a seeded COA,
      // which has no 1181/1230 row — so every broker advance
      // posted Dr 1130 (live JE-00015026/JE-00015027). The broker
      // advance belongs to its own dedicated advance account:
      // 1181 "عهد المخلصين الجمركيين" when the tenant created
      // it, else 1230. With neither present the resolver fails
      // closed with a clear message instead of silently posting
      // a broker advance to the Customers ledger.
      broker_advance: ['1181', '1230'],
      container_deposit: ['1180', '1182', '1240'],
      customer_advance: ['2130', '2120'],
      vat_receivable: ['1160', '1150'],
      // Clearing has NO code fallback: a suspense account is
      // designated explicitly in settings, never guessed from a
      // COA code (INV-IMPORT-SUPPLIER-ATTRIBUTION).
      clearing: [],
      equity: ['3100', '3101', '3200', '3000'],
    };

    const codes = candidateCodes[role] || [];
    for (const code of codes) {
      const byCode = await trx
        .selectFrom('accounting_accounts')
        .select([
          'id',
          'account_id',
          'code',
          'account_type',
          'is_active',
          'is_cash_bank',
          'is_inventory',
          'is_payable',
          'is_receivable',
        ])
        .where('tenant_id', '=', tenantId)
        .where('code', '=', code)
        .executeTakeFirst();
      if (byCode && accountIsEligible(byCode)) {
        return Number(byCode.id);
      }
    }

    // Strict Architectural Policy: Zero arbitrary fallbacks by account_type to prevent account contamination.
    // If no explicit matching account exists in settings or candidate codes, fail loudly.
    throw new UnprocessableEntityException(
      `تعذر تحديد حساب محاسبي نشط ومصنف لدور (${role}) في دليل الحسابات. يرجى تهيئة وتفعيل الحساب المناسب في شجرة الحسابات أو إعدادات المحاسبة أولاً.`,
    );
  }

  /**
   * The set of accounts a READ may attribute to a role: the same
   * acceptance set resolveTenantAccount enforces on posting
   * paths (accounting_settings override, else the candidate COA
   * codes, active, correctly typed and flagged). A read sums
   * over the whole set instead of resolving one id: a missing
   * role account then yields an empty set and a zero component
   * instead of breaking the report — posting paths still fail
   * closed through resolveTenantAccount itself, and a posted
   * line can only sit on an account the posting resolver
   * accepted, so the set can never undercount the ledger.
   */
  async eligibleRoleAccountIds(
    qb: any,
    tenantId: string,
    role: 'cogs' | 'forex_loss' | 'forex_gain' | 'inventory',
  ): Promise<number[]> {
    const roleSpec: Record<
      string,
      { type: string; codes: string[]; settingsKey?: string; requireInventoryFlag?: boolean }
    > = {
      cogs: { type: 'expense', codes: ['5110', '5101', '5100'], settingsKey: 'cogs_account_id' },
      forex_loss: { type: 'expense', codes: ['5201', '5190'] },
      forex_gain: { type: 'revenue', codes: ['4201', '4190'] },
      inventory: {
        type: 'asset',
        codes: ['1140', '1141', '1200'],
        settingsKey: 'inventory_account_id',
        requireInventoryFlag: true,
      },
    };
    const spec = roleSpec[role];
    let settingsId: number | null = null;
    if (spec.settingsKey) {
      const settings: any = await qb
        .selectFrom('accounting_settings')
        .select(spec.settingsKey)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const raw = settings ? Number(settings[spec.settingsKey]) : NaN;
      if (Number.isSafeInteger(raw) && raw > 0) settingsId = raw;
    }
    const rows: any[] = await qb
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .where('account_type', '=', spec.type)
      .$if(spec.requireInventoryFlag === true, (eb: any) => eb.where('is_inventory', '=', true))
      .where((eb: any) =>
        eb.or([...(settingsId !== null ? [eb('id', '=', settingsId)] : []), eb('code', 'in', spec.codes)]),
      )
      .execute();
    return rows.map((r) => Number(r.id)).filter((n) => Number.isSafeInteger(n) && n > 0);
  }
}
