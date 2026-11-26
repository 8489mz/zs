import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../../core/audit/audit.module';
import { AuthFoundationModule } from '../../core/auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { AccountingModule } from '../accounting/accounting.module';
import { SettingsModule } from '../settings/settings.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { ExchangeReturnPort } from '../../common/utils/exchange-return.port';

// Phase 1 B7 — @Global() so SalesModule resolves the exchange-return
// port without importing ReturnsModule (the sales->returns edge is
// gone; the dependency is one-way now). No existing module gains a
// new import; ReturnsService is still constructed exactly once here.
@Global()
@Module({
  imports: [DatabaseModule, AuditModule, AuthFoundationModule, AccountingModule, SettingsModule],
  controllers: [ReturnsController],
  providers: [ReturnsService, { provide: ExchangeReturnPort, useExisting: ReturnsService }],
  exports: [ReturnsService, ExchangeReturnPort],
})
export class ReturnsModule {}
