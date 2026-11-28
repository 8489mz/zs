import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'path';

/*
 * Phase 1 final R1 — restore the below-floor discount gate for
 * offline sync (INV-OFFLINE-SYNC-BELOW-FLOOR-GATE).
 *
 * GROUNDING (independent offline-POS implementation review,
 * 2026-11-28 17:13 EET, §4.1 — the most serious new problem):
 * backend/src/modules/sales/services/create-sale/
 * compute-totals-and-gates.ts swallowed a failed
 * authorizeDiscountOverride for offline sales — a wrong or
 * missing manager PIN ended in floorApproval = null and the sale
 * posted with only a [بيع تحت الحد] note tag. Online, the same
 * call throws and the sale is refused. The manager-PIN gate for
 * discounts above the cashier's limit is a standing user rule
 * (2026-11-25: admin password for discounts above the cashier's
 * limit STAYS), and the server-side gate is the last guarantee
 * for an offline sale — a crafted request could post a
 * below-floor discount with no approval at all. Meanwhile the
 * 5% rep cap still throws 403, so the two gates were
 * inconsistent: the cashier's below-floor discount passed with
 * a note, the rep's over-cap discount was refused.
 *
 * DECIDED BEHAVIOUR (user, 2026-11-28 19:37 EET — apply all
 * recommended): an offline sale whose discount is below the
 * floor is REJECTED at sync — not posted, not posted-with-a-note.
 * The cashier sells at full price offline and settles the
 * discount later. A valid manager approval still posts offline
 * (the approval path itself is unchanged); only the swallowed
 * failure is removed.
 *
 * FIX: the offline special-case in compute-totals-and-gates.ts
 * is deleted; the floor check now calls authorizeDiscountOverride
 * unconditionally, exactly like the online path, so a missing
 * PIN throws MANAGER_AUTH_REQUIRED and a wrong PIN throws
 * MANAGER_AUTH_INVALID, and the sync fails before any stock,
 * journal or tender work. The 5% rep cap is untouched; online
 * behaviour is untouched; the admin bypass is untouched.
 *
 * HOW THIS IS DRIVEN: the real SalesWriteService.createSale on
 * PGlite, reusing the admin-discount-authority harness verbatim
 * (schema + services), plus a second product whose cost sits
 * just under the retail price so a within-tier cashier discount
 * still lands below the floor: product 102, retail 100, cost 95
 * — a 9% line discount (net 91) passes the 10% tier gate for a
 * canDiscount cashier (9 / 91 = 9.89%) but is below the floor
 * (max(95, 1) = 95). A 10% discount would trip the tier gate
 * first (10 / 90 = 11.11% > 10%), so 9% is the case that
 * isolates the floor gate. Offline sales run inside
 * idempotencyStorage.run with a stable key, the way the sync
 * interceptor does it (the service requires a key for any
 * offlineDocNo payload).
 *
 * WHAT THIS PINS:
 * - §1: live behaviour — offline below-floor without a PIN is
 *   rejected (and writes nothing); with a wrong PIN rejected;
 *   with a valid PIN posts with the approval tag; the online
 *   control still rejects; the admin offline bypass still posts.
 * - §2: the swallow is gone from the service source; the new
 *   INV marker is present.
 * - §3: the INV entry exists exactly once in both places.
 * - §4: wiring 451 in both lists, this spec last, and the
 *   earlier chain specs re-pinned.
 * - §5: the re-pin sweep is complete (no stale count,
 *   last-entry or guard id remains).
 * - §6: the guard re-pin list (every earlier spec's guard
 *   assertion points at the new INV).
 * - §7: the boundary / baseline / write pins do not move and
 *   the "highest migration" pins stay at 0346 (no migration in
 *   this package).
 *
 * RED-1: run this spec BEFORE the fix — §1 case 1 fails (the
 * offline below-floor sale posts instead of rejecting).
 *
 * Wiring: both critical lists carry 451 specs in identical
 * order, this spec last.
 */

