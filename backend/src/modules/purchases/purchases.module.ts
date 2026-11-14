import { Module } from '@nestjs/common';
import { AuditModule } from '../../core/audit/audit.module';
import { AuthFoundationModule } from '../../core/auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { AccountingModule } from '../accounting/accounting.module';
import { SettingsModule } from '../settings/settings.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { PurchasesFinanceService } from './services/purchases-finance.service';
import { PurchasesQueryService } from './services/purchases-query.service';
import { PurchasesWriteService } from './services/purchases-write.service';
import { SupplierBillsService } from './services/supplier-bills.service';
import { SupplierPaymentSchedulesService } from './services/supplier-payment-schedules.service';
import { PurchasesReorderService } from './services/purchases-reorder.service';
import { MarginProtectionService } from './services/margin-protection.service';
import { PurchaseLandedCostsService } from './services/purchase-landed-costs.service';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import { PurchaseOrdersController } from './controllers/purchase-orders.controller';
import { PurchaseRfqsService } from './services/purchase-rfqs.service';
import { PurchaseRfqsController } from './controllers/purchase-rfqs.controller';
import { GoodsReceiptService } from './services/goods-receipt.service';
import { GoodsReceiptController } from './controllers/goods-receipt.controller';

@Module({
  imports: [DatabaseModule, AuditModule, AuthFoundationModule, AccountingModule, SettingsModule, ApprovalsModule],
  controllers: [PurchaseOrdersController, PurchaseRfqsController, GoodsReceiptController, PurchasesController],
  providers: [
    PurchasesService,
    PurchasesFinanceService,
    PurchasesQueryService,
    PurchasesWriteService,
    SupplierBillsService,
    SupplierPaymentSchedulesService,
    PurchasesReorderService,
    MarginProtectionService,
    PurchaseLandedCostsService,
    PurchaseOrdersService,
    PurchaseRfqsService,
    GoodsReceiptService,
  ],
  exports: [
    PurchasesService,
    SupplierBillsService,
    PurchasesReorderService,
    MarginProtectionService,
    PurchaseLandedCostsService,
    PurchaseOrdersService,
    PurchaseRfqsService,
    GoodsReceiptService,
  ],
})
export class PurchasesModule {}
