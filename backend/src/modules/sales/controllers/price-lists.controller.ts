import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, ParseIntPipe, Req } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { PriceListsService, UpsertPriceListDto } from '../services/price-lists.service';

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
  async update(@Req() req: RequestWithAuth, @Param('id', ParseIntPipe) id: number, @Body() dto: UpsertPriceListDto) {
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
    body: {
      customerId?: number | null;
      productId: number;
      quantity: number;
      basePrice: number;
      // INV-VAN-PRICE-LIST-WIRING: the credit branch of the engine
      // runs only when paymentTerms is 'credit'; without it the
      // preview could never reach the credit price.
      paymentTerms?: 'cash' | 'credit';
    },
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
