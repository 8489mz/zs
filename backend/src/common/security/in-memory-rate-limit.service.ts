import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql, type Kysely } from '../../database/kysely';
import { KYSELY_DB } from '../../database/database.constants';
import type { Database } from '../../database/database.types';

type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
  resetAt: number;
};

@Injectable()
export class InMemoryRateLimitService {
  private readonly buckets = new Map<string, Bucket>();
  private ensureTablePromise: Promise<void> | null = null;
  private lastPruneAt = 0;
  private readonly failClosedWithoutPersistentStore: boolean;
  private readonly isProduction: boolean;

  constructor(
    @Optional() @Inject(KYSELY_DB) private readonly db?: Kysely<Database>,
    @Optional() private readonly configService?: ConfigService,
  ) {
    const nodeEnv = this.configService?.get<string>('NODE_ENV') || process.env.NODE_ENV || 'development';
    this.isProduction = nodeEnv === 'production';
    this.failClosedWithoutPersistentStore = this.isProduction;
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    if (!this.db) {
      if (this.failClosedWithoutPersistentStore) {
        throw new Error('Persistent rate limit store is required in production');
      }
      return this.hitInMemory(key, limit, windowSeconds);
    }

    try {
      await this.ensurePersistentStore();
      return await this.hitInDatabase(key, limit, windowSeconds);
    } catch (error) {
      if (this.isProduction) {
        this.logRateLimitDbError(error, 'hit');
      }
      if (this.failClosedWithoutPersistentStore) {
        throw new Error('Rate limit persistent store is unavailable in production');
      }
      return this.hitInMemory(key, limit, windowSeconds);
    }
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);

    if (!this.db) return;

    try {
      await this.ensurePersistentStore();
      await sql`DELETE FROM auth_rate_limits WHERE key = ${key}`.execute(this.db);
    } catch (error) {
      if (this.isProduction) {
        this.logRateLimitDbError(error, 'reset');
      }
      // fall back to memory-only reset when the persistent store is unavailable
    }
  }

  private logRateLimitDbError(error: unknown, operation: 'hit' | 'reset'): void {
    const candidate = (error ?? {}) as Record<string, unknown>;
    const stack = typeof candidate.stack === 'string' ? candidate.stack : '';
    const stackFirstLine = stack ? stack.split('\n')[0]?.trim() : undefined;

    console.error(
      '[rate-limit]',
      JSON.stringify({
        operation,
        error: {
          name: typeof candidate.name === 'string' ? candidate.name : 'Error',
          message: typeof candidate.message === 'string' ? candidate.message : 'Unknown error',
          code: typeof candidate.code === 'string' ? candidate.code : undefined,
          constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
          table: typeof candidate.table === 'string' ? candidate.table : undefined,
          column: typeof candidate.column === 'string' ? candidate.column : undefined,
          stackFirstLine,
        },
      }),
    );
  }

  private hitInMemory(key: string, limit: number, windowSeconds: number): RateLimitResult {
    const safeLimit = Math.max(1, Number(limit) || 1);
    const safeWindowMs = Math.max(1, Number(windowSeconds) || 1) * 1000;
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + safeWindowMs;
      const bucket: Bucket = { count: 1, resetAt };
      this.buckets.set(key, bucket);
      this.pruneMemory(now);
      return {
        allowed: true,
        remaining: Math.max(0, safeLimit - 1),
        retryAfterSeconds: 0,
        limit: safeLimit,
        resetAt,
      };
    }

    existing.count += 1;
    return this.toResult(existing.count, existing.resetAt, safeLimit, now);
  }

  private async hitInDatabase(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const safeLimit = Math.max(1, Number(limit) || 1);
    const safeWindowMs = Math.max(1, Number(windowSeconds) || 1) * 1000;
    const now = Date.now();
    const resetAt = now + safeWindowMs;

    const result = await sql<{ count: number; reset_at_ms: number }>`
      INSERT INTO auth_rate_limits (key, count, reset_at, created_at, updated_at)
      VALUES (${key}, 1, to_timestamp(${resetAt} / 1000.0), now(), now())
      ON CONFLICT (key) DO UPDATE
      SET
        count = CASE
          WHEN auth_rate_limits.reset_at <= now() THEN 1
          ELSE auth_rate_limits.count + 1
        END,
        reset_at = CASE
          WHEN auth_rate_limits.reset_at <= now() THEN to_timestamp(${resetAt} / 1000.0)
          ELSE auth_rate_limits.reset_at
        END,
        updated_at = now()
      RETURNING count, (extract(epoch from reset_at) * 1000)::bigint AS reset_at_ms
    `.execute(this.db!);

    const row = result.rows[0];
    await this.prunePersistentStore(now);

    if (!row) {
      return this.hitInMemory(key, safeLimit, windowSeconds);
    }

    return this.toResult(Number(row.count || 0), Number(row.reset_at_ms || resetAt), safeLimit, now);
  }

  private toResult(count: number, resetAt: number, limit: number, now: number): RateLimitResult {
    const allowed = count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
      limit,
      resetAt,
    };
  }

  private async ensurePersistentStore(): Promise<void> {
    if (!this.db) return;
    if (this.isProduction) return;
    if (!this.ensureTablePromise) {
      this.ensureTablePromise = sql`
        CREATE TABLE IF NOT EXISTS auth_rate_limits (
          key text PRIMARY KEY,
          count integer NOT NULL,
          reset_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `
        .execute(this.db)
        .then(() => undefined);
    }

    await this.ensureTablePromise;
  }

  private async prunePersistentStore(now: number): Promise<void> {
    if (!this.db) return;
    if (now - this.lastPruneAt < 60_000) return;
    this.lastPruneAt = now;

    await sql`
      DELETE FROM auth_rate_limits
      WHERE reset_at < now() - interval '1 hour'
    `.execute(this.db);
  }

  private pruneMemory(now: number): void {
    if (this.buckets.size < 2000) return;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
