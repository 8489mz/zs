import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // 1. Create saas_plans table
    await db.schema
      .createTable('saas_plans')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('code', 'varchar(50)', (col) => col.unique().notNull())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('price', 'numeric(15, 2)', (col) => col.notNull())
      .addColumn('currency', 'varchar(10)', (col) => col.notNull().defaultTo('EGP'))
      .addColumn('billing_period_months', 'integer', (col) => col.notNull().defaultTo(1))
      .addColumn('max_users', 'integer')
      .addColumn('max_branches', 'integer')
      .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // 2. Create tenant_subscriptions table
    await db.schema
      .createTable('tenant_subscriptions')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(50)', (col) => col.notNull().references('tenants.id'))
      .addColumn('plan_id', 'integer', (col) => col.notNull().references('saas_plans.id'))
      .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active')) // active, past_due, expired, cancelled
      .addColumn('starts_at', 'timestamp', (col) => col.notNull())
      .addColumn('ends_at', 'timestamp', (col) => col.notNull())
      .addColumn('grace_ends_at', 'timestamp')
      .addColumn('auto_renew', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // 3. Create tenant_subscription_payments table
    await db.schema
      .createTable('tenant_subscription_payments')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(50)', (col) => col.notNull().references('tenants.id'))
      .addColumn('subscription_id', 'integer', (col) => col.notNull().references('tenant_subscriptions.id'))
      .addColumn('amount', 'numeric(15, 2)', (col) => col.notNull())
      .addColumn('currency', 'varchar(10)', (col) => col.notNull().defaultTo('EGP'))
      .addColumn('method', 'varchar(50)', (col) => col.notNull().defaultTo('manual'))
      .addColumn('reference', 'varchar(255)')
      .addColumn('paid_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('notes', 'text')
      .addColumn('created_by', 'integer', (col) => col.references('users.id'))
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Insert default basic plan
    const planResult = await db
      .insertInto('saas_plans')
      .values({
        code: 'basic',
        name: 'Basic',
        price: 0,
        currency: 'EGP',
        billing_period_months: 1,
        is_active: true,
      })
      .returning('id')
      .executeTakeFirst();

    if (planResult && planResult.id) {
      const planId = planResult.id;

      // Fetch all active tenants
      const activeTenants = await db
        .selectFrom('tenants')
        .select(['id', 'status'])
        .where('status', '=', 'active')
        .execute();

      if (activeTenants.length > 0) {
        // For each active tenant, create a lifetime subscription (ends_at 10 years in the future)
        const now = new Date();
        const tenYearsFromNow = new Date(now);
        tenYearsFromNow.setFullYear(tenYearsFromNow.getFullYear() + 10);
        const graceEndsAt = new Date(tenYearsFromNow);
        graceEndsAt.setDate(graceEndsAt.getDate() + 7);

        const subscriptionValues = activeTenants.map((tenant) => ({
          tenant_id: tenant.id,
          plan_id: planId,
          status: 'active',
          starts_at: now,
          ends_at: tenYearsFromNow,
          grace_ends_at: graceEndsAt,
          auto_renew: false,
        }));

        await db.insertInto('tenant_subscriptions').values(subscriptionValues).execute();
      }
    }
  },

  async down(db: Kysely<any>): Promise<void> {
    // Do nothing. Non-destructive.
  },
};
