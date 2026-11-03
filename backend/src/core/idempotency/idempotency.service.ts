import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from '../../database/database.types';
import { KYSELY_DB } from '../../database/database.constants';
import { AppError } from '../../common/errors/app-error';
import * as crypto from 'crypto';

export interface IdempotencyReservation {
  tenantId: string;
  accountId: string;
  idempotencyKey: string;
  operationType: string;
  requestHash: string;
}

export interface IdempotencyResult {
  status: 'processing' | 'committed' | 'failed' | 'recovery_required';
  responsePayload?: any;
  errorCode?: string;
  documentId?: string;
}

/** A 'processing' row older than this is treated as stuck and escalates to recovery_required. */
export const IDEMPOTENCY_STUCK_PROCESSING_MS = 60000;

/** Terminal rows are pruned only once they are at least this old (D5 decision). */
export const IDEMPOTENCY_PRUNE_RETENTION_DAYS = 30;

export interface IdempotencyReviewItem {
  idempotencyKey: string;
  operationType: string;
  /** Effective status: both classes below need manual recovery; nothing here auto-retries. */
  status: 'recovery_required';
  errorCode: string | null;
  documentId: string | null;
  updatedAt: Date;
}

@Injectable()
export class IdempotencyService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  /**
   * Generates a deterministic hash of the payload, including path parameters and ignoring volatile fields.
   */
  generateRequestHash(payload: any, pathParams?: any): string {
    const cleanPayload = this.stripVolatileFields(payload || {});
    const cleanParams = pathParams && typeof pathParams === 'object' && Object.keys(pathParams).length > 0
      ? this.sortKeysRecursively(pathParams)
      : undefined;

    const dataToHash = cleanParams ? { body: cleanPayload, params: cleanParams } : cleanPayload;
    // Sort keys recursively for deterministic serialization regardless of insertion order
    const serialized = JSON.stringify(this.sortKeysRecursively(dataToHash)) || '{}';
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  private sortKeysRecursively(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.sortKeysRecursively(item));
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = this.sortKeysRecursively(obj[key]);
    }
    return sorted;
  }

  private stripVolatileFields(payload: any): any {
    if (!payload || typeof payload !== 'object') return payload;
    if (Array.isArray(payload)) return payload.map(item => this.stripVolatileFields(item));

    const clone = { ...payload };
    const volatileKeys = ['timestamp', 'clientTime', 'requestId']; // add more as needed
    for (const key of volatileKeys) {
      delete clone[key];
    }
    for (const key of Object.keys(clone)) {
      if (typeof clone[key] === 'object') {
        clone[key] = this.stripVolatileFields(clone[key]);
      }
    }
    return clone;
  }

  /**
   * Reserves an operation execution. Throws an error or returns previous result if it exists.
   * If it successfully reserves, it returns void, and the caller must proceed with the business transaction.
   */
  async reserveOperation(params: IdempotencyReservation): Promise<IdempotencyResult | null> {
    const existingAny = await this.db
      .selectFrom('operation_executions')
      .selectAll()
      .where('tenant_id', '=', params.tenantId)
      .where('account_id', '=', params.accountId)
      .where('idempotency_key', '=', params.idempotencyKey)
      .execute();

    if (existingAny.length > 0) {
      const matchingOp = existingAny.find((r) => r.operation_type === params.operationType);
      if (!matchingOp) {
        throw new AppError(
          'Idempotency key reused for a different business operation',
          'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_OPERATION',
          400
        );
      }

      if (matchingOp.request_hash !== params.requestHash) {
        throw new AppError(
          'Idempotency key reused with different payload',
          'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
          400
        );
      }

      if (matchingOp.status === 'processing') {
        const ageMs = Date.now() - new Date(matchingOp.updated_at).getTime();
        if (ageMs > IDEMPOTENCY_STUCK_PROCESSING_MS) {
          return { status: 'recovery_required' };
        }
        return { status: 'processing' };
      }

      return {
        status: matchingOp.status as any,
        responsePayload: matchingOp.response_payload ? JSON.parse(matchingOp.response_payload) : undefined,
        errorCode: matchingOp.error_code || undefined,
        documentId: matchingOp.document_id || undefined,
      };
    }

    try {
      await this.db
        .insertInto('operation_executions')
        .values({
          tenant_id: params.tenantId,
          account_id: params.accountId,
          idempotency_key: params.idempotencyKey,
          operation_type: params.operationType,
          status: 'processing',
          request_hash: params.requestHash,
          created_at: sql`CURRENT_TIMESTAMP`,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .execute();

      return null; // Reservation successful
    } catch (error: any) {
      // Catch unique constraint violation in race conditions
      if (error.code === '23505' || error.message?.includes('UNIQUE') || error.message?.includes('duplicate key')) {
        const existing = await this.db
          .selectFrom('operation_executions')
          .selectAll()
          .where('tenant_id', '=', params.tenantId)
          .where('account_id', '=', params.accountId)
          .where('idempotency_key', '=', params.idempotencyKey)
          .execute();

        const match = existing.find((r) => r.operation_type === params.operationType);
        if (!match) {
          throw new AppError(
            'Idempotency key reused for a different business operation',
            'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_OPERATION',
            400
          );
        }

        if (match.request_hash !== params.requestHash) {
          throw new AppError(
            'Idempotency key reused with different payload',
            'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
            400
          );
        }

        if (match.status === 'processing') {
          const ageMs = Date.now() - new Date(match.updated_at).getTime();
          if (ageMs > IDEMPOTENCY_STUCK_PROCESSING_MS) {
            return { status: 'recovery_required' };
          }
          return { status: 'processing' };
        }

        return {
          status: match.status as any,
          responsePayload: match.response_payload ? JSON.parse(match.response_payload) : undefined,
          errorCode: match.error_code || undefined,
          documentId: match.document_id || undefined,
        };
      }
      throw error;
    }
  }

  /**
   * Records a confirmed failure outside the main transaction (or in a separate short transaction).
   */
  async recordFailure(params: Pick<IdempotencyReservation, 'tenantId' | 'accountId' | 'idempotencyKey' | 'operationType'>, errorCode: string, responsePayload?: any): Promise<void> {
    // Prevent overwriting a committed operation (Point #3)
    // Only update if it's currently processing and no document is linked
    await this.db
      .updateTable('operation_executions')
      .set({
        status: 'failed',
        error_code: errorCode,
        response_payload: responsePayload ? JSON.stringify(responsePayload) : null,
        updated_at: sql`CURRENT_TIMESTAMP`,
        completed_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('tenant_id', '=', params.tenantId)
      .where('account_id', '=', params.accountId)
      .where('idempotency_key', '=', params.idempotencyKey)
      .where('operation_type', '=', params.operationType)
      .where('status', '=', 'processing')
      .where('document_id', 'is', null)
      .execute();
  }

  /**
   * Commits the operation inside the business transaction.
   */
  async commitOperation(
    trx: Kysely<Database>,
    params: Pick<IdempotencyReservation, 'tenantId' | 'accountId' | 'idempotencyKey' | 'operationType'>,
    responsePayload: any,
    documentId?: string
  ): Promise<void> {
    await trx
      .updateTable('operation_executions')
      .set({
        status: 'committed',
        response_payload: JSON.stringify(responsePayload),
        document_id: documentId || null,
        updated_at: sql`CURRENT_TIMESTAMP`,
        completed_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('tenant_id', '=', params.tenantId)
      .where('account_id', '=', params.accountId)
      .where('idempotency_key', '=', params.idempotencyKey)
      .where('operation_type', '=', params.operationType)
      .execute();
  }

  /**
   * Finalizes an operation if it is still marked 'processing'.
   * Used by interceptor to guarantee handlers that never called commitOperation
   * do not leave a permanent 'processing' reservation.
   */
  async finalizeIfStillProcessing(
    params: Pick<IdempotencyReservation, 'tenantId' | 'accountId' | 'idempotencyKey' | 'operationType'>,
    responsePayload: any
  ): Promise<void> {
    await this.db
      .updateTable('operation_executions')
      .set({
        status: 'committed',
        response_payload: JSON.stringify(responsePayload ?? null),
        updated_at: sql`CURRENT_TIMESTAMP`,
        completed_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('tenant_id', '=', params.tenantId)
      .where('account_id', '=', params.accountId)
      .where('idempotency_key', '=', params.idempotencyKey)
      .where('operation_type', '=', params.operationType)
      .where('status', '=', 'processing')
      .execute();
  }

  /**
   * Marks a still-processing operation as needing manual recovery
   * (INV-IDEMPOTENCY-FINALIZE-AWAITED). Used only when the business
   * work committed but its result could not be recorded: the guarded
   * WHERE status = 'processing' never overwrites a committed or
   * failed row. A retry then reads 'recovery_required' (422) instead
   * of spinning on 'processing'.
   */
  async markRecoveryRequired(
    params: Pick<IdempotencyReservation, 'tenantId' | 'accountId' | 'idempotencyKey' | 'operationType'>,
    errorCode: string,
  ): Promise<void> {
    await this.db
      .updateTable('operation_executions')
      .set({
        status: 'recovery_required',
        error_code: errorCode,
        updated_at: sql`CURRENT_TIMESTAMP`,
        completed_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('tenant_id', '=', params.tenantId)
      .where('account_id', '=', params.accountId)
      .where('idempotency_key', '=', params.idempotencyKey)
      .where('operation_type', '=', params.operationType)
      .where('status', '=', 'processing')
      .execute();
  }

  /**
   * INV-IDEMPOTENCY-RETENTION-REVIEW-QUEUE (D5): deletes only
   * TERMINAL rows (committed / failed) whose completed_at is at
   * least 30 days old. 'processing' and 'recovery_required' rows are
   * never deleted here — they are the review queue's input, and
   * deleting them would destroy the only trace of an ambiguous
   * operation. Rows with a NULL completed_at are kept (unknown age).
   * The retention floor is 30 days: a smaller requested value is
   * clamped up, so no caller can prune recent history by accident.
   * There is no scheduler in this codebase; the prune is an explicit
   * staff action through the operations controller.
   */
  async pruneTerminalOperations(
    scope: { tenantId: string; accountId: string },
    retentionDays: number = IDEMPOTENCY_PRUNE_RETENTION_DAYS,
  ): Promise<{ deleted: number }> {
    const retention = Math.max(IDEMPOTENCY_PRUNE_RETENTION_DAYS, Math.floor(retentionDays) || IDEMPOTENCY_PRUNE_RETENTION_DAYS);
    const cutoff = new Date(Date.now() - retention * 24 * 60 * 60 * 1000);
    const result = await this.db
      .deleteFrom('operation_executions')
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .where('status', 'in', ['committed', 'failed'])
      .where('completed_at', '<', cutoff)
      .executeTakeFirst();
    return { deleted: Number(result.numDeletedRows ?? 0) };
  }

  /**
   * INV-IDEMPOTENCY-RETENTION-REVIEW-QUEUE (D5): the manual review
   * queue — 'recovery_required' rows of any age plus 'processing'
   * rows stuck past the 60-second escalation threshold, oldest
   * first. Read-only: nothing here retries or re-drives an operation
   * (D5 forbids automatic retry). Tenant- and account-scoped.
   */
  async listOperationsNeedingReview(
    scope: { tenantId: string; accountId: string },
    limit = 50,
  ): Promise<IdempotencyReviewItem[]> {
    const capped = Math.min(100, Math.max(1, Math.floor(limit) || 50));
    const stuckCutoff = new Date(Date.now() - IDEMPOTENCY_STUCK_PROCESSING_MS);
    const rows = await this.db
      .selectFrom('operation_executions')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .where((eb) =>
        eb.or([
          eb('status', '=', 'recovery_required'),
          eb.and([eb('status', '=', 'processing'), eb('updated_at', '<', stuckCutoff)]),
        ]),
      )
      .orderBy('updated_at', 'asc')
      .limit(capped)
      .execute();
    return rows.map((row) => ({
      idempotencyKey: row.idempotency_key,
      operationType: row.operation_type,
      status: 'recovery_required' as const,
      errorCode: row.error_code,
      documentId: row.document_id,
      updatedAt: row.updated_at as Date,
    }));
  }

  /**
   * Checks if an operation is already processed for this specific operation type.
   */
  async check(
    idempotencyKey: string,
    scope: { tenantId: string; accountId: string },
    operationType?: string
  ): Promise<{ response: any } | null> {
    let query = this.db
      .selectFrom('operation_executions')
      .selectAll()
      .where('idempotency_key', '=', idempotencyKey)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId);

    if (operationType) {
      query = query.where('operation_type', '=', operationType);
    }

    const record = await query.executeTakeFirst();

    if (record && record.status === 'committed') {
      return { response: record.response_payload ? JSON.parse(record.response_payload) : null };
    }
    return null;
  }

  /**
   * INV-CONVERSION-LIFECYCLE-RACES: read-only view of one reserved
   * operation, for callers that must decide what a stuck claim means
   * (order/quotation conversion recovery, stuck-claim deletion).
   * Unlike check(), this returns every status — a 'processing' row
   * and its age are evidence, not just a cache miss — and it accepts
   * an explicit executor so the read can run inside the caller's
   * transaction, after its row locks are held. Never writes.
   */
  async getOperationState(
    params: Pick<IdempotencyReservation, 'tenantId' | 'accountId' | 'idempotencyKey' | 'operationType'>,
    executor?: Kysely<Database>,
  ): Promise<{
    status: string;
    documentId: string | null;
    responsePayload: any;
    updatedAt: Date;
  } | null> {
    const db = executor ?? this.db;
    const record = await db
      .selectFrom('operation_executions')
      .selectAll()
      .where('tenant_id', '=', params.tenantId)
      .where('account_id', '=', params.accountId)
      .where('idempotency_key', '=', params.idempotencyKey)
      .where('operation_type', '=', params.operationType)
      .executeTakeFirst();
    if (!record) return null;
    let responsePayload: any;
    try {
      responsePayload = record.response_payload ? JSON.parse(record.response_payload) : undefined;
    } catch {
      responsePayload = undefined;
    }
    return {
      status: record.status,
      documentId: record.document_id ?? null,
      responsePayload,
      updatedAt: new Date(record.updated_at as any),
    };
  }
}
