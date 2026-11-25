import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // ────────────────────────────────────────────────────────────────────────────
    // Step 1: Build a temp table of all rows that are missing a valid account_id.
    //         We resolve the correct account_id from the products table using the
    //         same tenant_id + product_id pair.
    // ────────────────────────────────────────────────────────────────────────────
    await sql`
    CREATE TEMP TABLE pls_to_fix AS
    SELECT
      pls.id            AS invalid_id,
      pls.tenant_id,
      pls.product_id,
      pls.location_id,
      pls.qty           AS invalid_qty,
      p.account_id      AS correct_account_id
    FROM product_location_stock pls
    JOIN products p
      ON p.id = pls.product_id
     AND p.tenant_id = pls.tenant_id
    WHERE pls.account_id IS NULL
       OR BTRIM(pls.account_id) = '';
  `.execute(db);

    // ────────────────────────────────────────────────────────────────────────────
    // Step 2a: Safe merges — invalid row has qty=0.
    //           The valid row already holds the real stock; we simply delete the
    //           zero-qty phantom.  No data is lost or doubled.
    // ────────────────────────────────────────────────────────────────────────────
    await sql`
    CREATE TEMP TABLE pls_safe_merge AS
    SELECT
      f.invalid_id,
      valid_pls.id AS valid_id
    FROM pls_to_fix f
    JOIN product_location_stock valid_pls
      ON  valid_pls.product_id  = f.product_id
      AND valid_pls.location_id IS NOT DISTINCT FROM f.location_id
      AND valid_pls.tenant_id   = f.tenant_id
      AND valid_pls.account_id  = f.correct_account_id
    WHERE f.invalid_qty = 0;
  `.execute(db);

    // ────────────────────────────────────────────────────────────────────────────
    // Step 2b: Dangerous collisions — BOTH rows carry positive qty.
    //           We cannot safely decide whether to sum or discard, so we abort.
    // ────────────────────────────────────────────────────────────────────────────
    await sql`
    CREATE TEMP TABLE pls_dangerous_collisions AS
    SELECT
      f.invalid_id,
      f.tenant_id,
      f.correct_account_id  AS account_id,
      f.product_id,
      f.location_id,
      f.invalid_qty,
      valid_pls.id          AS valid_id,
      valid_pls.qty         AS valid_qty
    FROM pls_to_fix f
    JOIN product_location_stock valid_pls
      ON  valid_pls.product_id  = f.product_id
      AND valid_pls.location_id IS NOT DISTINCT FROM f.location_id
      AND valid_pls.tenant_id   = f.tenant_id
      AND valid_pls.account_id  = f.correct_account_id
    WHERE f.invalid_qty > 0;
  `.execute(db);

    // Check for dangerous collisions and raise an error if any exist.
    const dangerousCount = await sql<{ count: string }>`
    SELECT COUNT(*)::text AS count FROM pls_dangerous_collisions;
  `.execute(db);

    const count = Number(dangerousCount.rows[0]?.count ?? 0);
    if (count > 0) {
      const details = await sql<{
        invalid_id: string;
        tenant_id: string;
        account_id: string;
        product_id: string;
        location_id: string;
        invalid_qty: string;
        valid_id: string;
        valid_qty: string;
      }>`
      SELECT invalid_id, tenant_id, account_id, product_id, location_id,
             invalid_qty, valid_id, valid_qty
      FROM pls_dangerous_collisions
      LIMIT 20;
    `.execute(db);

      // Clean up before throwing
      await sql`
      DROP TABLE IF EXISTS pls_dangerous_collisions;
      DROP TABLE IF EXISTS pls_safe_merge;
      DROP TABLE IF EXISTS pls_to_fix;
    `.execute(db);

      throw new Error(
        `[MIGRATION ABORTED] Found ${count} dangerous product_location_stock collision(s) ` +
          `where BOTH the invalid (null-account_id) row and the valid row carry positive qty. ` +
          `Cannot auto-merge without risking stock doubling.\n` +
          `First up-to-20 collisions:\n` +
          JSON.stringify(details.rows, null, 2),
      );
    }

    // ────────────────────────────────────────────────────────────────────────────
    // Step 3: Delete the zero-qty phantom rows that have a safe valid counterpart.
    // ────────────────────────────────────────────────────────────────────────────
    await sql`
    DELETE FROM product_location_stock
    WHERE id IN (SELECT invalid_id FROM pls_safe_merge);
  `.execute(db);

    // ────────────────────────────────────────────────────────────────────────────
    // Step 4: Backfill account_id on remaining invalid rows (no collision exists).
    //         Scoped by tenant_id + product_id to ensure per-account correctness.
    // ────────────────────────────────────────────────────────────────────────────
    await sql`
    UPDATE product_location_stock pls
    SET    account_id = p.account_id
    FROM   products p
    WHERE  pls.product_id = p.id
      AND  pls.tenant_id  = p.tenant_id
      AND  (pls.account_id IS NULL OR BTRIM(pls.account_id) = '');
  `.execute(db);

    // ────────────────────────────────────────────────────────────────────────────
    // Step 5: Identify accounts that have EXACTLY ONE saleable operational location.
    //         Eligible location rules (mirrors POS Catalog logic):
    //           - is_active = true
    //           - location_type NOT IN ('damaged', 'in_transit')
    //           - If external_warehouse: branch must have allow_external_sales_stock = true
    //         Scoped by tenant_id + account_id.
    // ────────────────────────────────────────────────────────────────────────────
    await sql`
    CREATE TEMP TABLE single_location_accounts AS
    SELECT
      l.tenant_id,
      l.account_id,
      MIN(l.id)        AS single_location_id,
      MIN(l.branch_id) AS single_branch_id
    FROM   stock_locations l
    LEFT   JOIN branches b ON b.id = l.branch_id
    WHERE  l.is_active = true
      AND  l.location_type NOT IN ('damaged', 'in_transit')
      AND  (
        l.location_type != 'external_warehouse'
        OR b.allow_external_sales_stock = true
      )
    GROUP  BY l.tenant_id, l.account_id
    HAVING COUNT(*) = 1;
  `.execute(db);

    // ────────────────────────────────────────────────────────────────────────────
    // Step 6: Find products that have global stock > 0 but ZERO location-stock rows.
    //         These are candidates for reconciliation into the single eligible location.
    //         Scoped by tenant_id + account_id throughout.
    // ────────────────────────────────────────────────────────────────────────────
    await sql`
    CREATE TEMP TABLE products_to_reconcile AS
    SELECT
      p.id          AS product_id,
      p.tenant_id,
      p.account_id,
      p.stock_qty,
      sla.single_location_id,
      sla.single_branch_id,
      COALESCE(SUM(pls.qty), 0) AS current_location_qty
    FROM   products p
    JOIN   single_location_accounts sla
             ON  p.tenant_id  = sla.tenant_id
             AND p.account_id = sla.account_id
    LEFT   JOIN product_location_stock pls
             ON  pls.product_id  = p.id
             AND pls.tenant_id   = p.tenant_id
             AND pls.account_id  = p.account_id
    WHERE  p.is_active = true
      AND  p.stock_qty > 0
    GROUP  BY p.id, p.tenant_id, p.account_id, p.stock_qty,
              sla.single_location_id, sla.single_branch_id
    HAVING COALESCE(SUM(pls.qty), 0) = 0;
  `.execute(db);

    // ────────────────────────────────────────────────────────────────────────────
    // Step 7: Reconcile — update existing zero-qty row if present, else insert.
    // ────────────────────────────────────────────────────────────────────────────
    await sql`
    UPDATE product_location_stock pls
    SET    qty = p.stock_qty
    FROM   products_to_reconcile p
    WHERE  pls.product_id  = p.product_id
      AND  pls.location_id = p.single_location_id
      AND  pls.tenant_id   = p.tenant_id
      AND  pls.account_id  = p.account_id;
  `.execute(db);

    await sql`
    INSERT INTO product_location_stock
      (product_id, location_id, branch_id, qty, tenant_id, account_id)
    SELECT
      p.product_id,
      p.single_location_id,
      p.single_branch_id,
      p.stock_qty,
      p.tenant_id,
      p.account_id
    FROM   products_to_reconcile p
    WHERE  NOT EXISTS (
      SELECT 1
      FROM   product_location_stock pls
      WHERE  pls.product_id  = p.product_id
        AND  pls.location_id = p.single_location_id
        AND  pls.tenant_id   = p.tenant_id
        AND  pls.account_id  = p.account_id
    );
  `.execute(db);

    // ────────────────────────────────────────────────────────────────────────────
    // Step 8: Enforce NOT NULL + non-empty CHECK constraint on account_id.
    // ────────────────────────────────────────────────────────────────────────────
    await sql`
    ALTER TABLE product_location_stock
    ALTER COLUMN account_id SET NOT NULL;
  `.execute(db);

    await sql`
    ALTER TABLE product_location_stock
    ADD CONSTRAINT chk_product_location_stock_account_id_not_empty
    CHECK (BTRIM(account_id) != '');
  `.execute(db);

    // Cleanup temp tables
    await sql`
    DROP TABLE IF EXISTS products_to_reconcile;
    DROP TABLE IF EXISTS single_location_accounts;
    DROP TABLE IF EXISTS pls_dangerous_collisions;
    DROP TABLE IF EXISTS pls_safe_merge;
    DROP TABLE IF EXISTS pls_to_fix;
  `.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`
      ALTER TABLE product_location_stock
      DROP CONSTRAINT IF EXISTS chk_product_location_stock_account_id_not_empty;

      ALTER TABLE product_location_stock
      ALTER COLUMN account_id DROP NOT NULL;
    `.execute(db);
  },
};
