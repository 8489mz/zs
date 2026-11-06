/*
 * INV-TRANSFER-WAREHOUSE-DESTINATION: the new issue-order form accepted
 * only a branch as destination, so a warehouse such as T10K-WH2 could
 * never receive a transfer. These specs drive the REAL destination
 * helpers the issue-order controller calls in handleSubmit.
 */
import { describe, expect, it } from 'vitest';
import {
  buildIssueOrderPayloadIdentity,
  buildTransferDestinationOptions,
  resolveTransferDestination,
  type TransferDestinationLocation,
} from '@/features/inventory/components/issue-order/issue-order-destination.helpers';

const warehouseA: TransferDestinationLocation = { id: 11, name: 'T10K-WH2', branchId: 2, locationType: 'internal_warehouse' };
const warehouseB: TransferDestinationLocation = { id: 12, name: 'مخزن خارجي', branchId: 3, locationType: 'external_warehouse' };
const branchStock: TransferDestinationLocation = { id: 21, name: 'رصيد فرع المعادي', branchId: 5, locationType: 'branch_stock' };
const inTransit: TransferDestinationLocation = { id: 99, name: 'بضاعة بالطريق', branchId: null, locationType: 'in_transit' };
const locations = [warehouseA, warehouseB, branchStock, inTransit];
const branches = [{ id: 5, name: 'فرع المعادي' }, { id: 6, name: 'فرع مدينة نصر' }];

describe('resolveTransferDestination (INV-TRANSFER-WAREHOUSE-DESTINATION)', () => {
  it('a warehouse destination resolves to toLocationId with no toBranchId, in transfer mode', () => {
    expect(resolveTransferDestination({
      kind: 'warehouse', destinationId: '11', locations, issueMode: 'transfer_to_branch_stock',
    })).toEqual({ ok: true, toLocationId: 11 });
  });

  it('a warehouse destination resolves to toLocationId in final-issue mode too', () => {
    expect(resolveTransferDestination({
      kind: 'warehouse', destinationId: '12', locations, issueMode: 'final_issue',
    })).toEqual({ ok: true, toLocationId: 12 });
  });

  it('a warehouse destination needs no branch_stock location for its branch', () => {
    // T10K-WH2 belongs to branch 2, which has no branch_stock location in
    // the list at all; the old branch-only path would have rejected it.
    expect(resolveTransferDestination({
      kind: 'warehouse', destinationId: '11', locations, issueMode: 'transfer_to_branch_stock',
    }).ok).toBe(true);
  });

  it('a branch_stock location id chosen as a warehouse destination resolves to toLocationId', () => {
    expect(resolveTransferDestination({
      kind: 'warehouse', destinationId: '21', locations, issueMode: 'transfer_to_branch_stock',
    })).toEqual({ ok: true, toLocationId: 21 });
  });

  it('a branch destination resolves to toBranchId with no toLocationId, exactly as before', () => {
    expect(resolveTransferDestination({
      kind: 'branch', destinationId: '5', locations, issueMode: 'transfer_to_branch_stock',
    })).toEqual({ ok: true, toBranchId: 5 });
    expect(resolveTransferDestination({
      kind: 'branch', destinationId: '6', locations, issueMode: 'final_issue',
    })).toEqual({ ok: true, toBranchId: 6 });
  });

  it('a branch in transfer mode without a branch_stock location still fails with the named error', () => {
    expect(resolveTransferDestination({
      kind: 'branch', destinationId: '6', locations, issueMode: 'transfer_to_branch_stock',
    })).toEqual({
      ok: false,
      error: 'لا يوجد رصيد مخزون مرتبط بهذا الفرع. أنشئ رصيد فرع أولًا من أماكن المخزون.',
    });
  });

  it('a branch in final-issue mode needs no branch_stock location, as before', () => {
    expect(resolveTransferDestination({
      kind: 'branch', destinationId: '6', locations, issueMode: 'final_issue',
    }).ok).toBe(true);
  });

  it('an empty or invalid warehouse id fails with a named error', () => {
    expect(resolveTransferDestination({
      kind: 'warehouse', destinationId: '', locations, issueMode: 'final_issue',
    })).toEqual({ ok: false, error: 'يرجى تحديد مخزن الوجهة بشكل صحيح' });
    expect(resolveTransferDestination({
      kind: 'warehouse', destinationId: 'abc', locations, issueMode: 'final_issue',
    }).ok).toBe(false);
  });

  it('an unknown warehouse id fails with a named error, never a generic failure', () => {
    expect(resolveTransferDestination({
      kind: 'warehouse', destinationId: '404', locations, issueMode: 'final_issue',
    })).toEqual({ ok: false, error: 'مخزن الوجهة المحدد غير موجود؛ أعد اختيار الوجهة' });
  });

  it('the in-transit location can never be a destination', () => {
    expect(resolveTransferDestination({
      kind: 'warehouse', destinationId: '99', locations, issueMode: 'final_issue',
    })).toEqual({ ok: false, error: 'لا يمكن اختيار موقع البضاعة بالطريق كوجهة للتحويل' });
  });

  it('an invalid branch id fails with the exact pre-existing message', () => {
    expect(resolveTransferDestination({
      kind: 'branch', destinationId: '', locations, issueMode: 'final_issue',
    })).toEqual({ ok: false, error: 'يرجى تحديد فرع المستلم بشكل صحيح' });
  });
});

describe('buildTransferDestinationOptions (INV-TRANSFER-WAREHOUSE-DESTINATION)', () => {
  it('lists every branch as a branch option with its plain name', () => {
    const options = buildTransferDestinationOptions(branches, locations);
    expect(options.filter((o) => o.kind === 'branch')).toEqual([
      { id: '5', name: 'فرع المعادي', searchTerms: 'فرع المعادي', kind: 'branch' },
      { id: '6', name: 'فرع مدينة نصر', searchTerms: 'فرع مدينة نصر', kind: 'branch' },
    ]);
  });

  it('lists warehouses as warehouse options, marked as warehouses', () => {
    const options = buildTransferDestinationOptions(branches, locations);
    const warehouses = options.filter((o) => o.kind === 'warehouse');
    expect(warehouses.map((o) => o.id)).toEqual(['11', '12', '21']);
    expect(warehouses[0].name).toContain('T10K-WH2');
    expect(warehouses[0].name).toContain('(مخزن)');
    expect(warehouses[0].searchTerms).toContain('مخزن');
  });

  it('never offers the in-transit location as a destination', () => {
    const options = buildTransferDestinationOptions(branches, locations);
    expect(options.some((o) => o.id === '99')).toBe(false);
  });
});

describe('buildIssueOrderPayloadIdentity (INV-TRANSFER-WAREHOUSE-DESTINATION)', () => {
  const base = {
    fromLocationId: '10',
    toLocationId: '5',
    recipientName: '',
    note: '',
    issueMode: 'transfer_to_branch_stock' as const,
    lines: [{ productId: '1', qty: 2, locId: '10' }],
  };
  it('treats the same numeric id as a different payload when the destination kind differs', () => {
    const asBranch = buildIssueOrderPayloadIdentity({ ...base, toDestinationKind: 'branch' });
    const asWarehouse = buildIssueOrderPayloadIdentity({ ...base, toDestinationKind: 'warehouse' });
    expect(asBranch).not.toBe(asWarehouse);
  });
  it('is stable for identical inputs', () => {
    expect(buildIssueOrderPayloadIdentity({ ...base, toDestinationKind: 'branch' }))
      .toBe(buildIssueOrderPayloadIdentity({ ...base, toDestinationKind: 'branch' }));
  });
});
