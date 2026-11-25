import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { SettingsService } from './settings.service';
import { SettingsBackupService } from './services/settings-backup.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { BranchPayloadDto } from './dto/branch-payload.dto';
import { LocationPayloadDto } from './dto/location-payload.dto';
import { UpdateActivityProfileDto } from './dto/activity-profile.dto';

@Controller('api')
@UseGuards(SessionAuthGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly backupService: SettingsBackupService,
  ) {}

  private assertSettingsPermission(req: RequestWithAuth): void {
    const permissions = req.authContext?.permissions ?? [];
    if (
      !permissions.includes('canManageSettings') &&
      !permissions.includes('settings') &&
      req.authContext?.role !== 'super_admin'
    ) {
      throw new ForbiddenException('Missing required permissions');
    }
  }

  @Get('settings')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  async getSettings(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    await this.backupService.runAutoBackupIfDue(req.authContext).catch(() => undefined);
    return this.settingsService.getSettings(req.authContext!);
  }

  @Put('settings')
  updateSettings(
    @Body() rawPayload: Record<string, unknown>,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    this.assertSettingsPermission(req);
    const settings =
      rawPayload &&
      typeof rawPayload === 'object' &&
      'settings' in rawPayload &&
      rawPayload.settings &&
      typeof rawPayload.settings === 'object'
        ? (rawPayload.settings as Record<string, unknown>)
        : rawPayload;
    return this.settingsService.saveSettings(settings, req.authContext!);
  }

  @Get('branches')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  listBranches(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.settingsService.listBranches(req.authContext!);
  }

  @Post('branches')
  createBranch(@Body() payload: BranchPayloadDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    this.assertSettingsPermission(req);
    return this.settingsService.createBranch(payload, req.authContext!);
  }

  @Put('branches/:id')
  updateBranch(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: BranchPayloadDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    this.assertSettingsPermission(req);
    return this.settingsService.updateBranch(id, payload, req.authContext!);
  }

  @Delete('branches/:id')
  deleteBranch(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    this.assertSettingsPermission(req);
    return this.settingsService.deleteBranch(id, req.authContext!);
  }

  @Get('settings/locations')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  listLocations(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.settingsService.listLocations(req.authContext!);
  }

  @Post('settings/locations')
  createLocation(@Body() payload: LocationPayloadDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    this.assertSettingsPermission(req);
    return this.settingsService.createLocation(payload, req.authContext!);
  }

  @Put('settings/locations/:id')
  updateLocation(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: LocationPayloadDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    this.assertSettingsPermission(req);
    return this.settingsService.updateLocation(id, payload, req.authContext!);
  }

  @Delete('settings/locations/:id')
  deleteLocation(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    this.assertSettingsPermission(req);
    return this.settingsService.deleteLocation(id, req.authContext!);
  }

  @Get('settings/industry-profiles')
  getIndustryProfiles(): Record<string, unknown> {
    return { profiles: this.settingsService.getIndustryProfiles() };
  }

  @Put('settings/activity-profile')
  setActivityProfile(
    @Body() payload: UpdateActivityProfileDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    this.assertSettingsPermission(req);
    return this.settingsService.setActivityProfile(payload.activityType, req.authContext!);
  }
}
