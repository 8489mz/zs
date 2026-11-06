import { InstallmentInterestSchedulerService } from './services/installment-interest-scheduler.service';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthFoundationModule } from '../../core/auth/auth.module';
import { AccountingController } from './accounting.controller';
import { AccountingPostingService } from './accounting-posting.service';
import { AccountingService } from './accounting.service';
import { AccountingTenantFoundationService } from './accounting-tenant-foundation.service';
import { BalanceSheetService } from './services/balance-sheet.service';
import { TrialBalanceService } from './services/trial-balance.service';
import { CashFlowService } from './services/cash-flow.service';
import { AgedDebtsService } from './services/aged-debts.service';
import { PdcChequesService } from './services/pdc-cheques.service';
import { WithholdingTaxService } from './services/withholding-tax.service';
import { PaymentAllocationService } from './services/payment-allocation.service';
import { FiscalYearService } from './services/fiscal-year.service';
import { FixedAssetsSchedulerService } from './services/fixed-assets-scheduler.service';
import { AccountingRecoveryService } from './services/accounting-recovery.service';
import { CostCenterAllocationsService } from './services/cost-center-allocations.service';
import { ForexRevaluationService } from './services/forex-revaluation.service';
import { SaleEditRemediationService } from './services/sale-edit-remediation.service';
import { ArCollectionsController } from './ar-collections.controller';
import { ArCollectionsService } from './services/ar-collections.service';

@Module({
  imports: [DatabaseModule, AuthFoundationModule],
  controllers: [AccountingController, ArCollectionsController],
  providers: [
    InstallmentInterestSchedulerService,
    AccountingService,
    AccountingPostingService,
    AccountingTenantFoundationService,
    BalanceSheetService,
    TrialBalanceService,
    CashFlowService,
    AgedDebtsService,
    PdcChequesService,
    WithholdingTaxService,
    PaymentAllocationService,
    FiscalYearService,
    FixedAssetsSchedulerService,
    AccountingRecoveryService,
    CostCenterAllocationsService,
    ForexRevaluationService,
    SaleEditRemediationService,
    ArCollectionsService,
  ],
  exports: [
    AccountingService,
    AccountingPostingService,
    AccountingTenantFoundationService,
    BalanceSheetService,
    TrialBalanceService,
    CashFlowService,
    AgedDebtsService,
    PdcChequesService,
    WithholdingTaxService,
    PaymentAllocationService,
    FiscalYearService,
    FixedAssetsSchedulerService,
    AccountingRecoveryService,
    CostCenterAllocationsService,
    ForexRevaluationService,
    SaleEditRemediationService,
    ArCollectionsService,
  ],
})
export class AccountingModule {}

