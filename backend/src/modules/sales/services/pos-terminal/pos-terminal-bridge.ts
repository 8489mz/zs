import { UnauthorizedException, type Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import {
  derivePosBridgeKey,
  type BridgeJob,
  type TerminalPaymentSession,
  type BridgePoller,
} from './pos-terminal-shared';

export class PosTerminalBridge {
  constructor(
    private readonly logger: Logger,
    private readonly activeSessions: Map<string, TerminalPaymentSession>,
    private readonly sessionTtlMs: number,
    private readonly bridgePollers: Map<string, BridgePoller[]>,
    private readonly pendingBridgeJobs: Map<string, BridgeJob[]>,
    private readonly bridgeLastSeen: Map<string, number>,
    private readonly db?: Kysely<Database>,
  ) {}

  pruneExpiredSessions(): void {
    const cutoff = Date.now() - this.sessionTtlMs;
    for (const [id, session] of this.activeSessions) {
      if (session.createdAt < cutoff) this.activeSessions.delete(id);
    }
  }

  /** The external bridge API intentionally has no user session; authenticate the device instead. */
  assertBridgeAuthenticated(tenantId: string, suppliedKey?: string): void {
    const master = process.env.POS_BRIDGE_MASTER_SECRET || '';
    if (
      master.length < 32 ||
      !tenantId?.trim() ||
      typeof suppliedKey !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(suppliedKey)
    ) {
      throw new UnauthorizedException('POS bridge credentials are missing or invalid');
    }
    const expected = Buffer.from(derivePosBridgeKey(master, tenantId), 'hex');
    const provided = Buffer.from(suppliedKey, 'hex');
    if (!timingSafeEqual(expected, provided)) {
      throw new UnauthorizedException('POS bridge credentials are missing or invalid');
    }
  }

  /**
   * Hardware Bridge long-poll endpoint.
   * Holds request up to 25s waiting for a payment job for the given tenant.
   */
  async pollBridge(tenantId: string): Promise<{ hasJob: boolean; job?: BridgeJob }> {
    const cleanTenant = String(tenantId).trim();
    this.bridgeLastSeen.set(cleanTenant, Date.now());

    // 1. Return pending job if any
    const pendingList = this.pendingBridgeJobs.get(cleanTenant);
    if (pendingList && pendingList.length > 0) {
      const job = pendingList.shift()!;
      this.logger.log(`Dispatching pending bridge job ${job.jobId} to poller for tenant ${cleanTenant}`);
      return { hasJob: true, job };
    }

    // 2. Long-poll wait up to 25 seconds
    return new Promise((resolve) => {
      const resolveWrapper = (data: { hasJob: boolean; job?: BridgeJob }) => {
        clearTimeout(timeoutId);
        resolve(data);
      };

      const timeoutId = setTimeout(() => {
        const list = this.bridgePollers.get(cleanTenant) || [];
        this.bridgePollers.set(
          cleanTenant,
          list.filter((p: any) => p.resolve !== resolveWrapper),
        );
        resolve({ hasJob: false });
      }, 25000);

      if (!this.bridgePollers.has(cleanTenant)) {
        this.bridgePollers.set(cleanTenant, []);
      }
      this.bridgePollers.get(cleanTenant)!.push({ resolve: resolveWrapper, timeout: timeoutId });
    });
  }

  /**
   * Handle result callback from hardware bridge
   */
  async handleBridgeCallback(
    tenantId: string,
    payload: {
      jobId: string;
      status: string;
      authCode?: string;
      rrn?: string;
      cardScheme?: string;
      cardLastFour?: string;
      message?: string;
    },
  ): Promise<boolean> {
    const cleanTenant = String(tenantId).trim();
    this.bridgeLastSeen.set(cleanTenant, Date.now());
    this.pruneExpiredSessions();

    const session = this.activeSessions.get(payload.jobId);
    if (!session || session.tenantId !== cleanTenant || !['pending', 'processing'].includes(session.status)) {
      this.logger.warn('Bridge callback rejected: session not pending or tenant mismatch');
      return false;
    }

    const isApproved = payload.status === 'approved' || payload.status === 'APPROVED';
    if (isApproved && (!payload.authCode?.trim() || !payload.rrn?.trim())) {
      this.logger.warn('Bridge approval rejected: missing bank authorization or RRN');
      return false;
    }
    session.status = isApproved ? 'approved' : payload.status === 'cancelled' ? 'cancelled' : 'declined';
    session.approvalCode = isApproved ? payload.authCode : undefined;
    session.rrn = payload.rrn || session.transactionId;
    session.cardScheme = payload.cardScheme || 'Visa';
    session.cardLastFour = payload.cardLastFour || '';
    session.message =
      payload.message || (isApproved ? 'تمت الموافقة بنجاح من ماكينة الدفع' : 'تم رفض العملية من البنك أو الماكينة');
    session.updatedAt = Date.now();

    this.logger.log(
      `Bridge callback resolved session ${payload.jobId} => ${session.status} (Auth: ${session.approvalCode})`,
    );
    return true;
  }

  /**
   * Dispatch a terminal charge job to an active bridge poller or queue
   */
  dispatchToBridgeRelay(tenantId: string, job: BridgeJob): boolean {
    const cleanTenant = String(tenantId).trim();
    const pollers = this.bridgePollers.get(cleanTenant);
    if (pollers && pollers.length > 0) {
      const poller = pollers.shift()!;
      clearTimeout(poller.timeout);
      poller.resolve({ hasJob: true, job });
      this.logger.log(`Dispatched terminal charge job ${job.jobId} to active bridge poller for tenant ${cleanTenant}`);
      return true;
    }

    // Queue for next poll
    if (!this.pendingBridgeJobs.has(cleanTenant)) {
      this.pendingBridgeJobs.set(cleanTenant, []);
    }
    this.pendingBridgeJobs.get(cleanTenant)!.push(job);
    return false;
  }
}