import 'reflect-metadata';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { idempotencyStorage } from '../../src/core/idempotency/idempotency.context';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const CRITICAL_DIR = path.join(BACKEND, 'test', 'critical');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(CRITICAL_DIR, 'architecture-guard.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const BOUNDARY_SPEC = path.join(CRITICAL_DIR, 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const WRITES_SPEC = path.join(CRITICAL_DIR, 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');
const SERVICE = path.join(BACKEND, 'src', 'modules', 'sales', 'services', 'create-sale', 'compute-totals-and-gates.ts');
const DEPOSIT_3DP_SPEC = path.join(CRITICAL_DIR, 'import-deposit-amount-3dp.spec.ts');
const VAN_TRANSFER_3DP_SPEC = path.join(CRITICAL_DIR, 'van-transfer-loaded-amount-3dp.spec.ts');
const S2_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s2-maritime-settlement-idempotency.spec.ts');
const S3_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s3-money-precision-hr-import.spec.ts');
const S4_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s4-legacy-doc-numbers.spec.ts');
const S5_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s5-business-date-r3.spec.ts');
const S6_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s6-import-fx-payout-idempotency.spec.ts');
const S7_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s7-marketplace-webhook-map-row.spec.ts');
const S8_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s8-settings-import-posting-port.spec.ts');
const S9_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s9-test-file-wiring.spec.ts');
const S10_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s10-module-documentation.spec.ts');
const S11_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s11-module-documentation.spec.ts');
const S12_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s12-module-documentation.spec.ts');
const S13_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s13-mfa-begin-setup.spec.ts');
const S14_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s14-module-documentation.spec.ts');

const NEW_INV = 'INV-OFFLINE-SYNC-BELOW-FLOOR-GATE';
const NEW_SPEC = 'phase1-final-r1-offline-below-floor-gate.spec.ts';
const SHA = 'ab99b2de2c4f460a1da06394df064dffcbad0b14';
const VERIFIED_AT = '2026-11-28';

// Earlier chain specs (wiring loop §4): the s14 list plus the
// slice-14 spec itself, whose wiring assertions the re-pin sweep
// moves to the new count.
const EARLIER_WIRING: ReadonlyArray<readonly [string, string]> = [
  ['B1', path.join(CRITICAL_DIR, 'phase1-b1-reports-sales.spec.ts')],
  ['B2', path.join(CRITICAL_DIR, 'phase1-b2-sales-settings.spec.ts')],
  ['B3', path.join(CRITICAL_DIR, 'phase1-b3-sales-storefront.spec.ts')],
  ['B4', path.join(CRITICAL_DIR, 'phase1-b4-accounting-hr.spec.ts')],
  ['B5', path.join(CRITICAL_DIR, 'phase1-b5-accounting-manufacturing.spec.ts')],
  ['B6', path.join(CRITICAL_DIR, 'phase1-b6-accounting-purchases.spec.ts')],
  ['B7', path.join(CRITICAL_DIR, 'phase1-b7-returns-sales.spec.ts')],
  ['B8', path.join(CRITICAL_DIR, 'phase1-b8-delivery-reps-sales.spec.ts')],
  ['F2', path.join(CRITICAL_DIR, 'phase1-f2-feature-public-indices.spec.ts')],
  ['F3', path.join(CRITICAL_DIR, 'phase1-f3-feature-boundary-legs.spec.ts')],
  ['F4', path.join(CRITICAL_DIR, 'phase1-f4-settings-access-door.spec.ts')],
  ['F5a', path.join(CRITICAL_DIR, 'phase1-f5a-audit-settings.spec.ts')],
  ['F5b', path.join(CRITICAL_DIR, 'phase1-f5b-products-settings.spec.ts')],
  ['F5c', path.join(CRITICAL_DIR, 'phase1-f5c-accounts-purchases.spec.ts')],
  ['F5d', path.join(CRITICAL_DIR, 'phase1-f5d-maintenance-products.spec.ts')],
  ['F5e', path.join(CRITICAL_DIR, 'phase1-f5e-accounting-treasury.spec.ts')],
  ['F5f', path.join(CRITICAL_DIR, 'phase1-f5f-cash-drawer-pos.spec.ts')],
  ['F5g', path.join(CRITICAL_DIR, 'phase1-f5g-customers-sales.spec.ts')],
  ['F5h', path.join(CRITICAL_DIR, 'phase1-f5h-pos-sales.spec.ts')],
  ['F5i', path.join(CRITICAL_DIR, 'phase1-f5i-pos-settings.spec.ts')],
  ['F5h-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5h-repair-sales-envelope-check.spec.ts')],
  ['F5j', path.join(CRITICAL_DIR, 'phase1-f5j-inventory-products.spec.ts')],
  ['F5h-REPAIR-2', path.join(CRITICAL_DIR, 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts')],
  ['F5k', path.join(CRITICAL_DIR, 'phase1-f5k-pos-products.spec.ts')],
  ['F5j-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5j-repair-expiry-spec-import.spec.ts')],
  ['F5l', path.join(CRITICAL_DIR, 'phase1-f5l-pos-storefront.spec.ts')],
  ['F5l-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5l-repair-bundle-budget.spec.ts')],
  ['D-M1', path.join(CRITICAL_DIR, 'phase1-d-m1-job-fields.spec.ts')],
  ['D-M3', path.join(CRITICAL_DIR, 'phase1-d-m3-mail-nested.spec.ts')],
  ['D-D10a', path.join(CRITICAL_DIR, 'phase1-d-d10a-serials-payload.spec.ts')],
  ['discount-fix', path.join(CRITICAL_DIR, 'phase1-discount-fix-line-amount.spec.ts')],
  ['cleanup', path.join(CRITICAL_DIR, 'phase1-cleanup-as-any-reduction.spec.ts')],
  ['P1', path.join(CRITICAL_DIR, 'phase1-eval-p1-frontend-lint.spec.ts')],
  ['P2', path.join(CRITICAL_DIR, 'phase1-eval-p2-dev-passcode.spec.ts')],
  ['P3', path.join(CRITICAL_DIR, 'phase1-eval-p3-van-writer.spec.ts')],
  ['repair', path.join(CRITICAL_DIR, 'phase1-eval-repair-type-imports.spec.ts')],
  ['S1', path.join(CRITICAL_DIR, 'phase1-final-s1-fx-maritime-close-asof.spec.ts')],
  ['S2', path.join(CRITICAL_DIR, 'phase1-final-s2-maritime-settlement-idempotency.spec.ts')],
  ['S3', path.join(CRITICAL_DIR, 'phase1-final-s3-money-precision-hr-import.spec.ts')],
  ['S4', path.join(CRITICAL_DIR, 'phase1-final-s4-legacy-doc-numbers.spec.ts')],
  ['S5', path.join(CRITICAL_DIR, 'phase1-final-s5-business-date-r3.spec.ts')],
  ['S6', path.join(CRITICAL_DIR, 'phase1-final-s6-import-fx-payout-idempotency.spec.ts')],
  ['S7', path.join(CRITICAL_DIR, 'phase1-final-s7-marketplace-webhook-map-row.spec.ts')],
  ['S8', path.join(CRITICAL_DIR, 'phase1-final-s8-settings-import-posting-port.spec.ts')],
  ['S9', path.join(CRITICAL_DIR, 'phase1-final-s9-test-file-wiring.spec.ts')],
  ['S10', path.join(CRITICAL_DIR, 'phase1-final-s10-module-documentation.spec.ts')],
  ['S11', path.join(CRITICAL_DIR, 'phase1-final-s11-module-documentation.spec.ts')],
  ['S12', path.join(CRITICAL_DIR, 'phase1-final-s12-module-documentation.spec.ts')],
  ['S13', path.join(CRITICAL_DIR, 'phase1-final-s13-mfa-begin-setup.spec.ts')],
  ['S14', path.join(CRITICAL_DIR, 'phase1-final-s14-module-documentation.spec.ts')],
];

