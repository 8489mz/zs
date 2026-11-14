import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthFoundationModule } from '../../core/auth/auth.module';
import { AccountingModule } from '../accounting/accounting.module';
import { SettingsModule } from '../settings/settings.module';
import { CashDrawerController } from './cash-drawer.controller';
import { CashDrawerService } from './cash-drawer.service';
import { CashDrawerCounterpartService } from './cash-drawer-counterpart.service';

@Module({
  imports: [DatabaseModule, AuthFoundationModule, AccountingModule, SettingsModule],
  controllers: [CashDrawerController],
  providers: [CashDrawerService, CashDrawerCounterpartService],
  exports: [CashDrawerService],
})
export class CashDrawerModule {}
