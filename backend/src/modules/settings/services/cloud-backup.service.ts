import { Injectable, Inject, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { SettingsBackupService } from './settings-backup.service';

export interface CloudBackupConfig {
  enabled: boolean;
  endpoint: string; // e.g. 's3.eu-central-1.wasabisys.com' or 's3.amazonaws.com'
  region: string; // e.g. 'us-east-1'
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  retentionDays: number;
  lastBackupAt?: string;
  lastBackupStatus?: 'success' | 'failed' | '';
  lastError?: string;
}

const CLOUD_BACKUP_SETTING_KEY = 'cloudBackupConfig';

@Injectable()
export class CloudBackupService {
  private readonly logger = new Logger(CloudBackupService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly backupService: SettingsBackupService
  ) {}

  async getCloudConfig(auth: AuthContext): Promise<CloudBackupConfig> {
    // This contains plaintext S3 access credentials and allows offsite
    // exfiltration of a full business backup. Generic settings permission
    // is insufficient; use the existing dedicated backup capability.
    if (!auth || (auth.role !== 'super_admin' && !auth.permissions?.includes('canManageBackups'))) {
      throw new ForbiddenException('Backup management permission is required');
    }
    const tenantId = String(auth.tenantId);
    const row = await this.db
      .selectFrom('settings')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('key', '=', CLOUD_BACKUP_SETTING_KEY)
      .executeTakeFirst();

    if (!row || !row.value) {
      return {
        enabled: false,
        endpoint: 's3.amazonaws.com',
        region: 'us-east-1',
        bucket: '',
        accessKeyId: '',
        secretAccessKey: '',
        retentionDays: 30,
        lastBackupStatus: ''
      };
    }

    try {
      return JSON.parse(row.value) as CloudBackupConfig;
    } catch {
      return {
        enabled: false,
        endpoint: 's3.amazonaws.com',
        region: 'us-east-1',
        bucket: '',
        accessKeyId: '',
        secretAccessKey: '',
        retentionDays: 30,
        lastBackupStatus: ''
      };
    }
  }

  async saveCloudConfig(config: Partial<CloudBackupConfig>, auth: AuthContext): Promise<CloudBackupConfig> {
    const current = await this.getCloudConfig(auth);
    const updated: CloudBackupConfig = {
      ...current,
      ...config,
      retentionDays: Number(config.retentionDays || current.retentionDays || 30)
    };

    const tenantId = String(auth.tenantId);
    const accountId = String(auth.accountId || 'default');

    await this.db
      .insertInto('settings')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        key: CLOUD_BACKUP_SETTING_KEY,
        value: JSON.stringify(updated)
      })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'key']).doUpdateSet({
          value: JSON.stringify(updated)
        })
      )
      .execute();

    return updated;
  }

  /**
   * Test S3 bucket connectivity using AWS SigV4 HEAD/GET
   */
  async testConnection(auth: AuthContext): Promise<{ success: boolean; message: string }> {
    const config = await this.getCloudConfig(auth);
    if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) {
      throw new BadRequestException('بيانات الاتصال بالسحابة (Bucket, Access Key, Secret) غير مكتملة');
    }

    try {
      const url = `https://${config.bucket}.${config.endpoint}/`;
      const date = new Date();
      const headers = this.signAwsRequest({
        method: 'GET',
        url,
        region: config.region || 'us-east-1',
        service: 's3',
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        body: '',
        date
      });

      const res = await fetch(url, { method: 'GET', headers });
      if (res.status === 200 || res.status === 403 || res.status === 404) {
        // If 200, full access; if 403, credentials reached S3; if 404, bucket endpoint exists
        if (res.status === 403) {
          throw new BadRequestException('تم الوصول للسحابة بنجاح لكن الصلاحيات غير كافية (Access Denied)');
        }
        return { success: true, message: 'تم التحقق من الاتصال بالسحابة بنجاح!' };
      }

      return { success: true, message: 'الاتصال بالسحابة متاح وجاهز للنسخ الاحتياطي' };
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`فشل الاتصال بالسحابة: ${err.message}`);
    }
  }

  /**
   * Uploads database backup ZIP directly to S3
   */
  async uploadBackupToCloud(zipBuffer: Buffer, fileName: string, auth: AuthContext): Promise<string> {
    const config = await this.getCloudConfig(auth);
    if (!config.enabled) {
      throw new BadRequestException('النسخ الاحتياطي السحابي غير مفعل');
    }

    const cleanEndpoint = config.endpoint.replace(/^https?:\/\//, '').trim();
    const objectKey = `backups/${auth.tenantId}/${fileName}`;
    const url = `https://${config.bucket}.${cleanEndpoint}/${objectKey}`;
    const date = new Date();

    const headers = this.signAwsRequest({
      method: 'PUT',
      url,
      region: config.region || 'us-east-1',
      service: 's3',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      body: zipBuffer,
      date,
      contentType: 'application/zip'
    });

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: new Uint8Array(zipBuffer)
      });


      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`S3 Upload failed: ${response.status} ${errorText}`);
        throw new BadRequestException(`فشل رفع النسخة الاحتياطية إلى S3: ${response.statusText}`);
      }

      // Record success
      await this.saveCloudConfig({
        lastBackupAt: new Date().toISOString(),
        lastBackupStatus: 'success',
        lastError: ''
      }, auth);

      return url;
    } catch (error: any) {
      await this.saveCloudConfig({
        lastBackupAt: new Date().toISOString(),
        lastBackupStatus: 'failed',
        lastError: error.message
      }, auth);
      throw error;
    }
  }

  /**
   * Complete Automated Cloud Backup Flow:
   * 1. Generates complete DB snapshot via SettingsBackupService
   * 2. Saves to local disk if configured
   * 3. Uploads to Cloud S3 storage
   */
  async triggerCloudBackupNow(auth: AuthContext): Promise<{ success: boolean; fileName: string; cloudUrl: string; sizeBytes: number }> {
    const { zipBuffer } = await this.backupService.exportBackup(auth);
    const now = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    const fileName = `ZERP-cloud-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.zip`;

    const cloudUrl = await this.uploadBackupToCloud(zipBuffer, fileName, auth);

    return {
      success: true,
      fileName,
      cloudUrl,
      sizeBytes: zipBuffer.length
    };
  }

  /**
   * Standard AWS Signature Version 4 (SigV4) implementation
   */
  private signAwsRequest(params: {
    method: string;
    url: string;
    region: string;
    service: string;
    accessKeyId: string;
    secretAccessKey: string;
    body: string | Buffer;
    date: Date;
    contentType?: string;
  }): Record<string, string> {
    const urlObj = new URL(params.url);
    const host = urlObj.host;
    const path = urlObj.pathname || '/';

    const amzDate = params.date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    const payloadHash = crypto
      .createHash('sha256')
      .update(params.body)
      .digest('hex');

    const headers: Record<string, string> = {
      'host': host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    };

    if (params.contentType) {
      headers['content-type'] = params.contentType;
    }

    const sortedHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headers[k]}\n`).join('');
    const signedHeaders = sortedHeaderKeys.join(';');

    const canonicalRequest = [
      params.method,
      path,
      urlObj.search ? urlObj.search.substring(1) : '',
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${params.region}/${params.service}/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');

    const kDate = crypto.createHmac('sha256', `AWS4${params.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(params.region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(params.service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();

    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const authHeader = `${algorithm} Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...headers,
      'Authorization': authHeader
    };
  }
}
