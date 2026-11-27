import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import { AppError } from '../../../common/errors/app-error';

export interface ParsedDeviceCredentials {
  username: string;
  password: string;
}

/**
 * Parses `comm_key` column into username/password for HTTP-based biometric devices (Hikvision / Dahua).
 * Supports `"username:password"` or bare `"password"` (defaults username to `"admin"`).
 */
export function parseHttpDeviceCredentials(commKey: string | null | undefined): ParsedDeviceCredentials {
  const raw = String(commKey || '').trim();
  if (!raw || raw === '0') {
    return { username: 'admin', password: '' };
  }
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0) {
    return {
      username: raw.slice(0, colonIdx).trim() || 'admin',
      password: raw.slice(colonIdx + 1),
    };
  }
  return { username: 'admin', password: raw };
}

export function maskDeviceCommKey(brand: string, commKey: string | null | undefined): string {
  const b = String(brand || '').toLowerCase();
  const raw = String(commKey || '').trim();
  if (b !== 'hikvision' && b !== 'dahua') {
    return raw || '0';
  }
  if (!raw || raw === '0') return '';
  const { username, password } = parseHttpDeviceCredentials(raw);
  return password ? `${username}:••••••••` : username;
}

export function normalizeGenericJsonPushToAttlogLines(payload: unknown): {
  serialNumber: string | null;
  lines: string[];
} {
  if (!payload || typeof payload !== 'object') {
    return { serialNumber: null, lines: [] };
  }
  const obj = payload as Record<string, unknown>;
  const serialNumber =
    String(obj.serialNumber || obj.serial_number || obj.sn || obj.SN || obj.deviceSerial || '').trim() || null;

  const rawItems: Array<Record<string, unknown>> = Array.isArray(obj.punches)
    ? (obj.punches as Array<Record<string, unknown>>)
    : Array.isArray(obj.records)
      ? (obj.records as Array<Record<string, unknown>>)
      : obj.pin || obj.employeeNo || obj.userId
        ? [obj]
        : [];

  const lines: string[] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const pin = String(item.pin || item.userId || item.employeeNo || item.employeeNoString || '').trim();
    const rawTime = String(item.timestamp || item.time || item.dateTime || item.punchedAt || '').trim();
    const dtMatch = rawTime.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})/);
    if (!pin || !dtMatch) continue;
    const verifyCode = String(item.verifyCode ?? item.verify ?? '1');
    const stRaw = String(item.status ?? item.direction ?? '0').toLowerCase();
    const statusCode = stRaw === '1' || stRaw === 'out' || stRaw === 'checkout' || stRaw === 'check_out' ? '1' : '0';
    lines.push(`${pin}\t${dtMatch[1]} ${dtMatch[2]}\t${verifyCode}\t${statusCode}\t0\t0`);
  }

  return { serialNumber, lines };
}

function hashDigest(algo: string, input: string): string {
  const normalized = algo.toUpperCase().replace(/-SESS$/, '');
  const nodeAlgo = normalized === 'SHA-256' || normalized === 'SHA256' ? 'sha256' : 'md5';
  return crypto.createHash(nodeAlgo).update(input, 'utf8').digest('hex');
}

export function parseDigestChallenge(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const cleaned = String(header || '').replace(/^Digest\s+/i, '');
  const rx = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|([^,\s]*))/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(cleaned)) !== null) {
    out[match[1].toLowerCase()] = match[2] !== undefined ? match[2] : match[3] || '';
  }
  return out;
}

