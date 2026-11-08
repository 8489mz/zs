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
import { RequirePermissions, RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { RequireFeature } from '../../core/auth/decorators/feature.decorator';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { UpsertMaintenanceTicketDto } from './dto/upsert-maintenance-ticket.dto';
import { UpdateTicketStatusDto, AddTicketPartDto } from './dto/update-ticket-status.dto';
import { MaintenanceService } from './maintenance.service';

@Controller('api/maintenance/tickets')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get()
  @RequireAnyPermission('services', 'sales')
  listTickets(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.maintenanceService.listTickets(req.authContext!, {
      status,
      q,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25,
    });
  }

  // Counts MUST be registered before @Get(':id'): otherwise Nest
  // matches 'counts' as an id. Aggregate SQL only — the page must
  // never pull the table to count (review P2-4).
  @Get('counts')
  @RequireAnyPermission('services', 'sales')
  getTicketCounts(@Req() req: RequestWithAuth) {
    return this.maintenanceService.getTicketCounts(req.authContext!);
  }

  @Get(':id')
  @RequireAnyPermission('services', 'sales')
  getTicket(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.maintenanceService.getTicket(id, req.authContext!);
  }

  @Post()
  @RequireAnyPermission('services', 'sales')
  createTicket(@Body() payload: UpsertMaintenanceTicketDto, @Req() req: RequestWithAuth) {
    return this.maintenanceService.createTicket(payload, req.authContext!);
  }

  @Put(':id')
  @RequireAnyPermission('services', 'sales')
  updateTicket(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpsertMaintenanceTicketDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.maintenanceService.updateTicket(id, payload, req.authContext!);
  }

  @Patch(':id/status')
  @RequireAnyPermission('services', 'sales')
  updateTicketStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpdateTicketStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.maintenanceService.updateTicketStatus(id, payload, req.authContext!);
  }

  @Post(':id/parts')
  @RequireAnyPermission('services', 'sales', 'products')
  addPart(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: AddTicketPartDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.maintenanceService.addPart(id, payload, req.authContext!);
  }

  @Delete(':id/parts/:partId')
  @RequireAnyPermission('services', 'sales', 'products')
  removePart(
    @Param('id', ParseIntPipe) id: number,
    @Param('partId', ParseIntPipe) partId: number,
    @Req() req: RequestWithAuth,
  ) {
    return this.maintenanceService.removePart(id, partId, req.authContext!);
  }

  @Delete(':id')
  @RequirePermissions('canDelete')
  deleteTicket(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.maintenanceService.deleteTicket(id, req.authContext!);
  }
}
