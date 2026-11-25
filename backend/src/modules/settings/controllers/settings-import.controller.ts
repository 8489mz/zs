import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { SettingsImportService } from '../services/settings-import.service';
import { ImportRowsDto } from '../dto/settings-write.dto';

@Controller(['api/import', 'api/v1/import'])
@UseGuards(SessionAuthGuard)
export class SettingsImportController {
  constructor(private readonly importService: SettingsImportService) {}

  @Post('products')
  importProducts(@Body() payload: ImportRowsDto, @Req() req: RequestWithAuth) {
    this.importService.assertAdmin(req.authContext);
    return this.importService.importProducts(payload.rows || [], req.authContext!);
  }

  @Post('customers')
  importCustomers(@Body() payload: ImportRowsDto, @Req() req: RequestWithAuth) {
    this.importService.assertAdmin(req.authContext);
    return this.importService.importCustomers(payload.rows || [], req.authContext!);
  }

  @Post('suppliers')
  importSuppliers(@Body() payload: ImportRowsDto, @Req() req: RequestWithAuth) {
    this.importService.assertAdmin(req.authContext);
    return this.importService.importSuppliers(payload.rows || [], req.authContext!);
  }

  @Post('opening-stock')
  importOpeningStock(@Body() payload: ImportRowsDto, @Req() req: RequestWithAuth) {
    this.importService.assertAdmin(req.authContext);
    return this.importService.importOpeningStock(payload.rows || [], req.authContext!);
  }

  @Post('employees')
  importEmployees(@Body() payload: ImportRowsDto, @Req() req: RequestWithAuth) {
    this.importService.assertEmployeeImporter(req.authContext);
    return this.importService.importEmployees(payload.rows || [], req.authContext!);
  }
}