export function buildDigestAuthorizationHeader(params: {
  method: string;
  uri: string;
  username: string;
  password: string;
  challengeHeader: string;
  nc?: string;
  cnonce?: string;
}): string {
  const ch = parseDigestChallenge(params.challengeHeader);
  const realm = ch.realm || '';
  const nonce = ch.nonce || '';
  const opaque = ch.opaque || '';
  const algorithm = ch.algorithm || 'MD5';
  const qopRaw = ch.qop || '';
  const qopOptions = qopRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const qop = qopOptions.includes('auth') ? 'auth' : qopOptions[0] || '';
  const nc = params.nc || '00000001';
  const cnonce = params.cnonce || crypto.randomBytes(8).toString('hex');

  const ha1 = hashDigest(algorithm, `${params.username}:${realm}:${params.password}`);
  const ha2 = hashDigest(algorithm, `${params.method.toUpperCase()}:${params.uri}`);

  const response = qop
    ? hashDigest(algorithm, `${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hashDigest(algorithm, `${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${params.username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${params.uri}"`,
    `response="${response}"`,
  ];
  if (ch.algorithm) parts.push(`algorithm=${algorithm}`);
  if (opaque) parts.push(`opaque="${opaque}"`);
  if (qop) {
    parts.push(`qop=${qop}`);
    parts.push(`nc=${nc}`);
    parts.push(`cnonce="${cnonce}"`);
  }
  return `Digest ${parts.join(', ')}`;
}

interface SimpleHttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function rawHttpRequest(options: {
  host: string;
  port: number;
  path: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  useHttps?: boolean;
}): Promise<SimpleHttpResponse> {
  return new Promise((resolve, reject) => {
    const transport = options.useHttps || options.port === 443 ? https : http;
    const reqHeaders: Record<string, string> = { ...(options.headers || {}) };
    if (options.body !== undefined) {
      reqHeaders['Content-Length'] = String(Buffer.byteLength(options.body, 'utf8'));
    }

    const req = transport.request(
      {
        hostname: options.host,
        port: options.port,
        path: options.path,
        method: options.method,
        headers: reqHeaders,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.setTimeout(options.timeoutMs ?? 4500, () => {
      req.destroy(new Error('ETIMEDOUT'));
    });
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(options.body, 'utf8');
    }
    req.end();
  });
}

/**
 * Executes an HTTP/HTTPS request with transparent RFC 2617 Digest (and Basic fallback) authentication.
 */
export async function digestHttpRequest(options: {
  host: string;
  port: number;
  path: string;
  method: 'GET' | 'POST';
  username: string;
  password: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<SimpleHttpResponse> {
  const first = await rawHttpRequest(options);
  if (first.statusCode !== 401) {
    return first;
  }

  const wwwAuth = String(first.headers['www-authenticate'] || '');
  if (!wwwAuth) {
    return first;
  }

  let authHeader: string;
  if (/^Digest\s+/i.test(wwwAuth)) {
    authHeader = buildDigestAuthorizationHeader({
      method: options.method,
      uri: options.path,
      username: options.username,
      password: options.password,
      challengeHeader: wwwAuth,
    });
  } else {
    const basic = Buffer.from(`${options.username}:${options.password}`, 'utf8').toString('base64');
    authHeader = `Basic ${basic}`;
  }

  return rawHttpRequest({
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: authHeader,
    },
  });
}

function normalizeIsoTimestampToLocalText(rawTime: string): string | null {
  const s = String(rawTime || '').trim();
  const match = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})/);
  if (!match) return null;
  return `${match[1]} ${match[2]}`;
}

function formatUnixSecondsInTimezone(epochSeconds: number, timezone: string): string | null {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
  } catch {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  }
}

function mapHikvisionAttendanceStatus(status: unknown): string {
  const s = String(status || '')
    .trim()
    .toLowerCase();
  if (s === 'checkout' || s === 'check_out' || s === 'breakout' || s === 'overtimeout') return '1';
  return '0';
}

function mapHikvisionVerifyCode(minor: unknown): string {
  const m = Number(minor || 0);
  if (m === 75 || m === 104) return '15'; // Face
  if (m === 38 || m === 39) return '1'; // Fingerprint
  if (m === 1 || m === 2 || m === 9) return '4'; // Card
  if (m === 25 || m === 26) return '0'; // Password
  return '1';
}

export function parseHikvisionDeviceInfoXml(xml: string): {
  deviceName: string;
  model: string;
  serialNumber: string;
} {
  const pick = (tag: string) => {
    const rx = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i');
    return (xml.match(rx)?.[1] || '').trim();
  };
  return {
    deviceName: pick('deviceName'),
    model: pick('model'),
    serialNumber: pick('serialNumber'),
  };
}

export function parseHikvisionAcsEventResponse(jsonBody: string): {
  lines: string[];
  totalMatches: number;
  numOfMatches: number;
  responseStatusStrg: string;
} {
  const parsed = JSON.parse(jsonBody || '{}');
  const acs = parsed?.AcsEvent || parsed || {};
  const list: any[] = Array.isArray(acs.InfoList) ? acs.InfoList : [];
  const lines: string[] = [];

  for (const item of list) {
    const pin = String(item.employeeNoString || item.employeeNo || item.cardNo || '').trim();
    const dt = normalizeIsoTimestampToLocalText(item.time || item.dateTime || '');
    if (!pin || !dt) continue;
    const verifyCode = mapHikvisionVerifyCode(item.minor);
    const statusCode = mapHikvisionAttendanceStatus(item.attendanceStatus);
    lines.push(`${pin}\t${dt}\t${verifyCode}\t${statusCode}\t0\t0`);
  }

  return {
    lines,
    totalMatches: Number(acs.totalMatches || list.length || 0),
    numOfMatches: Number(acs.numOfMatches || list.length || 0),
    responseStatusStrg: String(acs.responseStatusStrg || '').toUpperCase(),
  };
}

