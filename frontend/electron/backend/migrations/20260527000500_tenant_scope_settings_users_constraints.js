"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migration = void 0;
const kysely_1 = require("kysely");
function demoTenantId() {
    return String(process.env.TENANT_ID || 'default').trim() || 'default';
}
function demoAccountId() {
    return String(process.env.ACCOUNT_ID || demoTenantId()).trim() || demoTenantId();
}
async function tableExists(db, table) {
    const result = await (0, kysely_1.sql) `
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${table}
    ) as exists
  `.execute(db);
    return Boolean(result.rows[0]?.exists);
}
const TABLES = ['settings', 'users', 'user_branches', 'branches', 'stock_locations', 'backup_snapshots'];
exports.migration = {
    async up(db) {
        const tenantId = demoTenantId();
        const accountId = demoAccountId();
        for (const table of TABLES) {
            if (!(await tableExists(db, table)))
                continue;
            await (0, kysely_1.sql) `ALTER TABLE ${kysely_1.sql.table(table)} ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''`.execute(db);
            await (0, kysely_1.sql) `ALTER TABLE ${kysely_1.sql.table(table)} ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT ''`.execute(db);
            await (0, kysely_1.sql) `UPDATE ${kysely_1.sql.table(table)} SET tenant_id = ${tenantId} WHERE tenant_id = ''`.execute(db);
            await (0, kysely_1.sql) `UPDATE ${kysely_1.sql.table(table)} SET account_id = ${accountId} WHERE account_id = ''`.execute(db);
        }
        if (await tableExists(db, 'settings')) {
            await (0, kysely_1.sql) `CREATE UNIQUE INDEX IF NOT EXISTS settings_tenant_key_uidx ON settings (tenant_id, key)`.execute(db);
        }
        if (await tableExists(db, 'users')) {
            await (0, kysely_1.sql) `CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_username_uidx ON users (tenant_id, lower(username))`.execute(db);
        }
        if (await tableExists(db, 'branches')) {
            await (0, kysely_1.sql) `CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_name_uidx ON branches (tenant_id, lower(name)) WHERE is_active = true`.execute(db);
        }
        if (await tableExists(db, 'product_categories')) {
            await (0, kysely_1.sql) `CREATE UNIQUE INDEX IF NOT EXISTS product_categories_tenant_name_uidx ON product_categories (tenant_id, lower(name)) WHERE is_active = true`.execute(db);
        }
        if (await tableExists(db, 'products')) {
            await (0, kysely_1.sql) `CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_barcode_uidx ON products (tenant_id, lower(barcode)) WHERE barcode IS NOT NULL AND barcode <> '' AND is_active = true`.execute(db);
        }
    },
    async down(_db) { },
};
//# sourceMappingURL=20260527000500_tenant_scope_settings_users_constraints.js.map
