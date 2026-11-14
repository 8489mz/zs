export { AccountsPage } from '@/features/accounts/pages/AccountsPage';
export { accountsRouteModule } from '@/features/accounts/routes';
/* INV-SUPPLIER-PAGE-BILL-STATEMENT: the supplier page reuses the
 * existing supplier payment form (pay + سحبة) and the ledger entry
 * labels through this public index — deep cross-feature imports are
 * forbidden by the feature-boundary guard. */
export { SupplierPaymentForm } from '@/features/accounts/components/PaymentForms';
export { formatLedgerEntryType } from '@/features/accounts/utils/ledger-format.utils';