// Earlier specs carrying a guard assertion (guard list §6): the
// s14 list plus the slice-14 spec itself.
const EARLIER_GUARD: ReadonlyArray<readonly [string, string]> = [
  ['B3', path.join(CRITICAL_DIR, 'phase1-b3-sales-storefront.spec.ts')],
  ['B4', path.join(CRITICAL_DIR, 'phase1-b4-accounting-hr.spec.ts')],
  ['B5', path.join(CRITICAL_DIR, 'phase1-b5-accounting-manufacturing.spec.ts')],
  ['B6', path.join(CRITICAL_DIR, 'phase1-b6-accounting-purchases.spec.ts')],
  ['B7', path.join(CRITICAL_DIR, 'phase1-b7-returns-sales.spec.ts')],
  ['B8', path.join(CRITICAL_DIR, 'phase1-b8-delivery-reps-sales.spec.ts')],
  ['cleanup', path.join(CRITICAL_DIR, 'phase1-cleanup-as-any-reduction.spec.ts')],
  ['D-D10a', path.join(CRITICAL_DIR, 'phase1-d-d10a-serials-payload.spec.ts')],
  ['D-M1', path.join(CRITICAL_DIR, 'phase1-d-m1-job-fields.spec.ts')],
  ['D-M3', path.join(CRITICAL_DIR, 'phase1-d-m3-mail-nested.spec.ts')],
  ['discount-fix', path.join(CRITICAL_DIR, 'phase1-discount-fix-line-amount.spec.ts')],
  ['P1', path.join(CRITICAL_DIR, 'phase1-eval-p1-frontend-lint.spec.ts')],
  ['P2', path.join(CRITICAL_DIR, 'phase1-eval-p2-dev-passcode.spec.ts')],
  ['P3', path.join(CRITICAL_DIR, 'phase1-eval-p3-van-writer.spec.ts')],
  ['repair', path.join(CRITICAL_DIR, 'phase1-eval-repair-type-imports.spec.ts')],
  ['F2', path.join(CRITICAL_DIR, 'phase1-f2-feature-public-indices.spec.ts')],
  ['F3', path.join(CRITICAL_DIR, 'phase1-f3-feature-boundary-legs.spec.ts')],
  ['F4', path.join(CRITICAL_DIR, 'phase1-f4-settings-access-door.spec.ts')],
  ['F5a', path.join(CRITICAL_DIR, 'phase1-f5a-audit-settings.spec.ts')],
  ['F5b', path.join(CRITICAL_DIR, 'phase1-f5b-products-settings.spec.ts')],
  ['F5c', path.join(CRITICAL_DIR, 'phase1-f5c-accounts-purchases.spec.ts')],
  ['F5d', path.join(CRITICAL_DIR, 'phase1-f5d-maintenance-products.spec.ts')],
  ['F5e', path.join(CRITICAL_DIR, 'phase1-f5e-accounting-treasury.spec.ts')],
  ['F5f', path.join(CRITICAL_DIR, 'phase1-f5f-cash-drawer-pos.spec.ts')],
  ['F5g', path.join(CRITICAL_DIR, 'phase1-f5g-customers-sales.spec.ts')],
  ['F5h', path.join(CRITICAL_DIR, 'phase1-f5h-pos-sales.spec.ts')],
  ['F5h-REPAIR-2', path.join(CRITICAL_DIR, 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts')],
  ['F5h-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5h-repair-sales-envelope-check.spec.ts')],
  ['F5i', path.join(CRITICAL_DIR, 'phase1-f5i-pos-settings.spec.ts')],
  ['F5j', path.join(CRITICAL_DIR, 'phase1-f5j-inventory-products.spec.ts')],
  ['F5j-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5j-repair-expiry-spec-import.spec.ts')],
  ['F5k', path.join(CRITICAL_DIR, 'phase1-f5k-pos-products.spec.ts')],
  ['F5l', path.join(CRITICAL_DIR, 'phase1-f5l-pos-storefront.spec.ts')],
  ['F5l-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5l-repair-bundle-budget.spec.ts')],
  ['S1', path.join(CRITICAL_DIR, 'phase1-final-s1-fx-maritime-close-asof.spec.ts')],
  ['S2', path.join(CRITICAL_DIR, 'phase1-final-s2-maritime-settlement-idempotency.spec.ts')],
  ['S3', path.join(CRITICAL_DIR, 'phase1-final-s3-money-precision-hr-import.spec.ts')],
  ['S4', path.join(CRITICAL_DIR, 'phase1-final-s4-legacy-doc-numbers.spec.ts')],
  ['S5', path.join(CRITICAL_DIR, 'phase1-final-s5-business-date-r3.spec.ts')],
  ['S6', path.join(CRITICAL_DIR, 'phase1-final-s6-import-fx-payout-idempotency.spec.ts')],
  ['S7', path.join(CRITICAL_DIR, 'phase1-final-s7-marketplace-webhook-map-row.spec.ts')],
  ['S8', path.join(CRITICAL_DIR, 'phase1-final-s8-settings-import-posting-port.spec.ts')],
  ['S9', path.join(CRITICAL_DIR, 'phase1-final-s9-test-file-wiring.spec.ts')],
  ['S10', path.join(CRITICAL_DIR, 'phase1-final-s10-module-documentation.spec.ts')],
  ['S11', path.join(CRITICAL_DIR, 'phase1-final-s11-module-documentation.spec.ts')],
  ['S12', path.join(CRITICAL_DIR, 'phase1-final-s12-module-documentation.spec.ts')],
  ['S13', path.join(CRITICAL_DIR, 'phase1-final-s13-mfa-begin-setup.spec.ts')],
  ['S14', path.join(CRITICAL_DIR, 'phase1-final-s14-module-documentation.spec.ts')],
];

