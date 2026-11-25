import { Inject, Injectable, Logger, BadRequestException } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import * as tls from 'tls';
import nodemailer from 'nodemailer';

export interface MaritimeMailConfig {
  outgoingProvider: 'outlook' | 'gmail' | 'custom';
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword?: string;
  fromName: string;
  fromEmail: string;

  incomingProvider: 'outlook' | 'gmail' | 'custom';
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPassword?: string;

  autoReadInboundBids: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncDetails?: string | null;

  // Custom RFQ Email Template & Dynamic Tags
  emailSubjectTemplate?: string;
  emailIntroTemplate?: string;
  emailSignatureTemplate?: string;
}

@Injectable()
export class MaritimeMailService {
  private readonly logger = new Logger(MaritimeMailService.name);
  private readonly SETTINGS_KEY = 'maritime_mail_config';

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
  ) {}

  private async getTenantCompanyProfile(tenantId: string): Promise<{
    companyName: string;
    companyEmail: string;
    companyPhone: string;
  }> {
    const tenantRow = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'owner_email', 'owner_phone'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    const companySettingsRows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'in', ['companyName', 'storeName', 'email', 'phone'])
      .execute();

    const settingsMap = companySettingsRows.reduce<Record<string, string>>((acc, r) => {
      try { acc[r.key] = JSON.parse(r.value); } catch { acc[r.key] = r.value; }
      return acc;
    }, {});

    return {
      companyName: settingsMap.companyName || settingsMap.storeName || tenantRow?.business_name || 'إدارة الشحن واللوجستيات',
      companyEmail: settingsMap.email || tenantRow?.owner_email || '',
      companyPhone: settingsMap.phone || tenantRow?.owner_phone || '',
    };
  }

  async getMailSettings(auth: AuthContext): Promise<MaritimeMailConfig> {
    const { tenantId } = requireTenantScope(auth);
    const companyProfile = await this.getTenantCompanyProfile(tenantId);

    const row = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', this.SETTINGS_KEY)
      .executeTakeFirst();

    const standardTemplates = {
      subject: '[{{rfq_number}}] Ocean Freight Rate Inquiry: {{pol_name}} to {{pod_name}} ({{container_count}}x {{container_type}})',
      intro: 'Dear {{carrier_name}} Pricing Desk,\n\nPlease provide your most competitive ocean freight spot rate for the following containerized shipment:',
      signature: 'Best regards,\n{{company_name}} Operations & Maritime Procurement Desk\n{{company_email}}',
    };

    if (!row?.value) {
      // Return default configuration dynamically pre-populated with tenant identity
      return {
        outgoingProvider: 'custom',
        smtpHost: 'mail.yourcompany.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: '',
        smtpPassword: '',
        fromName: companyProfile.companyName,
        fromEmail: companyProfile.companyEmail,
        incomingProvider: 'custom',
        imapHost: 'mail.yourcompany.com',
        imapPort: 993,
        imapSecure: true,
        imapUser: '',
        imapPassword: '',
        autoReadInboundBids: true,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncDetails: null,
        emailSubjectTemplate: standardTemplates.subject,
        emailIntroTemplate: standardTemplates.intro,
        emailSignatureTemplate: standardTemplates.signature,
      };
    }

    try {
      const parsed: MaritimeMailConfig = JSON.parse(row.value);
      return {
        ...parsed,
        outgoingProvider: parsed.outgoingProvider || 'custom',
        smtpHost: parsed.smtpHost || 'mail.yourcompany.com',
        smtpPort: parsed.smtpPort || 465,
        smtpSecure: parsed.smtpSecure ?? true,
        incomingProvider: parsed.incomingProvider || 'custom',
        imapHost: parsed.imapHost || 'mail.yourcompany.com',
        imapPort: parsed.imapPort || 993,
        imapSecure: parsed.imapSecure ?? true,
        smtpUser: parsed.smtpUser || '',
        imapUser: parsed.imapUser || '',
        fromName: parsed.fromName?.trim() || companyProfile.companyName,
        fromEmail: parsed.fromEmail?.trim() || companyProfile.companyEmail,
        emailSubjectTemplate: parsed.emailSubjectTemplate?.trim() || standardTemplates.subject,
        emailIntroTemplate: parsed.emailIntroTemplate?.trim() || standardTemplates.intro,
        emailSignatureTemplate: parsed.emailSignatureTemplate?.trim() || standardTemplates.signature,
        // Mask passwords before sending to frontend
        smtpPassword: parsed.smtpPassword ? '••••••••••••' : '',
        imapPassword: parsed.imapPassword ? '••••••••••••' : '',
      };
    } catch {
      return {} as any;
    }
  }

  async saveMailSettings(auth: AuthContext, dto: Partial<MaritimeMailConfig>): Promise<MaritimeMailConfig> {
    const { tenantId } = requireTenantScope(auth);
    const companyProfile = await this.getTenantCompanyProfile(tenantId);

    // Retrieve existing to retain passwords if masked
    const existingRow = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', this.SETTINGS_KEY)
      .executeTakeFirst();

    let currentConfig: Partial<MaritimeMailConfig> = {};
    if (existingRow?.value) {
      try {
        currentConfig = JSON.parse(existingRow.value);
      } catch {
        currentConfig = {};
      }
    }

    const isMasked = (str?: string) => !str || str.includes('•') || str === '••••••••••••';

    const resolvedUser = dto.smtpUser !== undefined ? dto.smtpUser.trim() : (currentConfig.smtpUser || '').trim();
    const resolvedFromEmail = (dto.fromEmail && dto.fromEmail.includes('@'))
      ? dto.fromEmail.trim()
      : (resolvedUser && resolvedUser.includes('@') ? resolvedUser : (currentConfig.fromEmail || resolvedUser || companyProfile.companyEmail));

    const mergedConfig: MaritimeMailConfig = {
      outgoingProvider: dto.outgoingProvider || currentConfig.outgoingProvider || 'custom',
      smtpHost: dto.smtpHost || currentConfig.smtpHost || 'mail.yourcompany.com',
      smtpPort: Number(dto.smtpPort || currentConfig.smtpPort || 465),
      smtpSecure: Boolean(dto.smtpSecure ?? currentConfig.smtpSecure ?? true),
      smtpUser: resolvedUser,
      smtpPassword: isMasked(dto.smtpPassword) ? currentConfig.smtpPassword || '' : dto.smtpPassword,
      fromName: dto.fromName?.trim() || currentConfig.fromName?.trim() || companyProfile.companyName,
      fromEmail: resolvedFromEmail,

      incomingProvider: dto.incomingProvider || currentConfig.incomingProvider || 'custom',
      imapHost: dto.imapHost || currentConfig.imapHost || 'mail.yourcompany.com',
      imapPort: Number(dto.imapPort || currentConfig.imapPort || 993),
      imapSecure: Boolean(dto.imapSecure ?? currentConfig.imapSecure ?? true),
      imapUser: dto.imapUser !== undefined ? dto.imapUser.trim() : (currentConfig.imapUser || resolvedUser || ''),
      imapPassword: isMasked(dto.imapPassword) ? currentConfig.imapPassword || '' : dto.imapPassword,

      autoReadInboundBids: Boolean(dto.autoReadInboundBids ?? currentConfig.autoReadInboundBids ?? true),
      lastSyncAt: currentConfig.lastSyncAt || null,
      lastSyncStatus: currentConfig.lastSyncStatus || null,
      lastSyncDetails: currentConfig.lastSyncDetails || null,

      emailSubjectTemplate: dto.emailSubjectTemplate !== undefined ? dto.emailSubjectTemplate : currentConfig.emailSubjectTemplate,
      emailIntroTemplate: dto.emailIntroTemplate !== undefined ? dto.emailIntroTemplate : currentConfig.emailIntroTemplate,
      emailSignatureTemplate: dto.emailSignatureTemplate !== undefined ? dto.emailSignatureTemplate : currentConfig.emailSignatureTemplate,
      companyOfficialEmail: (dto as any)?.companyOfficialEmail !== undefined
        ? String((dto as any).companyOfficialEmail).trim()
        : ((currentConfig as any)?.companyOfficialEmail || ''),
    } as any;

    // Save to settings table
    const jsonValue = JSON.stringify(mergedConfig);
    const existing = await this.db
      .selectFrom('settings')
      .select('key')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', this.SETTINGS_KEY)
      .executeTakeFirst();

    if (existing) {
      await this.db
        .updateTable('settings')
        .set({ value: jsonValue })
        .where('tenant_id', '=', tenantId)
        .where('key', '=', this.SETTINGS_KEY)
        .execute();
    } else {
      await this.db
        .insertInto('settings')
        .values({
          tenant_id: tenantId,
          key: this.SETTINGS_KEY,
          value: jsonValue,
        })
        .execute();
    }

    return {
      ...mergedConfig,
      smtpPassword: mergedConfig.smtpPassword ? '••••••••••••' : '',
      imapPassword: mergedConfig.imapPassword ? '••••••••••••' : '',
    };
  }

  private async getRawMailConfig(tenantId: string): Promise<MaritimeMailConfig | null> {
    const row = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', this.SETTINGS_KEY)
      .executeTakeFirst();

    if (!row?.value) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  async testConnection(auth: AuthContext, customDto?: Partial<MaritimeMailConfig>) {
    const { tenantId } = requireTenantScope(auth);
    const savedConfig = await this.getRawMailConfig(tenantId);
    const isMasked = (str?: string) => !str || str.includes('•') || str === '••••••••••••';

    const config: MaritimeMailConfig = {
      outgoingProvider: customDto?.outgoingProvider || savedConfig?.outgoingProvider || 'outlook',
      smtpHost: customDto?.smtpHost || savedConfig?.smtpHost || 'smtp.office365.com',
      smtpPort: Number(customDto?.smtpPort || savedConfig?.smtpPort || 587),
      smtpSecure: Boolean(customDto?.smtpSecure ?? savedConfig?.smtpSecure ?? false),
      smtpUser: customDto?.smtpUser !== undefined ? customDto.smtpUser : savedConfig?.smtpUser || '',
      smtpPassword: isMasked(customDto?.smtpPassword) ? savedConfig?.smtpPassword || '' : customDto?.smtpPassword,
      fromName: customDto?.fromName || savedConfig?.fromName || 'إدارة الشحن',
      fromEmail: customDto?.fromEmail || savedConfig?.fromEmail || customDto?.smtpUser || '',

      incomingProvider: customDto?.incomingProvider || savedConfig?.incomingProvider || 'outlook',
      imapHost: customDto?.imapHost || savedConfig?.imapHost || 'outlook.office365.com',
      imapPort: Number(customDto?.imapPort || savedConfig?.imapPort || 993),
      imapSecure: Boolean(customDto?.imapSecure ?? savedConfig?.imapSecure ?? true),
      imapUser: customDto?.imapUser !== undefined ? customDto.imapUser : savedConfig?.imapUser || '',
      imapPassword: isMasked(customDto?.imapPassword) ? savedConfig?.imapPassword || '' : customDto?.imapPassword,

      autoReadInboundBids: true,
    };

    const results: {
      smtpOk: boolean;
      smtpMessage: string;
      imapOk: boolean;
      imapMessage: string;
    } = {
      smtpOk: false,
      smtpMessage: '',
      imapOk: false,
      imapMessage: '',
    };

    // 1. Test SMTP
    if (!config.smtpHost || !config.smtpUser || !config.smtpPassword) {
      results.smtpOk = false;
      results.smtpMessage = 'يرجى إدخال اسم المضيف واسم المستخدم وكلمة مرور خادم SMTP';
    } else {
      try {
        const transporter = nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpSecure || config.smtpPort === 465,
          auth: {
            user: config.smtpUser,
            pass: config.smtpPassword,
          },
          tls: {
            rejectUnauthorized: false,
          },
        });

        await transporter.verify();
        results.smtpOk = true;
        results.smtpMessage = 'تم التحقق من خادم الإرسال (SMTP) والاتصال بنجاح ✓';
      } catch (err: any) {
        results.smtpOk = false;
        results.smtpMessage = `فشل اتصال SMTP: ${err?.message || 'تعذر الاتصال بالسيرفر'}`;
      }
    }

    // 2. Test IMAP
    if (!config.imapHost || !config.imapUser || !config.imapPassword) {
      results.imapOk = false;
      results.imapMessage = 'يرجى إدخال اسم المضيف واسم المستخدم وكلمة مرور خادم IMAP';
    } else {
      const imapRes = await this.rawTestImap(config.imapHost, config.imapPort, config.imapUser, config.imapPassword);
      results.imapOk = imapRes.ok;
      results.imapMessage = imapRes.message;
    }

    return results;
  }

  private async rawTestImap(host: string, port: number, user: string, pass: string): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      let resolved = false;
      const socket = tls.connect({
        host,
        port: port || 993,
        rejectUnauthorized: false,
      });

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve({ ok: false, message: 'انتهت مهلة الاتصال بخادم IMAP (Connection Timeout)' });
        }
      }, 10000);

      let step = 0;
      let buffer = '';

      socket.on('data', (data) => {
        buffer += data.toString();
        if (step === 0 && buffer.includes('* OK')) {
          step = 1;
          buffer = '';
          socket.write(`A01 LOGIN "${user}" "${pass}"\r\n`);
        } else if (step === 1) {
          if (buffer.includes('A01 OK')) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              socket.write(`A02 LOGOUT\r\n`);
              socket.end();
              resolve({ ok: true, message: 'تم الاتصال وتسجيل الدخول بخادم الاستقبال (IMAP) بنجاح ✓' });
            }
          } else if (buffer.includes('A01 NO') || buffer.includes('A01 BAD')) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              socket.destroy();
              resolve({ ok: false, message: 'فشل تسجيل الدخول بخادم IMAP: يرجى التأكد من البريد وكلمة المرور (أو App Password للأوتلوك/جيميل)' });
            }
          }
        }
      });

      socket.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({ ok: false, message: `خطأ اتصال بخادم IMAP: ${err.message}` });
        }
      });
    });
  }

  async sendTestEmail(auth: AuthContext, targetEmail: string) {
    const { tenantId } = requireTenantScope(auth);
    const config = await this.getRawMailConfig(tenantId);

    if (!config?.smtpHost || !config.smtpUser || !config.smtpPassword) {
      throw new BadRequestException('إعدادات البريد الإلكتروني غير مكتملة. يرجى حفظ السيرفر وبيانات الدخول أولاً.');
    }

    const senderEmail = (config.fromEmail && config.fromEmail.includes('@')) ? config.fromEmail : config.smtpUser;

    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure || config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPassword,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    try {
      const testEmailHtml = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;" dir="rtl">
            <div style="background: #170e5e; color: #ffffff; padding: 20px; text-align: center;">
              <h2 style="margin: 0; font-size: 1.25rem;">منظومة الشحن البحري واللوجستيات</h2>
              <p style="margin: 6px 0 0 0; font-size: 0.85rem; color: #cbd5e1;">Z-Systems Ocean Freight Automation</p>
            </div>
            <div style="padding: 24px; background: #ffffff;">
              <p style="font-weight: bold; font-size: 1rem; color: #15803d;">تهانينا! تم اختبار إرسال البريد الإلكتروني بنجاح.</p>
              <p style="color: #475569; font-size: 0.9rem;">
                هذه الرسالة تؤكد أن خادم الإرسال (SMTP) الخاص بشركتكم اللوجستية يعمل بكفاءة وجاهز لإرسال طلبات التسعير (RFQs) وعروض الأسعار وإشعارات الشحن لعملائكم وخطوط الملاحة.
              </p>
              <div style="background: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 18px 0; font-size: 0.82rem;">
                <div><strong>خادم SMTP:</strong> ${config.smtpHost}:${config.smtpPort}</div>
                <div style="margin-top: 4px;"><strong>البريد المرسل:</strong> ${senderEmail}</div>
                <div style="margin-top: 4px;"><strong>وقت الفحص:</strong> ${new Date().toLocaleString('ar-EG')}</div>
              </div>
            </div>
          </div>
        `;

      const info = await transporter.sendMail({
        from: `"${config.fromName || 'Z-Systems Maritime'}" <${senderEmail}>`,
        to: targetEmail,
        subject: `[Z-Systems] اختبار اتصال خادم البريد الملاحي بنجاح`,
        html: testEmailHtml,
      });

      // Automatically archive a copy into IMAP Sent folder
      this.appendSentEmailToImap(tenantId, {
        fromName: config.fromName || 'Z-Systems Maritime',
        fromEmail: senderEmail,
        to: targetEmail,
        subject: `[Z-Systems] اختبار اتصال خادم البريد الملاحي بنجاح`,
        html: testEmailHtml,
      }).catch((e) => this.logger.warn(`Failed to archive test email to Sent: ${e.message}`));

      return { success: true, messageId: info.messageId, recipient: targetEmail };
    } catch (err: any) {
      this.logger.error(`Failed to send test email: ${err?.message}`);
      throw new BadRequestException(`فشل إرسال البريد التجريبي: ${err?.message || 'خطأ في خادم البريد'}`);
    }
  }

  /**
   * Automatically archives an exact copy of an outgoing email into the IMAP "Sent" folder.
   * Dynamically discovers the Sent mailbox (e.g. INBOX.Sent, Sent, Sent Items)
   * Runs asynchronously without blocking the user interface or email flow.
   */
  async appendSentEmailToImap(
    tenantId: string,
    emailData: {
      fromName: string;
      fromEmail: string;
      to: string;
      subject: string;
      html: string;
    },
  ): Promise<boolean> {
    const config = await this.getRawMailConfig(tenantId);
    if (!config?.imapHost || !config.imapUser || !config.imapPassword) {
      return false;
    }

    const rawMessage = [
      `From: "${emailData.fromName}" <${emailData.fromEmail}>`,
      `To: ${emailData.to}`,
      `Subject: ${emailData.subject}`,
      `Date: ${new Date().toUTCString()}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      emailData.html,
    ].join('\r\n');

    const byteLength = Buffer.byteLength(rawMessage, 'utf8');

    return new Promise((resolve) => {
      let resolved = false;
      const socket = tls.connect({
        host: config.imapHost,
        port: config.imapPort || 993,
        rejectUnauthorized: false,
      });

      const finish = (result: boolean) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          try {
            socket.write('A99 LOGOUT\r\n');
            socket.end();
          } catch {
            // ignore
          }
          resolve(result);
        }
      };

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { socket.destroy(); } catch {}
          resolve(false);
        }
      }, 15000);

      let step = 0;
      let buffer = '';
      let targetSentFolder = 'INBOX.Sent';

      socket.on('data', (d) => {
        buffer += d.toString();

        if (step === 0 && buffer.includes('* OK')) {
          step = 1;
          buffer = '';
          socket.write(`A01 LOGIN "${config.imapUser}" "${config.imapPassword}"\r\n`);
        } else if (step === 1) {
          if (buffer.includes('A01 OK')) {
            step = 2;
            buffer = '';
            socket.write('A02 LIST "" "*"\r\n');
          } else if (buffer.includes('A01 NO') || buffer.includes('A01 BAD')) {
            finish(false);
          }
        } else if (step === 2 && buffer.includes('A02 OK')) {
          // Parse LIST output for mailbox with \Sent flag or name ending in Sent
          const listLines = buffer.split('\r\n');
          for (const line of listLines) {
            if (/\\Sent/i.test(line)) {
              const match = line.match(/\* LIST \([^)]*\) "[^"]*" "?([^"\r\n]+)"?/i);
              if (match && match[1]) {
                targetSentFolder = match[1].trim();
                break;
              }
            }
          }
          step = 3;
          buffer = '';
          socket.write(`A03 APPEND "${targetSentFolder}" (\\Seen) {${byteLength}}\r\n`);
        } else if (step === 3) {
          if (buffer.includes('+')) {
            step = 4;
            buffer = '';
            socket.write(rawMessage + '\r\n');
          } else if (buffer.includes('A03 NO') || buffer.includes('A03 BAD')) {
            if (targetSentFolder !== 'Sent') {
              targetSentFolder = 'Sent';
              step = 3;
              buffer = '';
              socket.write(`A03 APPEND "Sent" (\\Seen) {${byteLength}}\r\n`);
            } else {
              finish(false);
            }
          }
        } else if (step === 4) {
          if (buffer.includes('A03 OK')) {
            this.logger.log(`Successfully archived outgoing email into IMAP Sent folder [${targetSentFolder}]`);
            finish(true);
          } else if (buffer.includes('A03 NO') || buffer.includes('A03 BAD')) {
            this.logger.warn(`IMAP append to [${targetSentFolder}] failed: ${buffer.trim()}`);
            finish(false);
          }
        }
      });

      socket.on('error', (err) => {
        this.logger.warn(`IMAP append error: ${err.message}`);
        finish(false);
      });
    });
  }

  // --------------------------------------------------------------------------
  // Inbound Carrier Bids Automation (IMAP Reader & Parser)
  // --------------------------------------------------------------------------
  async syncInboundBids(auth: AuthContext, parseCarrierEmailTextFn: (text: string) => any) {
    const { tenantId } = requireTenantScope(auth);
    const config = await this.getRawMailConfig(tenantId);

    if (!config?.imapHost || !config.imapUser || !config.imapPassword) {
      throw new BadRequestException('إعدادات خادم الاستقبال (IMAP) غير مكتملة. يرجى إدخال السيرفر وكلمة المرور أولاً.');
    }

    // Perform IMAP search and bid extraction
    const syncResult = await this.readImapInboxForRfqs(config, tenantId, parseCarrierEmailTextFn);

    // Save last sync result
    const nowIso = new Date().toISOString();
    await this.db
      .updateTable('settings')
      .set({
        value: JSON.stringify({
          ...config,
          lastSyncAt: nowIso,
          lastSyncStatus: syncResult.error ? 'failed' : 'success',
          lastSyncDetails: syncResult.summary,
        }),
      })
      .where('tenant_id', '=', tenantId)
      .where('key', '=', this.SETTINGS_KEY)
      .execute();

    return syncResult;
  }

  private async readImapInboxForRfqs(
    config: MaritimeMailConfig,
    tenantId: string,
    parseCarrierEmailTextFn: (text: string) => any,
  ): Promise<{ scanned: number; imported: number; summary: string; error?: string }> {
    return new Promise((resolve) => {
      let resolved = false;
      const socket = tls.connect({
        host: config.imapHost,
        port: config.imapPort || 993,
        rejectUnauthorized: false,
      });

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve({ scanned: 0, imported: 0, summary: 'انتهت مهلة المزامنة مع خادم IMAP', error: 'TIMEOUT' });
        }
      }, 25000);

      let step = 0;
      let buffer = '';
      let msgIds: number[] = [];
      let importedCount = 0;

      socket.on('data', async (data) => {
        buffer += data.toString();

        if (step === 0 && buffer.includes('* OK')) {
          step = 1;
          buffer = '';
          socket.write(`A01 LOGIN "${config.imapUser}" "${config.imapPassword}"\r\n`);
        } else if (step === 1 && buffer.includes('A01 OK')) {
          step = 2;
          buffer = '';
          socket.write(`A02 SELECT INBOX\r\n`);
        } else if (step === 2 && buffer.includes('A02 OK')) {
          step = 3;
          buffer = '';
          // Search all messages in inbox
          socket.write(`A03 SEARCH ALL\r\n`);
        } else if (step === 3 && (buffer.includes('A03 OK') || buffer.includes('A03 NO'))) {
          // Parse message IDs from * SEARCH 1 2 3 ...
          const searchMatch = buffer.match(/\*\s+SEARCH\s+([\d\s]+)/i);
          if (searchMatch && searchMatch[1]) {
            msgIds = searchMatch[1]
              .trim()
              .split(/\s+/)
              .map(Number)
              .filter((n) => n > 0);
          }

          if (msgIds.length === 0) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              socket.write(`A04 LOGOUT\r\n`);
              socket.end();
              resolve({
                scanned: 0,
                imported: 0,
                summary: 'تم فحص صندوق الوارد: لا توجد رسائل بريدية مسجلة في السيرفر',
              });
            }
            return;
          }

          // Fetch the latest 15 messages for performance
          const targetIds = msgIds.slice(-15);
          step = 4;
          buffer = '';
          socket.write(`A04 FETCH ${targetIds.join(',')} (BODY[TEXT] BODY[HEADER.FIELDS (SUBJECT FROM DATE)])\r\n`);
        } else if (step === 4 && buffer.includes('A04 OK')) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);

            try {
              // Parse each message chunk from buffer
              importedCount = await this.processImapRawBuffer(buffer, tenantId, parseCarrierEmailTextFn);
            } catch (err: any) {
              this.logger.error(`Error parsing IMAP buffer: ${err?.message}`);
            }

            socket.write(`A05 LOGOUT\r\n`);
            socket.end();

            resolve({
              scanned: msgIds.length,
              imported: importedCount,
              summary: `تم فحص ${msgIds.length} رسالة بريدية في صندوق الوارد، وتم استخراج وقيد ${importedCount} عرض سعر جديد آلياً بنجاح ✓`,
            });
          }
        }
      });

      socket.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({ scanned: 0, imported: 0, summary: `خطأ اتصال بسيرفر البريد: ${err.message}`, error: err.message });
        }
      });
    });
  }

  private async processImapRawBuffer(
    buffer: string,
    tenantId: string,
    parseCarrierEmailTextFn: (text: string) => any,
  ): Promise<number> {
    let imported = 0;
    const chunks = buffer.split(/\*\s+\d+\s+FETCH/i).filter((c) => c.trim().length > 0);

    for (const chunk of chunks) {
      const rfqMatch = chunk.match(/(?:\[|\b)(RFQ-\d{4,6}-\d{4,})(?:\]|\b)/i);
      if (!rfqMatch) continue;
      const rfqNumber = rfqMatch[1].trim();

      // Extract sender info
      let senderName = '';
      let senderEmail = '';
      const fromMatch = chunk.match(/From:\s*"?([^"<]+)?"?\s*<([^>]+)>/i) || chunk.match(/From:\s*([^\s\r\n]+)/i);
      if (fromMatch) {
        senderName = (fromMatch[1] || '').trim();
        senderEmail = (fromMatch[2] || fromMatch[1] || '').trim();
      }

      const rfq = await this.db
        .selectFrom('maritime_rfqs')
        .select(['id', 'status', 'rfq_number'])
        .where('tenant_id', '=', tenantId)
        .where('rfq_number', '=', rfqNumber)
        .executeTakeFirst();

      if (!rfq) continue;

      // Lookup registered carrier by email or domain
      let carrierId: string | null = null;
      let carrierName = senderName || 'وكيل ملاحي (رد بالبريد)';

      if (senderEmail) {
        const carrierRow = await this.db
          .selectFrom('shipping_lines')
          .select(['id', 'code', 'name_en', 'name_ar'])
          .where('tenant_id', '=', tenantId)
          .where((eb) => eb.or([
            eb('email', 'ilike', senderEmail),
            eb('rfq_email', 'ilike', senderEmail),
          ]))
          .executeTakeFirst();

        if (carrierRow) {
          carrierId = String(carrierRow.id);
          carrierName = carrierRow.name_en || carrierRow.name_ar || carrierRow.code;
        }
      }

      // Parse rate parameters
      const parsed = parseCarrierEmailTextFn(chunk);
      if (parsed.oceanFreight > 0) {
        const totalCost = parsed.totalEstimated || (parsed.oceanFreight + (parsed.thcOrigin || 0) + (parsed.thcDestination || 0));

        // Avoid exact duplicates
        const existingBid = await this.db
          .selectFrom('maritime_rfq_bids')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('rfq_id', '=', String(rfq.id))
          .where('total_freight_cost', '=', totalCost as any)
          .executeTakeFirst();

        if (!existingBid) {
          await this.db
            .insertInto('maritime_rfq_bids')
            .values({
              tenant_id: tenantId,
              rfq_id: String(rfq.id),
              shipping_line_id: carrierId,
              shipping_line_name: carrierName,
              ocean_freight: parsed.oceanFreight,
              currency: parsed.currency || 'USD',
              thc_origin: parsed.thcOrigin || 0,
              thc_destination: parsed.thcDestination || 0,
              total_freight_cost: totalCost,
              free_days: parsed.freeDays || 14,
              transit_time_days: parsed.transitTimeDays || 0,
              submission_channel: 'email_auto',
              notes: 'عرض سعر تم قراءته وفك تشفيره آلياً من بريد الرد الوارد عبر IMAP',
            })
            .execute();

          // Update RFQ status
          await this.db
            .updateTable('maritime_rfqs')
            .set({ status: 'bids_received', updated_at: sql`NOW()` })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', rfq.id)
            .execute();

          imported++;
        }
      }
    }

    return imported;
  }
}
