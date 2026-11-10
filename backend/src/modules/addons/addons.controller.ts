import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../../core/auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { UpsertAddonDto } from './dto/upsert-addon.dto';
import { AddonsService } from './addons.service';

@Controller('api/addons')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class AddonsController {
  constructor(private readonly addonsService: AddonsService) {}

  @Get()
  @RequirePermissions('products')
  listAddons(@Req() req: RequestWithAuth) {
    return this.addonsService.listAddons(req.authContext!);
  }

  @Post()
  @RequirePermissions('products')
  createAddon(@Body() payload: UpsertAddonDto, @Req() req: RequestWithAuth) {
    return this.addonsService.createAddon(payload, req.authContext!);
  }

  @Put(':id')
  @RequirePermissions('products')
  updateAddon(@Param('id', ParseIntPipe) id: number, @Body() payload: UpsertAddonDto, @Req() req: RequestWithAuth) {
    return this.addonsService.updateAddon(id, payload, req.authContext!);
  }

  @Delete(':id')
  @RequirePermissions('products')
  deleteAddon(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.addonsService.deleteAddon(id, req.authContext!);
  }

  // --- Modifier Groups & Meal Combos Matrix ---

  @Get('modifier-groups')
  @RequirePermissions('products')
  listModifierGroups(@Req() req: RequestWithAuth) {
    return this.addonsService.listModifierGroups(req.authContext!);
  }

  @Post('modifier-groups')
  @RequirePermissions('products')
  createModifierGroup(@Body() payload: any, @Req() req: RequestWithAuth) {
    return this.addonsService.createModifierGroup(payload, req.authContext!);
  }

  @Put('modifier-groups/:id')
  @RequirePermissions('products')
  updateModifierGroup(@Param('id', ParseIntPipe) id: number, @Body() payload: any, @Req() req: RequestWithAuth) {
    return this.addonsService.updateModifierGroup(id, payload, req.authContext!);
  }

  @Delete('modifier-groups/:id')
  @RequirePermissions('products')
  deleteModifierGroup(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.addonsService.deleteModifierGroup(id, req.authContext!);
  }

  @Get('products/:productId/modifiers')
  @RequirePermissions('products')
  getProductModifiers(@Param('productId', ParseIntPipe) productId: number, @Req() req: RequestWithAuth) {
    return this.addonsService.getProductModifiers(productId, req.authContext!);
  }

  @Post('products/:productId/modifiers')
  @RequirePermissions('products')
  linkProductModifiers(
    @Param('productId', ParseIntPipe) productId: number,
    @Body('groupIds') groupIds: number[],
    @Req() req: RequestWithAuth
  ) {
    return this.addonsService.linkProductModifiers(productId, groupIds, req.authContext!);
  }
}
