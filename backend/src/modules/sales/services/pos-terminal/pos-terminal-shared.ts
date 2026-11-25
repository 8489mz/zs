import { createHmac } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export const execAsync = promisify(exec);

/**
 * One different bridge credential per tenant. Provision the derived credential to the
 * trusted Windows bridge; NEVER disclose the master secret to clients.
 */
export function derivePosBridgeKey(masterSecret: string, tenantId: string): string {
  if (masterSecret.length < 32 || !tenantId.trim()) throw new Error('POS bridge master secret/tenant not provisioned');
  return createHmac('sha256', masterSecret)
    .update('zs-pos-bridge:v1:' + tenantId.trim())
    .digest('hex');
}

export interface PosTerminalInfo {
  id: string;
  name: string;
  type: 'edc_standalone' | 'softpos' | 'integrated_ip';
  status: 'online' | 'busy' | 'offline';
  ipAddress?: string;
  provider?: string;
  isDefault?: boolean;
  pairingKey?: string;
  terminalTid?: string;
}

export function isPrivateSubnetIp(ip: string): boolean {
  if (!ip) return false;
  const clean = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (clean === 'localhost' || clean === '::1' || clean === '0.0.0.0') return true;
  if (clean.startsWith('127.')) return true; // all loopback addresses
  if (clean.startsWith('169.254.')) return true; // link-local & cloud metadata
  if (clean.startsWith('192.168.') || clean.startsWith('10.')) return true;
  const match172 = clean.match(/^172\.(\d+)\./);
  if (match172) {
    const octet = parseInt(match172[1], 10);
    return octet >= 16 && octet <= 31;
  }
  // IPv6 loopback / link-local / unique local
  if (clean.startsWith('fe80:') || clean.startsWith('fc00:') || clean.startsWith('fd00:')) return true;
  return false;
}

export function parseTerminalHostAndPort(
  rawHost: string,
  fallbackPort = 8080,
): { host: string; port: number; protocol: 'http' | 'https' } {
  if (!rawHost) return { host: '192.168.1.150', port: fallbackPort, protocol: 'http' };

  let clean = rawHost.trim();
  let protocol: 'http' | 'https' = 'http';

  if (clean.toLowerCase().startsWith('https://')) {
    protocol = 'https';
    clean = clean.slice(8);
  } else if (clean.toLowerCase().startsWith('http://')) {
    protocol = 'http';
    clean = clean.slice(7);
  }

  clean = clean.split('/')[0].trim();

  const colonIdx = clean.lastIndexOf(':');
  if (colonIdx !== -1) {
    const portPart = clean.slice(colonIdx + 1);
    const parsedPort = parseInt(portPart, 10);
    if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
      const hostPart = clean.slice(0, colonIdx).trim();
      if (parsedPort === 443 || parsedPort === 8443) protocol = 'https';
      return { host: hostPart || '192.168.1.150', port: parsedPort, protocol };
    }
  }

  const finalPort = Number.isFinite(fallbackPort) && fallbackPort > 0 ? fallbackPort : 8080;
  if (finalPort === 443 || finalPort === 8443) protocol = 'https';
  return { host: clean || '192.168.1.150', port: finalPort, protocol };
}

export function translateBankResponseCode(rawCode?: string, fallbackMessage?: string): string {
  if (!rawCode) return fallbackMessage || 'تم رفض العملية من البنك أو تم إلغاؤها';
  const clean = String(rawCode).trim().toUpperCase();

  const codeMap: Record<string, string> = {
    '00': 'تمت الموافقة بنجاح',
    '000': 'تمت الموافقة بنجاح',
    '000000': 'تمت الموافقة بنجاح',
    '01': 'يرجى مراجعة البنك المصدر للبطاقة',
    '04': 'يرجى حجز البطاقة (بطاقة مسروقة أو ملغاة)',
    '05': 'رفض من البنك المصدر (Do Not Honor)',
    '12': 'عملية غير صالحة',
    '13': 'مبلغ غير صالح',
    '14': 'رقم بطاقة غير صالح',
    '30': 'خطأ في تنسيق الرسالة البنكية',
    '41': 'بطاقة مفقودة - يرجى مصادرتها',
    '43': 'بطاقة مسروقة - يرجى مصادرتها',
    '51': 'تم الرفض: الرصيد غير كافٍ في بطاقة العميل',
    '54': 'تم الرفض: البطاقة منتهية الصلاحية',
    '55': 'تم الرفض: الرقم السري (PIN) غير صحيح',
    '57': 'العملية غير مسموح بها لحامل هذه البطاقة',
    '58': 'العملية غير مسموح بها في هذا النوع من المتاجر',
    '61': 'تم الرفض: تجاوز الحد الأقصى المسموح للسحب اليومي',
    '62': 'بطاقة مقيدة أو محظورة',
    '65': 'تجاوز عدد مرات السحب المسموح بها',
    '75': 'تم الرفض: تم تجاوز عدد محاولات إدخال الرقم السري المسموحة',
    '91': 'تم الرفض: تعذر الاتصال بمركز معالجة بنك العميل',
    '94': 'معاملة مكررة',
    '96': 'تم الرفض: عطل مؤقت في نظام البنك المعالج، يرجى المحاولة لاحقاً',
    '99': 'تم إلغاء العملية بواسطة حامل البطاقة',
    CANCELLED: 'تم إلغاء العملية بواسطة العميل',
    CANCELED: 'تم إلغاء العملية بواسطة العميل',
    TIMEOUT: 'انتهت مهلة إدخال البطاقة أو الرقم السري',
  };

  return codeMap[clean] || fallbackMessage || `تم رفض العملية من البنك (رمز الاستجابة: ${clean})`;
}

export interface TerminalPaymentRequest {
  terminalId?: string;
  amount: number;
  currency?: string;
  invoiceReference?: string;
  cashierShiftId?: string | number;
}

export interface TerminalPaymentSession {
  tenantId: string;
  transactionId: string;
  terminalId: string;
  terminalName: string;
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'approved' | 'declined' | 'cancelled';
  approvalCode?: string;
  rrn?: string;
  cardScheme?: string; // Mada, Visa, Mastercard, Meeza, KNET
  cardLastFour?: string;
  createdAt: number;
  updatedAt: number;
  message?: string;
  provider?: string;
  isSimulated?: boolean;
}

export interface TerminalConnectionTestResult {
  reachable: boolean;
  pingSucceeded: boolean;
  portOpen: boolean;
  ip: string;
  port: number;
  latencyMs?: number;
  message: string;
  details?: string;
  provider?: string;
}

export interface BridgeJob {
  jobId: string;
  tenantId: string;
  ip: string;
  port: number;
  provider: string;
  amount: number;
  currency: string;
  referenceId: string;
  terminalTid?: string;
  pairingKey?: string;
}

export interface BridgePoller {
  resolve: (data: { hasJob: boolean; job?: BridgeJob }) => void;
  timeout: NodeJS.Timeout;
}
