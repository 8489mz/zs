import { Module } from '@nestjs/common';
import {
  ContractingCoreController,
  ContractingFieldController,
  ContractingFinanceController,
  ContractingPlanningController,
  ContractingExecutionController,
  ContractingAssuranceController,
  ContractingAdminController,
} from './contracting.controller';
import { ContractingService } from './contracting.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AccountingModule],
  controllers: [
    ContractingCoreController,
    ContractingFieldController,
    ContractingFinanceController,
    ContractingPlanningController,
    ContractingExecutionController,
    ContractingAssuranceController,
    ContractingAdminController,
  ],
  providers: [ContractingService],
  exports: [ContractingService],
})
export class ContractingModule {}
