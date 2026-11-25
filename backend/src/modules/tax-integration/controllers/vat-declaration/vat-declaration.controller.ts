import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../../core/auth/interfaces/request-with-auth.interface';
import { VatDeclarationService, VatDeclarationQueryDto } from '../../services/vat-declaration/vat-declaration.service';

@Controller(['api/tax-integration/vat-declaration', 'api/v1/tax-integration/vat-declaration'])
@UseGuards(SessionAuthGuard)
export class VatDeclarationController {
  constructor(private readonly vatDeclarationService: VatDeclarationService) {}

  @Get()
  getDeclaration(@Query() query: VatDeclarationQueryDto, @Req() req: RequestWithAuth) {
    return this.vatDeclarationService.getDeclaration(query, req.authContext!);
  }
}
