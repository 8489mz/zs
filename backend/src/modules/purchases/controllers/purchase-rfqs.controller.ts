import { Controller, Get, Post, Delete, Param, Body, UseGuards, ParseIntPipe, Req } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { PurchaseRfqsService, CreateRfqDto, SubmitSupplierBidDto } from '../services/purchase-rfqs.service';

@Controller(['api/purchases/rfqs', 'api/v1/purchases/rfqs'])
@UseGuards(SessionAuthGuard)
export class PurchaseRfqsController {
  constructor(private readonly rfqsService: PurchaseRfqsService) {}

  @Get()
  async list(@Req() req: RequestWithAuth) {
    const data = await this.rfqsService.listRfqs(req.authContext!);
    return { data };
  }

  @Get(':id')
  async getOne(@Req() req: RequestWithAuth, @Param('id', ParseIntPipe) id: number) {
    const data = await this.rfqsService.getRfq(req.authContext!, id);
    return { data };
  }

  @Post()
  async create(@Req() req: RequestWithAuth, @Body() dto: CreateRfqDto) {
    const data = await this.rfqsService.createRfq(req.authContext!, dto);
    return { data, message: 'تم إنشاء طلب عرض السعر بنجاح' };
  }

  @Post(':id/bids')
  async submitBid(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitSupplierBidDto,
  ) {
    const data = await this.rfqsService.submitSupplierBid(req.authContext!, id, dto);
    return { data, message: 'تم تسجيل عرض المورد بنجاح' };
  }

  @Post(':id/select-winner')
  async selectWinner(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body('supplier_id', ParseIntPipe) supplierId: number,
  ) {
    const data = await this.rfqsService.selectWinnerAndConvertToPo(req.authContext!, id, supplierId);
    return { data, message: 'تم اعتماد العرض الفائز وتوليد أمر الشراء (PO) بنجاح' };
  }

  @Delete(':id')
  async delete(@Req() req: RequestWithAuth, @Param('id', ParseIntPipe) id: number) {
    await this.rfqsService.deleteRfq(req.authContext!, id);
    return { message: 'تم حذف طلب عرض السعر بنجاح' };
  }
}
