import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../auth/utils/tenant-boundary';
import { TamperAuditQueryDto } from './dto/tamper-audit.dto';

export interface TamperChainVerificationResult {
  isValid: boolean;
  totalRecords: number;
  verifiedAt: string;
  firstRecordAt: string | null;
  lastRecordAt: string | null;
  genesisHash: string | null;
  latestHash: string | null;
  compromisedRecordId: string | null;
  violationReason: string | null;
}

@Injectable()
export class TamperAuditService {
  private static readonly GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  /**
   * List tamper-evident audit logs with pagination and filters
   */
  async listTamperLogs(auth: AuthContext, query: TamperAuditQueryDto) {
    const scope = requireTenantScope(auth);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const offset = (page - 1) * pageSize;

    let baseQuery = this.db.selectFrom('tamper_audit_logs').where('tenant_id', '=', scope.tenantId);

    if (query.tableName) {
      baseQuery = baseQuery.where('table_name', '=', query.tableName);
    }

    if (query.operation) {
      baseQuery = baseQuery.where('operation', '=', query.operation);
    }

    if (query.recordId) {
      baseQuery = baseQuery.where('record_id', '=', query.recordId);
    }

    if (query.search) {
      const searchPattern = `%${query.search.trim()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('record_id', 'ilike', searchPattern),
          eb('user_username', 'ilike', searchPattern),
          eb('table_name', 'ilike', searchPattern),
          eb('client_ip', 'ilike', searchPattern),
        ]),
      );
    }

    if (query.fromDate) {
      baseQuery = baseQuery.where('created_at', '>=', new Date(query.fromDate));
    }

    if (query.toDate) {
      baseQuery = baseQuery.where('created_at', '<=', new Date(query.toDate));
    }

    // Count query
    const totalRow = await baseQuery.select((eb) => eb.fn.count<string>('id').as('count')).executeTakeFirst();
    const total = Number(totalRow?.count ?? 0);

    // Data query
    const items = await baseQuery.selectAll().orderBy('id', 'desc').limit(pageSize).offset(offset).execute();

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  /**
   * Cryptographic Hash Chain Integrity Verifier
   * Traverses all blocks in chronological order and verifies:
   * 1. Genesis block predecessor hash is standard zero string
   * 2. Every row hash matches SHA-256(prev_hash || tenant || table || record || op || diff || new)
   * 3. Continuity: row[i].prev_hash === row[i-1].row_hash
   */
  async verifyChainIntegrity(auth: AuthContext): Promise<TamperChainVerificationResult> {
    const scope = requireTenantScope(auth);
    const verifiedAt = new Date().toISOString();

    // Query all records for this tenant with DB-level recomputed hash (both UTF8 and bytea)
    const rows = await sql<{
      id: string;
      tenant_id: string;
      table_name: string;
      record_id: string;
      operation: string;
      prev_hash: string | null;
      row_hash: string;
      created_at: Date;
      computed_hash_utf8: string;
      computed_hash_bytea: string;
    }>`
      SELECT 
        id,
        tenant_id,
        table_name,
        record_id,
        operation,
        prev_hash,
        row_hash,
        created_at,
        encode(sha256(convert_to(prev_hash || '|' || tenant_id || '|' || table_name || '|' || record_id || '|' || operation || '|' || COALESCE(changed_fields::text, '') || '|' || COALESCE(new_values::text, ''), 'UTF8')), 'hex') AS computed_hash_utf8,
        encode(sha256((prev_hash || '|' || tenant_id || '|' || table_name || '|' || record_id || '|' || operation || '|' || COALESCE(changed_fields::text, '') || '|' || COALESCE(new_values::text, ''))::bytea), 'hex') AS computed_hash_bytea
      FROM tamper_audit_logs
      WHERE tenant_id = ${scope.tenantId}
      ORDER BY id ASC
    `.execute(this.db);

    const totalRecords = rows.rows.length;

    if (totalRecords === 0) {
      return {
        isValid: true,
        totalRecords: 0,
        verifiedAt,
        firstRecordAt: null,
        lastRecordAt: null,
        genesisHash: null,
        latestHash: null,
        compromisedRecordId: null,
        violationReason: null,
      };
    }

    const firstRecord = rows.rows[0];
    const lastRecord = rows.rows[totalRecords - 1];

    // Partition rows by table_name since the DB trigger partitions hash chains by (tenant_id, table_name) (ZS-019)
    const tablePartitions = new Map<string, typeof rows.rows>();
    for (const row of rows.rows) {
      const list = tablePartitions.get(row.table_name) || [];
      list.push(row);
      tablePartitions.set(row.table_name, list);
    }

    for (const [tableName, tableRows] of tablePartitions) {
      for (let i = 0; i < tableRows.length; i += 1) {
        const current = tableRows[i];

        // 1. Genesis check for the very first record of this table
        if (i === 0) {
          if (current.prev_hash !== TamperAuditService.GENESIS_PREV_HASH) {
            return {
              isValid: false,
              totalRecords,
              verifiedAt,
              firstRecordAt: firstRecord.created_at.toISOString(),
              lastRecordAt: lastRecord.created_at.toISOString(),
              genesisHash: firstRecord.row_hash,
              latestHash: lastRecord.row_hash,
              compromisedRecordId: current.id,
              violationReason: `كتلة البداية (Genesis Block) للسجل #${current.id} في جدول [${tableName}] تحتوي على هاش سابق غير قياسي (${current.prev_hash}).`,
            };
          }
        } else {
          // 2. Chain continuity check: current prev_hash MUST equal previous row_hash within this table
          const previous = tableRows[i - 1];
          if (current.prev_hash !== previous.row_hash) {
            return {
              isValid: false,
              totalRecords,
              verifiedAt,
              firstRecordAt: firstRecord.created_at.toISOString(),
              lastRecordAt: lastRecord.created_at.toISOString(),
              genesisHash: firstRecord.row_hash,
              latestHash: lastRecord.row_hash,
              compromisedRecordId: current.id,
              violationReason: `انقطاع في تسلسل الهاش التشفيري في جدول [${tableName}] بين السجل #${previous.id} والسجل #${current.id}. تم اكتشاف حذف أو تعديل لسجل وسيط.`,
            };
          }
        }

        // 3. Cryptographic row hash verification (supporting UTF8 and bytea - ZS-020)
        const matchesHash =
          current.row_hash === current.computed_hash_utf8 || current.row_hash === current.computed_hash_bytea;
        if (!matchesHash) {
          return {
            isValid: false,
            totalRecords,
            verifiedAt,
            firstRecordAt: firstRecord.created_at.toISOString(),
            lastRecordAt: lastRecord.created_at.toISOString(),
            genesisHash: firstRecord.row_hash,
            latestHash: lastRecord.row_hash,
            compromisedRecordId: current.id,
            violationReason: `تضارب تجزئة التشفير في السجل #${current.id} (الجدول: ${current.table_name}). محتوى السجل لا يطابق بصمته الرقمية المسجلة.`,
          };
        }
      }
    }

    return {
      isValid: true,
      totalRecords,
      verifiedAt,
      firstRecordAt: firstRecord.created_at.toISOString(),
      lastRecordAt: lastRecord.created_at.toISOString(),
      genesisHash: firstRecord.row_hash,
      latestHash: lastRecord.row_hash,
      compromisedRecordId: null,
      violationReason: null,
    };
  }

  /**
   * Get complete historical timeline of modifications for a specific record
   */
  async getRecordTimeline(auth: AuthContext, tableName: string, recordId: string) {
    const scope = requireTenantScope(auth);

    const items = await this.db
      .selectFrom('tamper_audit_logs')
      .where('tenant_id', '=', scope.tenantId)
      .where('table_name', '=', tableName)
      .where('record_id', '=', recordId)
      .selectAll()
      .orderBy('id', 'desc')
      .execute();

    return {
      tableName,
      recordId,
      totalModifications: items.length,
      history: items,
    };
  }
}
