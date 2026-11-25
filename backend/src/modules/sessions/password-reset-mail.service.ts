import { Injectable } from '@nestjs/common';
import { PlatformMailService } from '../../common/mail/platform-mail.service';

export type PasswordResetMailTarget = {
  businessName: string;
  username: string;
  resetUrl: string;
};

export type PasswordResetMailPayload = {
  email: string;
  ttlMinutes: number;
  /** أكثر من عنصر حين يملك نفس البريد أكثر من منشأة — رابط مستقل لكل منشأة. */
  targets: PasswordResetMailTarget[];
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
export class PasswordResetMailService {
  constructor(private readonly mail: PlatformMailService) {}

  private buildText(payload: PasswordResetMailPayload): string {
    const lines = [
      '==================================================',
      '      Z SYSTEMS PRO | استعادة كلمة المرور        ',
      '==================================================',
      '',
      'وصلنا طلب لإعادة تعيين كلمة مرور حسابك.',
      `الرابط صالح لمدة ${payload.ttlMinutes} دقيقة، ويعمل مرة واحدة فقط.`,
      '',
    ];

    for (const target of payload.targets) {
      if (payload.targets.length > 1) {
        lines.push(`• المنشأة: ${target.businessName}`);
      }
      lines.push(`• اسم المستخدم: ${target.username}`);
      lines.push(`• رابط إعادة التعيين: ${target.resetUrl}`);
      lines.push('');
    }

    lines.push('إذا لم تطلب هذا، تجاهل الرسالة — كلمة مرورك الحالية لم تتغير.');
    lines.push('');
    lines.push('==================================================');
    lines.push('Password reset requested for your Z Systems Pro account.');
    lines.push(`The link expires in ${payload.ttlMinutes} minutes and can be used once.`);
    lines.push('If you did not request this, ignore this email.');
    lines.push('==================================================');

    return lines.join('\n');
  }

  private buildHtml(payload: PasswordResetMailPayload): string {
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

    const blocks = payload.targets
      .map((target) => {
        const safeBusinessName = escapeHtml(target.businessName);
        const safeUsername = escapeHtml(target.username);
        const safeUrl = escapeHtml(target.resetUrl);
        const heading =
          payload.targets.length > 1
            ? `<div style="margin: 0 0 10px 0; color: #0f172a; font-size: 13px; font-weight: 700;">${safeBusinessName}</div>`
            : '';

        return `
        <div style="background-color: ${surface2}; border: 1px solid ${border}; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
          ${heading}
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: ${text};">
            <tr>
              <td style="padding: 6px 0; color: ${muted}; font-weight: 600; width: 110px; vertical-align: middle;">اسم المستخدم:</td>
              <td style="padding: 6px 0; vertical-align: middle;">
                <span dir="ltr" style="background-color: #ffffff; border: 1px solid ${border}; color: ${text}; padding: 3px 9px; border-radius: 6px; display: inline-block; font-weight: 700;">${safeUsername}</span>
              </td>
            </tr>
          </table>
          <div style="text-align: center; margin-top: 16px;">
            <a href="${safeUrl}" target="_blank" style="display: inline-block; background-color: ${primary}; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 30px; border-radius: 8px;">
              تعيين كلمة مرور جديدة
            </a>
          </div>
          <p style="margin: 14px 0 0 0; color: ${muted}; font-size: 11.5px; line-height: 1.6; word-break: break-all;" dir="ltr">${safeUrl}</p>
        </div>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>استعادة كلمة المرور - Z Systems Pro</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 28px 12px; background-color: ${surface2}; font-family: ${font}; color: ${text}; -webkit-font-smoothing: antialiased;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid ${border}; box-shadow: 0 8px 30px rgba(15, 23, 42, 0.06);">

    <div style="padding: 32px 28px 24px; text-align: center; border-bottom: 1px solid ${border};">
      <img src="${logoUrl}" alt="Z Systems" width="56" height="56" style="display: block; margin: 0 auto 12px; border: 0;" />
      <div style="font-size: 19px; font-weight: 800; color: ${primary}; letter-spacing: 0.2px;">Z Systems Pro</div>
      <div style="margin-top: 4px; font-size: 12px; font-weight: 600; color: ${muted};">المنظومة المحاسبية والإدارية السحابية المتكاملة</div>
    </div>

    <div style="padding: 28px 28px 8px;">
      <div dir="rtl" style="text-align: right;">
        <div style="display: inline-block; margin-bottom: 16px; padding: 5px 14px; background-color: ${primaryTint}; border-radius: 6px; color: ${primary}; font-size: 12px; font-weight: 700;">
          استعادة كلمة المرور
        </div>
        <h1 style="margin: 0 0 10px 0; color: #0f172a; font-size: 19px; font-weight: 800; line-height: 1.3;">طلب إعادة تعيين كلمة المرور</h1>
        <p style="margin: 0 0 20px 0; color: ${text}; font-size: 14px; line-height: 1.7;">
          وصلنا طلب لإعادة تعيين كلمة مرور حسابك. الرابط أدناه صالح لمدة <strong>${payload.ttlMinutes} دقيقة</strong> ويعمل <strong>مرة واحدة فقط</strong>.
        </p>

        ${blocks}

        <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px;">
          <p style="margin: 0; color: #9a3412; font-size: 12.5px; line-height: 1.6;">
            <strong>لم تطلب هذا؟</strong> تجاهل الرسالة ببساطة — كلمة مرورك الحالية لم تتغير، ولن يتغير شيء ما لم يُفتح الرابط.
          </p>
        </div>
      </div>

      <hr style="border: none; border-top: 1px solid ${border}; margin: 0 0 24px 0;" />

      <div dir="ltr" style="text-align: left;">
        <h2 style="margin: 0 0 8px 0; color: #0f172a; font-size: 15px; font-weight: 700;">Password reset</h2>
        <p style="margin: 0 0 14px 0; color: ${muted}; font-size: 13px; line-height: 1.6;">
          A password reset was requested for your Z Systems Pro account. The link expires in
          <strong>${payload.ttlMinutes} minutes</strong> and can be used once. If you did not request it, ignore this email.
        </p>
      </div>
    </div>

    <div style="background-color: ${surface2}; border-top: 1px solid ${border}; padding: 20px; text-align: center; color: ${muted}; font-size: 11.5px; line-height: 1.6;">
      <p style="margin: 0 0 4px 0; font-weight: 700; color: ${text};">Z Systems Pro</p>
      <p style="margin: 0;">© ${year} Z Systems Pro. جميع الحقوق محفوظة.</p>
    </div>

  </div>
</body>
</html>`;
  }

  async sendResetLink(payload: PasswordResetMailPayload): Promise<void> {
    await this.mail.send({
      to: payload.email,
      subject: 'استعادة كلمة المرور - Z Systems Pro | Password Reset',
      text: this.buildText(payload),
      html: this.buildHtml(payload),
    });
  }
}
