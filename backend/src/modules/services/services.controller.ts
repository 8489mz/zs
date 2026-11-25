import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IdempotencyInterceptor } from '../../core/idempotency/idempotency.interceptor';
import { RequirePermissions, RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { UpsertServiceDto } from './dto/upsert-service.dto';
import { ServicesService } from './services.service';

@Controller('api')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@UseInterceptors(IdempotencyInterceptor)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get('services')
  @RequireAnyPermission('services', 'sales')
  listServices(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.servicesService.listServices(query, req.authContext!);
  }

  @Post('services')
  @RequirePermissions('services')
  createService(@Body() payload: UpsertServiceDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.servicesService.createService(payload, req.authContext!);
  }

  @Put('services/:id')
  @RequirePermissions('services')
  updateService(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpsertServiceDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.servicesService.updateService(id, payload, req.authContext!);
  }

  @Delete('services/:id')
  @RequirePermissions('services')
  deleteService(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.servicesService.deleteService(id, req.authContext!);
  }
}
