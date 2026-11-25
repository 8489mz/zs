import {
  Body,
  Controller,
  Get,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { AdminRoleGuard } from '../../../core/auth/guards/admin-role.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { TenantTransferService } from '../services/tenant-transfer.service';

@Controller(['api/tenant-transfer', 'api/v1/tenant-transfer'])
@UseGuards(SessionAuthGuard, AdminRoleGuard)
export class TenantTransferController {
  constructor(private readonly transfer: TenantTransferService) {}

  @Get('info')
  info(): Record<string, unknown> {
    return { mode: this.transfer.isDesktop() ? 'desktop' : 'cloud' };
  }

  @Get('export')
  async export(@Req() req: RequestWithAuth, @Res({ passthrough: true }) res: any): Promise<StreamableFile> {
    const { buffer, fileName } = await this.transfer.exportForActor(req.authContext!);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(buffer);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async import(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 500 * 1024 * 1024 })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    if (!file?.buffer?.length) throw new BadRequestException('No file uploaded');
    return this.transfer.importForActor(req.authContext!, file.buffer, {
      confirmation: typeof body?.confirmation === 'string' ? body.confirmation : undefined,
      passphrase: typeof body?.passphrase === 'string' ? body.passphrase : undefined,
      pick: typeof body?.pick === 'string' ? body.pick : undefined,
    });
  }
}
