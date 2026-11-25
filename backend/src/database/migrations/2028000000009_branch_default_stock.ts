import { Kysely, sql } from 'kysely';

const NON_OPERATIONAL_TYPES = new Set(['damaged', 'in_transit', 'external_warehouse']);

export const migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .alterTable('branches')
      .addColumn('default_stock_location_id', 'integer', (col) =>
        col.references('stock_locations.id').onDelete('set null'),
      )
      .execute();

    // Read all existing currentLocationId settings (one per tenant+account scope)
    const settingsRows = await db
      .selectFrom('settings')
      .select(['tenant_id', 'account_id', 'value'])
      .where('key', '=', 'currentLocationId')
      .execute();

    // Build a lookup: tenantId|accountId -> locationId
    const settingsLocationMap = new Map<string, number>();
    for (const row of settingsRows) {
      try {
        const parsed = JSON.parse(row.value);
        const locId = Number(parsed);
        if (Number.isFinite(locId) && locId > 0) {
          settingsLocationMap.set(`${row.tenant_id}|${row.account_id}`, locId);
        }
      } catch {
        // ignore malformed
      }
    }

    // Also read currentBranchId settings to know which branch the setting applies to
    const settingsBranchRows = await db
      .selectFrom('settings')
      .select(['tenant_id', 'account_id', 'value'])
      .where('key', '=', 'currentBranchId')
      .execute();

    const settingsBranchMap = new Map<string, number>();
    for (const row of settingsBranchRows) {
      try {
        const parsed = JSON.parse(row.value);
        const branchId = Number(parsed);
        if (Number.isFinite(branchId) && branchId > 0) {
          settingsBranchMap.set(`${row.tenant_id}|${row.account_id}`, branchId);
        }
      } catch {
        // ignore malformed
      }
    }

    const branches = await db.selectFrom('branches').select(['id', 'name', 'tenant_id', 'account_id']).execute();

    for (const branch of branches) {
      const scopeKey = `${branch.tenant_id}|${branch.account_id}`;

      const activeLocations = await db
        .selectFrom('stock_locations')
        .select(['id', 'location_type'])
        .where('branch_id', '=', branch.id)
        .where('is_active', '=', true)
        .execute();

      const operationalLocations = activeLocations.filter((loc) => !NON_OPERATIONAL_TYPES.has(loc.location_type));
      const branchStocks = activeLocations.filter((loc) => loc.location_type === 'branch_stock');

      // Priority 1: currentLocationId from settings — if it belongs to this branch, is active, and is operational
      const settingsBranchId = settingsBranchMap.get(scopeKey);
      const settingsLocId = settingsLocationMap.get(scopeKey);

      if (settingsLocId && settingsBranchId === branch.id) {
        const matchedLoc = operationalLocations.find((loc) => loc.id === settingsLocId);
        if (matchedLoc) {
          await db
            .updateTable('branches')
            .set({ default_stock_location_id: matchedLoc.id })
            .where('id', '=', branch.id)
            .execute();
          continue;
        }
      }

      // Priority 2: exactly 1 branch_stock active
      if (branchStocks.length === 1) {
        await db
          .updateTable('branches')
          .set({ default_stock_location_id: branchStocks[0].id })
          .where('id', '=', branch.id)
          .execute();
        continue;
      }

      // Priority 3: no branch_stock, exactly 1 operational active location
      if (branchStocks.length === 0 && operationalLocations.length === 1) {
        await db
          .updateTable('branches')
          .set({ default_stock_location_id: operationalLocations[0].id })
          .where('id', '=', branch.id)
          .execute();
        continue;
      }

      // Priority 4: no active locations at all → create empty branch_stock, set as default
      if (activeLocations.length === 0) {
        let locationName = branch.name.trim();
        locationName = locationName.startsWith('فرع') ? `مخزون ${locationName}` : `مخزون فرع ${locationName}`;

        const inserted = await db
          .insertInto('stock_locations')
          .values({
            name: locationName,
            code: '',
            branch_id: branch.id,
            location_type: 'branch_stock',
            is_active: true,
            tenant_id: branch.tenant_id,
            account_id: branch.account_id,
          })
          .returning('id')
          .executeTakeFirst();

        if (inserted) {
          await db
            .updateTable('branches')
            .set({ default_stock_location_id: inserted.id })
            .where('id', '=', branch.id)
            .execute();
        }
        continue;
      }

      // Otherwise (>1 branch_stock, or no branch_stock + >1 operational): leave null for manager to choose
    }
  },

  async down(db: Kysely<any>) {
    await db.schema.alterTable('branches').dropColumn('default_stock_location_id').execute();
  },
};
