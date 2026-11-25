import { Controller, Get, Post, Body, Param, ParseIntPipe, Req, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { GccShippingService } from './gcc-shipping.service';
import { SaveGccShippingSettingsDto } from './dto/gcc-shipping-write.dto';
import { GccCreateShipmentDto } from './gcc-shipping.types';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { escapeHtml } from '../../common/utils/escape-html';

@Controller(['gcc-shipping', 'api/gcc-shipping'])
@UseGuards(SessionAuthGuard)
export class GccShippingController {
  constructor(private readonly gccShippingService: GccShippingService) {}

  @Get('settings')
  async getSettings(@Req() req: RequestWithAuth) {
    return this.gccShippingService.getSettings(req.authContext!);
  }

  @Post('settings')
  async saveSettings(@Body() payload: SaveGccShippingSettingsDto, @Req() req: RequestWithAuth) {
    return this.gccShippingService.saveSettings(payload, req.authContext!);
  }

  @Post('ship-order/:orderId')
  async shipOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: GccCreateShipmentDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.gccShippingService.createShipment(orderId, dto, req.authContext!);
  }

  @Get('track/:trackingNumber')
  async getTracking(@Param('trackingNumber') trackingNumber: string, @Req() req: RequestWithAuth) {
    return this.gccShippingService.getTracking(trackingNumber, req.authContext!);
  }

  @Get('awb-data/:trackingNumber')
  async getAwbData(@Param('trackingNumber') trackingNumber: string, @Req() req: RequestWithAuth) {
    return this.gccShippingService.getAwbPrintData(trackingNumber, req.authContext!);
  }

  /**
   * صفحة بوليصة الشحن الحرارية AWB المعتمدة للطباعة المباشرة على طابعات الباركود (4x6 إنش)
   */
  @Get('awb/:trackingNumber')
  async printAwb(@Param('trackingNumber') trackingNumber: string, @Req() req: RequestWithAuth, @Res() res: Response) {
    const awb = await this.gccShippingService.getAwbPrintData(trackingNumber, req.authContext!);
    const carrierName = awb.carrier === 'aramex' ? 'ARAMEX EXPRESS 🔴' : 'SMSA EXPRESS 🟡';
    const isCod = awb.codAmount > 0;

    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <title>بوليصة شحن خليجية - ${escapeHtml(awb.trackingNumber)}</title>
  <style>
    @page { size: 4in 6in; margin: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; background: #fff; color: #000; }
    .label-box { max-width: 380px; margin: auto; border: 2.5px solid #000; border-radius: 6px; padding: 12px; }
    .header-bar { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 8px; }
    .carrier-title { font-size: 1.25rem; font-weight: 900; letter-spacing: 0.5px; }
    .barcode-area { text-align: center; margin: 14px 0; padding: 8px 0; border-bottom: 2px dashed #000; }
    .barcode-graphic { height: 42px; width: 85%; margin: 0 auto 4px; background: repeating-linear-gradient(90deg, #000, #000 3px, #fff 3px, #fff 6px); }
    .tracking-code { font-family: monospace; font-size: 1.1rem; font-weight: 800; letter-spacing: 2px; }
    .grid-info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border-bottom: 1.5px solid #000; padding-bottom: 8px; margin-bottom: 8px; font-size: 11px; }
    .box-cell { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px; }
    .box-cell strong { display: block; margin-bottom: 3px; font-size: 12px; }
    .cod-banner { border: 2px solid #000; border-radius: 6px; padding: 8px; text-align: center; margin-top: 8px; background: ${isCod ? '#fffbeb' : '#f1f5f9'}; }
    .cod-amount { font-size: 1.4rem; font-weight: 900; }
    .footer { display: flex; justify-content: space-between; align-items: center; font-size: 10px; margin-top: 8px; color: #475569; }
    @media print {
      body { padding: 0; background: none; }
      .label-box { border: 2px solid #000; box-shadow: none; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="text-align: center; margin-bottom: 15px;">
    <button onclick="window.print()" style="background: #170e5e; color: #fff; border: none; padding: 10px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 14px;">
      🖨️ طباعة ملصق الشحن (4x6 Thermal)
    </button>
  </div>

  <div class="label-box">
    <div class="header-bar">
      <div class="carrier-title">${carrierName}</div>
      <div style="font-weight: 800; font-size: 11px; border: 1.5px solid #000; padding: 2px 6px; border-radius: 4px;">GCC EXPRESS</div>
    </div>

    <div class="barcode-area">
      <div class="barcode-graphic"></div>
      <div class="tracking-code">${escapeHtml(awb.trackingNumber)}</div>
    </div>

    <div class="grid-info">
      <div class="box-cell">
        <span style="color: #64748b; font-size: 10px;">المرسل (Shipper / Hub):</span>
        <strong>${escapeHtml(awb.shipper.name)}</strong>
        <div>${escapeHtml(awb.shipper.city)} - ${escapeHtml(awb.shipper.address)}</div>
        <div dir="ltr" style="text-align: right; margin-top: 2px;">📞 ${escapeHtml(awb.shipper.phone)}</div>
      </div>
      <div class="box-cell">
        <span style="color: #64748b; font-size: 10px;">المستلم (Consignee):</span>
        <strong>${escapeHtml(awb.receiver.name)}</strong>
        <div>${escapeHtml(awb.receiver.city)} - ${escapeHtml(awb.receiver.address)}</div>
        <div dir="ltr" style="text-align: right; margin-top: 2px;">📞 ${escapeHtml(awb.receiver.phone)}</div>
      </div>
    </div>

    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 8px;">
      <div><strong>الوزن:</strong> ${escapeHtml(awb.weight)} كجم</div>
      <div><strong>القطع:</strong> ${escapeHtml(awb.pieces)} طرد</div>
      <div><strong>التاريخ:</strong> ${escapeHtml(awb.createdDate)}</div>
    </div>

    <div class="cod-banner">
      <div style="font-size: 11px; font-weight: 700;">
        ${isCod ? '⚠️ مطلوب تحصيل عند الاستلام (COD AMOUNT)' : '✅ مدفوع إلكترونياً مسبقاً (PREPAID - DO NOT COLLECT)'}
      </div>
      <div class="cod-amount">
        ${escapeHtml(isCod ? `${awb.codAmount} ${awb.currency}` : '0.00 ' + awb.currency)}
      </div>
    </div>

    <div class="footer">
      <div>Z-Systems Express Logistics</div>
      <div>AWB: ${escapeHtml(awb.trackingNumber)}</div>
    </div>
  </div>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
}
