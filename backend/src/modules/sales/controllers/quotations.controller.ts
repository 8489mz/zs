import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { QuotationsService } from '../services/quotations.service';
import { CreateQuotationDto, UpdateQuotationDto } from '../dto/quotation.dto';

@Controller(['api/quotations', 'api/v1/quotations'])
@UseGuards(SessionAuthGuard)
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Get()
  listQuotations(@Query() query: { status?: string; search?: string }, @Req() req: RequestWithAuth) {
    return this.quotationsService.listQuotations(req.authContext!, query);
  }

  @Get(':id')
  getQuotationById(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.quotationsService.getQuotationById(id, req.authContext!);
  }

  @Post()
  createQuotation(@Body() dto: CreateQuotationDto, @Req() req: RequestWithAuth) {
    return this.quotationsService.createQuotation(dto, req.authContext!);
  }

  @Put(':id')
  updateQuotation(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateQuotationDto, @Req() req: RequestWithAuth) {
    return this.quotationsService.updateQuotation(id, dto, req.authContext!);
  }

  @Delete(':id')
  deleteQuotation(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.quotationsService.deleteQuotation(id, req.authContext!);
  }

  @Post(':id/convert-to-sale')
  convertToSale(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.quotationsService.convertToSale(id, req.authContext!);
  }
}
