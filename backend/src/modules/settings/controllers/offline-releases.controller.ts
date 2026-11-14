import { Controller, Get, Post, Body, Param, UseGuards, Req, Query, UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator, FileTypeValidator } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { SuperAdminRoleGuard } from '../../../core/auth/guards/super-admin-role.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { OfflineReleasesService } from '../services/offline-releases.service';

// ─── Public endpoint (no auth) — called by offline clients to check for updates ───
@Controller('api/updates')
export class OfflineUpdatesPublicController {
  constructor(private readonly releasesService: OfflineReleasesService) {}

  /**
   * GET /api/updates/version
   * Returns the currently installed version (read from .app_version file).
   * Used by the frontend to know its current version after an update.
   */
  @Get('version')
  getCurrentVersion() {
    return this.releasesService.getCurrentVersion();
  }

  /**
   * GET /api/updates/check?version=1.2.3
   * Called by the portable client on startup to check if a newer stable release exists.
   */
  @Get('check')
  async checkForUpdate(@Query('version') currentVersion = '') {
    return this.releasesService.checkForUpdate(currentVersion);
  }

  /**
   * GET /api/updates/history
   * Called by the portable client to view past updates.
   */
  @Get('history')
  async getHistory() {
    return this.releasesService.listReleaseHistory();
  }

  /**
   * POST /api/updates/simulate
   * Developer Sandbox simulation mode to test and verify updates in real-time.
   */
  @Post('simulate')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions('canManageSettings')
  async simulateUpdate(@Body() body: { fromVersion?: string; targetVersion?: string; passcode?: string }) {
    return this.releasesService.simulateUpdate(body);
  }

  /**
   * POST /api/updates/apply-local-zip (Legacy alias)
   */
  @Post('apply-local-zip')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions('canManageSettings')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 128 * 1024 * 1024 } }))
  async applyLocalZipUpdateLegacy(
    @UploadedFile() file: Express.Multer.File,
    @Body('passcode') passcode?: string,
  ) {
    return this.releasesService.applyLocalZipUpdate(file, passcode);
  }

  /**
   * POST /api/updates/apply (Legacy alias)
   */
  @Post('apply')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions('canManageSettings')
  async applyUpdateLegacy(@Body() body: { version: string; patchUrl: string; changelog: string; passcode?: string }) {
    return this.releasesService.applyLocalUpdate(body);
  }
}

// ─── Protected endpoints — apply updates locally ───
@Controller('api/local-updates')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class OfflineUpdatesProtectedController {
  constructor(private readonly releasesService: OfflineReleasesService) {}

  /**
   * POST /api/local-updates/apply
   * Called by the local desktop client to trigger downloading and applying a patch.
   */
  @Post('apply')
  @RequirePermissions('canManageSettings')
  async applyUpdate(@Body() body: { version: string; patchUrl: string; changelog: string; passcode?: string }) {
    return this.releasesService.applyLocalUpdate(body);
  }

  /**
   * POST /api/local-updates/apply-local-zip
   * Called by the local desktop client to trigger applying a manual local patch.
   */
  @Post('apply-local-zip')
  @RequirePermissions('canManageSettings')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 128 * 1024 * 1024 } }))
  async applyLocalZipUpdate(
    @UploadedFile() file: Express.Multer.File,
    @Body('passcode') passcode?: string,
  ) {
    return this.releasesService.applyLocalZipUpdate(file, passcode);
  }
}

// ─── Admin endpoints — manage releases ───
@Controller('api/admin/offline-releases')
@UseGuards(SessionAuthGuard, SuperAdminRoleGuard)
export class OfflineReleasesAdminController {
  constructor(private readonly releasesService: OfflineReleasesService) {}

  /** GET /api/admin/offline-releases — list all releases */
  @Get()
  listReleases(@Req() req: RequestWithAuth) {
    return this.releasesService.listReleases(req.authContext!);
  }

  /** GET /api/admin/offline-releases/passcode-by-version?version=... — get passcode by version string */
  @Get('passcode-by-version')
  getReleasePasscodeByVersion(@Req() req: RequestWithAuth, @Query('version') version: string) {
    return this.releasesService.getReleasePasscodeByVersion(req.authContext!, version);
  }

  /** GET /api/admin/offline-releases/:id/passcode — get release passcode for admin */
  @Get(':id/passcode')
  getReleasePasscode(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.releasesService.getReleasePasscode(req.authContext!, Number(id));
  }

  /**
   * POST /api/admin/offline-releases/:id/passcode
   * Provision (or rotate) the activation passcode for a release. The code
   * comes from the release script output — it is never derived server-side.
   * Body: { passcode }
   */
  @Post(':id/passcode')
  setReleasePasscode(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: { passcode: string },
  ) {
    return this.releasesService.setReleasePasscode(req.authContext!, Number(id), body?.passcode);
  }

  /**
   * POST /api/admin/offline-releases
   * Create a new release entry (draft — not active yet).
   * Body: { version, changelog, patchUrl, passcode, requiresPasscode }
   */
  @Post()
  createRelease(
    @Req() req: RequestWithAuth,
    @Body() body: { version: string; changelog: string; patchUrl: string; passcode?: string; requiresPasscode?: boolean },
  ) {
    return this.releasesService.createRelease(req.authContext!, body);
  }

  /**
   * POST /api/admin/offline-releases/:id/promote
   * Mark a release as the active stable release clients will see.
   */
  @Post(':id/promote')
  promoteRelease(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.releasesService.promoteRelease(req.authContext!, Number(id));
  }

  /**
   * POST /api/admin/offline-releases/:id/deactivate
   * Deactivate a release (clients stop seeing it).
   */
  @Post(':id/deactivate')
  deactivateRelease(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.releasesService.deactivateRelease(req.authContext!, Number(id));
  }

  /**
   * POST /api/admin/offline-releases/trigger-update
   * Write .update_pending marker and exit so the launcher applies the update.
   * Only works in portable/offline mode (APP_MODE=offline).
   */
  @Post('trigger-update')
  triggerUpdate(@Req() req: RequestWithAuth) {
    return this.releasesService.triggerUpdate(req.authContext!);
  }
}
