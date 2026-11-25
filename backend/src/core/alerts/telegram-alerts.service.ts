import { Inject, Injectable, Logger } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../auth/utils/tenant-boundary';

export interface TelegramAlertSettings {
  enabled: boolean;
  botToken: string;
  chatId: string;
  notifyOnCriticalErrors: boolean;
  notifyOnDeployments: boolean;
}

@Injectable()
export class TelegramAlertsService {
  private readonly logger = new Logger(TelegramAlertsService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  /**
   * استرجاع إعدادات تنبيهات تيليجرام
   */
  async getSettings(actor?: AuthContext): Promise<TelegramAlertSettings> {
    let tenantId: string | null = null;
    if (actor) {
      try {
        const scope = requireTenantScope(actor);
        tenantId = scope.tenantId;
      } catch {
        tenantId = null;
      }
    }

    let token = process.env.TELEGRAM_BOT_TOKEN || '';
    let chatId = process.env.TELEGRAM_CHAT_ID || '';
    let enabled = process.env.TELEGRAM_ALERTS_ENABLED === 'true';

    if (tenantId) {
      const rows = await this.db
        .selectFrom('settings')
        .select(['key', 'value'])
        .where('tenant_id', '=', tenantId)
        .where('key', 'like', 'telegram_alerts_%')
        .execute();

      for (const r of rows) {
        if (r.key === 'telegram_alerts_token' && r.value) token = r.value.replace(/^"|"$/g, '');
        if (r.key === 'telegram_alerts_chat_id' && r.value) chatId = r.value.replace(/^"|"$/g, '');
        if (r.key === 'telegram_alerts_enabled') enabled = r.value === 'true' || (r.value as any) === true;
      }
    }

    return {
      enabled: enabled || Boolean(token && chatId),
      botToken: token ? '••••••••' : '',
      chatId: chatId || '',
      notifyOnCriticalErrors: true,
      notifyOnDeployments: true,
    };
  }

  /**
   * حفظ إعدادات تيليجرام للمستأجر
   */
  async saveSettings(payload: Partial<TelegramAlertSettings>, actor: AuthContext): Promise<{ ok: boolean }> {
    const { tenantId, accountId } = requireTenantScope(actor);

    const updates: Array<{ key: string; val: any }> = [];
    if (payload.enabled !== undefined) updates.push({ key: 'telegram_alerts_enabled', val: payload.enabled });
    if (payload.botToken && payload.botToken !== '••••••••') {
      updates.push({ key: 'telegram_alerts_token', val: payload.botToken });
    }
    if (payload.chatId !== undefined) updates.push({ key: 'telegram_alerts_chat_id', val: payload.chatId });

    for (const item of updates) {
      await sql`
        INSERT INTO settings (key, value, tenant_id, account_id)
        VALUES (${item.key}, ${JSON.stringify(item.val)}, ${tenantId}, ${accountId})
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET value = EXCLUDED.value, account_id = EXCLUDED.account_id
      `.execute(this.db);
    }

    return { ok: true };
  }

  /**
   * إرسال رسالة مباشرة إلى تيليجرام
   */
  async sendMessage(
    text: string,
    customToken?: string,
    customChatId?: string,
  ): Promise<{ ok: boolean; message?: string }> {
    const token = customToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = customChatId || process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      this.logger.debug('Telegram alert skipped: Bot token or Chat ID not configured.');
      return { ok: false, message: 'مفتاح البوت أو معرف المحادثة غير معرّف' };
    }

    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.description || 'فشل إرسال رسالة التيليجرام');
      }

      return { ok: true };
    } catch (err: any) {
      this.logger.error(`Failed to send Telegram alert: ${err.message}`);
      return { ok: false, message: err.message };
    }
  }

  /**
   * إرسال تنبيه عطل أو حادث طارئ
   */
  async sendIncidentAlert(
    title: string,
    message: string,
    severity: 'info' | 'warning' | 'critical' = 'warning',
    metadata?: Record<string, any>,
  ): Promise<void> {
    const icon = severity === 'critical' ? '🚨🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
    const serverTime = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
    const host = process.env.ORACLE_HOST || 'Oracle Cloud VPS';

    let metaText = '';
    if (metadata) {
      metaText = `\n\n<b>التفاصيل التقنية:</b>\n<code>${JSON.stringify(metadata, null, 2).slice(0, 800)}</code>`;
    }

    const text = `
${icon} <b>تنبيه نظام Z-Systems [${severity.toUpperCase()}]</b>
━━━━━━━━━━━━━━━━━
<b>العنوان:</b> ${title}
<b>السيرفر:</b> ${host}
<b>الوقت:</b> ${serverTime}
<b>الرسالة:</b>
${message}${metaText}
━━━━━━━━━━━━━━━━━
<i>هذا التنبيه صادر آلياً من مسبار مراقبة منظومة Z-Systems</i>
    `.trim();

    await this.sendMessage(text);
  }

  /**
   * إرسال إشعار اكتمال النشر السحابي
   */
  async sendDeploymentAlert(version: string, commit: string, durationSeconds?: number): Promise<void> {
    const serverTime = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
    const text = `
🚀 <b>تم بنجاح تحديث ونشر منظومة Z-Systems</b>
━━━━━━━━━━━━━━━━━
<b>بيئة السيرفر:</b> Oracle Cloud VPS (Production)
<b>رقم الإصدار:</b> ${version}
<b>رمز الكوميت:</b> <code>${commit}</code>
<b>الوقت:</b> ${serverTime}
${durationSeconds ? `<b>المدة المستغرقة:</b> ${durationSeconds} ثانية\n` : ''}<b>حالة النظام:</b> 🟢 جاهز ويعمل بكفاءة 100%
━━━━━━━━━━━━━━━━━
<i>تم التحقق من نقاط الجاهزية وإعادة تحميل الخدمات بنجاح دون انقطاع</i>
    `.trim();

    await this.sendMessage(text);
  }
}
