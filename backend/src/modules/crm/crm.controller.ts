import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { CrmService } from './crm.service';
import { CreateActivityDto, CreateDealDto, ListDealsQueryDto, UpdateDealDto } from './dto/crm.dto';

@Controller(['api/crm', 'api/v1/crm'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireAnyPermission('sales', 'customers', 'crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Get('deals')
  listDeals(@Query() query: ListDealsQueryDto, @Req() req: RequestWithAuth) {
    return this.crmService.listDeals(query, req.authContext!);
  }

  @Get('deals/:id')
  getDeal(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.crmService.getDeal(id, req.authContext!);
  }

  @Post('deals')
  createDeal(@Body() dto: CreateDealDto, @Req() req: RequestWithAuth) {
    return this.crmService.createDeal(dto, req.authContext!);
  }

  @Put('deals/:id')
  updateDeal(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDealDto, @Req() req: RequestWithAuth) {
    return this.crmService.updateDeal(id, dto, req.authContext!);
  }

  @Delete('deals/:id')
  deleteDeal(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.crmService.deleteDeal(id, req.authContext!);
  }

  @Get('pipeline-summary')
  getPipelineSummary(@Req() req: RequestWithAuth) {
    return this.crmService.getPipelineSummary(req.authContext!);
  }

  @Post('deals/:id/activities')
  addActivity(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateActivityDto, @Req() req: RequestWithAuth) {
    return this.crmService.addActivity(id, dto as any, req.authContext!);
  }

  @Patch('activities/:id/toggle')
  toggleActivity(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.crmService.toggleActivity(id, req.authContext!);
  }

  @Post('deals/:id/convert-to-customer')
  convertToCustomer(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.crmService.convertToCustomer(id, req.authContext!);
  }
}
