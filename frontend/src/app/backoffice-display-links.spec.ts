/* INV-BACKOFFICE-DISPLAY-LINKS: suppliers must refresh with purchases, the
 * purchase dialog must receive real received quantities, and the register
 * cards must link to the account statement / supplier payment. This guard
 * reads the real wiring files so a reverted invalidation, a dropped link,
 * or a reintroduced overflowing actions grid fails the suite. */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('INV-BACKOFFICE-DISPLAY-LINKS', () => {
  const frontendDir = path.resolve(__dirname, '../..');
  const read = (rel: string) => fs.readFileSync(path.join(frontendDir, rel), 'utf8');

  it('refreshes suppliers immediately (active) when a purchase is created', () => {
    const content = read('src/app/query-invalidation.ts');
    expect(content).toContain("queryKey: queryKeys.suppliers, refetchType: 'active'");
    expect(content).toContain("queryKey: queryKeys.supplierBalances, refetchType: 'active'");
    expect(content).not.toContain("queryKey: queryKeys.suppliers, refetchType: 'none'");
    expect(content).not.toContain("queryKey: queryKeys.supplierBalances, refetchType: 'none'");
  });

  it('links each customer row to that customer statement in Accounts', () => {
    const content = read('src/features/customers/pages/customers-page/CustomersRegisterCard.tsx');
    expect(content).toContain('/accounts?customerId=${encodeURIComponent(customer.id)}');
  });

  it('links each supplier row to a supplier payment in Accounts', () => {
    const content = read('src/features/suppliers/pages/suppliers-page/SuppliersRegisterCard.tsx');
    expect(content).toContain('/accounts?supplierId=${encodeURIComponent(supplier.id)}');
  });

  it('links the purchase invoice to a supplier payment and wraps its actions bar', () => {
    const content = read('src/features/purchases/components/PurchaseDetailCard.tsx');
    expect(content).toContain('/accounts?supplierId=${encodeURIComponent(purchase.supplierId)}');
    expect(content).toContain("gridTemplateColumns: 'repeat(3, minmax(0, 1fr))'");
    expect(content).not.toContain("repeat(auto-fit, minmax(130px, 1fr))");
  });
});
