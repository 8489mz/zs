import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { DEFAULT_TRIAL_DAYS } from '../saas-admin/trial.constants';

type TrialSignupMailPayload = {
  businessName: string;
  ownerName?: string;
  ownerEmail: string;
  username: string;
  temporaryPassword: string;
  trialDays?: number;
};

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

@Injectable()
export class TrialSignupMailService {
  private getDeliveryMode(): 'smtp' | 'console' {
    const mode = String(process.env.MAIL_DELIVERY_MODE || '').trim().toLowerCase();
    return mode === 'console' ? 'console' : 'smtp';
  }

  private buildText(payload: TrialSignupMailPayload): string {
    const loginUrl = String(process.env.APP_LOGIN_URL || '').trim() || '/login';
    const trialDays = payload.trialDays ?? DEFAULT_TRIAL_DAYS;
    // Greet the person when the signup carried their name; the business
    // name stays the fallback for older clients that send no ownerName.
    const greetName = payload.ownerName || payload.businessName;

    return [
      '==================================================',
      '      Z SYSTEMS PRO | Z ERP - النسخة التجريبية    ',
      '==================================================',
      '',
      `مرحباً ${greetName}،`,
      '',
      'تم إنشاء وتجهيز نسختك التجريبية في Z Systems Pro بنجاح.',
      `مدة التجربة المجانية: ${trialDays} أيام كاملة بكافة المميزات.`,
      '',
      '--------------------------------------------------',
      'بيانات تسجيل الدخول إلى حسابك:',
      '--------------------------------------------------',
      `• رابط الدخول: ${loginUrl}`,
      `• اسم المستخدم: ${payload.username}`,
      `• البريد الإلكتروني: ${payload.ownerEmail}`,
      `• كلمة المرور المؤقتة: ${payload.temporaryPassword}`,
      '',
      'ملاحظة: يمكنك تسجيل الدخول باستخدام اسم المستخدم أو البريد الإلكتروني.',
      'تنبيه أمني: يرجى تغيير كلمة المرور فور أول تسجيل دخول.',
      '',
      '==================================================',
      '           ENGLISH VERSION / SUMMARY              ',
      '==================================================',
      `Welcome ${greetName},`,
      `Your Z Systems Pro workspace is active for ${trialDays} days.`,
      '',
      `• Login URL: ${loginUrl}`,
      `• Username: ${payload.username}`,
      `• Temporary Password: ${payload.temporaryPassword}`,
      '',
      'Important: Please change your password upon initial login.',
      '==================================================',
      'Z Systems Pro © All rights reserved.',
    ].join('\n');
  }

