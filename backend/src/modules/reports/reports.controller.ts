import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RequirePermissions, RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { ReportRangeQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';
import { DynamicPivotService } from './services/dynamic-pivot.service';
import { DailyCommercialRollupService } from './services/daily-commercial-rollup.service';
import { ExecuteDynamicPivotDto, SavePivotTemplateDto } from './dto/dynamic-pivot.dto';

@Controller('api')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly pivotService: DynamicPivotService,
    private readonly rollupService: DailyCommercialRollupService,
  ) {}

  @Get('dashboard/overview')
  @RequirePermissions('dashboard')
  dashboardOverview(
    @Query() query: ReportRangeQueryDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.reportsService.dashboardOverview(query, req.authContext!);
  }

  @Get('reports/summary')
  @RequirePermissions('reports')
  reportSummary(@Query() query: ReportRangeQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.reportsService.reportSummary(query, req.authContext!);
  }

  // INV-VAN-PROFIT-REP-REPORTING: standalone net-profit view (same
  // range query as the summary, including the deliveryRepId scope).
  @Get('reports/net-profit')
  @RequirePermissions('reports')
  netProfitReport(@Query() query: ReportRangeQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.reportsService.netProfitReport(query, req.authContext!);
  }

  // INV-VAN-SALES-LIST-DATE-FILTER: combined sales-per-rep /
  // purchases-per-supplier report, one response, one tenant-day range.
  @Get('reports/rep-supplier-summary')
  @RequirePermissions('reports')
  repSupplierSummary(
    @Query() query: ReportRangeQueryDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.reportsService.repSupplierSummary(query, req.authContext!);
  }

  @Get('reports/inventory')
  @RequirePermissions('reports')
  reportInventory(@Query() query: ReportRangeQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.reportsService.inventoryReport(query, req.authContext!);
  }

  @Get('reports/inventory/dead-stock')
  @RequirePermissions('reports')
  deadStockReport(@Query() query: ReportRangeQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.reportsService.deadStockReport(query, req.authContext!);
  }

  @Get('reports/customers/rfm')
  @RequirePermissions('reports')
  customerRfmReport(
    @Query() query: ReportRangeQueryDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.reportsService.customerRfmReport(query, req.authContext!);
  }

  @Get('reports/restaurant/food-cost-variance')
  @RequirePermissions('reports')
  foodCostVarianceReport(
    @Query() query: ReportRangeQueryDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.reportsService.foodCostVarianceReport(query, req.authContext!);
  }

  @Get('reports/restaurant/menu-engineering')
  @RequirePermissions('reports')
  menuEngineeringReport(
    @Query() query: ReportRangeQueryDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.reportsService.menuEngineeringReport(query, req.authContext!);
  }

  @Get('reports/customer-balances')
  @RequireAnyPermission('reports', 'accounts')
  customerBalances(@Query() query: ReportRangeQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.reportsService.customerBalances(query, req.authContext!);
  }

  @Get('reports/supplier-balances')
  @RequireAnyPermission('reports', 'accounts')
  supplierBalances(@Query() query: ReportRangeQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.reportsService.supplierBalances(query, req.authContext!);
  }

  @Get('reports/customers/:id/ledger')
  @RequireAnyPermission('reports', 'accounts')
  customerLedger(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ReportRangeQueryDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.reportsService.customerLedger(id, query, req.authContext!);
  }

  @Get('reports/suppliers/:id/ledger')
  @RequireAnyPermission('reports', 'accounts', 'suppliers')
  supplierLedger(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ReportRangeQueryDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.reportsService.supplierLedger(id, query, req.authContext!);
  }

  @Get('treasury-transactions')
  @RequirePermissions('treasury')
  treasury(@Query() query: ReportRangeQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.reportsService.treasuryTransactions(query, req.authContext!);
  }

  @Get('reports/employees')
  @RequirePermissions('reports')
  employeeSummary(@Query() query: ReportRangeQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.reportsService.employeeSummary(query, req.authContext!);
  }

  @Get('reports/employees/:id/details')
  @RequirePermissions('reports')
  employeeDetails(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ReportRangeQueryDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.reportsService.employeeDetails(id, query, req.authContext!);
  }

  @Get('audit-logs')
  @RequirePermissions('audit')
  auditLogs(@Query() query: ReportRangeQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.reportsService.auditLogs(query, req.authContext!);
  }

  @Get('reports/debt-aging')
  @RequireAnyPermission('reports', 'accounts')
  debtAging(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.reportsService.debtAgingReport(req.authContext!);
  }

  @Get('reports/demand-forecasting')
  @RequireAnyPermission('reports', 'inventory')
  demandForecasting(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.reportsService.demandForecastingReport(req.authContext!);
  }

  @Post('reports/pivot/execute')
  @RequireAnyPermission('reports', 'dashboard', 'sales', 'accounting')
  executePivot(@Body() dto: ExecuteDynamicPivotDto, @Req() req: RequestWithAuth) {
    return this.pivotService.executePivot(req.authContext!, dto);
  }

  @Get('reports/pivot/templates')
  @RequireAnyPermission('reports', 'dashboard', 'sales', 'accounting')
  getSavedTemplates(@Query('dataset') dataset: string, @Req() req: RequestWithAuth) {
    return this.pivotService.getSavedTemplates(req.authContext!, dataset);
  }

  @Post('reports/pivot/templates')
  @RequireAnyPermission('reports', 'dashboard', 'sales', 'accounting')
  savePivotTemplate(@Body() dto: SavePivotTemplateDto, @Req() req: RequestWithAuth) {
    return this.pivotService.saveTemplate(req.authContext!, dto);
  }

  @Delete('reports/pivot/templates/:id')
  @RequireAnyPermission('reports', 'dashboard', 'sales', 'accounting')
  deletePivotTemplate(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.pivotService.deleteTemplate(req.authContext!, id);
  }

  @Get('reports/rollups/multi-year-comparison')
  @RequireAnyPermission('reports', 'dashboard')
  multiYearRollupComparison(
    @Query('years') yearsParam: string,
    @Query('branchId') branchId: string,
    @Req() req: RequestWithAuth,
  ) {
    const years = (yearsParam || '')
      .split(',')
      .map((y) => parseInt(y.trim(), 10))
      .filter((y) => !isNaN(y) && y >= 2020 && y <= 2040);
    const targetYears = years.length > 0 ? years : [new Date().getFullYear() - 1, new Date().getFullYear()];
    const branch = branchId ? parseInt(branchId, 10) : undefined;
    return this.rollupService.getHistoricalMultiYearComparison(req.authContext!.tenantId!, targetYears, branch);
  }

  @Post('reports/rollups/compute-day')
  @RequirePermissions('reports')
  computeDayRollup(@Body('date') date: string, @Body('branchId') branchId: number, @Req() req: RequestWithAuth) {
    // No date supplied: the rollup service owns the default (it holds
    // the tenant's db handle and resolves the tenant-local day). Passing
    // an empty string lets it default instead of stamping the UTC day,
    // which is the wrong business day around local midnight.
    const targetDate = (date || '').trim();
    return this.rollupService.computeAndStoreDailyRollup(req.authContext!.tenantId!, targetDate, branchId);
  }

  // INV-VAN-PROFIT-REP-REPORTING: one-off backfill after the returns
  // fix — recomputes stored rollup rows for a date range (derived
  // aggregates, never journals). Run once after deploy, repeatable.
  @Post('reports/rollups/recompute-range')
  @RequirePermissions('reports')
  recomputeRangeRollups(
    @Body('dateFrom') dateFrom: string,
    @Body('dateTo') dateTo: string,
    @Body('branchId') branchId: number,
    @Req() req: RequestWithAuth,
  ) {
    return this.rollupService.recomputeRollupsForRange(
      req.authContext!.tenantId!,
      (dateFrom || '').trim(),
      (dateTo || '').trim(),
      branchId,
    );
  }
}
