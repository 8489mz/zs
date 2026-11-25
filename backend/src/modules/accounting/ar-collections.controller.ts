import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { AccountingAccessGuard } from '../../core/auth/guards/accounting-access.guard';
import { RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { RequireFeature } from '../../core/auth/decorators/feature.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { ArCollectionsService } from './services/ar-collections.service';
import {
  ArCollectionsQueryDto,
  CreateCollectionLogDto,
  RecordPromiseToPayDto,
  ToggleCreditBlockDto,
  UpdateDunningLevelDto,
} from './dto/ar-collections.dto';

@Controller(['api/accounting/collections', 'api/v1/accounting/collections'])
@UseGuards(SessionAuthGuard, PermissionsGuard, AccountingAccessGuard)
@RequireFeature('accounting')
@RequireAnyPermission('accounting', 'accounts')
export class ArCollectionsController {
  constructor(private readonly collectionsService: ArCollectionsService) {}

  @Get('overview')
  async getOverview(@Req() req: RequestWithAuth) {
    return this.collectionsService.getOverview(req.authContext!);
  }

  @Get('cases')
  async getCases(@Req() req: RequestWithAuth, @Query() query: ArCollectionsQueryDto) {
    return this.collectionsService.getCases(req.authContext!, query);
  }

  @Get('cases/:id')
  async getCaseDetails(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.collectionsService.getCaseDetails(req.authContext!, id, {
      page: Number(page),
      pageSize: Number(pageSize),
    });
  }

  @Post('sync')
  async syncCollections(@Req() req: RequestWithAuth) {
    return this.collectionsService.syncCollections(req.authContext!);
  }

  @Post('cases/:id/logs')
  async logInteraction(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() dto: CreateCollectionLogDto) {
    return this.collectionsService.logInteraction(req.authContext!, id, dto);
  }

  @Post('cases/:id/promise-to-pay')
  async recordPromiseToPay(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() dto: RecordPromiseToPayDto) {
    return this.collectionsService.recordPromiseToPay(req.authContext!, id, dto);
  }

  @Post('cases/:id/toggle-credit-block')
  async toggleCreditBlock(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() dto: ToggleCreditBlockDto) {
    return this.collectionsService.toggleCreditBlock(req.authContext!, id, dto);
  }

  @Get('dunning-levels')
  async getDunningLevels(@Req() req: RequestWithAuth) {
    return this.collectionsService.getDunningLevels(req.authContext!);
  }

  @Put('dunning-levels/:id')
  async updateDunningLevel(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() dto: UpdateDunningLevelDto) {
    return this.collectionsService.updateDunningLevel(req.authContext!, id, dto);
  }
}
