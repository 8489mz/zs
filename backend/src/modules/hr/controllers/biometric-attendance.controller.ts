import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import {
  BiometricAttendanceService,
  type ImportBiometricLogDto,
  type PreviewBiometricLogDto,
  type UpsertBiometricDeviceDto,
} from '../services/biometric-attendance.service';
import { BiometricStagingService } from '../services/biometric-staging.service';
import {
  normalizeGenericJsonPushToAttlogLines,
  parseHikvisionWebhookPayload,
} from '../services/http-biometric-lan.client';

@Controller('api/hr/biometric')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('hr')
export class BiometricAttendanceController {
  constructor(
    private readonly biometricService: BiometricAttendanceService,
    private readonly stagingService: BiometricStagingService,
  ) {}

  @Get('devices')
  @RequirePermissions('hrAttendance')
  async listDevices(@Req() req: RequestWithAuth) {
    return this.biometricService.listDevices(req.authContext!);
  }

  @Post('devices')
  @RequirePermissions('hrAttendance')
  async createDevice(@Body() body: UpsertBiometricDeviceDto, @Req() req: RequestWithAuth) {
    return this.biometricService.upsertDevice(null, body, req.authContext!);
  }

  @Put('devices/:id')
  @RequirePermissions('hrAttendance')
  async updateDevice(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpsertBiometricDeviceDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.biometricService.upsertDevice(id, body, req.authContext!);
  }

  @Delete('devices/:id')
  @RequirePermissions('hrAttendance')
  async deleteDevice(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.biometricService.deleteDevice(id, req.authContext!);
  }

  @Post('devices/:id/test-lan')
  @RequirePermissions('hrAttendance')
  async testLanConnection(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.biometricService.testLanDeviceConnection(id, req.authContext!);
  }

  @Post('devices/:id/pull-lan')
  @RequirePermissions('hrAttendance')
  async pullLanAttendance(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.biometricService.pullAttendanceFromLanDevice(id, req.authContext!);
  }

  @Post('employee-pin/:employeeId')
  @RequirePermissions('hrAttendance')
  async assignEmployeePin(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() body: { biometricPin: string | null },
    @Req() req: RequestWithAuth,
  ) {
    return this.biometricService.assignEmployeeBiometricPin(employeeId, body?.biometricPin ?? null, req.authContext!);
  }

  @Post('preview-log')
  @RequirePermissions('hrAttendance')
  async previewLog(@Body() body: PreviewBiometricLogDto, @Req() req: RequestWithAuth) {
    return this.biometricService.previewBiometricLog(body, req.authContext!);
  }

  @Post('import-log')
  @RequirePermissions('hrAttendance')
  async importLog(@Body() body: ImportBiometricLogDto, @Req() req: RequestWithAuth) {
    return this.biometricService.importBiometricLog(body, req.authContext!);
  }

  @Get('pending-punches')
  @RequirePermissions('hrAttendance')
  async listPendingPunches(@Req() req: RequestWithAuth) {
    return this.stagingService.listPendingUnmatchedPunches(req.authContext!);
  }

  @Post('create-employee')
  @RequirePermissions('hrAttendance')
  async createEmployeeFromPin(@Body() body: { pin: string; displayName?: string | null }, @Req() req: RequestWithAuth) {
    return this.stagingService.createEmployeeFromBiometricPin(body, req.authContext!);
  }

  @Post('bulk-create-employees')
  @RequirePermissions('hrAttendance')
  async bulkCreateEmployees(
    @Body() body: { items: Array<{ pin: string; displayName?: string | null }> },
    @Req() req: RequestWithAuth,
  ) {
    return this.stagingService.bulkCreateEmployeesFromPins(body?.items || [], req.authContext!);
  }

  @Delete('pending-punches/:pin')
  @RequirePermissions('hrAttendance')
  async dismissPendingPin(@Param('pin') pin: string, @Req() req: RequestWithAuth) {
    return this.stagingService.dismissPendingPin(pin, req.authContext!);
  }
}

