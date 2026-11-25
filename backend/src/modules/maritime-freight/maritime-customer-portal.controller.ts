import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { MaritimeCustomerPortalService, CreatePortalQuoteRequestDto } from './maritime-customer-portal.service';
import {
  ApproveQuotationDto,
  MaritimeCustomerLoginDto,
  MaritimeCustomerTokenLoginDto,
  RejectQuotationDto,
} from './dto/customer-portal.dto';

@Controller(['freight-portal', 'api/freight-portal', 'api/maritime-freight/portal'])
export class MaritimeCustomerPortalController {
  constructor(private readonly portalService: MaritimeCustomerPortalService) {}

  @Post('auth/login')
  async login(@Body() body: MaritimeCustomerLoginDto) {
    return this.portalService.customerLogin(body);
  }

  @Post('auth/token-login')
  async tokenLogin(@Body() body: MaritimeCustomerTokenLoginDto) {
    return this.portalService.customerTokenLogin(body.token);
  }

  @Get('auth/profile')
  async getProfile(@Headers('authorization') authHeader: string) {
    const auth = await this.portalService.verifyCustomerToken(authHeader);
    return { ok: true, customer: auth };
  }

  @Get('dashboard')
  async getDashboard(@Headers('authorization') authHeader: string) {
    const auth = await this.portalService.verifyCustomerToken(authHeader);
    return this.portalService.getDashboard(auth);
  }

  @Get('shipments')
  async getShipments(
    @Headers('authorization') authHeader: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const auth = await this.portalService.verifyCustomerToken(authHeader);
    return this.portalService.getShipments(auth, { status, search, page, pageSize });
  }

  @Get('shipments/:id')
  async getShipmentDetails(@Headers('authorization') authHeader: string, @Param('id') id: string) {
    const auth = await this.portalService.verifyCustomerToken(authHeader);
    return this.portalService.getShipmentDetails(auth, id);
  }

  @Post('quotes/request')
  async requestQuote(@Headers('authorization') authHeader: string, @Body() dto: CreatePortalQuoteRequestDto) {
    const auth = await this.portalService.verifyCustomerToken(authHeader);
    return this.portalService.requestQuote(auth, dto);
  }

  @Get('quotes')
  async getQuotations(@Headers('authorization') authHeader: string, @Query('status') status?: string) {
    const auth = await this.portalService.verifyCustomerToken(authHeader);
    return this.portalService.getQuotations(auth, { status });
  }

  @Get('quotes/:id')
  async getQuotationDetails(@Headers('authorization') authHeader: string, @Param('id') id: string) {
    const auth = await this.portalService.verifyCustomerToken(authHeader);
    return this.portalService.getQuotationDetails(auth, id);
  }

  @Post('quotes/:id/approve')
  async approveQuotation(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
    @Body() body: ApproveQuotationDto,
    @Req() req: any,
  ) {
    const auth = await this.portalService.verifyCustomerToken(authHeader);
    const clientIp = req?.ip || req?.headers?.['x-forwarded-for'] || 'portal';
    return this.portalService.approveQuotation(auth, id, { ...body, clientIp: String(clientIp) });
  }

  @Post('quotes/:id/reject')
  async rejectQuotation(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
    @Body() body: RejectQuotationDto,
  ) {
    const auth = await this.portalService.verifyCustomerToken(authHeader);
    return this.portalService.rejectQuotation(auth, id, body);
  }

  @Get('statement')
  async getStatement(@Headers('authorization') authHeader: string) {
    const auth = await this.portalService.verifyCustomerToken(authHeader);
    return this.portalService.getStatement(auth);
  }
}
