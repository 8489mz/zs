import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { MaritimeFreightService } from './maritime-freight.service';
import { SubmitPublicCarrierBidDto } from './dto/public-carrier-bid.dto';

@Controller([
  'public/freight-tracking',
  'api/public/freight-tracking',
  'api/public/carrier-quote',
  'public/carrier-quote',
])
export class MaritimePublicTrackingController {
  constructor(private readonly freightService: MaritimeFreightService) {}

  @Get('track/:token')
  async getPublicTracking(@Param('token') token: string) {
    return this.freightService.getPublicTrackingByToken(token);
  }

  @Get(':token')
  async getPublicTrackingDirect(@Param('token') token: string) {
    return this.freightService.getPublicTrackingByToken(token);
  }

  @Get('rfq/:id')
  async getPublicRfqForQuote(
    @Param('id') id: string,
    @Query('token') token?: string,
    @Query('carrier') carrier?: string,
  ) {
    return this.freightService.getPublicRfqForQuote(id, token || '', carrier);
  }

  @Post('rfq/:id/bid')
  async submitPublicCarrierBid(@Param('id') id: string, @Body() dto: SubmitPublicCarrierBidDto) {
    return this.freightService.submitPublicCarrierBid(id, dto);
  }
}