/**
 * Extracts normalized ATTLOG lines + device identifier from a Hikvision HTTP Listening real-time push
 * (supports both raw JSON and multipart/form-data event payloads sent by Hikvision terminals).
 */
export function parseHikvisionWebhookPayload(rawBody: string): {
  serialNumber: string | null;
  lines: string[];
} {
  const text = String(rawBody || '');
  let jsonCandidate = text.trim();

  if (!jsonCandidate.startsWith('{')) {
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (startIdx >= 0 && endIdx > startIdx) {
      jsonCandidate = text.slice(startIdx, endIdx + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonCandidate);
    const ev = parsed?.AccessControllerEvent || parsed?.AcsEvent || parsed || {};
    const serialNumber =
      String(parsed?.serialNumber || ev?.serialNo || ev?.deviceSerialNo || parsed?.macAddress || '').trim() || null;
    const pin = String(ev.employeeNoString || ev.employeeNo || ev.cardNo || '').trim();
    const dt = normalizeIsoTimestampToLocalText(parsed?.dateTime || ev.time || ev.dateTime || '');
    if (!pin || !dt) {
      return { serialNumber, lines: [] };
    }
    const verifyCode = mapHikvisionVerifyCode(ev.subEventType ?? ev.minor);
    const statusCode = mapHikvisionAttendanceStatus(ev.attendanceStatus);
    return {
      serialNumber,
      lines: [`${pin}\t${dt}\t${verifyCode}\t${statusCode}\t0\t0`],
    };
  } catch {
    return { serialNumber: null, lines: [] };
  }
}

export async function probeHikvisionLanDevice(
  ip: string,
  port: number,
  username: string,
  password: string,
): Promise<Record<string, unknown>> {
  const startMs = Date.now();
  try {
    const res = await digestHttpRequest({
      host: ip,
      port: port || 80,
      path: '/ISAPI/System/deviceInfo',
      method: 'GET',
      username,
      password,
      timeoutMs: 3500,
    });
    const latencyMs = Date.now() - startMs;
    if (res.statusCode === 401 || res.statusCode === 403) {
      return {
        reachable: true,
        ip,
        port,
        responseCode: res.statusCode,
        requiresCommKey: true,
        latencyMs,
        message: `جهاز Hikvision متصل (${latencyMs}ms) ولكنه رفض اسم المستخدم أو كلمة المرور (HTTP ${res.statusCode})`,
      };
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const info = parseHikvisionDeviceInfoXml(res.body);
      const label = [info.model || info.deviceName, info.serialNumber].filter(Boolean).join(' — ');
      return {
        reachable: true,
        ip,
        port,
        responseCode: res.statusCode,
        requiresCommKey: false,
        latencyMs,
        model: info.model || undefined,
        serialNumber: info.serialNumber || undefined,
        message: `متصل بجهاز Hikvision ISAPI بنجاح (${latencyMs}ms)${label ? ` — ${label}` : ''}`,
      };
    }
    return {
      reachable: false,
      ip,
      port,
      responseCode: res.statusCode,
      latencyMs,
      message: `استجاب جهاز Hikvision برمز غير متوقع (HTTP ${res.statusCode})`,
    };
  } catch (err: any) {
    return {
      reachable: false,
      ip,
      port,
      message: `تعذر الاتصال بجهاز Hikvision على ${ip}:${port} (${err?.code || err?.message || 'timeout'})`,
    };
  }
}

export async function fetchHikvisionLanAttendance(
  ip: string,
  port: number,
  username: string,
  password: string,
  fromDate: string,
  toDate: string,
): Promise<{ rawAttlogLines: string[]; deviceUsers: never[] }> {
  const allLines: string[] = [];
  const searchID = `zs-${Date.now()}`;
  const PAGE_SIZE = 30;
  const MAX_PAGES = 200;
  let position = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = JSON.stringify({
      AcsEventCond: {
        searchID,
        searchResultPosition: position,
        maxResults: PAGE_SIZE,
        major: 5,
        minor: 0,
        startTime: `${fromDate}T00:00:00`,
        endTime: `${toDate}T23:59:59`,
      },
    });

    const res = await digestHttpRequest({
      host: ip,
      port: port || 80,
      path: '/ISAPI/AccessControl/AcsEvent?format=json',
      method: 'POST',
      username,
      password,
      headers: { 'Content-Type': 'application/json' },
      body,
      timeoutMs: 8000,
    });

    if (res.statusCode === 401 || res.statusCode === 403) {
      throw new AppError(
        'رفض جهاز Hikvision بيانات الدخول (تأكد من اسم المستخدم وكلمة المرور)',
        'HR_BIOMETRIC_AUTH_FAILED',
        401,
      );
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new AppError(
        `فشل سحب الحركات من جهاز Hikvision (HTTP ${res.statusCode})`,
        'HR_BIOMETRIC_HIKVISION_FAILED',
        502,
      );
    }

    const parsed = parseHikvisionAcsEventResponse(res.body);
    allLines.push(...parsed.lines);

    if (parsed.responseStatusStrg !== 'MORE' || parsed.numOfMatches <= 0) {
      break;
    }
    position += parsed.numOfMatches;
    if (parsed.totalMatches > 0 && position >= parsed.totalMatches) {
      break;
    }
  }

  return { rawAttlogLines: allLines, deviceUsers: [] };
}

