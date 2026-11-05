/* INV-BACKOFFICE-DISPLAY-LINKS: the purchase list serializer must carry the
 * received quantities and lifecycle/match status the detail dialog renders.
 * A GRN that received 4 of 10 must show received 4 / remaining 6, never 0/10. */
import { strict as assert } from 'node:assert';
import { mapPurchaseRows } from '../../src/modules/purchases/helpers/purchases-query.helper';

const purchase = {
  id: 7,
  doc_no: 'ZP-260101-0001',
  supplier_id: 3,
  supplier_name: 'مورد اختبار',
  payment_type: 'credit',
  subtotal: 1000,
  discount: 0,
  tax_rate: 0,
  tax_amount: 0,
  prices_include_tax: false,
  total: 1000,
  note: '',
  status: 'posted',
  lifecycle_status: 'grn_received',
  matched_status: 'pending',
  created_by_name: 'مستخدم',
  created_at: '2026-01-01',
  branch_id: 1,
  location_id: 1,
  branch_name: 'فرع',
  location_name: 'مخزن',
  required_date: null,
  currency: 'EGP',
  company_name: '',
  contact_id: null,
  shipping_address_id: null,
  cost_center_id: null,
  project_id: null,
  import_project_id: null,
  terms_template: '',
};

const items = [
  { id: 11, purchase_id: 7, product_id: 5, product_name: 'صنف أ', qty: 10, received_qty: 4, unit_cost: 100, line_total: 1000, unit_name: 'قطعة', unit_multiplier: 1 },
  { id: 12, purchase_id: 7, product_id: 6, product_name: 'صنف ب', qty: 3, received_qty: 3, unit_cost: 50, line_total: 150, unit_name: 'قطعة', unit_multiplier: 1 },
];

const [row] = mapPurchaseRows([purchase], items);
assert.equal(row.lifecycleStatus, 'grn_received');
assert.equal(row.matchedStatus, 'pending');
assert.equal((row.items as Array<Record<string, unknown>>)[0].receivedQty, 4);
assert.equal((row.items as Array<Record<string, unknown>>)[1].receivedQty, 3);

// A row without received_qty (legacy rows) maps to 0, never undefined.
const [legacyRow] = mapPurchaseRows(
  [{ ...purchase, id: 8 }],
  [{ id: 13, purchase_id: 8, product_id: 5, product_name: 'صنف', qty: 2, unit_cost: 10, line_total: 20, unit_name: 'قطعة', unit_multiplier: 1 }],
);
assert.equal((legacyRow.items as Array<Record<string, unknown>>)[0].receivedQty, 0);

console.log('purchases-query.helper.spec: all cases passed');
