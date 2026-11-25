import {
  Body,
  Controller,
  Get,
  ParseBoolPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  StreamableFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { AdminRoleGuard } from '../../../core/auth/guards/admin-role.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { SettingsBackupService } from '../services/settings-backup.service';
import { CloudBackupService, CloudBackupConfig } from '../services/cloud-backup.service';
import { BackupEnvelopeDto } from '../dto/backup-envelope.dto';
import { CloudBackupConfigDto } from '../dto/settings-write.dto';

@Controller('api')
@UseGuards(SessionAuthGuard, AdminRoleGuard)
export class SettingsBackupController {
  constructor(
    private readonly backupService: SettingsBackupService,
    private readonly cloudBackupService: CloudBackupService,
  ) {}

  @Get(['backup', 'v1/backup'])
  async getBackup(@Req() req: RequestWithAuth, @Res({ passthrough: true }) res: any): Promise<StreamableFile> {
    const { zipBuffer } = await this.backupService.exportBackup(req.authContext!);
    const now = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    const fileName = `ZERP-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    return new StreamableFile(zipBuffer);
  }

  @Get(['backup-snapshots', 'v1/backup-snapshots'])
  listSnapshots(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.backupService.listSnapshots(req.authContext!);
  }

  @Get(['backup/config', 'v1/backup/config'])
  getBackupConfig(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.backupService.getBackupConfig(req.authContext!);
  }

  @Post(['backup/config', 'v1/backup/config'])
  saveBackupConfig(
    @Body() payload: Record<string, unknown>,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.backupService.saveBackupConfig(payload, req.authContext!);
  }

  @Post(['backup/folder/test', 'v1/backup/folder/test'])
  testBackupFolder(
    @Body() payload: Record<string, unknown>,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.backupService.testBackupFolder(payload, req.authContext!);
  }

  @Post(['backup/save-file', 'v1/backup/save-file'])
  saveBackupToConfiguredFolder(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.backupService.saveBackupToConfiguredFolder(req.authContext!);
  }

  @Get(['backup/cloud/config', 'v1/backup/cloud/config'])
  getCloudConfig(@Req() req: RequestWithAuth): Promise<CloudBackupConfig> {
    return this.cloudBackupService.getCloudConfig(req.authContext!);
  }

  @Post(['backup/cloud/config', 'v1/backup/cloud/config'])
  saveCloudConfig(@Body() payload: CloudBackupConfigDto, @Req() req: RequestWithAuth): Promise<CloudBackupConfig> {
    return this.cloudBackupService.saveCloudConfig(payload, req.authContext!);
  }

  @Post(['backup/cloud/test', 'v1/backup/cloud/test'])
  testCloudConnection(@Req() req: RequestWithAuth): Promise<{ success: boolean; message: string }> {
    return this.cloudBackupService.testConnection(req.authContext!);
  }

  @Post(['backup/cloud/trigger', 'v1/backup/cloud/trigger'])
  triggerCloudBackupNow(@Req() req: RequestWithAuth) {
    return this.cloudBackupService.triggerCloudBackupNow(req.authContext!);
  }

  @Post(['backup/verify', 'v1/backup/verify'])
  @UseInterceptors(FileInterceptor('file'))
  async verifyBackup(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 500 * 1024 * 1024 })],
        fileIsRequired: false,
      }),
    )
    file: Express.Multer.File | undefined,
    @Body() body: BackupEnvelopeDto,
    @Req() _req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    let payload: unknown = undefined;
    if (file) {
      payload = file.buffer;
    } else if (body && Object.keys(body).length > 0) {
      // Legacy json payload fallback if it's sent as body
      payload = body;
    }
    if (!payload) {
      throw new BadRequestException('No backup file or payload provided');
    }
    return this.backupService.verifyBackup(payload);
  }

  @Post(['backup/restore', 'v1/backup/restore'])
  @UseInterceptors(FileInterceptor('file'))
  async restoreBackup(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 500 * 1024 * 1024 })],
        fileIsRequired: false,
      }),
    )
    file: Express.Multer.File | undefined,
    @Body() body: BackupEnvelopeDto,
    @Req() req: RequestWithAuth,
    @Query('dryRun', new ParseBoolPipe({ optional: true })) dryRun?: boolean,
  ): Promise<Record<string, unknown>> {
    let payload: unknown = undefined;
    if (file) {
      payload = file.buffer;
    } else if (body && Object.keys(body).length > 0) {
      payload = body;
    }
    if (!payload) {
      throw new BadRequestException('No backup file or payload provided');
    }

    // We pass body for legacy confirmation if it's a JSON payload, or we extract confirmation from body if it's a file
    let confirmationPayload: any = body;
    if (file && body.confirmation) {
      confirmationPayload = { confirmation: body.confirmation };
    }
    // But wait, backup service uses `payload` for BOTH the data AND the confirmation right now.
    // Let's modify the service to accept confirmation separately, or we just merge it if it's a buffer?
    // The service does: `const confirmation = String(payload.confirmation || payload.restoreConfirmation || '').trim();`
    // If payload is a Buffer, this will be empty!
    // We should pass body as a second arg to verify/restore?
    // Wait, the service already parses it inside parseAndVerifyPayload, but assertRestoreConfirmation is called on `payload`.
    // I will merge them if it's a buffer, by wrapping it!

    let combinedPayload = payload;
    if (Buffer.isBuffer(payload)) {
      combinedPayload = { buffer: payload, confirmation: body.confirmation || body.restoreConfirmation };
    }

    return this.backupService.restoreBackup(combinedPayload, req.authContext!, dryRun ?? false);
  }
}
