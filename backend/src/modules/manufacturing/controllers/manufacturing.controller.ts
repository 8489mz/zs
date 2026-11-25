import { Controller, Post, Body, Get, Param, ParseIntPipe, Patch, Put, Delete, UseGuards, Req } from '@nestjs/common';
import { ManufacturingService } from '../services/manufacturing.service';
import {
  CreateBomDto,
  CreateWorkOrderDto,
  CompleteWorkOrderDto,
  UpsertWorkCenterDto,
  CreateUnbuildOrderDto,
  CreateMtoWorkOrderDto,
} from '../dto/manufacturing.dto';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { RequirePermissions, RequireAnyPermission } from '../../../core/auth/decorators/permissions.decorator';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';

@Controller('api/manufacturing')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('manufacturing')
export class ManufacturingController {
  constructor(private readonly manufacturingService: ManufacturingService) {}

  @Post('boms')
  @RequireAnyPermission('inventory', 'products')
  createBom(@Body() dto: CreateBomDto, @Req() req: RequestWithAuth) {
    return this.manufacturingService.createBom(dto, req.authContext!);
  }

  @Get('boms')
  @RequireAnyPermission('inventory', 'products')
  getBoms(@Req() req: RequestWithAuth) {
    return this.manufacturingService.getBoms(req.authContext!);
  }

  @Patch('boms/:id')
  @RequireAnyPermission('inventory', 'products')
  updateBom(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateBomDto, @Req() req: RequestWithAuth) {
    return this.manufacturingService.updateBom(id, dto, req.authContext!);
  }

  @Put('boms/:id')
  @RequireAnyPermission('inventory', 'products')
  updateBomPut(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateBomDto, @Req() req: RequestWithAuth) {
    return this.manufacturingService.updateBom(id, dto, req.authContext!);
  }

  @Delete('boms/:id')
  @RequireAnyPermission('inventory', 'products')
  deleteBom(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.manufacturingService.deleteBom(id, req.authContext!);
  }

  @Post('work-orders')
  @RequireAnyPermission('inventory', 'products')
  createWorkOrder(@Body() dto: CreateWorkOrderDto, @Req() req: RequestWithAuth) {
    return this.manufacturingService.createWorkOrder(dto, req.authContext!);
  }

  @Get('work-orders')
  @RequireAnyPermission('inventory', 'products')
  getWorkOrders(@Req() req: RequestWithAuth) {
    return this.manufacturingService.getWorkOrders(req.authContext!);
  }

  @Patch('work-orders/:id/complete')
  @RequireAnyPermission('inventory', 'products')
  completeWorkOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteWorkOrderDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.manufacturingService.completeWorkOrder(id, dto, req.authContext!);
  }

  // --- Work Centers & Machine Routing (Odoo 17 Benchmark) ---
  @Get('work-centers')
  @RequireAnyPermission('inventory', 'products')
  listWorkCenters(@Req() req: RequestWithAuth) {
    return this.manufacturingService.listWorkCenters(req.authContext!);
  }

  @Post('work-centers')
  @RequireAnyPermission('inventory', 'products')
  createWorkCenter(@Body() dto: UpsertWorkCenterDto, @Req() req: RequestWithAuth) {
    return this.manufacturingService.upsertWorkCenter(null, dto, req.authContext!);
  }

  @Put('work-centers/:id')
  @RequireAnyPermission('inventory', 'products')
  updateWorkCenter(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertWorkCenterDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.manufacturingService.upsertWorkCenter(id, dto, req.authContext!);
  }

  @Delete('work-centers/:id')
  @RequireAnyPermission('inventory', 'products')
  deleteWorkCenter(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.manufacturingService.deleteWorkCenter(id, req.authContext!);
  }

  @Get('work-orders/:id/operations')
  @RequireAnyPermission('inventory', 'products')
  getWorkOrderOperations(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.manufacturingService.getWorkOrderOperations(id, req.authContext!);
  }

  @Get('unbuild-orders')
  @RequireAnyPermission('inventory', 'products')
  listUnbuildOrders(@Req() req: RequestWithAuth) {
    return this.manufacturingService.listUnbuildOrders(req.authContext!);
  }

  @Post('unbuild-orders')
  @RequireAnyPermission('inventory', 'products')
  createUnbuildOrder(@Body() dto: CreateUnbuildOrderDto, @Req() req: RequestWithAuth) {
    return this.manufacturingService.createUnbuildOrder(dto, req.authContext!);
  }

  @Post('work-orders/mto')
  @RequireAnyPermission('inventory', 'products', 'sales')
  createMtoWorkOrder(@Body() dto: CreateMtoWorkOrderDto, @Req() req: RequestWithAuth) {
    return this.manufacturingService.createMtoWorkOrder(dto, req.authContext!);
  }
}
