import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, ParseIntPipe, Req } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { PriceListsService, UpsertPriceListDto, UpdatePriceListDto } from '../services/price-lists.service';
import { CalculatePriceDto } from '../dto/price-calculate.dto';

@Controller('api/sales/price-lists')
@UseGuards(SessionAuthGuard)
export class PriceListsController {
  constructor(private readonly priceListsService: PriceListsService) {}

  @Get()
  async list(@Req() req: RequestWithAuth) {
    const data = await this.priceListsService.listPriceLists(req.authContext!);
    return { data };
  }

  @Get(':id')
  async getOne(@Req() req: RequestWithAuth, @Param('id', ParseIntPipe) id: number) {
    const data = await this.priceListsService.getPriceList(req.authContext!, id);
    return { data };
  }

  @Post()
  async create(@Req() req: RequestWithAuth, @Body() dto: UpsertPriceListDto) {
    const data = await this.priceListsService.createPriceList(req.authContext!, dto);
    return { data, message: 'تم إنشاء قائمة الأسعار بنجاح' };
  }

  @Put(':id')
  async update(@Req() req: RequestWithAuth, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePriceListDto) {
    const data = await this.priceListsService.updatePriceList(req.authContext!, id, dto);
    return { data, message: 'تم تحديث قائمة الأسعار بنجاح' };
  }

  @Delete(':id')
  async delete(@Req() req: RequestWithAuth, @Param('id', ParseIntPipe) id: number) {
    await this.priceListsService.deletePriceList(req.authContext!, id);
    return { message: 'تم حذف قائمة الأسعار بنجاح' };
  }

  @Post('calculate')
  async calculatePrice(
    @Req() req: RequestWithAuth,
    @Body()
    body: CalculatePriceDto,
  ) {
    const data = await this.priceListsService.calculateEffectivePrice(
      req.authContext!,
      body.customerId || null,
      Number(body.productId),
      Number(body.quantity || 1),
      Number(body.basePrice || 0),
      body.paymentTerms ? { paymentTerms: body.paymentTerms } : undefined,
    );
    return { data };
  }
}