export function parseDahuaKeyValueMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    out[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
  }
  return out;
}

export function parseDahuaAccessRecords(text: string, timezone = 'Africa/Cairo'): string[] {
  const grouped = new Map<number, Record<string, string>>();
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const match = rawLine.trim().match(/^records\[(\d+)\]\.([^=]+)=(.*)$/);
    if (!match) continue;
    const idx = Number(match[1]);
    const key = match[2].trim();
    const val = match[3].trim();
    const entry = grouped.get(idx) || {};
    entry[key] = val;
    grouped.set(idx, entry);
  }

  const lines: string[] = [];
  const indices = Array.from(grouped.keys()).sort((a, b) => a - b);
  for (const idx of indices) {
    const rec = grouped.get(idx)!;
    // Status=1 means verified access/attendance event; skip denied/failed scans if Status is explicitly 0
    if (rec.Status !== undefined && rec.Status !== '' && rec.Status !== '1' && rec.Status.toLowerCase() !== 'true') {
      continue;
    }
    const pin = String(rec.UserID || rec.CardNo || '').trim();
    if (!pin) continue;

    let dt: string | null = null;
    if (rec.CreateTime && /^\d+$/.test(rec.CreateTime)) {
      dt = formatUnixSecondsInTimezone(Number(rec.CreateTime), timezone);
    } else if (rec.CreateTime) {
      dt = normalizeIsoTimestampToLocalText(rec.CreateTime);
    }
    if (!dt) continue;

    const method = Number(rec.Method || 0);
    const verifyCode = method === 15 ? '15' : method === 6 ? '1' : method === 1 ? '4' : method === 0 ? '0' : '1';
    const typeLower = String(rec.Type || rec.AttendanceState || '').toLowerCase();
    const statusCode = typeLower === 'exit' || typeLower === 'checkout' || typeLower === '1' ? '1' : '0';
    lines.push(`${pin}\t${dt}\t${verifyCode}\t${statusCode}\t0\t0`);
  }

  return lines;
}

export async function probeDahuaLanDevice(
  ip: string,
  port: number,
  username: string,
  password: string,
): Promise<Record<string, unknown>> {
  const startMs = Date.now();
  try {
    const res = await digestHttpRequest({
      host: ip,
      port: port || 80,
      path: '/cgi-bin/magicBox.cgi?action=getSystemInfo',
      method: 'GET',
      username,
      password,
      timeoutMs: 3500,
    });
    const latencyMs = Date.now() - startMs;
    if (res.statusCode === 401 || res.statusCode === 403) {
      return {
        reachable: true,
        ip,
        port,
        responseCode: res.statusCode,
        requiresCommKey: true,
        latencyMs,
        message: `جهاز Dahua متصل (${latencyMs}ms) ولكنه رفض اسم المستخدم أو كلمة المرور (HTTP ${res.statusCode})`,
      };
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const kv = parseDahuaKeyValueMap(res.body);
      const label = [kv.deviceType, kv.serialNumber].filter(Boolean).join(' — ');
      return {
        reachable: true,
        ip,
        port,
        responseCode: res.statusCode,
        requiresCommKey: false,
        latencyMs,
        model: kv.deviceType || undefined,
        serialNumber: kv.serialNumber || undefined,
        message: `متصل بجهاز Dahua CGI بنجاح (${latencyMs}ms)${label ? ` — ${label}` : ''}`,
      };
    }
    return {
      reachable: false,
      ip,
      port,
      responseCode: res.statusCode,
      latencyMs,
      message: `استجاب جهاز Dahua برمز غير متوقع (HTTP ${res.statusCode})`,
    };
  } catch (err: any) {
    return {
      reachable: false,
      ip,
      port,
      message: `تعذر الاتصال بجهاز Dahua على ${ip}:${port} (${err?.code || err?.message || 'timeout'})`,
    };
  }
}