const TENANT = 't1';
const ACCOUNT = 'a1';
const MANAGER_PIN = '1234';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

const adminAuth: AuthContext = {
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'admin',
  permissions: ['sales', 'canEditPrice'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

const cashierDiscountAuth: AuthContext = {
  userId: 3,
  sessionId: 'spec-b',
  username: 'cashier-b',
  role: 'cashier',
  permissions: ['sales', 'canDiscount'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  SalesWriteService.invalidateSettingsCache(TENANT);
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE cost_centers (id bigint PRIMARY KEY, tenant_id text, code text, name text);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, half_wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, updated_at timestamptz);
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT false, reason text, auto_restore_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW(), import_receipt_id bigint);
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text DEFAULT 'EGP', type text DEFAULT 'percentage', default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE inventory_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number text, expiry_date text, quantity numeric DEFAULT 0, unit_cost numeric DEFAULT 0, location_id integer, supplier_name text, status text DEFAULT 'active', notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_inventory_batch_allocations (id bigint PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric DEFAULT 0, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, system_cash_discount_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, received_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, idempotency_key text NOT NULL, operation_type text NOT NULL, status text NOT NULL, request_hash text NOT NULL, document_id text, response_payload text, error_code text, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), completed_at timestamptz);
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 2, tenant_id: TENANT, username: 'cashier-a', role: 'cashier', is_active: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 3, tenant_id: TENANT, username: 'cashier-b', role: 'cashier', is_active: true })
    .execute();
  const accounts: Array<[number, string]> = [
    [1110, '1110'],
    [1120, '1120'],
    [1130, '1130'],
    [1140, '1140'],
    [2120, '2120'],
    [4100, '4100'],
    [4300, '4300'],
    [5100, '5100'],
  ];
  for (const [id, code] of accounts) {
    await anyDb
      .insertInto('accounting_accounts')
      .values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true, is_tax: false })
      .execute();
  }
  await anyDb
    .insertInto('accounting_settings')
    .values({
      id: 1,
      tenant_id: TENANT,
      cash_account_id: 1110,
      bank_account_id: 1120,
      customer_receivable_account_id: 1130,
      inventory_account_id: 1140,
      sales_revenue_account_id: 4100,
      sales_discount_account_id: 4300,
      cogs_account_id: 5100,
      sales_tax_account_id: 2120,
    })
    .execute();
  await anyDb
    .insertInto('branches')
    .values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 })
    .execute();
  await anyDb
    .insertInto('stock_locations')
    .values({
      id: 10,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      branch_id: 1,
      name: 'Main warehouse',
      location_type: 'internal_warehouse',
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('products')
    .values({
      id: 101,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Widget 101',
      stock_qty: 100,
      cost_price: 10,
      retail_price: 100,
      wholesale_price: 100,
      min_selling_price: 1,
      is_active: true,
      item_type: 'product',
    })
    .execute();
  // Product 102 isolates the floor gate: retail 100, cost 95 — a
  // 9% line discount (net 91) passes the 10% tier gate for a
  // canDiscount cashier (9 / 91 = 9.89%) but is below the floor
  // (max(95, 1) = 95).
  await anyDb
    .insertInto('products')
    .values({
      id: 102,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Widget 102',
      stock_qty: 100,
      cost_price: 95,
      retail_price: 100,
      wholesale_price: 100,
      min_selling_price: 1,
      is_active: true,
      item_type: 'product',
    })
    .execute();
  for (const productId of [101, 102]) {
    await anyDb
      .insertInto('product_location_stock')
      .values({
        tenant_id: TENANT,
        account_id: ACCOUNT,
        product_id: productId,
        branch_id: 1,
        location_id: 10,
        qty: 100,
      })
      .execute();
  }
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any)
    .insertInto('cashier_shifts')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      doc_no: `SHIFT-${id}`,
      opened_by: openedBy,
      status: 'open',
      branch_id: 1,
      location_id: 10,
      opening_cash: 0,
      expected_cash: 0,
      created_at: SHIFT_OPENED_AT,
    })
    .execute();
}

