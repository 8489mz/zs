import { Controller, Get, Post, Body, Param, ParseIntPipe, Req, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { BostaService } from './bosta.service';
import { SaveBostaSettingsDto } from './dto/bosta-write.dto';
import { BostaCreateDeliveryDto } from './bosta.types';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { escapeHtml } from '../../common/utils/escape-html';

@Controller(['bosta', 'api/bosta', 'api/v1/bosta'])
@UseGuards(SessionAuthGuard)
export class BostaController {
  constructor(private readonly bostaService: BostaService) {}

  @Get('settings')
  async getSettings(@Req() req: RequestWithAuth) {
    return this.bostaService.getSettings(req.authContext!);
  }

  @Post('settings')
  async saveSettings(@Body() payload: SaveBostaSettingsDto, @Req() req: RequestWithAuth) {
    return this.bostaService.saveSettings(payload, req.authContext!);
  }

  @Post('ship-order/:orderId')
  async shipOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: BostaCreateDeliveryDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.bostaService.createDelivery(orderId, dto, req.authContext!);
  }

  @Get('track/:trackingNumber')
  async getTracking(@Param('trackingNumber') trackingNumber: string, @Req() req: RequestWithAuth) {
    return this.bostaService.getTracking(trackingNumber, req.authContext!);
  }

  @Post('cancel/:deliveryId')
  async cancelDelivery(@Param('deliveryId') deliveryId: string, @Req() req: RequestWithAuth) {
    return this.bostaService.cancelDelivery(deliveryId, req.authContext!);
  }

  /**
   * عرض وطباعة بوليصة الشحن الرسمية المتوافقة مع طابعات الملصقات 4x6 والفواتير
   */
  @Get('awb/:deliveryId')
  async printAwb(@Param('deliveryId') deliveryId: string, @Req() req: RequestWithAuth, @Res() res: Response) {
    const awb = await this.bostaService.getAwbUrl(deliveryId, req.authContext!);
    if (!awb.isSandbox) {
      return res.redirect(302, awb.url);
    }
    // قالب محاكاة قابل للطباعة؛ البوليصة الرسمية تُفتح من رابط Bosta في الإنتاج.
    const trackingNo = awb.trackingNumber;
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <title>بوليصة شحن بوسطة - ${escapeHtml(trackingNo)}</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 20px; background: #f8fafc; color: #0f172a; }
    .label-card { max-width: 420px; margin: auto; background: #fff; border: 2px solid #000; border-radius: 8px; padding: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 12px; }
    .bosta-logo { font-size: 24px; font-weight: 900; color: #e11d48; letter-spacing: 1px; }
    .tracking-box { text-align: center; border: 2px dashed #334155; padding: 10px; border-radius: 6px; margin-bottom: 12px; background: #f1f5f9; }
    .barcode-fake { font-family: monospace; font-size: 28px; letter-spacing: 4px; font-weight: bold; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    .info-label { color: #64748b; font-weight: 600; }
    .info-value { font-weight: bold; color: #0f172a; }
    .cod-badge { font-size: 18px; font-weight: 800; color: #b91c1c; text-align: center; background: #fee2e2; padding: 8px; border-radius: 6px; margin-top: 10px; border: 1px solid #f87171; }
    .print-help { margin-top: 16px; padding: 10px; background: #fffbeb; color: #92400e; border: 1px solid #fcd34d; border-radius: 6px; font-size: 14px; font-weight: 700; text-align: center; }
    @media print {
      body { background: #fff; padding: 0; }
      .label-card { border: 2px solid #000; box-shadow: none; max-width: 100%; width: 100%; }
      .print-help { display: none; }
    }
  </style>
</head>
<body>
  <div class="label-card">
    <div class="header">
      <div class="bosta-logo">Bosta</div>
      <div style="font-weight: 700; font-size: 14px;">بوليصة محاكاة</div>
    </div>
    <div class="tracking-box">
      <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">رقم التتبع (Airway Bill)</div>
      <div class="barcode-fake">محاكاة — لا تمثل باركوداً رسمياً</div>
      <div style="font-size: 16px; font-weight: 800; color: #0f172a;">#${escapeHtml(trackingNo)}</div>
    </div>
    <div class="info-row">
      <span class="info-label">المستلم:</span>
      <span class="info-value">عميل متجر معتمد</span>
    </div>
    <div class="info-row">
      <span class="info-label">الوجهة:</span>
      <span class="info-value">محافظات مصر - تسليم حتى الباب</span>
    </div>
    <div class="info-row">
      <span class="info-label">تاريخ الإنشاء:</span>
      <span class="info-value">${new Date().toLocaleDateString('ar-EG')}</span>
    </div>
    <div class="cod-badge">
      مبلغ التحصيل (COD): مبيعات معتمدة
    </div>
    <p class="print-help">للطباعة استخدم Ctrl+P من المتصفح. هذه البوليصة تجريبية.</p>
  </div>
</body>
</html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
}
