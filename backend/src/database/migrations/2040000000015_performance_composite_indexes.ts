import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

const upStatements = [
  // Expenses
  `CREATE INDEX IF NOT EXISTS idx_expenses_tenant_id_desc ON expenses(tenant_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date ON expenses(tenant_id, expense_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_tenant_branch ON expenses(tenant_id, branch_id)`,

  // Services
  `CREATE INDEX IF NOT EXISTS idx_services_tenant_id_desc ON services(tenant_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_services_tenant_date ON services(tenant_id, service_date DESC)`,

  // Return Documents & Items
  `CREATE INDEX IF NOT EXISTS idx_return_docs_tenant_type_inv ON return_documents(tenant_id, return_type, invoice_id)`,
  `CREATE INDEX IF NOT EXISTS idx_return_docs_tenant_id_desc ON return_documents(tenant_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_return_items_tenant_doc ON return_items(tenant_id, return_document_id)`,

  // Stock Count
  `CREATE INDEX IF NOT EXISTS idx_stock_count_sess_tenant_loc ON stock_count_sessions(tenant_id, location_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_count_items_tenant_sess ON stock_count_items(tenant_id, session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_damaged_stock_tenant_prod ON damaged_stock_records(tenant_id, product_id, location_id)`,

  // Manufacturing
  `CREATE INDEX IF NOT EXISTS idx_mfg_boms_tenant_prod ON manufacturing_boms(tenant_id, product_id, is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_mfg_bom_lines_bom ON manufacturing_bom_lines(bom_id, component_product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mfg_wo_tenant_status ON manufacturing_work_orders(tenant_id, status, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_mfg_wo_cons_wo ON manufacturing_wo_consumptions(work_order_id)`,

  // Serials
  `CREATE INDEX IF NOT EXISTS idx_serials_tenant_prod_status ON product_serials(tenant_id, product_id, status)`,

  // Sale Allocations
  `CREATE INDEX IF NOT EXISTS idx_sale_alloc_tenant_line ON sale_line_stock_allocations(tenant_id, sale_line_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sale_alloc_tenant_sale ON sale_line_stock_allocations(tenant_id, sale_id)`,

  // HR
  `CREATE INDEX IF NOT EXISTS idx_hr_attendance_tenant_emp_date ON hr_attendance_records(tenant_id, employee_id, work_date)`,
  `CREATE INDEX IF NOT EXISTS idx_hr_attendance_tenant_date ON hr_attendance_records(tenant_id, work_date)`,
  `CREATE INDEX IF NOT EXISTS idx_hr_employees_tenant_status ON hr_employees(tenant_id, status, id DESC)`,

  // Audit
  `CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC)`,
];

const downStatements = [
  // Expenses
  `DROP INDEX IF EXISTS idx_expenses_tenant_id_desc`,
  `DROP INDEX IF EXISTS idx_expenses_tenant_date`,
  `DROP INDEX IF EXISTS idx_expenses_tenant_branch`,

  // Services
  `DROP INDEX IF EXISTS idx_services_tenant_id_desc`,
  `DROP INDEX IF EXISTS idx_services_tenant_date`,

  // Return Documents & Items
  `DROP INDEX IF EXISTS idx_return_docs_tenant_type_inv`,
  `DROP INDEX IF EXISTS idx_return_docs_tenant_id_desc`,
  `DROP INDEX IF EXISTS idx_return_items_tenant_doc`,

  // Stock Count
  `DROP INDEX IF EXISTS idx_stock_count_sess_tenant_loc`,
  `DROP INDEX IF EXISTS idx_stock_count_items_tenant_sess`,
  `DROP INDEX IF EXISTS idx_damaged_stock_tenant_prod`,

  // Manufacturing
  `DROP INDEX IF EXISTS idx_mfg_boms_tenant_prod`,
  `DROP INDEX IF EXISTS idx_mfg_bom_lines_bom`,
  `DROP INDEX IF EXISTS idx_mfg_wo_tenant_status`,
  `DROP INDEX IF EXISTS idx_mfg_wo_cons_wo`,

  // Serials
  `DROP INDEX IF EXISTS idx_serials_tenant_prod_status`,

  // Sale Allocations
  `DROP INDEX IF EXISTS idx_sale_alloc_tenant_line`,
  `DROP INDEX IF EXISTS idx_sale_alloc_tenant_sale`,

  // HR
  `DROP INDEX IF EXISTS idx_hr_attendance_tenant_emp_date`,
  `DROP INDEX IF EXISTS idx_hr_attendance_tenant_date`,
  `DROP INDEX IF EXISTS idx_hr_employees_tenant_status`,

  // Audit
  `DROP INDEX IF EXISTS idx_audit_tenant_created`,
];

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    for (const statement of upStatements) {
      await sql.raw(statement).execute(db);
    }
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    for (const statement of downStatements) {
      await sql.raw(statement).execute(db);
    }
  },
};