function buildServices(db: Kysely<Database>): {
  sales: SalesWriteService;
  drawer: CashDrawerService;
  posting: AccountingPostingService;
} {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const authz = new SalesAuthorizationService(db);
  const finance = new SalesFinanceService(db);
  const query = new SalesQueryService(db, authz);
  const idempotency = new IdempotencyService(db);
  const tx = new TransactionHelper();
  const audit = new AuditService(db);
  const planFeatures = { hasFeature: (_planId: any, _extra: any, feature: string) => feature === 'pos' };
  const returnsStub = {};
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  const sales = new SalesWriteService(
    db,
    tx,
    audit,
    authz,
    finance,
    query,
    posting,
    idempotency,
    planFeatures as never,
    returnsStub as never,
    undefined,
    undefined,
    drawer,
  );
  return { sales, drawer, posting };
}

async function seedDiscountSettings(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb
    .insertInto('settings')
    .values({ tenant_id: TENANT, key: 'posMaxDiscountThresholdEnabled', value: 'true' })
    .execute();
  await anyDb
    .insertInto('settings')
    .values({ tenant_id: TENANT, key: 'posMaxDiscountThresholdType', value: '"percentage"' })
    .execute();
  await anyDb
    .insertInto('settings')
    .values({ tenant_id: TENANT, key: 'posMaxDiscountThresholdValue', value: '10' })
    .execute();
}

