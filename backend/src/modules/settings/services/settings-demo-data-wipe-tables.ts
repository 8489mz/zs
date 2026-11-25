import { sql } from '../../../database/kysely';

/*
 * Factory-reset delete list (INV-TENANT-WIPE-FK-CLOSURE).
 *
 * Extracted from SettingsDemoDataService so the service file stays under
 * its file-size baseline: the list is long because every operational
 * table that holds a foreign key WITHOUT a delete rule (NO ACTION) or
 * with RESTRICT to a wiped parent must be deleted here, in
 * child-before-parent order, or a single row in any of them aborts the
 * whole wipe transaction with a Postgres FK violation (23503) and the
 * API answers a generic 500. The function is pure: it only runs deletes
 * on the caller's transaction handle, so it is safe to call from
 * wipeTenantData and wipeAllData.
 */
export async function executeWipeTables(trx: any, tenantId: string, preservedUserId: any): Promise<void> {
  // 0. Child rows that block the earliest deletes (INV-TENANT-WIPE-FK-CLOSURE):
  // instalment interest blocks plans/installments/journals, supplier links
  // block suppliers, marketplace settlements block journals, partner payouts
  // block treasury transactions / partners / projects, preorder refunds block
  // preorders, container preorders block customers/products, proformas block
  // suppliers, field returns block sales/customers/reps. Every one of them
  // holds a foreign key WITHOUT a delete rule (NO ACTION) or with RESTRICT
  // to a wiped parent, so a single row in any of them used to abort the
  // whole wipe with a 500. Refund events go before preorders (RESTRICT).
  await (trx as any)
    .deleteFrom('accounting_installment_interest')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('accounting_supplier_links')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('accounting_marketplace_settlements')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_partner_project_payouts')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_preorder_refund_events')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_container_preorders')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_proforma_invoices')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('settlement_allocations')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('van_field_returns')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);

  // 1. Operational tables
  await (trx as any)
    .deleteFrom('customer_installments')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('customer_installment_plans')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('quotation_items')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('quotations')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);

  await trx
    .deleteFrom('sale_items')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('sale_payments')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('held_sale_items')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('held_sales')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('sales')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();

  await trx
    .deleteFrom('purchase_items')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('purchase_attachments')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('purchases')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();

  await trx
    .deleteFrom('return_items')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('return_documents')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();

  await trx
    .deleteFrom('cashier_shifts')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('treasury_transactions')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('expenses')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();

  await trx
    .deleteFrom('customer_payments')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('customer_ledger')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('customers')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();

  // Van rows that block trips / reps / products (INV-TENANT-WIPE-FK-CLOSURE):
  // load requisitions block trips + reps, stock transfers block reps,
  // transfer items + damaged swaps block products. The CASCADE / SET NULL
  // children (visits, targets, fleet, settlements, trip costs) are wiped
  // here too so the store is white instead of keeping stale van rows.
  // Transfer items go before transfers, drivers/oil/fuel before vehicles.
  await (trx as any)
    .deleteFrom('van_load_requisitions')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('van_stock_transfer_items')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('van_stock_transfers')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('van_damaged_swaps')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('van_field_visits')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('delivery_rep_targets')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('fleet_vehicle_drivers')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('fleet_oil_changes')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('fleet_fuel_logs')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('fleet_vehicles')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('van_rep_financial_settlements')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('van_trip_expenses')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('van_trip_packaging_movements')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('van_store_visits')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('van_trade_marketing_surveys')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('van_rep_live_breadcrumbs')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);

  await (trx as any)
    .deleteFrom('van_sales_trips')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('delivery_representatives')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();

  await trx
    .deleteFrom('stock_transfer_items')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('stock_transfers')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('stock_count_items')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('stock_count_sessions')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('damaged_stock_records')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('stock_movements')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('product_location_stock')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();

  // Manufacturing & Work Orders (must be deleted before products/stock)
  await trx
    .deleteFrom('manufacturing_wo_consumptions')
    .where(
      'work_order_id',
      'in',
      trx
        .selectFrom('manufacturing_work_orders')
        .select('id')
        .where(sql<boolean>`tenant_id = ${tenantId}`),
    )
    .execute();
  await trx
    .deleteFrom('manufacturing_work_orders')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();

  await trx
    .deleteFrom('manufacturing_bom_lines')
    .where(
      'bom_id',
      'in',
      trx
        .selectFrom('manufacturing_boms')
        .select('id')
        .where(sql<boolean>`tenant_id = ${tenantId}`),
    )
    .execute();
  await trx
    .deleteFrom('manufacturing_boms')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();

  // Import rows that block shipments / lots / partners / products
  // (INV-TENANT-WIPE-FK-CLOSURE): allocations block lots + products,
  // lots block products, receipts + late-expense events block shipments,
  // refund events block deposits. Receipts go after stock_movements
  // (deleted in section 1), which reference them with RESTRICT.
  // Project partners go before projects, refund events before deposits,
  // allocations before lots.
  await (trx as any)
    .deleteFrom('import_sale_allocations')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_inventory_lots')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_inventory_receipts')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_inventory_receipt_reversals')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_late_expense_events')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_container_refund_events')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_container_deposits')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_broker_advances')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_broker_expenses')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_broker_capitalizations')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_documents')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_qc_inspections')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_reconciliation_exceptions')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_aci_compliance')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_quotations')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_sample_orders')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_suppliers_meta')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_project_partners')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_sourcing_trips')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_projects')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_customs_brokers')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_customs_tariffs')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_fx_acquisitions')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_partner_ledger')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_approval_requests')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);

  // Import & Export Shipments (must be deleted before products/suppliers)
  await (trx as any)
    .deleteFrom('import_sale_partner_shares')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_sales_and_profit')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_shipment_items')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('import_shipments')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);

  // Suppliers must go AFTER import_shipments: import_shipments.supplier_id
  // references suppliers.id ON DELETE RESTRICT (migration 2036), so deleting
  // suppliers first fails with 23503 and the API answers 409 naming import_shipments.
  await trx
    .deleteFrom('supplier_payment_schedule_logs')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('supplier_payment_schedules')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('supplier_payments')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('supplier_ledger')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('suppliers')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await (trx as any)
    .deleteFrom('import_partners')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);

  // Maintenance & Trade-in & Online Orders & Pharmacy
  await trx
    .deleteFrom('maintenance_ticket_parts')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('maintenance_tickets')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('trade_in_transactions')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('online_orders')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);

  await trx
    .deleteFrom('pharmacy_clinical_services')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('pharmacy_shortages')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('pharmacy_prescriptions')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('pharmacy_batches')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('pharmacy_drugs')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);

  // Price change runs & allocations
  await trx
    .deleteFrom('sale_line_stock_allocations')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('price_change_items')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('price_change_runs')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);

  await trx
    .deleteFrom('product_offers')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('product_units')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('product_customer_prices')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('product_pricing_profiles')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('pricing_rules')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('products')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('product_categories')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();

  // 2. HR tables (ordered strictly from child leaf to parent root)
  await (trx as any)
    .deleteFrom('hr_payroll_loan_deduction_allocations')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_payroll_item_adjustments')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_payroll_run_items')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('hr_employee_adjustments')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_payroll_runs')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_employee_loan_installments')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_employee_loans')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_employee_ledger')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_employee_assets')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_attendance_exceptions')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_attendance_records')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_leave_requests')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_leave_types')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_compensation_packages')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_employment_contracts')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_employee_documents')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_employee_contacts')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await (trx as any)
    .deleteFrom('hr_holidays')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_employees')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_positions')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_job_titles')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('hr_departments')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);

  // 3. Accounting & Journals
  // Treasury transfers reference journals with RESTRICT
  // (INV-TENANT-WIPE-FK-CLOSURE): they must go before the journals.
  await (trx as any)
    .deleteFrom('treasury_transfers')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);
  await trx
    .deleteFrom('journal_entry_lines')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  await trx
    .deleteFrom('journal_entries')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();

  // Services (must be deleted before users)
  await trx
    .deleteFrom('services')
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute()
    .catch(() => undefined);

  // Unlink any audit logs or subscription payments created by users being deleted
  await trx
    .updateTable('audit_logs')
    .set({ created_by: null })
    .where(
      'created_by',
      'in',
      trx
        .selectFrom('users')
        .select('id')
        .where('id', '<>', preservedUserId)
        .where(sql<boolean>`tenant_id = ${tenantId}`),
    )
    .execute();

  await (trx as any)
    .updateTable('tenant_subscription_payments')
    .set({ created_by: null })
    .where(
      'created_by',
      'in',
      trx
        .selectFrom('users')
        .select('id')
        .where('id', '<>', preservedUserId)
        .where(sql<boolean>`tenant_id = ${tenantId}`),
    )
    .execute()
    .catch(() => undefined);

  // 4. Delete demo users (keep preserved user)
  await trx
    .deleteFrom('users')
    .where('id', '<>', preservedUserId)
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
}
