import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { AllowAuthenticated } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { TableReservationsService } from '../services/table-reservations.service';
import { CreateTableReservationDto, UpdateTableReservationStatusDto } from '../dto/table-reservation.dto';

@Controller('api/sales/table-reservations')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@AllowAuthenticated()
export class TableReservationsController {
  constructor(private readonly service: TableReservationsService) {}

  @Get()
  async listReservations(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
    @Query('date') date?: string,
    @Query('type') type?: string,
  ) {
    const scope = requireTenantScope(req.authContext!);
    const branch = branchId ? parseInt(branchId, 10) : undefined;
    return this.service.listReservations(scope.tenantId, branch, date, type);
  }

  @Post()
  async createReservation(@Req() req: RequestWithAuth, @Body() dto: CreateTableReservationDto) {
    const scope = requireTenantScope(req.authContext!);
    const userId = Number(req.authContext?.userId || 0);
    return this.service.createReservation(scope.tenantId, userId, dto);
  }

  @Patch(':id/status')
  async updateStatus(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTableReservationStatusDto,
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.updateStatus(scope.tenantId, id, dto);
  }

  @Delete(':id')
  async deleteReservation(@Req() req: RequestWithAuth, @Param('id', ParseIntPipe) id: number) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.deleteReservation(scope.tenantId, id);
  }
}
