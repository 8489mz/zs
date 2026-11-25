import { type Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // 1. Create tamper_audit_logs table
    await sql
      .raw(
        `
      CREATE TABLE IF NOT EXISTS tamper_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        table_name VARCHAR(100) NOT NULL,
        record_id VARCHAR(100) NOT NULL,
        operation VARCHAR(20) NOT NULL,
        old_values JSONB,
        new_values JSONB,
        changed_fields JSONB,
        user_id INT,
        user_username VARCHAR(150),
        db_user VARCHAR(150),
        client_ip VARCHAR(100),
        prev_hash VARCHAR(64),
        row_hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
      )
      .execute(db);

    // 2. Indexes for fast lookup and chronological chain verification
    await sql
      .raw(
        `
      CREATE INDEX IF NOT EXISTS idx_tamper_audit_tenant_table_rec ON tamper_audit_logs(tenant_id, table_name, record_id);
      CREATE INDEX IF NOT EXISTS idx_tamper_audit_tenant_created ON tamper_audit_logs(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tamper_audit_row_hash ON tamper_audit_logs(row_hash);
    `,
      )
      .execute(db);

    // 3. Append-only immutability guard trigger on tamper_audit_logs itself
    await sql
      .raw(
        `
      CREATE OR REPLACE FUNCTION fn_tamper_audit_prevent_tamper()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'سجلات التدقيق الجنائي غير قابلة للتعديل أو الحذف نهائياً (Tamper Audit Trail is strictly immutable and append-only).';
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_tamper_audit_immutable ON tamper_audit_logs;
      CREATE TRIGGER trg_tamper_audit_immutable
      BEFORE UPDATE OR DELETE ON tamper_audit_logs
      FOR EACH ROW EXECUTE FUNCTION fn_tamper_audit_prevent_tamper();
    `,
      )
      .execute(db);

    // 4. Core audit trigger function with cryptographic SHA-256 chaining
    await sql
      .raw(
        `
      CREATE OR REPLACE FUNCTION fn_tamper_evident_audit_trigger()
      RETURNS TRIGGER AS $$
      DECLARE
        v_tenant_id TEXT;
        v_record_id TEXT;
        v_op TEXT;
        v_old_json JSONB := NULL;
        v_new_json JSONB := NULL;
        v_diff_json JSONB := '{}'::jsonb;
        v_user_id INT := NULL;
        v_username TEXT := NULL;
        v_db_user TEXT := CURRENT_USER;
        v_client_ip TEXT := inet_client_addr()::text;
        v_prev_hash TEXT := NULL;
        v_row_hash TEXT;
        v_key TEXT;
        v_val JSONB;
      BEGIN
        v_op := TG_OP;

        IF (v_op = 'INSERT') THEN
          v_new_json := to_jsonb(NEW);
          v_tenant_id := COALESCE(v_new_json->>'tenant_id', 'default');
          v_record_id := COALESCE(v_new_json->>'id', '0');
        ELSIF (v_op = 'DELETE') THEN
          v_old_json := to_jsonb(OLD);
          v_tenant_id := COALESCE(v_old_json->>'tenant_id', 'default');
          v_record_id := COALESCE(v_old_json->>'id', '0');
        ELSIF (v_op = 'UPDATE') THEN
          v_old_json := to_jsonb(OLD);
          v_new_json := to_jsonb(NEW);
          v_tenant_id := COALESCE(v_new_json->>'tenant_id', v_old_json->>'tenant_id', 'default');
          v_record_id := COALESCE(v_new_json->>'id', v_old_json->>'id', '0');

          -- Compute diff of changed keys only
          FOR v_key, v_val IN SELECT key, value FROM jsonb_each(v_new_json)
          LOOP
            IF (v_old_json -> v_key IS DISTINCT FROM v_val) THEN
              v_diff_json := v_diff_json || jsonb_build_object(v_key, jsonb_build_object('old', v_old_json -> v_key, 'new', v_val));
            END IF;
          END LOOP;

          -- If nothing meaningful changed (or only updated_at timestamp)
          IF v_diff_json = '{}'::jsonb OR (v_diff_json ? 'updated_at' AND (SELECT count(*) FROM jsonb_object_keys(v_diff_json)) = 1) THEN
            RETURN NEW;
          END IF;
        END IF;

        -- Extract session user context if set by application, fallback to db user
        BEGIN
          v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::int;
          v_username := NULLIF(current_setting('app.current_username', true), '');
        EXCEPTION WHEN OTHERS THEN
          v_user_id := NULL;
          v_username := NULL;
        END;

        IF v_username IS NULL THEN
          v_username := v_db_user;
        END IF;

        -- Get latest row hash for this tenant (Genesis block if first)
        SELECT row_hash INTO v_prev_hash
        FROM tamper_audit_logs
        WHERE tenant_id = v_tenant_id
        ORDER BY id DESC
        LIMIT 1;

        IF v_prev_hash IS NULL THEN
          v_prev_hash := '0000000000000000000000000000000000000000000000000000000000000000';
        END IF;

        -- Cryptographic SHA-256 Hash Chaining
        v_row_hash := encode(sha256((v_prev_hash || '|' || v_tenant_id || '|' || TG_TABLE_NAME || '|' || v_record_id || '|' || v_op || '|' || COALESCE(v_diff_json::text, '') || '|' || COALESCE(v_new_json::text, '') || '|' || clock_timestamp()::text)::bytea), 'hex');

        INSERT INTO tamper_audit_logs (
          tenant_id,
          table_name,
          record_id,
          operation,
          old_values,
          new_values,
          changed_fields,
          user_id,
          user_username,
          db_user,
          client_ip,
          prev_hash,
          row_hash,
          created_at
        ) VALUES (
          v_tenant_id,
          TG_TABLE_NAME,
          v_record_id,
          v_op,
          v_old_json,
          v_new_json,
          v_diff_json,
          v_user_id,
          v_username,
          v_db_user,
          v_client_ip,
          v_prev_hash,
          v_row_hash,
          CURRENT_TIMESTAMP
        );

        IF (v_op = 'DELETE') THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `,
      )
      .execute(db);

    // 5. Attach trigger to critical financial and operational tables
    const auditedTables = [
      'journal_entries',
      'journal_entry_lines',
      'accounting_accounts',
      'accounting_settings',
      'sales',
      'sale_items',
      'purchases',
      'purchase_items',
      'treasury_transactions',
      'customer_payments',
      'supplier_payments',
    ];

    for (const table of auditedTables) {
      try {
        await sql
          .raw(
            `
          DROP TRIGGER IF EXISTS trg_audit_${table} ON ${table};
          CREATE TRIGGER trg_audit_${table}
          AFTER INSERT OR UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION fn_tamper_evident_audit_trigger();
        `,
          )
          .execute(db);
      } catch (err) {
        // Table might not exist in some environments, continue
      }
    }
  },

  async down(db: Kysely<any>): Promise<void> {
    const auditedTables = [
      'journal_entries',
      'journal_entry_lines',
      'accounting_accounts',
      'accounting_settings',
      'sales',
      'sale_items',
      'purchases',
      'purchase_items',
      'treasury_transactions',
      'customer_payments',
      'supplier_payments',
    ];

    for (const table of auditedTables) {
      try {
        await sql.raw(`DROP TRIGGER IF EXISTS trg_audit_${table} ON ${table};`).execute(db);
      } catch (err) {}
    }

    try {
      await sql.raw(`DROP TRIGGER IF EXISTS trg_tamper_audit_immutable ON tamper_audit_logs;`).execute(db);
      await sql.raw(`DROP FUNCTION IF EXISTS fn_tamper_audit_prevent_tamper();`).execute(db);
      await sql.raw(`DROP FUNCTION IF EXISTS fn_tamper_evident_audit_trigger();`).execute(db);
      await sql.raw(`DROP TABLE IF EXISTS tamper_audit_logs;`).execute(db);
    } catch (err) {}
  },
};