/**
 * ZKTeco ADMS / iClock Cloud Push Protocol Receiver.
 * Hardware terminals call:
 * - GET  /api/hr/biometric/iclock/cdata?SN=6422150300031&options=all
 * - POST /api/hr/biometric/iclock/cdata?SN=6422150300031&table=ATTLOG
 * - GET  /api/hr/biometric/iclock/getrequest?SN=6422150300031
 */
@Controller(['api/hr/biometric/iclock', 'iclock'])
export class BiometricAdmsWebhookController {
  constructor(private readonly biometricService: BiometricAttendanceService) {}

  @Get('cdata')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async handshake(@Query('SN') sn?: string) {
    return this.biometricService.handleAdmsHandshake(sn || '');
  }

  @Post('cdata')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async receivePush(
    @Query('SN') sn: string | undefined,
    @Query('table') table: string | undefined,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    let rawText = '';
    if (typeof body === 'string') {
      rawText = body;
    } else if (Buffer.isBuffer(body)) {
      rawText = body.toString('utf8');
    } else if (body && typeof body === 'object' && 'rawText' in (body as Record<string, unknown>)) {
      rawText = String((body as Record<string, unknown>).rawText || '');
    } else if (typeof req?.rawBody === 'string' || Buffer.isBuffer(req?.rawBody)) {
      rawText = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : req.rawBody;
    } else if (body && typeof body === 'object' && Object.keys(body as Record<string, unknown>).length > 0) {
      // Sometimes express urlencoded parser turns raw lines into keys of body object
      rawText = Object.keys(body as Record<string, unknown>).join('\n');
    } else if (req && req.readable) {
      // Physical ZKTeco ADMS terminals send Content-Type: text/plain which Express json() skips
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      rawText = Buffer.concat(chunks).toString('utf8');
    }

    return this.biometricService.handleAdmsPush(sn || '', table || 'ATTLOG', rawText);
  }

  @Get('getrequest')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async pollCommand() {
    return 'OK';
  }
}

/**
 * Multi-Brand Hardware Cloud Push Receiver (Hikvision HTTP Listening + Universal JSON Push for Dahua / Anviz / Suprema / Bridges).
 * Authenticates hardware strictly by active registered `serial_number` for tenant isolation.
 */
@Controller('api/hr/biometric-push')
export class BiometricMultiBrandWebhookController {
  constructor(private readonly biometricService: BiometricAttendanceService) {}

  @Post('hikvision')
  async receiveHikvisionEvent(@Query('SN') sn: string | undefined, @Body() body: unknown, @Req() req: any) {
    let rawText = '';
    if (typeof body === 'string') {
      rawText = body;
    } else if (Buffer.isBuffer(body)) {
      rawText = body.toString('utf8');
    } else if (body && typeof body === 'object' && Object.keys(body as Record<string, unknown>).length > 0) {
      rawText = JSON.stringify(body);
    } else if (typeof req?.rawBody === 'string' || Buffer.isBuffer(req?.rawBody)) {
      rawText = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : req.rawBody;
    } else if (req && req.readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      rawText = Buffer.concat(chunks).toString('utf8');
    }

    const parsed = parseHikvisionWebhookPayload(rawText);
    const resolvedSn = String(sn || parsed.serialNumber || '').trim();
    if (!resolvedSn) {
      return { ok: false, message: 'ERROR: SN REQUIRED' };
    }
    if (parsed.lines.length === 0) {
      return { ok: true, received: 0 };
    }
    const result = await this.biometricService.handleAdmsPush(resolvedSn, 'ATTLOG', parsed.lines.join('\n'));
    return { ok: result.startsWith('OK'), result };
  }

  @Post('json')
  async receiveGenericJsonPush(@Query('SN') sn: string | undefined, @Body() body: unknown) {
    const parsed = normalizeGenericJsonPushToAttlogLines(body);
    const resolvedSn = String(sn || parsed.serialNumber || '').trim();
    if (!resolvedSn) {
      return { ok: false, message: 'ERROR: SN REQUIRED' };
    }
    if (parsed.lines.length === 0) {
      return { ok: true, received: 0 };
    }
    const result = await this.biometricService.handleAdmsPush(resolvedSn, 'ATTLOG', parsed.lines.join('\n'));
    return { ok: result.startsWith('OK'), result };
  }
}
