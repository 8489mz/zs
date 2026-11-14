export { accountingRouteModule } from '@/features/accounting/routes';
export { isCashBankAccount } from '@/features/accounting/api/accounting.api';
/* INV-SUPPLIER-PAGE-BILL-STATEMENT: the supplier bill form picks its
 * line accounts from the chart through this public index — deep
 * cross-feature imports are forbidden by the feature-boundary guard. */
export { accountingApi } from '@/features/accounting/api/accounting.api';

