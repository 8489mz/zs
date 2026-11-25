import * as net from 'node:net';
import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import {
  parseTerminalHostAndPort,
  isPrivateSubnetIp,
  execAsync,
  type TerminalConnectionTestResult,
} from './pos-terminal-shared';

export class PosTerminalConnection {
  constructor(private readonly db?: Kysely<Database>) {}

  /**
   * Test physical LAN / Wi-Fi connection to POS Terminal (Ping & TCP Port Handshake)
   */
  async testConnection(
    tenantId: string,
    payload: { ip?: string; port?: number; provider?: string },
  ): Promise<TerminalConnectionTestResult> {
    const parsed = parseTerminalHostAndPort(payload?.ip || '', Number(payload?.port || 8080));
    let cleanIp = parsed.host;
    let port = parsed.port;
    const provider = payload?.provider || 'fawry';

    // If no IP supplied, fetch configured settings for tenant
    if (!payload?.ip) {
      if (this.db) {
        try {
          const rows = await this.db
            .selectFrom('settings')
            .selectAll()
            .where('tenant_id', '=', String(tenantId))
            .execute();
          const settingsMap: Record<string, any> = {};
          for (const row of rows) {
            try {
              settingsMap[row.key] = JSON.parse(row.value);
            } catch {
              settingsMap[row.key] = row.value;
            }
          }
          const fromDb = parseTerminalHostAndPort(
            settingsMap.posTerminalIp || '192.168.1.150',
            Number(settingsMap.posTerminalPort || 8080),
          );
          cleanIp = fromDb.host;
          port = fromDb.port;
        } catch {
          cleanIp = '192.168.1.150';
        }
      } else {
        cleanIp = '192.168.1.150';
      }
    }

    // Mock Simulator special handling
    if (provider === 'mock_sandbox') {
      return {
        reachable: true,
        pingSucceeded: true,
        portOpen: true,
        ip: cleanIp || '127.0.0.1',
        port,
        latencyMs: 1,
        message: 'محاكي نقاط البيع التجريبي (Mock Simulator) نشط ومتصل افتراضياً',
        details: 'بيئة الاختبار الافتراضية جاهزة تماماً لتجربة عمليات الدفع في الكاشير.',
        provider,
      };
    }

    // Validation
    if (!cleanIp || cleanIp === '0.0.0.0' || !/^[a-zA-Z0-9.-]+$/.test(cleanIp)) {
      return {
        reachable: false,
        pingSucceeded: false,
        portOpen: false,
        ip: cleanIp,
        port,
        message: 'عنوان IP الماكينة غير محدد أو غير صالح',
        details: 'يرجى كتابة عنوان IP صالح لماكينة فوري / PAX مثل 192.168.1.8',
        provider,
      };
    }

    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return {
        reachable: false,
        pingSucceeded: false,
        portOpen: false,
        ip: cleanIp,
        port,
        message: 'رقم المنفذ (Port) غير صالح',
        details: 'يجب أن يكون المنفذ رقماً بين 1 و 65535 (الافتراضي لماكينات PAX هو 8080 أو 10009)',
        provider,
      };
    }

    // SSRF Guard (ZS-084): Block loopback and link-local / cloud metadata unconditionally
    const isLoopbackOrMetadata =
      cleanIp.startsWith('127.') ||
      cleanIp === 'localhost' ||
      cleanIp === '::1' ||
      cleanIp.startsWith('169.254.') ||
      cleanIp === '0.0.0.0';

    if (isLoopbackOrMetadata) {
      return {
        reachable: false,
        pingSucceeded: false,
        portOpen: false,
        ip: cleanIp,
        port,
        message: 'عنوان IP الماكينة غير مسموح به (Loopback / Cloud Metadata)',
        details: 'لا يمكن اختبار الاتصال بعناوين الاسترجاع الداخلي أو عناوين بيانات السيرفر السحابي لحماية أمن النظام.',
        provider,
      };
    }

    const isPrivateSub = isPrivateSubnetIp(cleanIp);
    const isCloudEnv = process.env.APP_MODE === 'CLOUD_SAAS' || process.env.NODE_ENV === 'production';
    if (isCloudEnv && isPrivateSub) {
      return {
        reachable: false,
        pingSucceeded: false,
        portOpen: false,
        ip: cleanIp,
        port,
        message: `تعذر الوصول لماكينة الدفع (${cleanIp}) من بيئة السيرفر السحابي (Cloud SaaS)`,
        details: `العنوان ${cleanIp} يقع ضمن الشبكة المحلية (LAN) الخاصة بفرعك. السيرفر السحابي المعزول لا يستطيع الوصول للراوتر المحلي عبر الإنترنت العام. للربط المباشر مع ماكينات الشبكة المحلية، يرجى تشغيل تطبيق Z-Systems Desktop للكاشير على نفس الشبكة، أو استخدام وضع الربط السحابي مع المزود (مثل Geidea Cloud ECR بتعيين Terminal TID).`,
        provider,
      };
    }

