import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { Kysely } from 'kysely';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';

@Injectable()
export class SettingsSupportService {
  private readonly logger = new Logger(SettingsSupportService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  assertAdmin(auth?: AuthContext | null): asserts auth is AuthContext {
    if (!auth) throw new ForbiddenException('Authentication required');
    const canManage =
      auth.role === 'super_admin' ||
      auth.permissions.includes('settings') ||
      auth.permissions.includes('canManageSettings');
    if (!canManage) throw new ForbiddenException('Missing required permissions');
    requireTenantScope(auth);
  }

  async generateSupportBundle(actor: AuthContext): Promise<Buffer> {
    this.assertAdmin(actor);
    const { tenantId } = requireTenantScope(actor);
    const zip = new AdmZip();
    const auditRows = await this.db
      .selectFrom('audit_logs')
      .select(['id', 'action', 'event_code', 'details', 'created_at'])
      .where('tenant_id', '=', tenantId)
      .orderBy('id', 'desc')
      .limit(250)
      .execute();
    zip.addFile(
      'tenant-audit.json',
      Buffer.from(
        JSON.stringify(
          {
            tenantId,
            generatedAt: new Date().toISOString(),
            auditLogs: auditRows,
          },
          null,
          2,
        ),
        'utf8',
      ),
    );
    const buffer = zip.toBuffer();
    await this.audit
      .log('استخراج حزمة الدعم', `تم إنشاء حزمة الدعم الفني بواسطة ${actor.username}`, actor)
      .catch(() => undefined);
    return buffer;
  }

  /**
   * Internal generator without requiring interactive user auth (used by automated monthly scheduler)
   */
  async generateSupportBundleInternal(): Promise<Buffer> {
    const zip = new AdmZip();

    // 1. Health & Environment Snapshot (Allowlist only)
    const envAllowlist = ['APP_MODE', 'NODE_ENV', 'PORT', 'npm_package_version', 'PORTABLE_MODE'];
    const safeEnv: Record<string, string> = {};
    for (const key of envAllowlist) {
      if (process.env[key]) {
        safeEnv[key] = process.env[key]!;
      }
    }

    const healthSnapshot = {
      timestamp: new Date().toISOString(),
      appVersion: process.env.npm_package_version || '1.1.30',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      env: safeEnv,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
    };

    zip.addFile('health.json', Buffer.from(JSON.stringify(healthSnapshot, null, 2), 'utf8'));

    // 2. Read Update Markers
    const rootDir = process.cwd();
    const updateMarkers = ['.update_pending', '.update_failed', '.update_ready'];
    const statusSnapshot: Record<string, boolean> = {};
    for (const marker of updateMarkers) {
      try {
        await fs.access(path.join(rootDir, marker));
        statusSnapshot[marker] = true;
      } catch {
        statusSnapshot[marker] = false;
      }
    }
    zip.addFile('status.json', Buffer.from(JSON.stringify(statusSnapshot, null, 2), 'utf8'));

    // 3. Collect Logs from multiple possible paths (root, runtime, parent)
    const candidateDirs = [
      path.join(rootDir, 'logs'),
      path.join(rootDir, '..', 'logs'),
      path.join(rootDir, 'runtime', 'data', 'logs'),
      path.join(rootDir, 'runtime', 'logs'),
      path.join(rootDir, 'runtime', 'run', 'logs'),
    ];

    const addedFiles = new Set<string>();
    const tailLines = parseInt(process.env.SUPPORT_BUNDLE_LOG_TAIL_LINES || '2500', 10);

    for (const logsDir of candidateDirs) {
      try {
        if (!fsSync.existsSync(logsDir)) continue;
        const files = await fs.readdir(logsDir);
        for (const file of files) {
          if (file.endsWith('.log') && !addedFiles.has(file)) {
            addedFiles.add(file);
            const content = await fs.readFile(path.join(logsDir, file), 'utf8');
            // Basic redaction for tokens/passwords
            const redacted = content
              .replace(/(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, '[REDACTED_JWT]')
              .replace(
                /(password|secret|pwd|pass|token|smtp_pass|smtp_user|session_?id|sid)[\s:=]+['"]?[^'"\s,]+['"]?/gi,
                '$1=[REDACTED]',
              )
              .replace(/(?:mongodb|postgres|mysql|redis):\/\/[^"\s]+/gi, '[REDACTED_CONNECTION_STRING]');

            const lines = redacted.split('\n');
            const tail = lines.slice(-tailLines).join('\n');

            zip.addFile(`logs/${file}`, Buffer.from(tail, 'utf8'));
          }
        }
      } catch {
        // Continue searching next candidate dir
      }
    }

    return zip.toBuffer();
  }

  async resolveClientMeta(
    tenantId?: string,
  ): Promise<{ clientName: string; clientIdentifier: string; appVersion: string }> {
    let clientName = tenantId ? '' : 'Platform diagnostics';
    let clientIdentifier = tenantId || 'platform';
    const appVersion = process.env.npm_package_version || '1.1.30';

    try {
      const tenant = tenantId
        ? await this.db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst()
        : null;
      if (tenant?.business_name) {
        clientName = tenant.business_name;
        if (tenant.id) clientIdentifier = String(tenant.id);
      }

      if (!clientName && tenantId) {
        const storeSetting = await this.db
          .selectFrom('settings')
          .select(['value'])
          .where('tenant_id', '=', tenantId)
          .where('key', 'in', ['storeName', 'companyName'])
          .executeTakeFirst();
        if (storeSetting?.value) {
          try {
            clientName = JSON.parse(storeSetting.value);
          } catch {
            clientName = storeSetting.value;
          }
        }
      }
    } catch {
      // Fallback
    }

    if (!clientName) clientName = tenantId || 'Platform diagnostics';
    return { clientName, clientIdentifier, appVersion };
  }

  async uploadSupportBundleToServer(actor?: AuthContext, existingBuffer?: Buffer) {
    if (actor) {
      this.assertAdmin(actor);
    }

    const bundleBuffer =
      existingBuffer || (actor ? await this.generateSupportBundle(actor) : await this.generateSupportBundleInternal());
    const { clientName, clientIdentifier, appVersion } = await this.resolveClientMeta(
      actor ? requireTenantScope(actor).tenantId : undefined,
    );

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const logPeriod = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

    const centralUrl =
      process.env.CENTRAL_DIAGNOSTICS_URL || 'https://app.zsystemai.com/api/v1/saas-admin/diagnostics/upload';

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(bundleBuffer)], { type: 'application/zip' }),
      `diagnostics_${logPeriod}.zip`,
    );
    formData.append('clientName', clientName);
    formData.append('clientIdentifier', clientIdentifier);
    formData.append('appVersion', appVersion);
    formData.append('logPeriod', logPeriod);

    try {
      const response = await fetch(centralUrl, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(20000), // 20s timeout
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`رد السيرفر بخطأ (${response.status}): ${errText || 'فشل رفع الحزمة'}`);
      }

      const resJson = await response.json().catch(() => ({}));

      if (actor) {
        await this.audit
          .log(
            'إرسال تقرير الدعم الفني',
            `تم رفع تقرير الدعم الفني إلى السيرفر المركزي بنجاح بواسطة ${actor.username}`,
            actor,
          )
          .catch(() => undefined);
      }

      return {
        success: true,
        message: 'تم إرسال تقرير الدعم الفني بنجاح إلى الإدارة المركزية.',
        data: resJson,
      };
    } catch (err: any) {
      this.logger.warn(`Failed to upload support bundle to central server: ${err?.message}`);
      throw new Error(err?.message || 'تعذر الاتصال بالسيرفر المركزي لرفع التقرير');
    }
  }
}