// The 9% line discount on product 102: net 91, floor 95, tier
// 9.89% (inside the 10% cap for a canDiscount cashier).
function belowFloorPayload(extra: Record<string, unknown> = {}): any {
  return {
    items: [{ productId: 102, qty: 1, price: 100, priceType: 'retail', unitMultiplier: 1, lineDiscount: 9 }],
    discount: 0,
    taxRate: 0,
    paymentType: 'cash',
    paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: 91 }],
    tenderedAmount: 91,
    branchId: 1,
    locationId: 10,
    source: 'pos',
    ...extra,
  };
}

function offlinePayload(managerPin?: string): any {
  return belowFloorPayload({
    offlineDocNo: 'INV-TERMINAL-260101-0001',
    offlineCreatedAt: new Date().toISOString(),
    ...(managerPin !== undefined ? { managerPin } : {}),
  });
}

async function createOfflineSale(
  sales: SalesWriteService,
  payload: any,
  auth: AuthContext,
  key: string,
): Promise<Record<string, unknown>> {
  return idempotencyStorage.run({ idempotencyKey: key, operationType: 'sale' }, () =>
    sales.createSale(payload, auth),
  ) as Promise<Record<string, unknown>>;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err: any) {
    assert.equal(err?.code, code, `expected ${code}, got ${err?.code}: ${err?.message}`);
    return;
  }
  assert.fail(`expected rejection with ${code}`);
}

async function readSaleNote(db: Kysely<Database>, saleId: number): Promise<string> {
  const row = await (db as any)
    .selectFrom('sales')
    .select('note')
    .where('id', '=', saleId)
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow();
  return String(row.note || '');
}

async function countSales(db: Kysely<Database>): Promise<number> {
  const rows = await (db as any).selectFrom('sales').select('id').where('tenant_id', '=', TENANT).execute();
  return rows.length;
}

async function readLocationQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await (db as any)
    .selectFrom('product_location_stock')
    .select('qty')
    .where('tenant_id', '=', TENANT)
    .where('product_id', '=', productId)
    .executeTakeFirstOrThrow();
  return Number(row.qty);
}