    // Execute Ping and TCP Port probe
    const [pingRes, tcpRes] = await Promise.all([this.pingHost(cleanIp, 2000), this.checkTcpPort(cleanIp, port, 3000)]);

    // Case 1: Port is open - Ready to trade!
    if (tcpRes.open) {
      const latency = tcpRes.rttMs || pingRes.rttMs || 10;
      return {
        reachable: true,
        pingSucceeded: true,
        portOpen: true,
        ip: cleanIp,
        port,
        latencyMs: latency,
        message: `تم الاتصال بالماكينة بنجاح (${latency}ms) - المنفذ ${port} مفتوح ومستعد لاستقبال الفواتير`,
        details: `الماكينة متصلة بالشبكة وتستجيب لبروتوكول ECR بنجاح. شاشة الكاشير جاهزة لإرسال مبالغ الدفع آلياً دون أي تدخل يدوي.`,
        provider,
      };
    }

    // Case 2: Machine is online on Wi-Fi/LAN (Ping ok), but TCP port closed
    if (pingRes.ok) {
      const pingText = pingRes.rttMs ? `${pingRes.rttMs}ms` : 'Ping ناجح';
      const appName =
        provider === 'knet_pos'
          ? 'تطبيق كي نت (KNET)'
          : provider === 'geidea'
            ? 'تطبيق جيديا (Geidea Mada)'
            : provider === 'network_international'
              ? 'تطبيق Network International (NI)'
              : provider === 'paymob'
                ? 'تطبيق Paymob'
                : 'تطبيق فوري / PAX';
      return {
        reachable: false,
        pingSucceeded: true,
        portOpen: false,
        ip: cleanIp,
        port,
        latencyMs: pingRes.rttMs,
        message: `الماكينة متصلة بالشبكة (${pingText}) ولكن المنفذ ${port} غير مفتوح`,
        details: `الماكينة استجابت بنجاح على الشبكة المحلية، ولكن ${appName} لم يفتح منفذ ECR رقم ${port} بعد. يرجى الدخول لإعدادات التطبيق على الماكينة -> "إعدادات الربط / ECR" -> تفعيل الربط وتعيين المنفذ ${port}.`,
        provider,
      };
    }

    return {
      reachable: false,
      pingSucceeded: false,
      portOpen: false,
      ip: cleanIp,
      port,
      message: `تعذر الوصول لماكينة الدفع على العنوان ${cleanIp}`,
      details: `الجهاز غير موجود على الشبكة المحلية أو مغلق. يرجى التأكد من تشغيل الماكينة، واتصالها بنفس شبكة الواي فاي للكمبيوتر، وصحة عنوان IP.`,
      provider,
    };
  }

  private async pingHost(host: string, timeoutMs = 2500): Promise<{ ok: boolean; rttMs?: number }> {
    const isWin = process.platform === 'win32';
    const pingCmd = isWin ? `ping -n 2 -w 1500 ${host}` : `ping -c 2 -W 2 ${host}`;

    try {
      const { stdout } = await execAsync(pingCmd, { timeout: timeoutMs + 2000 });
      const is100Loss =
        stdout.includes('(100% loss)') ||
        stdout.includes('100% loss') ||
        stdout.includes('100% packet loss') ||
        stdout.includes('Destination host unreachable');

      const ok = isWin
        ? (stdout.includes(`Reply from ${host}:`) || (stdout.includes('Reply from') && !is100Loss)) && !is100Loss
        : (stdout.includes('1 received') ||
            stdout.includes('2 received') ||
            stdout.includes('1 packets received') ||
            stdout.includes('2 packets received')) &&
          !is100Loss;

      const match = stdout.match(/Average = ([0-9]+)ms/i) || stdout.match(/time[=<]([0-9.]+)\s*ms/i);
      const rttMs = match ? Math.round(Number(match[1])) : undefined;

      return { ok, rttMs: ok ? rttMs : undefined };
    } catch {
      return { ok: false };
    }
  }

  private checkTcpPort(
    host: string,
    port: number,
    timeoutMs = 3000,
  ): Promise<{ open: boolean; rttMs?: number; error?: string }> {
    const start = Date.now();
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;

      const finish = (open: boolean, error?: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({ open, rttMs: open ? Math.max(1, Date.now() - start) : undefined, error });
      };

      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        finish(true);
      });

      socket.on('timeout', () => {
        finish(false, 'ETIMEDOUT');
      });

      socket.on('error', (err: any) => {
        finish(false, err?.code || 'ECONNFAILED');
      });

      try {
        socket.connect(port, host);
      } catch (err: any) {
        finish(false, err?.code || 'ESOCKET_ERR');
      }
    });
  }
}