export async function fetchDahuaLanAttendance(
  ip: string,
  port: number,
  username: string,
  password: string,
  fromDate: string,
  toDate: string,
  timezone = 'Africa/Cairo',
): Promise<{ rawAttlogLines: string[]; deviceUsers: never[] }> {
  const startEpoch = Math.floor(new Date(`${fromDate}T00:00:00Z`).getTime() / 1000) - 86400;
  const endEpoch = Math.floor(new Date(`${toDate}T23:59:59Z`).getTime() / 1000) + 86400;

  const createRes = await digestHttpRequest({
    host: ip,
    port: port || 80,
    path: '/cgi-bin/recordFinder.cgi?action=factory.create&name=AccessControlCardRec',
    method: 'GET',
    username,
    password,
    timeoutMs: 5000,
  });

  if (createRes.statusCode === 401 || createRes.statusCode === 403) {
    throw new AppError(
      'رفض جهاز Dahua بيانات الدخول (تأكد من اسم المستخدم وكلمة المرور)',
      'HR_BIOMETRIC_AUTH_FAILED',
      401,
    );
  }

  // Fallback to single-shot recordFinder.cgi?action=find when factory.create is unsupported on older Dahua firmware
  const createKv = parseDahuaKeyValueMap(createRes.body);
  const objectId = createKv.result;
  if (!objectId || createRes.statusCode < 200 || createRes.statusCode >= 300) {
    const directRes = await digestHttpRequest({
      host: ip,
      port: port || 80,
      path: `/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec&StartTime=${startEpoch}&EndTime=${endEpoch}&count=500`,
      method: 'GET',
      username,
      password,
      timeoutMs: 8000,
    });
    if (directRes.statusCode < 200 || directRes.statusCode >= 300) {
      throw new AppError(
        `فشل سحب الحركات من جهاز Dahua (HTTP ${directRes.statusCode})`,
        'HR_BIOMETRIC_DAHUA_FAILED',
        502,
      );
    }
    return {
      rawAttlogLines: parseDahuaAccessRecords(directRes.body, timezone),
      deviceUsers: [],
    };
  }

  const allLines: string[] = [];
  try {
    await digestHttpRequest({
      host: ip,
      port: port || 80,
      path: `/cgi-bin/recordFinder.cgi?action=startFind&object=${encodeURIComponent(objectId)}&condition.StartTime=${startEpoch}&condition.EndTime=${endEpoch}`,
      method: 'GET',
      username,
      password,
      timeoutMs: 5000,
    });

    const PAGE_COUNT = 100;
    const MAX_PAGES = 100;
    for (let page = 0; page < MAX_PAGES; page++) {
      const pageRes = await digestHttpRequest({
        host: ip,
        port: port || 80,
        path: `/cgi-bin/recordFinder.cgi?action=doFind&object=${encodeURIComponent(objectId)}&count=${PAGE_COUNT}`,
        method: 'GET',
        username,
        password,
        timeoutMs: 8000,
      });
      if (pageRes.statusCode < 200 || pageRes.statusCode >= 300) break;

      const kv = parseDahuaKeyValueMap(pageRes.body);
      const found = Number(kv.found || 0);
      if (found <= 0) break;

      allLines.push(...parseDahuaAccessRecords(pageRes.body, timezone));
      if (found < PAGE_COUNT) break;
    }
  } finally {
    await digestHttpRequest({
      host: ip,
      port: port || 80,
      path: `/cgi-bin/recordFinder.cgi?action=destroy&object=${encodeURIComponent(objectId)}`,
      method: 'GET',
      username,
      password,
      timeoutMs: 2500,
    }).catch(() => undefined);
  }

  return { rawAttlogLines: allLines, deviceUsers: [] };
}
