import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { CommercialSubscriptionService } from '../services/commercial-subscription.service';
import { CreateCommercialSubscriptionDto, UpdateSubscriptionStatusDto } from '../dto/commercial-subscription.dto';

@Controller(['api/sales/subscriptions', 'api/v1/sales/subscriptions'])
@UseGuards(SessionAuthGuard)
export class CommercialSubscriptionController {
  constructor(private readonly subscriptionService: CommercialSubscriptionService) {}

  @Get()
  getSubscriptions(@Query() query: { status?: string; search?: string }, @Req() req: RequestWithAuth) {
    return this.subscriptionService.getSubscriptions(req.authContext!, query);
  }

  @Get(':id')
  getSubscriptionDetails(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.subscriptionService.getSubscriptionDetails(req.authContext!, id);
  }

  @Post()
  createSubscription(@Body() dto: CreateCommercialSubscriptionDto, @Req() req: RequestWithAuth) {
    return this.subscriptionService.createSubscription(req.authContext!, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateSubscriptionStatusDto, @Req() req: RequestWithAuth) {
    return this.subscriptionService.updateStatus(req.authContext!, id, dto);
  }

  @Post('generate-due')
  generateDueInvoices(@Req() req: RequestWithAuth) {
    return this.subscriptionService.generateDueInvoices(req.authContext!);
  }
}
