import { BadRequestException, type Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { parseTerminalHostAndPort, type TerminalPaymentRequest, type TerminalPaymentSession, type BridgeJob, type PosTerminalInfo } from './pos-terminal-shared';

export class PosTerminalPayments {
  constructor(
    private readonly activeSessions: Map<string, TerminalPaymentSession>,
    private readonly logger: Logger,
    private readonly pendingBridgeJobs: Map<string, BridgeJob[]>,
    private readonly bound: {
      getTerminals: (tenantId: string) => Promise<PosTerminalInfo[]>;
      pruneExpiredSessions: () => void;
      getTenantBaseCurrency: (tenantId: string) => Promise<string>;
      dispatchToBridgeRelay: (tenantId: string, job: BridgeJob) => boolean;
      executeTerminalCharge: (
        session: TerminalPaymentSession,
        ip: string,
        port: number,
        provider: string,
        terminal: PosTerminalInfo,
        request: TerminalPaymentRequest,
      ) => Promise<void>;
      dispatchTerminalCancel: (
        ip: string,
        port: number,
        provider: string,
        transactionId: string,
      ) => Promise<void>;
    },
  ) {}

  /**
   * Initiate payment request to the EDC card terminal
   */
  async initiatePayment(tenantId: string, request: TerminalPaymentRequest): Promise<TerminalPaymentSession> {
    if (!Number.isFinite(request.amount) || request.amount <= 0) {
      throw new BadRequestException('المبلغ المطلوب للجهاز يجب أن يكون أكبر من صفر');
    }

    const terminals = await this.getTerminals(tenantId);
    if (!terminals.length) {
      throw new BadRequestException('خدمة ماكينات نقاط البيع (POS Terminal) غير مفعلة في إعدادات المنشأة');
    }

    const selectedTerminal = terminals.find(t => t.id === request.terminalId) || terminals.find(t => t.isDefault) || terminals[0];
    this.pruneExpiredSessions();

    // Prevent concurrent charges on the exact same terminal
    const isTerminalBusy = Array.from(this.activeSessions.values()).some(
      s => s.tenantId === tenantId && s.terminalId === selectedTerminal.id && (s.status === 'processing' || s.status === 'pending')
    );
    if (isTerminalBusy) {
      throw new BadRequestException(`ماكينة الدفع (${selectedTerminal.name}) مشغولة حالياً بعملية دفع أخرى قيد التنفيذ؛ يرجى إنهاء المعاملة الجارية أو إلغاؤها أولاً.`);
    }

    const transactionId = `EDC-${randomUUID()}`;

    // Extract IP and Port from terminal configuration safely
    const { host: cleanIp, port } = parseTerminalHostAndPort(selectedTerminal.ipAddress || '192.168.1.150:8080', 8080);
    const prov = (selectedTerminal.provider || '').toLowerCase();

    // Determine if session should run in simulation / sandbox mode
    const isMock = prov.includes('mock') || prov.includes('sandbox');
    if (isMock && (process.env.APP_MODE === 'CLOUD_SAAS' || process.env.NODE_ENV === 'production')) {
      throw new BadRequestException('محاكي الدفع غير مسموح به في بيئة الإنتاج');
    }
    // Simulated bank approvals are strictly a development-only feature.
    if (isMock && (process.env.APP_MODE === 'CLOUD_SAAS' || process.env.NODE_ENV === 'production')) {
      throw new BadRequestException('Mock POS terminal provider is forbidden in production');
    }

    const tenantCurrency = request.currency
      ? String(request.currency).trim().toUpperCase()
      : await this.getTenantBaseCurrency(tenantId);

    const isLocalLan = cleanIp.startsWith('192.168.') || cleanIp.startsWith('10.') || cleanIp.startsWith('172.') || cleanIp === '127.0.0.1' || cleanIp === 'localhost';

    const session: TerminalPaymentSession = {
      tenantId,
      transactionId,
      terminalId: selectedTerminal.id,
      terminalName: selectedTerminal.name,
      amount: request.amount,
      currency: tenantCurrency,
      status: isMock ? 'pending' : 'processing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      message: isMock
        ? 'في انتظار تمرير أو إدخال البطاقة على جهاز الدفع...'
        : `في انتظار تمرير أو إدخال البطاقة على ماكينة الدفع (${selectedTerminal.name})...`,
      provider: selectedTerminal.provider,
      isSimulated: isMock,
    };

    this.activeSessions.set(transactionId, session);
    this.logger.log(`Initiated terminal payment: ${transactionId} for amount: ${request.amount} on ${selectedTerminal.name} (Simulated: ${isMock}, LocalLan: ${isLocalLan})`);

    // If real device, dispatch via Bridge Relay (for local LAN) or direct cloud call
    if (!isMock) {
      if (isLocalLan) {
        const job: BridgeJob = {
          jobId: transactionId,
          tenantId,
          ip: cleanIp,
          port,
          provider: prov,
          amount: request.amount,
          currency: tenantCurrency,
          referenceId: transactionId,
          terminalTid: selectedTerminal.terminalTid,
          pairingKey: selectedTerminal.pairingKey,
        };

        const dispatched = this.dispatchToBridgeRelay(tenantId, job);
        if (dispatched) {
          session.message = `في انتظار تمرير أو إدخال البطاقة على ماكينة الدفع (${selectedTerminal.name})...`;
        } else {
          // Allow up to 4.5 seconds for a polling bridge to pick it up before declining
          setTimeout(() => {
            const current = this.activeSessions.get(transactionId);
            if (current && current.status === 'processing' && !current.approvalCode) {
              const pending = this.pendingBridgeJobs.get(tenantId) || [];
              const stillQueued = pending.some(j => j.jobId === transactionId);
              if (stillQueued) {
                this.pendingBridgeJobs.set(tenantId, pending.filter(j => j.jobId !== transactionId));
                current.status = 'declined';
                current.message = `ماكينة الدفع (${selectedTerminal.name} - ${cleanIp}) على شبكة محلية، ولم يتم اكتشاف اتصال مع جسر Z-Systems Bridge على جهاز الكاشير. يرجى تشغيل الجسر.`;
                current.updatedAt = Date.now();
                this.logger.warn(`Terminal session ${transactionId} declined: No active bridge poller for tenant ${tenantId}`);
              }
            }
          }, 4500);
        }
      } else {
        this.executeTerminalCharge(session, cleanIp, port, prov, selectedTerminal, request).catch((err) => {
          this.logger.error(`Terminal charge background error for ${transactionId}:`, err);
        });
      }
    }

    return session;
  }

  /**
   * Check status of terminal payment (cashier polling or device webhook)
   */
  async getPaymentStatus(tenantId: string, transactionId: string): Promise<TerminalPaymentSession> {
    this.pruneExpiredSessions();
    const session = this.activeSessions.get(transactionId);
    if (!session || session.tenantId !== tenantId) {
      throw new BadRequestException('معاملة الدفع غير موجودة أو منتهية الصلاحية');
    }

    if (session.isSimulated && (process.env.APP_MODE === 'CLOUD_SAAS' || process.env.NODE_ENV === 'production')) {
      session.status = 'declined';
      session.message = 'المحاكاة البنكية غير متاحة في الإنتاج';
      session.updatedAt = Date.now();
      return session;
    }

    // Only apply timer simulation if the session was explicitly marked as simulated
    if (session.isSimulated) {
      const elapsedMs = Date.now() - session.createdAt;

      if (session.status === 'pending' && elapsedMs > 2500) {
        session.status = 'processing';
        session.message = 'جاري معالجة البطاقة والاتصال بالبنك...';
        session.updatedAt = Date.now();
      } else if (session.status === 'processing' && elapsedMs > 4500) {
        session.status = 'approved';
        session.approvalCode = `AUTH-${Math.floor(100000 + Math.random() * 900000)}`;
        session.rrn = `RRN${Date.now().toString().slice(-9)}`;

        const curr = (session.currency || '').toUpperCase();
        const prov = (session.provider || '').toLowerCase();
        if (curr === 'KWD' || prov.includes('knet')) {
          session.cardScheme = 'knet';
        } else if (curr === 'SAR' || prov.includes('geidea') || prov.includes('mada')) {
          session.cardScheme = 'mada';
        } else if (curr === 'AED' || prov.includes('network')) {
          session.cardScheme = Math.random() > 0.5 ? 'Visa' : 'Mastercard';
        } else {
          session.cardScheme = Math.random() > 0.4 ? 'Visa' : 'Meeza';
        }

        session.cardLastFour = String(Math.floor(1000 + Math.random() * 9000));
        session.message = 'تمت الموافقة بنجاح!';
        session.updatedAt = Date.now();
      }
    }

    return session;
  }

  /**
   * Cancel an ongoing terminal transaction
   */
  async cancelPayment(tenantId: string, transactionId: string): Promise<TerminalPaymentSession> {
    this.pruneExpiredSessions();
    const session = this.activeSessions.get(transactionId);
    if (!session || session.tenantId !== tenantId) {
      throw new BadRequestException('معاملة الدفع غير موجودة');
    }
    if (session.status === 'approved') {
      throw new BadRequestException('لا يمكن إلغاء تحصيل بنكي معتمد محلياً؛ يلزم إجراء Void/Refund موثق من البنك');
    }
    if (session.status === 'declined' || session.status === 'cancelled') return session;

    // A simulated/unsent job may be cancelled locally without a bank operation.
    if (session.isSimulated) {
      session.status = 'cancelled';
      session.message = 'تم إلغاء العملية التجريبية';
      session.updatedAt = Date.now();
      return session;
    }
    const pending = this.pendingBridgeJobs.get(tenantId) || [];
    if (pending.some(job => job.jobId === transactionId)) {
      this.pendingBridgeJobs.set(tenantId, pending.filter(job => job.jobId !== transactionId));
      session.status = 'cancelled';
      session.message = 'أُلغي الطلب قبل إرساله إلى ماكينة البنك';
      session.updatedAt = Date.now();
      return session;
    }

    // The bank may already have debited the card. Never report "cancelled" based on
    // a best-effort network request; keep status unsettled until reliable confirmation.
    const terminals = await this.getTerminals(tenantId).catch(() => []);
    const term = terminals.find(t => t.id === session.terminalId);
    if (term?.ipAddress) {
      const { host, port } = parseTerminalHostAndPort(term.ipAddress, 8080);
      if (host) {
        await this.dispatchTerminalCancel(host, port, (term.provider || '').toLowerCase(), transactionId);
      }
    }
    session.message = 'تمت محاولة إرسال طلب الإلغاء؛ راجع حالة البنك قبل إعادة التحصيل';
    session.updatedAt = Date.now();
    return session;
  }

  private async getTerminals(tenantId: string): Promise<PosTerminalInfo[]> {
    return this.bound.getTerminals(tenantId);
  }

  private pruneExpiredSessions(): void {
    this.bound.pruneExpiredSessions();
  }

  private async getTenantBaseCurrency(tenantId: string): Promise<string> {
    return this.bound.getTenantBaseCurrency(tenantId);
  }

  private dispatchToBridgeRelay(tenantId: string, job: BridgeJob): boolean {
    return this.bound.dispatchToBridgeRelay(tenantId, job);
  }

  private async executeTerminalCharge(
    session: TerminalPaymentSession,
    ip: string,
    port: number,
    provider: string,
    terminal: PosTerminalInfo,
    request: TerminalPaymentRequest,
  ): Promise<void> {
    return this.bound.executeTerminalCharge(session, ip, port, provider, terminal, request);
  }

  private async dispatchTerminalCancel(
    ip: string,
    port: number,
    provider: string,
    transactionId: string,
  ): Promise<void> {
    return this.bound.dispatchTerminalCancel(ip, port, provider, transactionId);
  }
}
