import { Module } from '@nestjs/common';
import { AuditModule } from '../../core/audit/audit.module';
import { AuthFoundationModule } from '../../core/auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { HrTreasuryAdapter } from './hr-treasury.adapter';
import { MobileAttendanceService } from './mobile-attendance.service';
import { MobileAttendanceController } from './mobile-attendance.controller';
import { EmployeePortalService } from './employee-portal.service';
import { EmployeePortalController } from './employee-portal.controller';
import { AccountingModule } from '../accounting/accounting.module';
import { CashDrawerModule } from '../cash-drawer/cash-drawer.module';
import { EndOfServiceService } from './services/end-of-service.service';
import { EndOfServiceController } from './controllers/end-of-service.controller';
import { RecruitmentAtsController } from './controllers/recruitment-ats.controller';
import { RecruitmentAtsService } from './services/recruitment-ats.service';
import {
  BiometricAdmsWebhookController,
  BiometricAttendanceController,
  BiometricMultiBrandWebhookController,
} from './controllers/biometric-attendance.controller';
import { BiometricAttendanceService } from './services/biometric-attendance.service';
import { BiometricStagingService } from './services/biometric-staging.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuthFoundationModule, AccountingModule, CashDrawerModule],
  controllers: [
    HrController,
    MobileAttendanceController,
    EmployeePortalController,
    EndOfServiceController,
    RecruitmentAtsController,
    BiometricAttendanceController,
    BiometricAdmsWebhookController,
    BiometricMultiBrandWebhookController,
  ],
  providers: [
    HrService,
    HrTreasuryAdapter,
    MobileAttendanceService,
    EmployeePortalService,
    EndOfServiceService,
    RecruitmentAtsService,
    BiometricAttendanceService,
    BiometricStagingService,
  ],
  exports: [
    MobileAttendanceService,
    EmployeePortalService,
    EndOfServiceService,
    RecruitmentAtsService,
    BiometricAttendanceService,
    BiometricStagingService,
  ],
})
export class HrModule {}
