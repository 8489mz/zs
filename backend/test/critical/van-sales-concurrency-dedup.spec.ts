import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';

describe('Van Sales Concurrency, Deduplication & Idempotency Shield', () => {
  it('should dedup concurrent sales via in-flight promise sharing and cache', async () => {
    let internalExecutionCount = 0;

    // Create a mock service instance
    const createQueryMock = () => {
      const q: any = {};
      q.select = () => q;
      q.where = () => q;
      q.orderBy = () => q;
      q.executeTakeFirst = async () => null;
      // tenantBaseCurrency reads currency_exchange_rates via .execute().
      q.execute = async () => [];
      return q;
    };
    const mockDb: any = {
      selectFrom: () => createQueryMock(),
    };

    const service = new VanSalesService(
      mockDb,
      {} as any,
      {} as any,
      {} as any,
    );

    // Mock executeFieldSaleInternal to simulate a 50ms async DB operation
    (service as any).executeFieldSaleInternal = async (
      repId: number,
      tenantId: string,
      accountId: string,
      payload: any,
    ) => {
      internalExecutionCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        saleId: 276,
        docNo: 'VAN-261015-0002',
        total: 590,
        subtotal: 590,
        discount: 0,
        paymentMethod: 'cash',
        customerName: 'كاظيون ماركتنو',
        itemsCount: 1,
        cashPaid: 590,
        creditOwed: 0,
      };
    };

    const payload = {
      tripId: 15,
      clientTxId: 'tx_van_test_123',
      customerId: 74,
      customerName: 'كاظيون ماركتنو',
      paymentMethod: 'cash' as const,
      paidAmount: 590,
      items: [{ productId: 114, qty: 1, unitPrice: 590 }],
    };

    // 1. Fire two concurrent calls (simulating 14ms rapid double tap)
    const [res1, res2] = await Promise.all([
      service.executeFieldSale(10, 'default', 'acc_1', payload),
      service.executeFieldSale(10, 'default', 'acc_1', payload),
    ]);

    // Both should succeed with the exact same invoice number
    assert.equal(res1.docNo, 'VAN-261015-0002');
    assert.equal(res2.docNo, 'VAN-261015-0002');
    assert.equal(res1.saleId, 276);
    assert.equal(res2.saleId, 276);

    // CRITICAL INVARIANT: The internal DB sale was executed EXACTLY ONCE!
    assert.equal(internalExecutionCount, 1, 'Sale must be executed exactly once despite concurrent calls');

    // 2. Fire a 3rd call 100ms later (within the 5-second rapid duplicate cache window)
    const res3 = await service.executeFieldSale(10, 'default', 'acc_1', payload);
    assert.equal(res3.docNo, 'VAN-261015-0002');
    assert.equal(res3.saleId, 276);
    assert.equal(internalExecutionCount, 1, 'Recent cache must prevent duplicate execution within 5 seconds');
  });

  it('should dedup concurrent collections via in-flight promise sharing and cache', async () => {
    let collectionExecutionCount = 0;

    const createQueryMock = () => {
      const q: any = {};
      q.select = () => q;
      q.where = () => q;
      q.orderBy = () => q;
      q.executeTakeFirst = async () => null;
      // tenantBaseCurrency reads currency_exchange_rates via .execute().
      q.execute = async () => [];
      return q;
    };
    const mockDb: any = {
      selectFrom: () => createQueryMock(),
    };

    const service = new VanSalesService(
      mockDb,
      {} as any,
      {} as any,
      {} as any,
    );

    (service as any).recordFieldCollectionInternal = async (
      repId: number,
      tenantId: string,
      accountId: string,
      payload: any,
    ) => {
      collectionExecutionCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        receiptNo: 'COL-261015-0001',
        amount: payload.amount,
        customerName: 'كاظيون ماركتنو',
        previousBalance: 1500,
        newBalance: 1000,
      };
    };

    const colPayload = {
      tripId: 15,
      clientTxId: 'tx_col_test_456',
      customerId: 74,
      amount: 500,
    };

    // Fire two concurrent collections
    const [cRes1, cRes2] = await Promise.all([
      service.recordFieldCollection(10, 'default', 'acc_1', colPayload),
      service.recordFieldCollection(10, 'default', 'acc_1', colPayload),
    ]);

    assert.equal(cRes1.receiptNo, 'COL-261015-0001');
    assert.equal(cRes2.receiptNo, 'COL-261015-0001');
    assert.equal(collectionExecutionCount, 1, 'Collection must be recorded exactly once despite concurrent calls');

    // Sequential retry within cache window
    const cRes3 = await service.recordFieldCollection(10, 'default', 'acc_1', colPayload);
    assert.equal(cRes3.receiptNo, 'COL-261015-0001');
    assert.equal(collectionExecutionCount, 1, 'Cached receipt must be returned without re-executing collection');
  });

  it('should dedup concurrent sales by fingerprint even if clientTxId is missing or distinct', async () => {
    let fingerprintExecutionCount = 0;

    const createQueryMock = () => {
      const q: any = {};
      q.select = () => q;
      q.where = () => q;
      q.orderBy = () => q;
      q.executeTakeFirst = async () => null;
      // tenantBaseCurrency reads currency_exchange_rates via .execute().
      q.execute = async () => [];
      return q;
    };
    const mockDb: any = {
      selectFrom: () => createQueryMock(),
    };

    const service = new VanSalesService(
      mockDb,
      {} as any,
      {} as any,
      {} as any,
    );

    (service as any).executeFieldSaleInternal = async () => {
      fingerprintExecutionCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        saleId: 280,
        docNo: 'VAN-261015-0005',
        total: 1200,
        subtotal: 1200,
        discount: 0,
        paymentMethod: 'cash',
        customerName: 'محل البركة',
        itemsCount: 2,
        cashPaid: 1200,
        creditOwed: 0,
      };
    };

    // Two simultaneous requests with identical items, rep, and customer but different or missing clientTxId
    const reqA = {
      tripId: 20,
      clientTxId: 'tx_a_' + Math.random(),
      customerId: 88,
      customerName: 'محل البركة',
      paymentMethod: 'cash' as const,
      paidAmount: 1200,
      items: [
        { productId: 50, qty: 2, unitPrice: 300 },
        { productId: 51, qty: 1, unitPrice: 600 },
      ],
    };

    const reqB = {
      tripId: 20,
      clientTxId: 'tx_b_' + Math.random(),
      customerId: 88,
      customerName: 'محل البركة',
      paymentMethod: 'cash' as const,
      paidAmount: 1200,
      items: [
        { productId: 51, qty: 1, unitPrice: 600 },
        { productId: 50, qty: 2, unitPrice: 300 },
      ], // reversed order in array, should be canonicalized by fingerprint
    };

    const [resA, resB] = await Promise.all([
      service.executeFieldSale(12, 'default', 'acc_1', reqA),
      service.executeFieldSale(12, 'default', 'acc_1', reqB),
    ]);

    assert.equal(resA.docNo, 'VAN-261015-0005');
    assert.equal(resB.docNo, 'VAN-261015-0005');
    assert.equal(fingerprintExecutionCount, 1, 'Fingerprint deduplication must block duplicate sale execution');
  });
});
