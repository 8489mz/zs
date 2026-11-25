import { Kysely, sql } from 'kysely';

/**
 * Migration 2040000000208: Tamper Audit Hash Bytea Conversion Fix
 *
 * Replaces unsafe text-to-bytea cast `(text_expr)::bytea` with `convert_to(text_expr, 'UTF8')`
 * inside `fn_tamper_evident_audit_trigger`.
 * The direct `::bytea` cast fails with `22P02: invalid input syntax for type bytea`
 * when rows contain escape sequences, XML strings (e.g. zatca_ubl_xml), or backslashes.
 */
export async function up(db: Kysely<any>): Promise<void> {
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
      v_now TIMESTAMPTZ := clock_timestamp();
      v_key TEXT;
      v_val JSONB;
    BEGIN
      v_op := TG_OP;

      -- If session is in tenant purge mode, bypass audit recording
      IF current_setting('app.allow_tenant_purge', true) = 'on' THEN
        IF (v_op = 'DELETE') THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END IF;

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

      -- Concurrency & Zero-Forking Guarantee:
      -- Acquire a transaction-level advisory lock partitioned by tenant and table.
      PERFORM pg_advisory_xact_lock(hashtext(v_tenant_id || ':' || TG_TABLE_NAME));

      -- Get latest row hash for this tenant + table chain partition (Genesis block if first)
      SELECT row_hash INTO v_prev_hash
      FROM tamper_audit_logs
      WHERE tenant_id = v_tenant_id AND table_name = TG_TABLE_NAME
      ORDER BY id DESC
      LIMIT 1;

      IF v_prev_hash IS NULL THEN
        v_prev_hash := '0000000000000000000000000000000000000000000000000000000000000000';
      END IF;

      -- Cryptographic SHA-256 Hash Chaining using safe convert_to(..., 'UTF8')
      v_row_hash := encode(sha256(convert_to(v_prev_hash || '|' || v_tenant_id || '|' || TG_TABLE_NAME || '|' || v_record_id || '|' || v_op || '|' || COALESCE(v_diff_json::text, '') || '|' || COALESCE(v_new_json::text, ''), 'UTF8')), 'hex');

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
        v_now
      );

      IF (v_op = 'DELETE') THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `,
    )
    .execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Retain UTF8 conversion for integrity
}
