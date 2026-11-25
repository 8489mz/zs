import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { AllowAuthenticated, RequirePermissions } from '../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { UpsertUserDto } from './dto/upsert-user.dto';
import { SyncUsersDto } from './dto/sync-users.dto';
import { BulkDisableUsersDto } from './dto/bulk-disable-users.dto';
import { UsersService } from './users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { DeleteUserDto } from './dto/delete-user.dto';

@Controller('api/users')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Put('me/password')
  @AllowAuthenticated()
  changePassword(@Body() payload: ChangePasswordDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.usersService.changePassword(payload, req.authContext!);
  }

  @Put('me')
  @AllowAuthenticated()
  updateProfile(@Body() payload: UpdateProfileDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.usersService.updateProfile(payload, req.authContext!);
  }

  @Get()
  @AllowAuthenticated()
  list(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.usersService.listUsers(query, req.authContext!);
  }

  @Post()
  @RequirePermissions('canManageUsers')
  create(@Body() payload: UpsertUserDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.usersService.createUser(payload, req.authContext!);
  }

  @Put(':id')
  @RequirePermissions('canManageUsers')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpsertUserDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.usersService.updateUser(id, payload, req.authContext!, req.authContext?.sessionId);
  }

  @Put()
  @RequirePermissions('canManageUsers')
  sync(@Body() payload: SyncUsersDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.usersService.syncUsers(payload.users ?? [], req.authContext!, req.authContext?.sessionId);
  }

  @Delete(':id')
  @RequirePermissions('canManageUsers')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DeleteUserDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.usersService.deleteUser(id, body?.managerPin, req.authContext!);
  }

  @Post(':id/unlock')
  @RequirePermissions('canManageUsers')
  unlock(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.usersService.unlockUser(id, req.authContext!);
  }

  @Post('bulk-disable')
  @RequirePermissions('canManageUsers')
  bulkDisable(@Body() payload: BulkDisableUsersDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.usersService.bulkDisableUsers(payload.userIds ?? [], req.authContext!, req.authContext?.sessionId);
  }
}
