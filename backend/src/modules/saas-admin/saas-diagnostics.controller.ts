import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  BadRequestException,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fsSync from 'fs';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { SuperAdminRoleGuard } from '../../core/auth/guards/super-admin-role.guard';
import { SaasDiagnosticsService, UploadDiagnosticDto } from './saas-diagnostics.service';
import { DiagnosticsUploadRateLimitGuard } from './diagnostics-upload-rate-limit.guard';

@Controller(['api/saas-admin/diagnostics', 'api/v1/saas-admin/diagnostics'])
export class SaasDiagnosticsController {
  constructor(private readonly diagnosticsService: SaasDiagnosticsService) {}

  /**
   * Browser GET test probe / info endpoint
   */
  @Get('upload')
  uploadInfo() {
    return {
      status: 'active',
      service: 'Z-Systems Diagnostics Telemetry Server',
      message: 'مسار استقبال ملفات التشخيص يعمل بنجاح. هذا المسار يستقبل ملفات POST المرفوعة من التطبيق.',
    };
  }

  /**
   * Public upload endpoint for desktop / offline clients
   */
  @Post('upload')
  @UseGuards(DiagnosticsUploadRateLimitGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 30 * 1024 * 1024 }, // 30MB limit
    }),
  )
  async uploadDiagnosticBundle(@UploadedFile() file: Express.Multer.File, @Body() body: UploadDiagnosticDto) {
    if (!file) {
      throw new BadRequestException('ملف التقرير التشخيصي (file) مطلوب');
    }

    return this.diagnosticsService.saveUploadedDiagnosticBundle(file, body);
  }

  /**
   * List client diagnostics for SaaS admin
   */
  @Get()
  @UseGuards(SessionAuthGuard, SuperAdminRoleGuard)
  async listDiagnostics(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.diagnosticsService.listDiagnostics({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search,
    });
  }

  /**
   * Download a diagnostic zip file
   */
  @Get(':id/download')
  @UseGuards(SessionAuthGuard, SuperAdminRoleGuard)
  async downloadDiagnostic(@Param('id', ParseIntPipe) id: number, @Res({ passthrough: true }) res: Response) {
    const fileInfo = await this.diagnosticsService.getDiagnosticFile(id);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileInfo.fileName)}"`,
      'Content-Length': fileInfo.fileSizeBytes,
    });

    const stream = fsSync.createReadStream(fileInfo.filePath);
    return new StreamableFile(stream);
  }

  /**
   * Delete a diagnostic bundle
   */
  @Delete(':id')
  @UseGuards(SessionAuthGuard, SuperAdminRoleGuard)
  async deleteDiagnostic(@Param('id', ParseIntPipe) id: number) {
    return this.diagnosticsService.deleteDiagnostic(id);
  }
}
