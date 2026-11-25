import { Inject, Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AiCopilotService } from '../../ai-copilot/ai-copilot.service';

export interface WhatsAppConfig {
  enabled: boolean;
  provider: 'ultramsg' | 'greenapi' | 'custom_webhook';
  apiUrl?: string;
  instanceId?: string;
  token?: string;
  webhookSecret?: string;
  autoSendInvoice: boolean;
  autoSendOnlineOrder: boolean;
  invoiceTemplate?: string;
  aiBotEnabled?: boolean;
  aiBotPrompt?: string;
  aiBotWelcomeMessage?: string;
  aiBotOffHoursOnly?: boolean;
}

@Injectable()
export class WhatsAppGatewayService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly aiCopilotService: AiCopilotService,
  ) {}

  async getConfig(actor: AuthContext): Promise<WhatsAppConfig> {
    const { tenantId } = requireTenantScope(actor);
    const rows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'like', 'whatsapp_gateway_%')
      .execute();

    const map = new Map<string, any>();
    for (const r of rows) {
      try {
        map.set(r.key, JSON.parse(r.value));
      } catch {
        map.set(r.key, r.value);
      }
    }

    return {
      enabled: map.get('whatsapp_gateway_enabled') === true,
      provider: map.get('whatsapp_gateway_provider') || 'ultramsg',
      apiUrl: map.get('whatsapp_gateway_api_url') || '',
      instanceId: map.get('whatsapp_gateway_instance_id') || '',
      token: map.get('whatsapp_gateway_token') ? '••••••••' : '',
      webhookSecret: map.get('whatsapp_gateway_webhook_secret') ? '••••••••' : '',
      autoSendInvoice: map.get('whatsapp_gateway_auto_invoice') === true,
      autoSendOnlineOrder: map.get('whatsapp_gateway_auto_order') === true,
      invoiceTemplate:
        map.get('whatsapp_gateway_invoice_template') ||
        'مرحباً بك يا {customerName} في {businessName}، يسعدنا تسوقك معنا! يمكنك استعراض فاتورتك رقم #{invoiceNo} بقيمة {totalAmount} ج.م عبر الرابط التالي: {invoiceLink}',
      aiBotEnabled: map.get('whatsapp_gateway_ai_bot_enabled') === true,
      aiBotPrompt: map.get('whatsapp_gateway_ai_bot_prompt') || '',
      aiBotWelcomeMessage: map.get('whatsapp_gateway_ai_bot_welcome') || '',
      aiBotOffHoursOnly: map.get('whatsapp_gateway_ai_bot_off_hours') === true,
    };
  }

  async saveConfig(payload: Partial<WhatsAppConfig>, actor: AuthContext): Promise<{ ok: boolean }> {
    const { tenantId, accountId } = requireTenantScope(actor);

    const updates: Array<{ key: string; val: any }> = [];
    if (payload.enabled !== undefined) updates.push({ key: 'whatsapp_gateway_enabled', val: payload.enabled });
    if (payload.provider !== undefined) updates.push({ key: 'whatsapp_gateway_provider', val: payload.provider });
    if (payload.apiUrl !== undefined) updates.push({ key: 'whatsapp_gateway_api_url', val: payload.apiUrl });
    if (payload.instanceId !== undefined)
      updates.push({ key: 'whatsapp_gateway_instance_id', val: payload.instanceId });
    if (payload.token && payload.token !== '••••••••') {
      updates.push({ key: 'whatsapp_gateway_token', val: payload.token });
    }
    if (payload.webhookSecret && payload.webhookSecret !== '••••••••') {
      if (payload.webhookSecret.length < 32)
        throw new BadRequestException('Webhook secret must be at least 32 characters');
      updates.push({ key: 'whatsapp_gateway_webhook_secret', val: payload.webhookSecret });
    }
    if (payload.autoSendInvoice !== undefined)
      updates.push({ key: 'whatsapp_gateway_auto_invoice', val: payload.autoSendInvoice });
    if (payload.autoSendOnlineOrder !== undefined)
      updates.push({ key: 'whatsapp_gateway_auto_order', val: payload.autoSendOnlineOrder });
    if (payload.invoiceTemplate !== undefined)
      updates.push({ key: 'whatsapp_gateway_invoice_template', val: payload.invoiceTemplate });
    if (payload.aiBotEnabled !== undefined)
      updates.push({ key: 'whatsapp_gateway_ai_bot_enabled', val: payload.aiBotEnabled });
    if (payload.aiBotPrompt !== undefined)
      updates.push({ key: 'whatsapp_gateway_ai_bot_prompt', val: payload.aiBotPrompt });
    if (payload.aiBotWelcomeMessage !== undefined)
      updates.push({ key: 'whatsapp_gateway_ai_bot_welcome', val: payload.aiBotWelcomeMessage });
    if (payload.aiBotOffHoursOnly !== undefined)
      updates.push({ key: 'whatsapp_gateway_ai_bot_off_hours', val: payload.aiBotOffHoursOnly });

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

  private async getRawConfig(tenantId: string): Promise<Record<string, any>> {
    const rows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'like', 'whatsapp_gateway_%')
      .execute();

    const map: Record<string, any> = {};
    for (const r of rows) {
      try {
        map[r.key] = JSON.parse(r.value);
      } catch {
        map[r.key] = r.value;
      }
    }
    return map;
  }

  async sendRawMessage(tenantId: string, phone: string, text: string): Promise<{ success: boolean; message?: string }> {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const to = cleanPhone.startsWith('01') ? `2${cleanPhone}` : cleanPhone;
    if (!to || to.length < 8) {
      return { success: false, message: 'رقم الهاتف غير صالح' };
    }

    const cfg = await this.getRawConfig(tenantId);
    if (!cfg.whatsapp_gateway_enabled) {
      return { success: false, message: 'بوابة الواتساب السحابية غير مفعلة' };
    }

    const provider = cfg.whatsapp_gateway_provider || 'ultramsg';
    const apiUrl = cfg.whatsapp_gateway_api_url;
    const instanceId = cfg.whatsapp_gateway_instance_id;
    const token = cfg.whatsapp_gateway_token;

    try {
      if (provider === 'ultramsg') {
        const url = apiUrl || `https://api.ultramsg.com/${instanceId}/messages/chat`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: token || '',
            to,
            body: text,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { success: false, message: data.message || 'خطأ من بوابة UltraMsg' };
        return { success: true };
      }

      if (provider === 'greenapi') {
        const url = `${apiUrl || 'https://api.green-api.com'}/waInstance${instanceId}/sendMessage/${token}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: `${to}@c.us`,
            message: text,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { success: false, message: data.message || 'خطأ من بوابة Green API' };
        return { success: true };
      }

      if (provider === 'custom_webhook' && apiUrl) {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ phone: to, message: text, instanceId }),
        });
        if (!res.ok) return { success: false, message: 'خطأ من الويب هوك السحابي المخصص' };
        return { success: true };
      }

      return { success: false, message: 'مزود الواتساب غير معروف أو لم يتم إدخال إعدادات الاتصال' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'تعذر الاتصال بخادم الواتساب' };
    }
  }

  private async getTenantCurrencyInfo(tenantId: string): Promise<{ symbol: string; decimals: number; code: string }> {
    const row = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'currency')
      .executeTakeFirst();

    let code = 'EGP';
    if (row?.value) {
      try {
        code = JSON.parse(row.value);
      } catch {
        code = row.value;
      }
    }
    code = String(code || 'EGP')
      .trim()
      .toUpperCase();
    const isThreeDec = code === 'KWD' || code === 'BHD' || code === 'OMR';
    const symbol =
      code === 'KWD'
        ? 'د.ك'
        : code === 'SAR'
          ? 'ر.س'
          : code === 'AED'
            ? 'د.إ'
            : code === 'QAR'
              ? 'ر.ق'
              : code === 'BHD'
                ? 'د.ب'
                : code === 'OMR'
                  ? 'ر.ع'
                  : 'ج.م';
    return { symbol, decimals: isThreeDec ? 3 : 2, code };
  }

  private formatAmountWithCurrency(
    amount: number | string | undefined | null,
    curr: { symbol: string; decimals: number; code: string },
  ): string {
    const num = Number(amount || 0);
    const formatted =
      curr.decimals === 3 ? num.toFixed(3) : curr.code === 'EGP' && num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
    return `${formatted} ${curr.symbol}`;
  }

  async sendTestMessage(phone: string, actor: AuthContext): Promise<{ success: boolean; message?: string }> {
    const { tenantId } = requireTenantScope(actor);
    const tenant = await this.db
      .selectFrom('tenants')
      .select('business_name')
      .where('id', '=', tenantId)
      .executeTakeFirst();

    const businessName = tenant?.business_name || 'منظومة Z-Systems';
    const testText = `تم نجاح اختبار ربط بوابة الواتساب السحابية بنظام ${businessName}!\nسيتم إرسال الفواتير والإشعارات آلياً لعملائك بنجاح.`;

    return this.sendRawMessage(tenantId, phone, testText);
  }

  async sendInvoiceNotification(
    saleId: number,
    actor: AuthContext,
    options?: { autoOnly?: boolean },
  ): Promise<{ success: boolean; message?: string }> {
    const { tenantId } = requireTenantScope(actor);

    const cfg = await this.getRawConfig(tenantId);
    if (!cfg.whatsapp_gateway_enabled) {
      return { success: false, message: 'بوابة الواتساب السحابية غير مفعلة' };
    }
    if (options?.autoOnly && !cfg.whatsapp_gateway_auto_invoice) {
      return { success: false, message: 'الإرسال التلقائي للفواتير عبر الواتساب غير مفعل' };
    }

    const sale = await this.db
      .selectFrom('sales')
      .selectAll()
      .where('id', '=', saleId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!sale) throw new BadRequestException('الفاتورة غير موجودة');

    const customer = sale.customer_id
      ? await this.db.selectFrom('customers').selectAll().where('id', '=', sale.customer_id).executeTakeFirst()
      : null;

    const phone = customer?.phone;
    if (!phone) {
      return { success: false, message: 'العميل لا يمتلك رقم هاتف مسجل' };
    }

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'slug'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    const curr = await this.getTenantCurrencyInfo(tenantId);

    let template =
      cfg.whatsapp_gateway_invoice_template ||
      'مرحباً بك يا {customerName} في {businessName}، يسعدنا تسوقك معنا! يمكنك استعراض فاتورتك رقم #{invoiceNo} بقيمة {totalAmount} عبر الرابط التالي: {invoiceLink}';

    const customerName = customer?.name || 'عميلنا العزيز';
    const businessName = tenant?.business_name || 'متجرنا';
    const invoiceNo = sale.doc_no || String(sale.id);
    const totalAmount = this.formatAmountWithCurrency(sale.total, curr);
    const invoiceLink = `https://${tenant?.slug || 'app'}.zsystemai.com/invoice/${sale.doc_no || sale.id}`;

    // Clean up template if it still has hardcoded "ج.م"
    template = template.replace(/{totalAmount}\s*ج\.م/g, '{totalAmount}');

    const text = template
      .replace(/{customerName}/g, customerName)
      .replace(/{businessName}/g, businessName)
      .replace(/{invoiceNo}/g, invoiceNo)
      .replace(/{totalAmount}/g, totalAmount)
      .replace(/{invoiceLink}/g, invoiceLink);

    return this.sendRawMessage(tenantId, phone, text);
  }

  async sendOnlineOrderNotification(
    orderId: number,
    tenantId: string,
    options?: { trackingUrl?: string | null },
  ): Promise<{ success: boolean; message?: string }> {
    const cfg = await this.getRawConfig(tenantId);
    if (!cfg.whatsapp_gateway_enabled || !cfg.whatsapp_gateway_auto_order) {
      return { success: false, message: 'الإرسال التلقائي لطلبات المتجر عبر الواتساب غير مفعل' };
    }

    const order = await this.db
      .selectFrom('online_orders')
      .selectAll()
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!order) return { success: false, message: 'الطلب غير موجود' };

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'owner_phone'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    const curr = await this.getTenantCurrencyInfo(tenantId);
    const businessName = tenant?.business_name || 'متجرنا';
    const customerPhone = order.customer_phone;
    const orderNo = order.order_number || String(order.id);
    const total = this.formatAmountWithCurrency(order.total_amount, curr);

    // Send confirmation to customer
    if (customerPhone) {
      const trackingLine = options?.trackingUrl ? `\nتابع حالة طلبك من هنا: ${options.trackingUrl}` : '';
      const customerMsg = `مرحباً بك ${order.customer_name || 'عميلنا العزيز'}!\nتم استلام طلبك رقم #${orderNo} بنجاح من متجر ${businessName} بقيمة ${total}.\nسنقوم بتجهيزه وتأكيده في أقرب وقت.${trackingLine}\nشكراً لتسوقك معنا!`;
      void this.sendRawMessage(tenantId, customerPhone, customerMsg).catch(() => undefined);
    }

    // Send alert to store owner/merchant
    const merchantPhone = tenant?.owner_phone;
    if (merchantPhone) {
      const merchantMsg = `طلب أونلاين جديد #${orderNo}!\nالعميل: ${order.customer_name} (${order.customer_phone})\nالإجمالي: ${total}\nالعنوان: ${order.customer_address || 'استلام من الفرع'}\nيرجى فتح لوحة التحكم لتأكيد الطلب.`;
      void this.sendRawMessage(tenantId, merchantPhone, merchantMsg).catch(() => undefined);
    }

    return { success: true };
  }

  async sendShiftCloseNotification(shiftId: number, tenantId: string): Promise<{ success: boolean; message?: string }> {
    const cfg = await this.getRawConfig(tenantId);
    if (!cfg.whatsapp_gateway_enabled) {
      return { success: false, message: 'بوابة الواتساب غير مفعلة' };
    }

    const shift = await this.db
      .selectFrom('cashier_shifts')
      .selectAll()
      .where('id', '=', shiftId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!shift) return { success: false, message: 'الوردية غير موجودة' };

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'owner_phone'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    const merchantPhone = tenant?.owner_phone;
    if (!merchantPhone) return { success: false, message: 'رقم هاتف المالك غير مسجل' };

    const cashierUser = shift.opened_by
      ? await this.db.selectFrom('users').select(['username']).where('id', '=', shift.opened_by).executeTakeFirst()
      : null;

    const branch = shift.branch_id
      ? await this.db.selectFrom('branches').select(['name']).where('id', '=', shift.branch_id).executeTakeFirst()
      : null;

    const curr = await this.getTenantCurrencyInfo(tenantId);
    const businessName = tenant?.business_name || 'منظومة Z-Systems';
    const cashierName = cashierUser?.username || 'كاشير الوردية';
    const branchName = branch?.name || 'الفرع الرئيسي';
    const docNo = shift.doc_no || `#CS-${shift.id}`;
    const counted = this.formatAmountWithCurrency(shift.counted_cash, curr);
    const expected = this.formatAmountWithCurrency(shift.expected_cash, curr);
    const varianceVal = Number(shift.variance || 0);
    const varianceText =
      varianceVal === 0
        ? `متطابق تماماً (0 ${curr.symbol})`
        : varianceVal > 0
          ? `زيادة بمقدار +${this.formatAmountWithCurrency(varianceVal, curr)} 🟢`
          : `عجز بمقدار ${this.formatAmountWithCurrency(Math.abs(varianceVal), curr)} 🔴`;

    const closeNote = shift.close_note ? `\n📝 ملاحظة: ${shift.close_note}` : '';
    const closeTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

    const msg =
      `🔔 *إشعار إغلاق وردية كاشير - ${businessName}*\n\n` +
      `📍 *الفرع:* ${branchName}\n` +
      `👤 *الكاشير:* ${cashierName}\n` +
      `🔢 *رقم الوردية:* ${docNo}\n` +
      `💵 *المتوقع في الصندوق:* ${expected}\n` +
      `💰 *الكاش الفعلي المحصي:* ${counted}\n` +
      `📊 *الفارق (عجز/زيادة):* ${varianceText}` +
      closeNote +
      `\n⏰ *وقت الإغلاق:* ${closeTime}\n\n` +
      `_تم الإرسال آلياً عبر منظومة Z-Systems_`;

    void this.sendRawMessage(tenantId, merchantPhone, msg).catch(() => undefined);
    return { success: true };
  }

  async sendRefundNotification(
    docNo: string,
    amount: number,
    reason: string,
    tenantId: string,
    authorName: string,
  ): Promise<{ success: boolean; message?: string }> {
    const cfg = await this.getRawConfig(tenantId);
    if (!cfg.whatsapp_gateway_enabled) {
      return { success: false, message: 'بوابة الواتساب غير مفعلة' };
    }

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'owner_phone'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    const merchantPhone = tenant?.owner_phone;
    if (!merchantPhone) return { success: false, message: 'رقم هاتف المالك غير مسجل' };

    const curr = await this.getTenantCurrencyInfo(tenantId);
    const businessName = tenant?.business_name || 'منظومة Z-Systems';
    const formattedAmount = this.formatAmountWithCurrency(amount, curr);
    const time = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

    const msg =
      `⚠️ *تنبيه عملية مرتجع مبيعات - ${businessName}*\n\n` +
      `📄 *رقم المرتجع:* #${docNo}\n` +
      `💰 *المبلغ المسترد للعميل:* ${formattedAmount}\n` +
      `👤 *الموظف المنفذ:* ${authorName}\n` +
      `📝 *السبب:* ${reason || 'لم يُحدد سبب'}\n` +
      `⏰ *الوقت:* ${time}\n\n` +
      `_تم الإرسال آلياً للتنبيه والرقابة المالية_`;

    void this.sendRawMessage(tenantId, merchantPhone, msg).catch(() => undefined);
    return { success: true };
  }

  async handleVerifiedInboundWebhook(
    payload: any,
    tenantId: string | undefined,
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ) {
    if (!tenantId || !signature || !rawBody) throw new ForbiddenException('Webhook authentication required');
    const setting = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'whatsapp_gateway_webhook_secret')
      .executeTakeFirst();
    if (!setting) throw new ForbiddenException('Webhook authentication required');
    let secret: string;
    try {
      secret = JSON.parse(setting.value);
    } catch {
      secret = setting.value;
    }
    if (typeof secret !== 'string' || secret.length < 32)
      throw new ForbiddenException('Webhook authentication required');
    const supplied = signature.replace(/^sha256=/i, '');
    if (!/^[a-f0-9]{64}$/i.test(supplied)) throw new ForbiddenException('Invalid webhook signature');
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(supplied, 'hex'))) {
      throw new ForbiddenException('Invalid webhook signature');
    }
    return this.handleInboundWebhook(payload, tenantId);
  }

  async handleInboundWebhook(
    payload: any,
    trustedTenantId?: string,
  ): Promise<{
    handled: boolean;
    reply?: string;
    to?: string;
    engine?: string;
    message?: string;
  }> {
    let fromPhone = '';
    let messageText = '';

    // 1. Detect provider payload structure
    // UltraMsg format
    if (payload?.event_type === 'message_received' && payload?.data) {
      fromPhone = String(payload.data.from || '');
      messageText = String(payload.data.body || '');
    }
    // GreenAPI format
    else if (payload?.typeWebhook === 'incomingMessageReceived') {
      messageText = String(
        payload?.messageData?.textMessageData?.textMessage || payload?.messageData?.extendedTextMessageData?.text || '',
      );
      fromPhone = String(payload?.senderData?.sender || '');
    }
    // Meta Cloud API format
    else if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      const msg = payload.entry[0].changes[0].value.messages[0];
      fromPhone = String(msg.from || '');
      messageText = String(msg.text?.body || '');
    }
    // Generic direct / simulator format
    else if (payload?.phone && (payload?.message || payload?.text || payload?.question)) {
      fromPhone = String(payload.phone || '');
      messageText = String(payload.message || payload.text || payload.question || '');
    }

    if (!messageText.trim() || !fromPhone.trim()) {
      return { handled: false, message: 'لا توجد بيانات رسالة أو رقم هاتف في الطلب' };
    }

    fromPhone = fromPhone
      .replace('@c.us', '')
      .replace('@s.whatsapp.net', '')
      .replace(/[^0-9]/g, '');

    // 2. Resolve Tenant
    const resolvedTenantId = trustedTenantId;
    if (!resolvedTenantId) {
      return { handled: false, message: 'تعذر تحديد حساب المنشأة' };
    }

    // 3. Check if bot is enabled
    const cfg = await this.getRawConfig(resolvedTenantId);
    if (!cfg.whatsapp_gateway_ai_bot_enabled) {
      return { handled: false, message: 'بوت الذكاء الاصطناعي التفاعلي غير مفعل في إعدادات المنشأة' };
    }

    // 4. Generate AI reply
    const botResult = await this.aiCopilotService.generateSalesBotReply({
      question: messageText,
      tenantId: resolvedTenantId,
      customerPhone: fromPhone,
    });

    // 5. Send message back to customer via WhatsApp if valid phone and not simulated
    if (botResult?.reply && fromPhone.length >= 8 && payload?.simulate !== true) {
      void this.sendRawMessage(resolvedTenantId, fromPhone, botResult.reply).catch(() => undefined);
    }

    return {
      handled: true,
      reply: botResult.reply,
      to: fromPhone,
      engine: botResult.engine,
    };
  }
}
