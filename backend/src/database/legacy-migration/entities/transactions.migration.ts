import { EntityCounters, MigrationContext } from '../types';
import { asNumber, asString, normalizePaymentChannel, normalizePaymentType, readAll } from '../utils';
import { syncIdSequence } from '../db';

interface OldSale {
  id: number;
  customer_name: string | null;
  payment_type: string;
  subtotal: number;
  discount: number;
  total: number;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface OldSaleItem {
  id: number;
  sale_id: number;
  product_id: number | null;
  product_name: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

interface OldPurchase {
  id: number;
  doc_no: string | null;
  supplier_id: number | null;
  payment_type: string;
  subtotal: number;
  discount: number;
  total: number;
  note: string;
  status: string;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface OldPurchaseItem {
  id: number;
  purchase_id: number;
  product_id: number | null;
  product_name: string;
  qty: number;
  unit_cost: number;
  line_total: number;
  unit_name: string;
  unit_multiplier: number;
}

interface OldCustomerPayment {
  id: number;
  customer_id: number;
  amount: number;
  note: string;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: string;
}

interface OldSupplierPayment {
  id: number;
  doc_no: string | null;
  supplier_id: number;
  amount: number;
  note: string;
  branch_id: number | null;
  location_id: number | null;
  payment_date: string;
  created_by: number | null;
  created_at: string;
}

interface OldCustomerLedger {
  id: number;
  customer_id: number;
  entry_type: string;
  amount: number;
  balance_after: number;
  note: string;
  reference_type: string | null;
  reference_id: number | null;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: string;
}

interface OldSupplierLedger {
  id: number;
  supplier_id: number;
  entry_type: string;
  amount: number;
  balance_after: number;
  note: string;
  reference_type: string | null;
  reference_id: number | null;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: string;
}

interface OldTreasuryTransaction {
  id: number;
  txn_type: string;
  amount: number;
  note: string;
  reference_type: string | null;
  reference_id: number | null;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: string;
}

export async function migrateSales(ctx: MigrationContext): Promise<EntityCounters> {
  const sales = readAll<OldSale>(ctx.oldDb, 'SELECT * FROM sales ORDER BY id');
  const saleItems = readAll<OldSaleItem>(ctx.oldDb, 'SELECT * FROM sale_items ORDER BY id');
  const counters: EntityCounters = {
    scanned: sales.length + saleItems.length,
    inserted: 0,
    skipped: 0,
    errors: 0,
  };

  for (const row of sales) {
    try {
      await ctx.newDb
        .insertInto('sales')
        .values({
          id: asNumber(row.id),
          doc_no: null,
          customer_id: null,
          customer_name: row.customer_name ? asString(row.customer_name) : null,
          payment_type: normalizePaymentType(row.payment_type),
          payment_channel: normalizePaymentChannel(row.payment_type),
          subtotal: asNumber(row.subtotal),
          discount: asNumber(row.discount),
          delivery_fee: 0,
          tax_rate: 0,
          tax_amount: 0,
          prices_include_tax: false,
          total: asNumber(row.total),
          paid_amount: asNumber(row.total),
          tendered_amount: asNumber(row.total),
          change_amount: 0,
          store_credit_used: 0,
          status: 'posted',
          note: '',
          table_number: '',
          order_type: 'takeaway',
          branch_id: row.branch_id ? asNumber(row.branch_id) : null,
          location_id: row.location_id ? asNumber(row.location_id) : null,
          created_by: row.created_by ? (ctx.idMap.users.get(asNumber(row.created_by)) ?? null) : null,
          cancelled_at: null,
          cancelled_by: null,
          cancel_reason: '',
          created_at: asString(row.created_at),
          updated_at: asString(row.updated_at),
        })
        .onConflict((oc: any) => oc.column('id').doNothing())
        .execute();

      ctx.idMap.sales.set(asNumber(row.id), asNumber(row.id));
      counters.inserted += 1;
    } catch (error) {
      counters.errors += 1;
      ctx.logger.error(`sale ${row.id} failed: ${String(error)}`);
    }
  }

  for (const row of saleItems) {
    try {
      const mappedSaleId = ctx.idMap.sales.get(asNumber(row.sale_id));
      if (!mappedSaleId) {
        counters.skipped += 1;
        continue;
      }

      const mappedProductId = row.product_id ? (ctx.idMap.products.get(asNumber(row.product_id)) ?? null) : null;
      await ctx.newDb
        .insertInto('sale_items')
        .values({
          id: asNumber(row.id),
          sale_id: mappedSaleId,
          product_id: mappedProductId,
          product_name: asString(row.product_name),
          qty: asNumber(row.qty),
          unit_price: asNumber(row.unit_price),
          line_total: asNumber(row.line_total),
          unit_name: 'قطعة',
          unit_multiplier: 1,
          cost_price: 0,
          price_type: 'retail',
          notes: '',
          modifiers: '[]',
        })
        .onConflict((oc: any) => oc.column('id').doNothing())
        .execute();

      counters.inserted += 1;
    } catch (error) {
      counters.errors += 1;
      ctx.logger.error(`sale_item ${row.id} failed: ${String(error)}`);
    }
  }

  await syncIdSequence(ctx.newDb, 'sales');
  await syncIdSequence(ctx.newDb, 'sale_items');
  return counters;
}

export async function migratePurchases(ctx: MigrationContext): Promise<EntityCounters> {
  const purchases = readAll<OldPurchase>(ctx.oldDb, 'SELECT * FROM purchases ORDER BY id');
  const purchaseItems = readAll<OldPurchaseItem>(ctx.oldDb, 'SELECT * FROM purchase_items ORDER BY id');
  const counters: EntityCounters = {
    scanned: purchases.length + purchaseItems.length,
    inserted: 0,
    skipped: 0,
    errors: 0,
  };

  for (const row of purchases) {
    try {
      await ctx.newDb
        .insertInto('purchases')
        .values({
          id: asNumber(row.id),
          doc_no: row.doc_no ? asString(row.doc_no) : null,
          supplier_id: row.supplier_id ? (ctx.idMap.suppliers.get(asNumber(row.supplier_id)) ?? null) : null,
          payment_type: normalizePaymentType(row.payment_type),
          subtotal: asNumber(row.subtotal),
          discount: asNumber(row.discount),
          tax_rate: 0,
          tax_amount: 0,
          prices_include_tax: false,
          total: asNumber(row.total),
          note: asString(row.note),
          status: asString(row.status, 'posted'),
          branch_id: row.branch_id ? asNumber(row.branch_id) : null,
          location_id: row.location_id ? asNumber(row.location_id) : null,
          created_by: row.created_by ? (ctx.idMap.users.get(asNumber(row.created_by)) ?? null) : null,
          cancelled_at: null,
          cancelled_by: null,
          cancel_reason: '',
          created_at: asString(row.created_at),
          updated_at: asString(row.updated_at),
        })
        .onConflict((oc: any) => oc.column('id').doNothing())
        .execute();

      ctx.idMap.purchases.set(asNumber(row.id), asNumber(row.id));
      counters.inserted += 1;
    } catch (error) {
      counters.errors += 1;
      ctx.logger.error(`purchase ${row.id} failed: ${String(error)}`);
    }
  }

  for (const row of purchaseItems) {
    try {
      const mappedPurchaseId = ctx.idMap.purchases.get(asNumber(row.purchase_id));
      if (!mappedPurchaseId) {
        counters.skipped += 1;
        continue;
      }
      await ctx.newDb
        .insertInto('purchase_items')
        .values({
          id: asNumber(row.id),
          purchase_id: mappedPurchaseId,
          product_id: row.product_id ? (ctx.idMap.products.get(asNumber(row.product_id)) ?? null) : null,
          product_name: asString(row.product_name),
          qty: asNumber(row.qty),
          unit_cost: asNumber(row.unit_cost),
          line_total: asNumber(row.line_total),
          unit_name: asString(row.unit_name, 'قطعة'),
          unit_multiplier: asNumber(row.unit_multiplier, 1),
        })
        .onConflict((oc: any) => oc.column('id').doNothing())
        .execute();
      counters.inserted += 1;
    } catch (error) {
      counters.errors += 1;
      ctx.logger.error(`purchase_item ${row.id} failed: ${String(error)}`);
    }
  }

  await syncIdSequence(ctx.newDb, 'purchases');
  await syncIdSequence(ctx.newDb, 'purchase_items');
  return counters;
}

export async function migratePayments(ctx: MigrationContext): Promise<EntityCounters> {
  const customerPayments = readAll<OldCustomerPayment>(ctx.oldDb, 'SELECT * FROM customer_payments ORDER BY id');
  const supplierPayments = readAll<OldSupplierPayment>(ctx.oldDb, 'SELECT * FROM supplier_payments ORDER BY id');
  const counters: EntityCounters = {
    scanned: customerPayments.length + supplierPayments.length,
    inserted: 0,
    skipped: 0,
    errors: 0,
  };

  for (const row of customerPayments) {
    try {
      const mappedCustomerId = ctx.idMap.customers.get(asNumber(row.customer_id));
      if (!mappedCustomerId) {
        counters.skipped += 1;
        continue;
      }

      await ctx.newDb
        .insertInto('customer_payments')
        .values({
          id: asNumber(row.id),
          customer_id: mappedCustomerId,
          amount: asNumber(row.amount),
          note: asString(row.note),
          branch_id: row.branch_id ? asNumber(row.branch_id) : null,
          location_id: row.location_id ? asNumber(row.location_id) : null,
          created_by: row.created_by ? (ctx.idMap.users.get(asNumber(row.created_by)) ?? null) : null,
          created_at: asString(row.created_at),
        })
        .onConflict((oc: any) => oc.column('id').doNothing())
        .execute();

      ctx.idMap.customerPayments.set(asNumber(row.id), asNumber(row.id));
      counters.inserted += 1;
    } catch (error) {
      counters.errors += 1;
      ctx.logger.error(`customer_payment ${row.id} failed: ${String(error)}`);
    }
  }

  for (const row of supplierPayments) {
    try {
      const mappedSupplierId = ctx.idMap.suppliers.get(asNumber(row.supplier_id));
      if (!mappedSupplierId) {
        counters.skipped += 1;
        continue;
      }

      await ctx.newDb
        .insertInto('supplier_payments')
        .values({
          id: asNumber(row.id),
          doc_no: row.doc_no ? asString(row.doc_no) : null,
          supplier_id: mappedSupplierId,
          amount: asNumber(row.amount),
          note: asString(row.note),
          branch_id: row.branch_id ? asNumber(row.branch_id) : null,
          location_id: row.location_id ? asNumber(row.location_id) : null,
          payment_date: asString(row.payment_date),
          created_by: row.created_by ? (ctx.idMap.users.get(asNumber(row.created_by)) ?? null) : null,
          created_at: asString(row.created_at),
        })
        .onConflict((oc: any) => oc.column('id').doNothing())
        .execute();

      ctx.idMap.supplierPayments.set(asNumber(row.id), asNumber(row.id));
      counters.inserted += 1;
    } catch (error) {
      counters.errors += 1;
      ctx.logger.error(`supplier_payment ${row.id} failed: ${String(error)}`);
    }
  }

  await syncIdSequence(ctx.newDb, 'customer_payments');
  await syncIdSequence(ctx.newDb, 'supplier_payments');
  return counters;
}

export async function migrateLedgers(ctx: MigrationContext): Promise<EntityCounters> {
  const customerLedger = readAll<OldCustomerLedger>(ctx.oldDb, 'SELECT * FROM customer_ledger ORDER BY id');
  const supplierLedger = readAll<OldSupplierLedger>(ctx.oldDb, 'SELECT * FROM supplier_ledger ORDER BY id');
  const counters: EntityCounters = {
    scanned: customerLedger.length + supplierLedger.length,
    inserted: 0,
    skipped: 0,
    errors: 0,
  };

  for (const row of customerLedger) {
    try {
      const mappedCustomerId = ctx.idMap.customers.get(asNumber(row.customer_id));
      if (!mappedCustomerId) {
        counters.skipped += 1;
        continue;
      }
      await ctx.newDb
        .insertInto('customer_ledger')
        .values({
          id: asNumber(row.id),
          customer_id: mappedCustomerId,
          entry_type: asString(row.entry_type),
          amount: asNumber(row.amount),
          balance_after: asNumber(row.balance_after),
          note: asString(row.note),
          reference_type: row.reference_type ? asString(row.reference_type) : null,
          reference_id: row.reference_id ? asNumber(row.reference_id) : null,
          branch_id: row.branch_id ? asNumber(row.branch_id) : null,
          location_id: row.location_id ? asNumber(row.location_id) : null,
          created_by: row.created_by ? (ctx.idMap.users.get(asNumber(row.created_by)) ?? null) : null,
          created_at: asString(row.created_at),
        })
        .onConflict((oc: any) => oc.column('id').doNothing())
        .execute();

      ctx.idMap.customerLedger.set(asNumber(row.id), asNumber(row.id));
      counters.inserted += 1;
    } catch (error) {
      counters.errors += 1;
      ctx.logger.error(`customer_ledger ${row.id} failed: ${String(error)}`);
    }
  }

  for (const row of supplierLedger) {
    try {
      const mappedSupplierId = ctx.idMap.suppliers.get(asNumber(row.supplier_id));
      if (!mappedSupplierId) {
        counters.skipped += 1;
        continue;
      }
      await ctx.newDb
        .insertInto('supplier_ledger')
        .values({
          id: asNumber(row.id),
          supplier_id: mappedSupplierId,
          entry_type: asString(row.entry_type),
          amount: asNumber(row.amount),
          balance_after: asNumber(row.balance_after),
          note: asString(row.note),
          reference_type: row.reference_type ? asString(row.reference_type) : null,
          reference_id: row.reference_id ? asNumber(row.reference_id) : null,
          branch_id: row.branch_id ? asNumber(row.branch_id) : null,
          location_id: row.location_id ? asNumber(row.location_id) : null,
          created_by: row.created_by ? (ctx.idMap.users.get(asNumber(row.created_by)) ?? null) : null,
          created_at: asString(row.created_at),
        })
        .onConflict((oc: any) => oc.column('id').doNothing())
        .execute();

      ctx.idMap.supplierLedger.set(asNumber(row.id), asNumber(row.id));
      counters.inserted += 1;
    } catch (error) {
      counters.errors += 1;
      ctx.logger.error(`supplier_ledger ${row.id} failed: ${String(error)}`);
    }
  }

  await syncIdSequence(ctx.newDb, 'customer_ledger');
  await syncIdSequence(ctx.newDb, 'supplier_ledger');
  return counters;
}

export async function migrateTreasury(ctx: MigrationContext): Promise<EntityCounters> {
  const rows = readAll<OldTreasuryTransaction>(ctx.oldDb, 'SELECT * FROM treasury_transactions ORDER BY id');
  const counters: EntityCounters = { scanned: rows.length, inserted: 0, skipped: 0, errors: 0 };

  for (const row of rows) {
    try {
      await ctx.newDb
        .insertInto('treasury_transactions')
        .values({
          id: asNumber(row.id),
          txn_type: asString(row.txn_type),
          amount: asNumber(row.amount),
          note: asString(row.note),
          reference_type: row.reference_type ? asString(row.reference_type) : null,
          reference_id: row.reference_id ? asNumber(row.reference_id) : null,
          branch_id: row.branch_id ? asNumber(row.branch_id) : null,
          location_id: row.location_id ? asNumber(row.location_id) : null,
          created_by: row.created_by ? (ctx.idMap.users.get(asNumber(row.created_by)) ?? null) : null,
          created_at: asString(row.created_at),
        })
        .onConflict((oc: any) => oc.column('id').doNothing())
        .execute();

      counters.inserted += 1;
    } catch (error) {
      counters.errors += 1;
      ctx.logger.error(`treasury_transaction ${row.id} failed: ${String(error)}`);
    }
  }

  await syncIdSequence(ctx.newDb, 'treasury_transactions');
  return counters;
}
