import { type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // Use a try-catch for addColumn because it might already exist locally
    try {
      await db.schema
        .alterTable('accounting_settings')
        .addColumn('manufacturing_overhead_account_id', 'integer', (col) =>
          col.references('accounting_accounts.id').onDelete('restrict'),
        )
        .execute();
    } catch (e) {
      // Ignore if column already exists in dev
    }

    const settings = await db.selectFrom('accounting_settings').select(['tenant_id', 'account_id']).execute();
    if (!settings.find((s) => s.tenant_id === 'default')) {
      settings.push({ tenant_id: 'default', account_id: 'default' } as any);
    }

    for (const setting of settings) {
      const { tenant_id, account_id } = setting;

      const existing = await db
        .selectFrom('accounting_accounts')
        .select('id')
        .where('code', '=', '5400')
        .where('tenant_id', '=', tenant_id)
        .executeTakeFirst();
      let overheadAccountId = existing?.id;

      if (!overheadAccountId) {
        const parent = await db
          .selectFrom('accounting_accounts')
          .select('id')
          .where('code', '=', '5000')
          .where('tenant_id', '=', tenant_id)
          .executeTakeFirst();

        const inserted = await db
          .insertInto('accounting_accounts')
          .values([
            {
              tenant_id,
              account_id,
              code: '5400',
              name_ar: 'تحميل التكاليف الصناعية',
              name_en: 'Manufacturing Overhead Clearing',
              account_type: 'expense',
              normal_balance: 'credit',
              parent_id: parent?.id || null,
              account_group: 'cogs',
              allow_manual_entries: true,
              is_control_account: false,
              is_cash_bank: false,
              is_receivable: false,
              is_payable: false,
              is_inventory: false,
              is_tax: false,
              is_active: true,
            },
          ])
          .returning('id')
          .executeTakeFirst();

        overheadAccountId = inserted?.id;
      }

      if (overheadAccountId) {
        await db
          .updateTable('accounting_settings')
          .set({ manufacturing_overhead_account_id: overheadAccountId })
          .where('tenant_id', '=', tenant_id)
          .execute();
      }
    }
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('accounting_settings').dropColumn('manufacturing_overhead_account_id').execute();
  },
};
