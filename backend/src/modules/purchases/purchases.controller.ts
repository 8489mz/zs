import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Put, Query, Req, Res, UseGuards, UseInterceptors, UploadedFile, BadRequestException, ParseFilePipe, MaxFileSizeValidator, FileTypeValidator, Optional } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { RequirePermissions } from '../../core/auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { IdempotencyInterceptor } from '../../core/idempotency/idempotency.interceptor';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { CreateCustomerPaymentDto, CreateSupplierPaymentDto } from './dto/create-party-payment.dto';
import { CreateSupplierPaymentScheduleDto, PaySupplierScheduleInstallmentDto } from './dto/supplier-payment-schedule.dto';
import { UpsertPurchaseDto } from './dto/upsert-purchase.dto';
import { PurchasesService } from './purchases.service';
import { SupplierPaymentSchedulesService } from './services/supplier-payment-schedules.service';
import { MarginProtectionService, ApplyRepricingPayload } from './services/margin-protection.service';
import { PurchaseLandedCostsService } from './services/purchase-landed-costs.service';
import { ApplyPurchaseLandedCostsDto } from './dto/purchase-landed-cost.dto';

@Controller('api')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class PurchasesController {
  constructor(
    private readonly purchasesService: PurchasesService,
    private readonly scheduleService: SupplierPaymentSchedulesService,
    @Optional() private readonly landedCostsService?: PurchaseLandedCostsService,
    @Optional() private readonly marginProtectionService?: MarginProtectionService,
  ) {}

  @Get('purchases')
  @RequirePermissions('purchases')
  listPurchases(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.purchasesService.listPurchases(query, req.authContext!);
  }

  @Get('purchases/reorder/suggestions')
  @RequirePermissions('purchases')
  getReorderSuggestions(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.purchasesService.getReorderSuggestions(query, req.authContext!);
  }

  @Post('purchases/reorder/generate-drafts')
  @RequirePermissions('purchases')
  @UseInterceptors(IdempotencyInterceptor)
  generateDraftPurchaseOrders(@Body() payload: any, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.purchasesService.generateDraftPurchaseOrders(payload, req.authContext!);
  }

  @Get('purchases/check-duplicate')
  @RequirePermissions('purchases')
  checkDuplicateBill(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.purchasesService.checkDuplicateBill(
      {
        supplierId: Number(query.supplierId || 0),
        supplierInvoiceNo: typeof query.supplierInvoiceNo === 'string' ? query.supplierInvoiceNo : undefined,
        total: query.total !== undefined ? Number(query.total) : undefined,
        date: typeof query.date === 'string' ? query.date : undefined,
        excludePurchaseId: query.excludePurchaseId ? Number(query.excludePurchaseId) : undefined,
      },
      req.authContext!,
    );
  }

  @Get('purchases/:id')
  @RequirePermissions('purchases')
  getPurchase(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.purchasesService.getPurchaseById(id, req.authContext!);
  }

  @Post('purchases')
  @RequirePermissions('purchases')
  createPurchase(
    @Body() payload: UpsertPurchaseDto,
    @Req() req: RequestWithAuth,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    return this.purchasesService.createPurchase(payload, req.authContext!, idempotencyKey);
  }

  @Put('purchases/:id')
  @RequirePermissions('canEditInvoices')
  @UseInterceptors(IdempotencyInterceptor)
  updatePurchase(@Param('id', ParseIntPipe) id: number, @Body() payload: UpsertPurchaseDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.purchasesService.updatePurchase(id, payload, req.authContext!);
  }

  @Post('purchases/:id/cancel')
  @RequirePermissions('canEditInvoices')
  @UseInterceptors(IdempotencyInterceptor)
  cancelPurchase(@Param('id', ParseIntPipe) id: number, @Body() body: { reason?: string; managerPin?: string }, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.purchasesService.cancelPurchase(id, String(body?.reason || ''), req.authContext!, String(body?.managerPin || ''));
  }

  @Post('purchases/:id/receive-goods')
  @RequirePermissions('purchases')
  @UseInterceptors(IdempotencyInterceptor)
  receivePurchaseGoods(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { receivedItems: { itemId: number; receivedQty: number; serials?: any[] }[] },
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.purchasesService.receivePurchaseGoods(id, body?.receivedItems || [], req.authContext!);
  }

  @Get('purchases/:id/payment-schedule')
  @RequirePermissions('purchases')
  listPurchasePaymentSchedule(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.scheduleService.listForPurchase(id, req.authContext!);
  }

  @Post('purchases/:id/payment-schedule')
  @RequirePermissions('accounts')
  @UseInterceptors(IdempotencyInterceptor)
  createPurchasePaymentSchedule(@Param('id', ParseIntPipe) id: number, @Body() payload: CreateSupplierPaymentScheduleDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.scheduleService.createForPurchase(id, payload, req.authContext!);
  }

  @Get('suppliers/:id/payment-schedule')
  @RequirePermissions('accounts')
  listSupplierPaymentSchedule(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.scheduleService.listForSupplier(id, req.authContext!);
  }

  @Post('suppliers/:id/payment-schedule')
  @RequirePermissions('accounts')
  @UseInterceptors(IdempotencyInterceptor)
  createSupplierPaymentSchedule(@Param('id', ParseIntPipe) id: number, @Body() payload: CreateSupplierPaymentScheduleDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.scheduleService.createForSupplier(id, payload, req.authContext!);
  }

  @Post('supplier-payment-schedules/:id/settle')
  @RequirePermissions('accounts')
  settleSupplierSchedule(@Param('id', ParseIntPipe) id: number, @Body() payload: PaySupplierScheduleInstallmentDto, @Req() req: RequestWithAuth, @Headers('x-idempotency-key') idempotencyKey?: string): Promise<Record<string, unknown>> {
    return this.scheduleService.payInstallment(id, payload, req.authContext!, idempotencyKey);
  }

  @Get('purchases/:id/margin-analysis')
  @RequirePermissions('purchases')
  analyzePurchaseMargins(
    @Param('id', ParseIntPipe) id: number,
    @Query('targetMargin') targetMargin: string,
    @Req() req: RequestWithAuth,
  ) {
    if (!this.marginProtectionService) {
      throw new BadRequestException('Margin protection service unavailable');
    }
    const margin = Number(targetMargin) || 25;
    return this.marginProtectionService.analyzePurchaseMargins(id, margin, req.authContext!);
  }

  @Post('purchases/:id/apply-repricing')
  @RequirePermissions('purchases')
  @UseInterceptors(IdempotencyInterceptor)
  applyPurchaseRepricing(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: ApplyRepricingPayload,
    @Req() req: RequestWithAuth,
  ) {
    if (!this.marginProtectionService) {
      throw new BadRequestException('Margin protection service unavailable');
    }
    return this.marginProtectionService.applyRepricing(id, payload, req.authContext!);
  }

  @Get('supplier-payments')
  @RequirePermissions('accounts')
  listSupplierPayments(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.purchasesService.listSupplierPayments(req.authContext!, query);
  }

  @Get('supplier-payments/:id')
  @RequirePermissions('accounts')
  getSupplierPayment(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.purchasesService.getSupplierPaymentById(id, req.authContext!);
  }

  @Post('supplier-payments')
  @RequirePermissions('accounts')
  createSupplierPayment(@Body() payload: CreateSupplierPaymentDto, @Req() req: RequestWithAuth, @Headers('x-idempotency-key') idempotencyKey?: string): Promise<Record<string, unknown>> {
    return this.purchasesService.createSupplierPayment(payload, req.authContext!, idempotencyKey);
  }

  @Post('customer-payments')
  @RequirePermissions('accounts')
  createCustomerPayment(@Body() payload: CreateCustomerPaymentDto, @Req() req: RequestWithAuth, @Headers('x-idempotency-key') idempotencyKey?: string): Promise<Record<string, unknown>> {
    return this.purchasesService.createCustomerPayment(payload, req.authContext!, idempotencyKey);
  }

  @Post('purchases/attachments/upload')
  @RequirePermissions('purchases')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads/purchases',
      filename: (req: any, file: any, cb: any) => {
        // Strip out any potentially dangerous characters or multiple extensions from the original name
        const ext = extname(file.originalname).toLowerCase();
        // Server generated completely random name to prevent path traversal
        cb(null, randomUUID() + ext);
      }
    })
  }))
  uploadAttachment(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
          new FileTypeValidator({ fileType: /^(application\/pdf|image\/png|image\/jpeg|image\/webp)$/ }),
        ],
        fileIsRequired: true,
      }),
    ) file: Express.Multer.File
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    // Reject double extensions explicitly just to be extra safe
    if (file.originalname.split('.').length > 2) {
      throw new BadRequestException('الملفات ذات الامتدادات المتعددة غير مسموحة');
    }
    const ext = extname(file.originalname).toLowerCase();
    const dangerous = ['.exe', '.bat', '.cmd', '.ps1', '.js', '.html', '.svg', '.zip', '.rar'];
    if (dangerous.includes(ext)) {
      throw new BadRequestException('نوع الملف غير مسموح به');
    }

    return {
      fileName: file.originalname,
      fileUrl: file.filename,
      fileSize: file.size,
      fileType: file.mimetype
    };
  }

  @Get('purchases/:purchaseId/attachments/:attachmentId/download')
  @RequirePermissions('purchases')
  async downloadPurchaseAttachment(
    @Param('purchaseId', ParseIntPipe) purchaseId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Req() req: RequestWithAuth,
    @Res() res: Response
  ) {
    const { attachment } = await this.purchasesService.getPurchaseAttachment(purchaseId, attachmentId, req.authContext!);
    const fileUrl = String((attachment as Record<string, unknown>).file_url || '').trim();

    // Safety check against path traversal stored in DB
    if (!fileUrl || fileUrl.includes('..') || fileUrl.includes('/') || fileUrl.includes('\\')) {
      throw new BadRequestException('مسار الملف غير صالح');
    }

    const filePath = join(process.cwd(), 'uploads/purchases', fileUrl);
    res.sendFile(filePath);
  }

  @Get('purchases/:id/landed-costs')
  @RequirePermissions('purchases')
  getPurchaseLandedCosts(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    if (!this.landedCostsService) throw new BadRequestException('خدمة تكلفة الوصول غير مفعلة');
    return this.landedCostsService.getPurchaseLandedCosts(id, req.authContext!);
  }

  @Post('purchases/:id/landed-costs')
  @RequirePermissions('canEditInvoices')
  @UseInterceptors(IdempotencyInterceptor)
  applyPurchaseLandedCosts(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: ApplyPurchaseLandedCostsDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    if (!this.landedCostsService) throw new BadRequestException('خدمة تكلفة الوصول غير مفعلة');
    return this.landedCostsService.applyPurchaseLandedCosts(id, payload, req.authContext!);
  }
}