  private buildHtml(payload: TrialSignupMailPayload): string {
    const loginUrl = String(process.env.APP_LOGIN_URL || '').trim() || '/login';
    const trialDays = payload.trialDays ?? DEFAULT_TRIAL_DAYS;
    const safeGreetName = escapeHtml(payload.ownerName || payload.businessName);
    const safeUsername = escapeHtml(payload.username);
    const safeEmail = escapeHtml(payload.ownerEmail);
    const safePassword = escapeHtml(payload.temporaryPassword);
    const safeLoginUrl = escapeHtml(loginUrl);
    const year = new Date().getFullYear();
    const logoUrl = 'https://app.zsystemai.com/logo_cropped.png';

    // Brand tokens mirrored from frontend/src/styles/partials/base.css — keep this in sync
    // with that file so system emails always match the app's own look.
    const primary = '#170c5c';
    const primaryTint = 'rgba(23, 12, 92, 0.08)';
    const text = '#1e293b';
    const muted = '#64748b';
    const border = '#e2e8f0';
    const surface2 = '#f8fafc';
    const font = "'Cairo', 'Tajawal', -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Arial, sans-serif";

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>بيانات الدخول إلى النسخة التجريبية - Z Systems Pro</title>
  <!--[if !mso]><!-->
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
  <!--<![endif]-->
</head>
<body style="margin: 0; padding: 28px 12px; background-color: ${surface2}; font-family: ${font}; color: ${text}; -webkit-font-smoothing: antialiased;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid ${border}; box-shadow: 0 8px 30px rgba(15, 23, 42, 0.06);">

    <!-- HEADER -->
    <div style="padding: 32px 28px 24px; text-align: center; border-bottom: 1px solid ${border};">
      <img src="${logoUrl}" alt="Z Systems" width="56" height="56" style="display: block; margin: 0 auto 12px; border: 0;" />
      <div style="font-size: 19px; font-weight: 800; color: ${primary}; letter-spacing: 0.2px;">Z Systems Pro</div>
      <div style="margin-top: 4px; font-size: 12px; font-weight: 600; color: ${muted};">المنظومة المحاسبية والإدارية السحابية المتكاملة</div>
    </div>

    <!-- MAIN BODY -->
    <div style="padding: 28px 28px 8px;">

      <!-- ARABIC SECTION -->
      <div dir="rtl" style="text-align: right;">
        <div style="display: inline-block; margin-bottom: 16px; padding: 5px 14px; background-color: ${primaryTint}; border-radius: 6px; color: ${primary}; font-size: 12px; font-weight: 700;">
          تفعيل النسخة التجريبية — ${trialDays} يوم
        </div>
        <h1 style="margin: 0 0 10px 0; color: #0f172a; font-size: 19px; font-weight: 800; line-height: 1.3;">مرحباً ${safeGreetName}</h1>
        <p style="margin: 0 0 20px 0; color: ${text}; font-size: 14px; line-height: 1.7;">
          تم تجهيز وتفعيل مساحة العمل السحابية الخاصة بنشاطك التجاري بنجاح، ونسختك التجريبية جاهزة للاستخدام الفوري بكافة الصلاحيات لمدة <strong>${trialDays} أيام</strong>.
        </p>

        <!-- CREDENTIALS BOX -->
        <div style="background-color: ${surface2}; border: 1px solid ${border}; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <div style="margin: 0 0 14px 0; color: #0f172a; font-size: 13px; font-weight: 700;">
            بيانات تسجيل الدخول إلى حسابك
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: ${text};">
            <tr>
              <td style="padding: 8px 0; color: ${muted}; font-weight: 600; width: 120px; vertical-align: middle;">رابط النظام:</td>
              <td style="padding: 8px 0; font-weight: 600; vertical-align: middle;">
                <a href="${safeLoginUrl}" target="_blank" style="color: ${primary}; text-decoration: none; word-break: break-all;" dir="ltr">${safeLoginUrl}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: ${muted}; font-weight: 600; vertical-align: middle;">اسم المستخدم:</td>
              <td style="padding: 8px 0; font-weight: 700; color: #0f172a; vertical-align: middle;">
                <span dir="ltr" style="background-color: #ffffff; border: 1px solid ${border}; color: ${text}; padding: 3px 9px; border-radius: 6px; display: inline-block;">${safeUsername}</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: ${muted}; font-weight: 600; vertical-align: middle;">البريد الإلكتروني:</td>
              <td style="padding: 8px 0; font-weight: 600; color: #0f172a; vertical-align: middle;">
                <span dir="ltr" style="color: ${text};">${safeEmail}</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: ${muted}; font-weight: 600; vertical-align: middle;">كلمة المرور المؤقتة:</td>
              <td style="padding: 8px 0; vertical-align: middle;">
                <span dir="ltr" style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 14px; font-weight: 700; background-color: ${primaryTint}; color: ${primary}; padding: 5px 10px; border-radius: 6px; letter-spacing: 0.3px; display: inline-block;">${safePassword}</span>
              </td>
            </tr>
          </table>
          <p style="margin: 12px 0 0 0; color: ${muted}; font-size: 11.5px; line-height: 1.5;">
            * يمكنك تسجيل الدخول باستخدام اسم المستخدم أو البريد الإلكتروني.
          </p>
        </div>

        <!-- CTA BUTTON -->
        <div style="text-align: center; margin-bottom: 20px;">
          <a href="${safeLoginUrl}" target="_blank" style="display: inline-block; background-color: ${primary}; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 13px 32px; border-radius: 8px;">
            الدخول إلى النظام الآن
          </a>
        </div>

        <!-- SECURITY NOTICE -->
        <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px;">
          <p style="margin: 0; color: #9a3412; font-size: 12.5px; line-height: 1.6;">
            <strong>تنبيه أمني:</strong> يُرجى تغيير كلمة المرور المؤقتة فور تسجيل الدخول لأول مرة من إعدادات المستخدم.
          </p>
        </div>
      </div>

      <!-- SEPARATOR -->
      <hr style="border: none; border-top: 1px solid ${border}; margin: 0 0 24px 0;" />

      <!-- ENGLISH SECTION -->
      <div dir="ltr" style="text-align: left;">
        <h2 style="margin: 0 0 8px 0; color: #0f172a; font-size: 15px; font-weight: 700;">Welcome to Z Systems Pro</h2>
        <p style="margin: 0 0 14px 0; color: ${muted}; font-size: 13px; line-height: 1.6;">
          Hello <strong>${safeGreetName}</strong>, your cloud workspace is ready for <strong>${trialDays} days</strong>.
        </p>

        <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; color: ${text};">
          <tr>
            <td style="padding: 5px 0; color: ${muted}; font-weight: 600; width: 120px;">Portal URL:</td>
            <td style="padding: 5px 0;"><a href="${safeLoginUrl}" target="_blank" style="color: ${primary}; text-decoration: none; font-weight: 600;">${safeLoginUrl}</a></td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: ${muted}; font-weight: 600;">Username:</td>
            <td style="padding: 5px 0; font-weight: 700; color: #0f172a;">${safeUsername}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: ${muted}; font-weight: 600;">Temp Password:</td>
            <td style="padding: 5px 0;">
              <span style="font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12.5px; font-weight: 700; background-color: ${primaryTint}; color: ${primary}; padding: 3px 8px; border-radius: 4px;">${safePassword}</span>
            </td>
          </tr>
        </table>
      </div>

    </div>

    <!-- FOOTER -->
    <div style="background-color: ${surface2}; border-top: 1px solid ${border}; padding: 20px; text-align: center; color: ${muted}; font-size: 11.5px; line-height: 1.6;">
      <p style="margin: 0 0 4px 0; font-weight: 700; color: ${text};">Z Systems Pro</p>
      <p style="margin: 0;">© ${year} Z Systems Pro. جميع الحقوق محفوظة.</p>
    </div>

  </div>
</body>
</html>`;
  }

  async sendTrialCredentials(payload: TrialSignupMailPayload): Promise<void> {
    const fromName = String(process.env.MAIL_FROM_NAME || 'Z Systems').trim();
    const fromEmail = String(process.env.MAIL_FROM_EMAIL || '').trim();
    const subject = 'بيانات الدخول إلى النسخة التجريبية - Z Systems Pro | Trial Access';
    const text = this.buildText(payload);
    const html = this.buildHtml(payload);
    const mode = this.getDeliveryMode();
    const isProduction = String(process.env.NODE_ENV || '').trim() === 'production';

    if (mode === 'console' && !isProduction) {
      // Development-only console mode. Never use this in production.
      // eslint-disable-next-line no-console
      console.info(`[trial-signup-mail] to=${payload.ownerEmail} subject=${subject}`);
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

    const nodemailer = require('nodemailer') as {
      createTransport(config: Record<string, unknown>): {
        sendMail(payload: Record<string, unknown>): Promise<unknown>;
      };
    };
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });

    await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: payload.ownerEmail,
      subject,
      text,
      html,
    });
  }
}