async function freshCase(run: (db: Kysely<Database>, sales: SalesWriteService) => Promise<void>): Promise<void> {
  const { db } = await makeDb();
  try {
    SalesWriteService.invalidateSettingsCache(TENANT);
    await seedFoundation(db);
    await seedDiscountSettings(db);
    await seedShift(db, 1, 1);
    await seedShift(db, 2, 2);
    await seedShift(db, 3, 3);
    const { sales } = buildServices(db);
    await run(db, sales);
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<void> {
  // §1.1: Offline below-floor sale, canDiscount cashier, NO manager
  // PIN — rejected at sync, and nothing is written (no sale row,
  // no stock movement). RED-1: on the unfixed tree this sale
  // posts with only a [بيع تحت الحد] note tag.
  await freshCase(async (db, sales) => {
    await expectCode(
      createOfflineSale(sales, offlinePayload(), cashierDiscountAuth, 'r1-offline-no-pin'),
      'MANAGER_AUTH_REQUIRED',
    );
    assert.equal(await countSales(db), 0, 'rejected offline sale must write no sale row');
    assert.equal(await readLocationQty(db, 102), 100, 'rejected offline sale must not deduct stock');
  });
  console.log('  offline below-floor without PIN rejected, nothing written passed');

  // §1.2: Offline below-floor sale with a WRONG manager PIN —
  // rejected with the invalid-PIN code, nothing written.
  await freshCase(async (db, sales) => {
    await expectCode(
      createOfflineSale(sales, offlinePayload('0000'), cashierDiscountAuth, 'r1-offline-wrong-pin'),
      'MANAGER_AUTH_INVALID',
    );
    assert.equal(await countSales(db), 0, 'rejected offline sale must write no sale row');
    assert.equal(await readLocationQty(db, 102), 100, 'rejected offline sale must not deduct stock');
  });
  console.log('  offline below-floor with wrong PIN rejected passed');

  // §1.3: Offline below-floor sale with a VALID manager PIN —
  // posts, and the note names the approver (the approval path
  // itself is unchanged; only the swallowed failure is removed).
  await freshCase(async (db, sales) => {
    const created: any = await createOfflineSale(
      sales,
      offlinePayload(MANAGER_PIN),
      cashierDiscountAuth,
      'r1-offline-valid-pin',
    );
    const saleId = Number(created?.sale?.id);
    assert.ok(saleId > 0, 'offline below-floor sale with a valid PIN must create the sale');
    const note = await readSaleNote(db, saleId);
    assert.ok(note.includes('اعتماد بيع تحت الحد'), `note must name the approver, got: ${note}`);
    const sale = await (db as any)
      .selectFrom('sales')
      .select('total')
      .where('id', '=', saleId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(sale.total), 91);
  });
  console.log('  offline below-floor with valid PIN posts with approval tag passed');

  // §1.4: Online control — the same sale without the offline
  // fields, no PIN — still rejected (online behaviour unchanged).
  await freshCase(async (db, sales) => {
    await expectCode(sales.createSale(belowFloorPayload(), cashierDiscountAuth), 'MANAGER_AUTH_REQUIRED');
    assert.equal(await countSales(db), 0, 'rejected online sale must write no sale row');
  });
  console.log('  online below-floor without PIN still rejected passed');

  // §1.5: Admin offline below-floor sale, no PIN — still posts
  // (the admin bypass is unchanged); the note records the
  // below-floor lines with no approver name.
  await freshCase(async (db, sales) => {
    const created: any = await createOfflineSale(sales, offlinePayload(), adminAuth, 'r1-offline-admin');
    const saleId = Number(created?.sale?.id);
    assert.ok(saleId > 0, 'admin offline below-floor sale must create the sale');
    const note = await readSaleNote(db, saleId);
    assert.ok(note.includes('[بيع تحت الحد: أصناف 102]'), `note must record the below-floor line, got: ${note}`);
    assert.ok(!note.includes('اعتماد بيع تحت الحد'), 'admin floor tag carries no approver');
  });
  console.log('  admin offline below-floor without PIN still posts passed');

  // §2: Source pin — the swallow is gone and the new INV marker
  // is present in the service.
  {
    const serviceSource = fs.readFileSync(SERVICE, 'utf8');
    assert.ok(serviceSource.includes(NEW_INV), 'service must mark the restored gate with the new INV');
    assert.ok(
      !serviceSource.includes('} catch {\n            floorApproval = null;\n          }'),
      'service must not swallow a failed floor approval for offline sales',
    );
  }
  console.log('  source pin passed');

  // §3: The INV entry exists exactly once in both places (never
  // quote another INV id literally).
  {
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }
  console.log('  invariant pin passed');

  // §4: Wiring: both critical lists carry 451 specs in identical
  // order, this spec last, and the earlier chain specs re-pinned.
  {
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(specs.length, 451);
    assert.equal(chain.length, 451);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 451 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-r1-offline-below-floor-gate.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-r1-offline-below-floor-gate.spec.ts');
    for (const [label, specPath] of EARLIER_WIRING) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 451);') && src.includes('assert.equal(chain.length, 451);'),
        `${label} spec wiring must re-pin to 451`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-r1-offline-below-floor-gate.spec.ts'"),
        `${label} spec last-entry must re-pin to the new spec`,
      );
    }
  }
  console.log('  wiring pin passed');

  // §5: The wiring re-pin sweep is complete: no critical spec
  // may still pin the old count, point its last-entry at the
  // previous spec, or pin the old guard INV. (The patterns below
  // are built by concatenation so this block's own source never
  // contains the patterns it scans for.)
  {
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const prevName = 'phase1-final-s14-module-' + 'documentation.spec.ts';
    const prevInv = 'INV-MODULE-DOCUMENTATION-' + 'S14';
    const staleSpecs = 'specs.length, 45' + '0';
    const staleChain = 'chain.length, 45' + '0';
    const staleList = 'list.length, 45' + '0';
    for (const file of fs.readdirSync(CRITICAL_DIR)) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(CRITICAL_DIR, file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (450)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the previous spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 14)');
  }
  console.log('  stale sweep passed');

  // §6: The guard tail holds ONLY the newest id, so this package
  // re-pins the earlier specs' guard assertions to the new INV;
  // their invariants-file assertions still pin their own id
  // (each line stays in ARCHITECTURE_INVARIANTS.md exactly once).
  {
    for (const [label, specPath] of EARLIER_GUARD) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-OFFLINE-SYNC-BELOW-FLOOR-GATE/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }
  }
  console.log('  guard re-pin list passed');

  // §7: The module-boundary pins do not move in this package
  // (one production file changes, but no import edges move) and
  // the "highest migration" pins stay at 0346 (no migration in
  // this package).
  {
    const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
    assert.ok(
      boundary.includes('const PINNED_POSTING_EXTERNAL = 97;'),
      'module-boundary must pin the posting count 97',
    );
    assert.ok(
      boundary.includes("'settings->accounting': 14,"),
      'module-boundary must still pin the settings->accounting table 14',
    );
    assert.ok(
      boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
      'module-boundary must still pin the backend total 740',
    );
    assert.ok(
      boundary.includes("'delivery-reps->accounting': 109,"),
      'module-boundary must still pin delivery-reps->accounting 109',
    );
    assert.ok(
      boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
      'module-boundary must still pin the frontend total 105',
    );
    assert.ok(
      boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
      'module-boundary must still pin 63 backend edges',
    );
    assert.ok(
      boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
      'module-boundary must still pin 44 frontend edges',
    );
    assert.ok(
      boundary.includes('const FRONTEND_EDGE_FLOOR = 44;'),
      'module-boundary must still pin the frontend edge floor 44',
    );
    assert.ok(
      boundary.includes('const PINNED_FRONTEND_BIDIRECTIONAL_PAIRS: string[] = [];'),
      'the frontend bidirectional pair list must stay empty',
    );
    const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
    assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57');
    const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
    assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152');
    const writesSpec = fs.readFileSync(WRITES_SPEC, 'utf8');
    const writesDoc = fs.readFileSync(WRITES_DOC, 'utf8');
    assert.ok(
      writesSpec.includes('const PINNED_WRITE_COUNT = 5;'),
      'stock-movements-writes must pin the write count 5',
    );
    assert.ok(writesDoc.includes('Total business writes: **5**'), 'the writes doc must state the total 5');
    for (const [label, specPath] of [
      ['deposit-3dp', DEPOSIT_3DP_SPEC],
      ['van-transfer-3dp', VAN_TRANSFER_3DP_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes(`const HIGHEST_MIGRATION_FILE = '2040000000346_loss_prevention_anti_theft_shield.ts';`),
        `${label} spec highest-migration pin must stay at 0346`,
      );
      assert.ok(
        src.includes('the 0346 migration must be the highest-numbered migration on disk'),
        `${label} spec highest-migration message must stay at 0346`,
      );
    }
    for (const [label, specPath] of [
      ['S2', S2_SPEC],
      ['S3', S3_SPEC],
      ['S5', S5_SPEC],
      ['S6', S6_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes(`const MIGRATION_FILE = '2040000000346_loss_prevention_anti_theft_shield.ts';`),
        `${label} spec migration-file pin must stay at 0346`,
      );
      assert.ok(src.includes('must re-point to 0346'), `${label} spec highest-migration assertions must stay at 0346`);
    }
    const s2Src = fs.readFileSync(S2_SPEC, 'utf8');
    assert.ok(
      s2Src.includes('the 0346 migration must be the highest-numbered migration on disk'),
      'S2 spec highest-migration assertion must stay at 0346',
    );
    assert.ok(
      s2Src.includes('spec highest-migration pin must re-point to 0346'),
      'S2 spec §10 pin message must stay at 0346',
    );
    assert.ok(
      s2Src.includes('spec highest-migration message must re-point to 0346'),
      'S2 spec §10 message must stay at 0346',
    );
    const s4Src = fs.readFileSync(S4_SPEC, 'utf8');
    assert.ok(
      s4Src.includes(
        "import { migration } from '../../src/database/migrations/2040000000344_legacy_document_number_unique_indexes';",
      ),
      'S4 spec must still drive the real 0344 migration (its own migration under test)',
    );
    assert.ok(s4Src.includes('files[files.length - 1],'), 'S4 spec §4 must still compare the highest file on disk');
    assert.ok(
      s4Src.includes("'2040000000346_loss_prevention_anti_theft_shield.ts',"),
      'S4 spec §4 highest-migration literal must stay at 0346',
    );
    assert.ok(
      s4Src.includes('the 0346 migration must be the highest-numbered migration on disk'),
      'S4 spec highest-migration assertion must stay at 0346',
    );
    assert.ok(
      s4Src.includes('spec highest-migration pin must re-point to 0346'),
      'S4 spec §9 pin message must stay at 0346',
    );
    for (const [label, specPath] of [
      ['S7', S7_SPEC],
      ['S8', S8_SPEC],
      ['S9', S9_SPEC],
      ['S10', S10_SPEC],
      ['S11', S11_SPEC],
      ['S12', S12_SPEC],
      ['S13', S13_SPEC],
      ['S14', S14_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('2040000000346_loss_prevention_anti_theft_shield.ts'),
        `${label} spec highest-migration pin must stay at 0346`,
      );
    }
  }
  console.log('  boundary pins passed');

  console.log('phase1 final r1 checks passed (offline below-floor gate restored, 451 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
