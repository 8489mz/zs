import { Module } from '@nestjs/common';
import { AuthFoundationModule } from '../../core/auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsAdminService } from './services/reports-admin.service';
import { ReportsSummaryService } from './services/reports-summary.service';
import { DynamicPivotService } from './services/dynamic-pivot.service';
import { DailyCommercialRollupService } from './services/daily-commercial-rollup.service';

@Module({
  imports: [DatabaseModule, AuthFoundationModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportsSummaryService,
    ReportsAdminService,
    DynamicPivotService,
    DailyCommercialRollupService,
  ],
  exports: [DynamicPivotService, DailyCommercialRollupService],
})
export class ReportsModule {}
