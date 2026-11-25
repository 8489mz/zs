import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { AuthContext } from '../interfaces/auth-context.interface';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class AuthCacheService implements OnModuleDestroy {
  // Primary in-memory store: sub-millisecond, zero-dependency, zero network overhead
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries = 20_000;
  private sweepTimer: NodeJS.Timeout | null = null;

  // Default TTLs in seconds
  private readonly defaultSessionTtl = 60; // 60 seconds for active session context
  private readonly defaultTenantStatusTtl = 60; // 60 seconds for subscription / status check
  private readonly defaultTenantPayloadTtl = 60;

  constructor() {
    // Periodic sweep every 60s to prune expired entries and maintain lean memory footprint
    this.sweepTimer = setInterval(() => {
      this.sweepExpired();
    }, 60000);

    if (this.sweepTimer.unref) {
      this.sweepTimer.unref();
    }
  }

  onModuleDestroy() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.store.clear();
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  private get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    // Map insertion order is the LRU queue; reads move live entries to its tail.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  private set<T>(key: string, value: T, ttlSeconds: number): void {
    const expiresAt = Date.now() + Math.max(0, ttlSeconds) * 1000;
    this.store.delete(key);
    this.store.set(key, { value, expiresAt });
    if (this.store.size > this.maxEntries) {
      this.sweepExpired();
      while (this.store.size > this.maxEntries) {
        const oldest = this.store.keys().next().value;
        if (oldest === undefined) break;
        this.store.delete(oldest);
      }
    }
  }

  private delete(key: string): void {
    this.store.delete(key);
  }

  // --- Session AuthContext Caching ---

  getSession(sessionId: string): AuthContext | null {
    if (!sessionId) return null;
    return this.get<AuthContext>(`session:${sessionId}`);
  }

  setSession(sessionId: string, auth: AuthContext, ttlSeconds = this.defaultSessionTtl): void {
    if (!sessionId || !auth) return;
    this.set(`session:${sessionId}`, auth, ttlSeconds);
  }

  invalidateSession(sessionId: string): void {
    if (!sessionId) return;
    this.delete(`session:${sessionId}`);
  }

  invalidateUserSessions(userId: number): void {
    if (!userId) return;
    for (const [key, entry] of this.store.entries()) {
      if (key.startsWith('session:')) {
        const auth = entry.value as AuthContext;
        if (auth && auth.userId === userId) {
          this.store.delete(key);
        }
      }
    }
  }

  // --- Tenant Status & Subscription Caching ---

  isTenantAllowed(tenantId: string): boolean | null {
    if (!tenantId) return null;
    return this.get<boolean>(`tenant:allowed:${tenantId}`);
  }

  setTenantAllowed(tenantId: string, allowed: boolean, ttlSeconds = this.defaultTenantStatusTtl): void {
    if (!tenantId) return;
    this.set(`tenant:allowed:${tenantId}`, allowed, ttlSeconds);
  }

  // --- Tenant Payload & SaaS Plan Features Caching ---

  getTenantPayload(tenantId: string): Record<string, unknown> | null {
    if (!tenantId) return null;
    return this.get<Record<string, unknown>>(`tenant:payload:${tenantId}`);
  }

  setTenantPayload(
    tenantId: string,
    payload: Record<string, unknown>,
    ttlSeconds = this.defaultTenantPayloadTtl,
  ): void {
    if (!tenantId || !payload) return;
    this.set(`tenant:payload:${tenantId}`, payload, ttlSeconds);
  }

  // --- Broad Invalidation ---

  invalidateTenant(tenantId: string): void {
    if (!tenantId) return;
    this.delete(`tenant:allowed:${tenantId}`);
    this.delete(`tenant:payload:${tenantId}`);

    // Invalidate sessions belonging to this tenant
    for (const [key, entry] of this.store.entries()) {
      if (key.startsWith('session:')) {
        const auth = entry.value as AuthContext;
        if (auth && auth.tenantId === tenantId) {
          this.store.delete(key);
        }
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
