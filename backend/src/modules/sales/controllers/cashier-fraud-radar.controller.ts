import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { CashierFraudRadarService, FraudRadarSummaryResponse, FraudRadarEventItem } from '../services/cashier-fraud-radar.service';

@Controller('api/sales/fraud-radar')
@UseGuards(SessionAuthGuard)
export class CashierFraudRadarController {
  constructor(private readonly fraudRadarService: CashierFraudRadarService) {}

  @Get('summary')
  async getSummary(
    @Query('timeframe') timeframe: 'today' | '7days' | '30days' = 'today',
    @Req() req: RequestWithAuth,
  ): Promise<FraudRadarSummaryResponse> {
    const validTimeframe = ['today', '7days', '30days'].includes(timeframe) ? timeframe : 'today';
    return this.fraudRadarService.getSummary(validTimeframe, req.authContext!);
  }

  @Get('events')
  async getEvents(
    @Query('limit') limit: string,
    @Query('timeframe') timeframe: 'today' | '7days' | '30days' = 'today',
    @Req() req: RequestWithAuth,
  ): Promise<FraudRadarEventItem[]> {
    const parsedLimit = limit ? parseInt(limit, 10) : 40;
    const validTimeframe = ['today', '7days', '30days'].includes(timeframe) ? timeframe : 'today';
    return this.fraudRadarService.getEvents(parsedLimit, req.authContext!, validTimeframe);
  }
}
