import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { PosTerminalBridge } from './pos-terminal/pos-terminal-bridge';
import { PosTerminalTerminals } from './pos-terminal/pos-terminal-terminals';
import { PosTerminalPayments } from './pos-terminal/pos-terminal-payments';
import { PosTerminalCharges } from './pos-terminal/pos-terminal-charges';
import { PosTerminalConnection } from './pos-terminal/pos-terminal-connection';
import type { BridgeJob, BridgePoller, PosTerminalInfo, TerminalPaymentRequest, TerminalPaymentSession, TerminalConnectionTestResult } from './pos-terminal/pos-terminal-shared';
export { derivePosBridgeKey } from './pos-terminal/pos-terminal-shared';
export type { TerminalPaymentRequest } from './pos-terminal/pos-terminal-shared';


@Injectable()
export class PosTerminalService {
  private readonly logger = new Logger(PosTerminalService.name);
  private activeSessions = new Map<string, TerminalPaymentSession>();
  private readonly sessionTtlMs = 15 * 60 * 1000;

  private bridgePollers = new Map<string, BridgePoller[]>();
  private pendingBridgeJobs = new Map<string, BridgeJob[]>();
  private bridgeLastSeen = new Map<string, number>();

  private _s1?: PosTerminalBridge;
  private _s2?: PosTerminalTerminals;
  private _s3?: PosTerminalPayments;
  private _s4?: PosTerminalCharges;
  private _s5?: PosTerminalConnection;

  private get s1(): PosTerminalBridge {
    return (this._s1 ??= new PosTerminalBridge(this.logger, this.activeSessions, this.sessionTtlMs, this.bridgePollers, this.pendingBridgeJobs, this.bridgeLastSeen, this.db));
  }

  private get s2(): PosTerminalTerminals {
    return (this._s2 ??= new PosTerminalTerminals(this.logger, this.db));
  }

  private get s3(): PosTerminalPayments {
    return (this._s3 ??= new PosTerminalPayments(this.activeSessions, this.logger, this.pendingBridgeJobs, {
      getTerminals: (tenantId) => this.getTerminals(tenantId),
      pruneExpiredSessions: () => this.s1.pruneExpiredSessions(),
      getTenantBaseCurrency: (tenantId) => this.s2.getTenantBaseCurrency(tenantId),
      dispatchToBridgeRelay: (tenantId, job) => this.s1.dispatchToBridgeRelay(tenantId, job),
      executeTerminalCharge: (session, ip, port, provider, terminal, request) => this.s4.executeTerminalCharge(session, ip, port, provider, terminal, request),
      dispatchTerminalCancel: (ip, port, provider, transactionId) => this.s4.dispatchTerminalCancel(ip, port, provider, transactionId),
    }));
  }

  private get s4(): PosTerminalCharges {
    return (this._s4 ??= new PosTerminalCharges(this.logger));
  }

  private get s5(): PosTerminalConnection {
    return (this._s5 ??= new PosTerminalConnection(this.db));
  }

  constructor(@Optional() @Inject(KYSELY_DB) private readonly db?: Kysely<Database>) {}

  assertBridgeAuthenticated(tenantId: string, suppliedKey?: string): void {
    return this.s1.assertBridgeAuthenticated(tenantId, suppliedKey);
  }

  async pollBridge(tenantId: string): Promise<{ hasJob: boolean; job?: BridgeJob }> {
    return this.s1.pollBridge(tenantId);
  }

  async handleBridgeCallback(tenantId: string, payload: {
    jobId: string;
    status: string;
    authCode?: string;
    rrn?: string;
    cardScheme?: string;
    cardLastFour?: string;
    message?: string;
  }): Promise<boolean> {
    return this.s1.handleBridgeCallback(tenantId, payload);
  }
  async getTerminals(tenantId: string): Promise<PosTerminalInfo[]> {
    return this.s2.getTerminals(tenantId);
  }
  async initiatePayment(tenantId: string, request: TerminalPaymentRequest): Promise<TerminalPaymentSession> {
    return this.s3.initiatePayment(tenantId, request);
  }

  async getPaymentStatus(tenantId: string, transactionId: string): Promise<TerminalPaymentSession> {
    return this.s3.getPaymentStatus(tenantId, transactionId);
  }

  async cancelPayment(tenantId: string, transactionId: string): Promise<TerminalPaymentSession> {
    return this.s3.cancelPayment(tenantId, transactionId);
  }

  async testConnection(
    tenantId: string,
    payload: { ip?: string; port?: number; provider?: string }
  ): Promise<TerminalConnectionTestResult> {
    return this.s5.testConnection(tenantId, payload);
  }
}
