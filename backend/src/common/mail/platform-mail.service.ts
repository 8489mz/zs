import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

export type PlatformMailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * المصدر الوحيد لإرسال بريد **المنصة** (بريد نُرسله نحن من إعدادات السيرفر: بيانات النسخة
 * التجريبية، استعادة كلمة المرور، …).
 *
 * لا علاقة له بـ`MaritimeMailService`: ذاك يرسل من صندوق بريد **المستأجر نفسه** بإعدادات
 * SMTP مخزَّنة في `settings` لكل منشأة. أما هذا فبريد المنصة بإعدادات البيئة.
 *
 * وُحِّد هنا لأن قواعد التسليم الثلاث يجب ألّا تختلف بين مُرسِل وآخر:
 *  - **وضع الكونسول للتطوير فقط:** `MAIL_DELIVERY_MODE=console` يُتجاهل في الإنتاج، وإلا كان
 *    متغيّر بيئة واحد كفيلاً بإسكات كل بريد النظام في الإنتاج بلا أي خطأ.
 *  - **فشل صريح على إعداد ناقص:** لا "إرسال صامت" حين لا يوجد خادم بريد.
 *  - عنوان المُرسِل والاعتماد يُقرآن من مكان واحد.
 */
@Injectable()
export class PlatformMailService {
  private readonly logger = new Logger(PlatformMailService.name);

  private getDeliveryMode(): 'smtp' | 'console' {
    const mode = String(process.env.MAIL_DELIVERY_MODE || '').trim().toLowerCase();
    return mode === 'console' ? 'console' : 'smtp';
  }

  /** true حين لا يوجد إعداد بريد صالح — يسمح للمستدعي أن يقرر قبل أن يبني الرسالة. */
  isConfigured(): boolean {
    if (this.getDeliveryMode() === 'console' && String(process.env.NODE_ENV || '').trim() !== 'production') {
      return true;
    }
    return Boolean(
      String(process.env.SMTP_HOST || '').trim()
      && Number(process.env.SMTP_PORT || 587)
      && String(process.env.MAIL_FROM_EMAIL || '').trim(),
    );
  }

  async send(payload: PlatformMailPayload): Promise<void> {
    const fromName = String(process.env.MAIL_FROM_NAME || 'Z Systems').trim();
    const fromEmail = String(process.env.MAIL_FROM_EMAIL || '').trim();
    const mode = this.getDeliveryMode();
    const isProduction = String(process.env.NODE_ENV || '').trim() === 'production';

    if (mode === 'console' && !isProduction) {
      // Development-only console mode. Never use this in production.
      this.logger.log(`[platform-mail] to=${payload.to} subject=${payload.subject}`);
      return;
    }

    const host = String(process.env.SMTP_HOST || '').trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = String(process.env.SMTP_SECURE || 'false').trim().toLowerCase() === 'true';
    const user = String(process.env.SMTP_USER || '').trim();
    const pass = String(process.env.SMTP_PASSWORD || '').trim();

    if (!host || !port || !fromEmail) {
      throw new InternalServerErrorException('MAIL_CONFIG_MISSING');
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });

    await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
  }
}
