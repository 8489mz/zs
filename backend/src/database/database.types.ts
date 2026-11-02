import { ColumnType, Generated } from 'kysely';

export interface Phase1BootstrapTable {
  id: Generated<number>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface MarketplaceWebhookEventTable {
  id: Generated<number>;
  tenant_id: string | null;
  account_id: string | null;
  marketplace: string;
  event_type: string;
  event_key: string;
  dedup_key: string;
  payload: ColumnType<unknown, unknown | undefined, unknown | undefined>;
  payload_hash: string;
  status: string; // pending, unresolved
  received_at: ColumnType<Date, string | undefined, never>;
  processed_at: Date | null;
}

export interface OperationExecutionTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  idempotency_key: string;
  operation_type: string;
  status: string; // processing, committed, failed, recovery_required
  request_hash: string;
  document_id: string | null;
  response_payload: string | null;
  error_code: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  completed_at: Date | null;
}

export interface SessionTable {
  id: string;
  user_id: number;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  expires_at: Date;
  created_at: ColumnType<Date, string | undefined, never>;
  last_seen_at: Date | null;
  ip_address: string;
  user_agent: string;
  /** Platform admin driving this session via impersonation; null for a normal login. */
  impersonated_by: ColumnType<number | null, number | null | undefined, number | null | undefined>;
}

export interface PasswordResetTokenTable {
  id: string;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  user_id: number;
  /** SHA-256 of the emailed token. The token itself is never stored. */
  token_hash: string;
  expires_at: Date;
  used_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  invalidated_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  requested_ip: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface UserMfaTable {
  user_id: number;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  /** TOTP secret, AES-256-GCM encrypted. The key lives in the environment, never in the database. */
  secret_encrypted: string;
  confirmed_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  last_used_step: ColumnType<number, number | undefined, number | undefined>;
  recovery_codes: ColumnType<string[], string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface UserTable {
  id: Generated<number>;
  username: string;
  phone: string | null;
  password_hash: string;
  password_salt: string;
  role: 'super_admin' | 'admin' | 'cashier';
  is_active: boolean;
  permissions_json: string;
  default_branch_id: number | null;
  display_name: string;
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  pin?: string | null;
  pin_hash?: string | null;
  last_login_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface TenantTable {
  id: string;
  slug: string;
  business_name: string;
  owner_name: string;
  owner_phone: string;
  owner_email: string | null;
  activity_type: string | null;
  /**
   * بلد التسعير (ISO-2). يضبطه مسؤول المنصة وحده ولا يملكه مدير المنشأة — البلد
   * هو ما يحدد عملة الاشتراك وأسعاره، فلا يُشتق من إعداد يستطيع العميل تغييره.
   * هجرة 148 · PRICING_AND_PACKAGING.md §11 البند C8.
   */
  country_code: string | null;
  status: 'trial' | 'active' | 'expired' | 'suspended';
  trial_starts_at: Date;
  trial_ends_at: Date;
  activated_at: Date | null;
  plan_id: string | null;
  custom_domain: string | null;
  extra_features: any; // JSONB
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface TrialSignupTable {
  id: string;
  tenant_id: string;
  source: string | null;
  campaign: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface SettingTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  key: string;
  value: string;
}

export interface AccountingAccountTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  code: ColumnType<string, string | undefined, string | undefined>;
  name_ar: string;
  name_en: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'contra_asset' | 'contra_revenue';
  parent_id: number | null;
  account_group: string;
  normal_balance: 'debit' | 'credit';
  is_active: boolean;
  is_system: boolean;
  allow_manual_entries: boolean;
  is_control_account: boolean;
  is_cash_bank: boolean;
  is_receivable: boolean;
  is_payable: boolean;
  is_inventory: boolean;
  is_tax: boolean;
  /** IAS 21: only monetary items are retranslated at the closing rate. */
  is_monetary?: boolean;
  /** Foreign currency this account is denominated in, when it is a monetary FX account. */
  revaluation_currency?: string | null;
  description_ar: string;
  sort_order: number;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface JournalEntryTable {
  dedup_key?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  cash_flow_category?: ColumnType<'operating' | 'investing' | 'financing' | null, string | null | undefined, string | null | undefined>;
  id: Generated<number>;
  tenant_id: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  account_id: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  entry_no: string;
  entry_date: ColumnType<Date, string | undefined, string | undefined>;
  description: string;
  source_type: string;
  source_id: number | null;
  status: 'draft' | 'posted' | 'cancelled';
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  posted_by: number | null;
  posted_at: Date | null;
  cancelled_by: number | null;
  cancelled_at: Date | null;
  cancel_reason: string;
  reversed_by_entry_id?: number | null;
  reversal_of_entry_id?: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface JournalEntryLineTable {
  id: Generated<number>;
  tenant_id: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  journal_entry_id: number;
  account_id: number;
  cost_center_id?: number | null;
  description: string;
  debit: number;
  credit: number;
  partner_type: 'none' | 'customer' | 'supplier' | 'employee';
  partner_id: number | null;
  branch_id: number | null;
  location_id: number | null;
  is_reconciled?: boolean;
  reconciled_at?: Date | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface BankStatementTable {
  id: Generated<number>;
  tenant_id: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  account_id: number;
  statement_no: string;
  statement_date: ColumnType<string, string | Date, string | Date>;
  starting_balance: number;
  ending_balance: number;
  status: 'draft' | 'in_progress' | 'reconciled';
  notes: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface BankStatementLineTable {
  id: Generated<number>;
  tenant_id: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  statement_id: number;
  line_date: ColumnType<string, string | Date, string | Date>;
  description: string;
  reference: string | null;
  amount: number;
  is_reconciled: boolean;
  matched_journal_line_id: number | null;
  reconciled_at: Date | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

/**
 * قيدٌ محاسبي فشل ترحيله. صفٌّ هنا يعني: الفاتورة موجودة والدفتر ناقص، وأحدٌ ما يجب أن يعرف.
 * انظر الهجرة 147 و`accounting-recovery.service.ts`.
 */
export interface AccountingPostingFailureTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  source_type: string;
  source_id: number;
  error_message: ColumnType<string, string | undefined, string | undefined>;
  attempts: ColumnType<number, number | undefined, number | undefined>;
  first_failed_at: ColumnType<Date, Date | string | undefined, never>;
  last_attempt_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  resolved_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null | undefined>;
}

export interface AccountingSettingsTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: number;
  cash_account_id: number | null;
  bank_account_id: number | null;
  customer_receivable_account_id: number | null;
  supplier_payable_account_id: number | null;
  inventory_account_id: number | null;
  sales_revenue_account_id: number | null;
  sales_discount_account_id: number | null;
  cogs_account_id: number | null;
  purchase_account_id: number | null;
  expenses_account_id: number | null;
  sales_tax_account_id: number | null;
  purchase_tax_account_id: number | null;
  manufacturing_overhead_account_id: number | null;
  lock_date_all: ColumnType<string | null, string | Date | null | undefined, string | Date | null | undefined>;
  lock_date_non_adviser: ColumnType<string | null, string | Date | null | undefined, string | Date | null | undefined>;
  lock_date_tax: ColumnType<string | null, string | Date | null | undefined, string | Date | null | undefined>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface AuditLogTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  action: string;
  event_code?: string | null;
  details: string;
  target_tenant_id: string | null;
  created_by: number | null;
  /** Platform admin who performed this while impersonating `created_by`; null otherwise. */
  impersonated_by: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface BranchTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  name: string;
  code: ColumnType<string, string | undefined, string | undefined>;
  default_stock_location_id: number | null;
  sales_stock_mode: 'single_location' | 'all_operational_locations';
  allow_external_sales_stock: boolean;
  is_active: boolean;
}

export interface SaleLineStockAllocationTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  sale_id: number;
  sale_line_id: number;
  product_id: number;
  location_id: number;
  quantity: number;
  allocation_order: number;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface StockLocationTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  name: string;
  code: ColumnType<string, string | undefined, string | undefined>;
  branch_id: number | null;
  location_type: 'branch_stock' | 'internal_warehouse' | 'external_warehouse' | 'damaged' | 'in_transit';
  is_active: boolean;
}

export interface UserBranchTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  user_id: number;
  branch_id: number;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface ProductCategoryTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  name: string;
  is_active: boolean;
  kitchen_station?: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface SupplierTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  name: string;
  phone: string;
  address: string;
  balance: number;
  notes: ColumnType<string, string | undefined, string | undefined>;
  is_active: boolean;
  metadata: any | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface CustomerTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  name: string;
  phone: string;
  address: string;
  balance: number;
  customer_type: 'cash' | 'vip' | 'credit' | 'wholesale';
  credit_limit: number;
  store_credit_balance: number;
  company_name: string;
  tax_number: string;
  is_active: boolean;
  metadata: any | null;
  loyalty_points: ColumnType<number, number | undefined, number | undefined>;
  price_list_id?: number | null;
  is_credit_blocked?: boolean;
  credit_block_reason?: string | null;
  credit_blocked_at?: ColumnType<Date, string | Date | undefined, string | Date | undefined> | null;
  credit_blocked_by?: number | null;
  portal_pin_hash?: string | null;
  portal_pin_salt?: string | null;
  portal_token?: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ProductTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  name: string;
  name_en?: string | null;
  barcode: string | null;
  sku: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  category_id: number | null;
  supplier_id: number | null;
  item_type: ColumnType<'product' | 'raw_material' | 'service', 'product' | 'raw_material' | 'service' | undefined, 'product' | 'raw_material' | 'service' | undefined>;
  item_kind: ColumnType<'standard' | 'fashion', 'standard' | 'fashion' | undefined, 'standard' | 'fashion' | undefined>;
  style_code: string | null;
  color: string | null;
  size: string | null;
  bin_location: string | null;
  primary_bin_id?: number | null;
  default_location_id: number | null;
  cost_price: number;
  retail_price: number;
  wholesale_price: number;
  credit_price?: number | null;
  consumer_price?: number | null;
  min_selling_price?: number | null;
  stock_qty: number;
  reserved_qty: ColumnType<number, number | undefined, number | undefined>;
  min_stock_qty: number;
  notes: ColumnType<string, string | undefined, string | undefined>;
  is_active: boolean;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  catalog_updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  tax_code_type: string | null;
  tax_code: string | null;
  metadata: any | null;
  track_serials?: boolean | null;
  kitchen_station?: string | null;
  calories?: number | null;
  allergens?: unknown;
  is_spicy?: boolean | null;
  is_vegetarian?: boolean | null;
  is_gluten_free?: boolean | null;
}

export interface ProductSerialTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  product_id: number;
  serial_number: string;
  imei_2: string | null;
  status: 'in_stock' | 'sold' | 'returned' | 'in_repair' | 'scrapped';
  branch_id: number | null;
  location_id: number | null;
  cost_price: number;
  purchase_id: number | null;
  purchase_item_id: number | null;
  sale_id: number | null;
  sale_item_id: number | null;
  warranty_end_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaintenanceTicketTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  ticket_no: string;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  device_brand: string | null;
  device_model: string;
  serial_number: string | null;
  passcode: string | null;
  problem_description: string;
  device_condition: string | null;
  expected_cost: number;
  final_cost: number;
  advance_payment: number;
  status: 'received' | 'inspecting' | 'in_progress' | 'repaired' | 'delivered' | 'unrepairable' | 'cancelled';
  technician_id: number | null;
  technician_name: string | null;
  technician_notes: string | null;
  branch_id: number | null;
  location_id: number | null;
  sale_id: number | null;
  warranty_days: number;
  received_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  repaired_at: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  delivered_at: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaintenanceTicketPartTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  ticket_id: number;
  product_id: number;
  product_name: string;
  qty: number;
  unit_cost: number;
  unit_price: number;
  location_id: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface TradeInTransactionTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  doc_no: string;
  seller_name: string;
  seller_phone: string;
  seller_national_id: string;
  device_brand: string | null;
  device_model: string;
  serial_number: string;
  imei_2: string | null;
  device_condition_notes: string | null;
  agreed_purchase_price: number;
  transaction_type: 'cash_purchase' | 'exchange_trade_in';
  created_product_id: number | null;
  sale_id: number | null;
  payment_method: string;
  signature_data: string | null;
  branch_id: number | null;
  location_id: number | null;
  notes: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface StyleCodeCounterTable {
  tenant_id: string;
  scope: string;
  next_value: number;
}

export interface ProductUnitTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  product_id: number;
  name: string;
  multiplier: number;
  barcode: string | null;
  is_base_unit: boolean;
  is_sale_unit_default: boolean;
  is_purchase_unit_default: boolean;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ProductOfferTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  product_id: number;
  offer_type: 'percent' | 'fixed' | 'price' | 'bundle' | 'bogo';
  value: number;
  min_qty: ColumnType<number, number | undefined, number>;
  start_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  end_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  bogo_buy_qty?: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  bogo_get_qty?: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  bogo_discount_percent?: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  happy_hour_start?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  happy_hour_end?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  days_of_week?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  is_active: boolean;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ProductCustomerPriceTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  product_id: number;
  customer_id: number;
  price: number;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}



export interface ProductPricingProfileTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  product_id: number;
  pricing_group_key: string | null;
  pricing_mode: 'standard' | 'inherit' | 'manual';
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface PricingRuleTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  name: string;
  supplier_id: number | null;
  category_id: number | null;
  item_kind: 'standard' | 'fashion' | null;
  style_code: string | null;
  operation_type: 'percent_increase' | 'percent_decrease' | 'fixed_increase' | 'fixed_decrease' | 'set_price' | 'margin_from_cost';
  operation_value: number;
  targets_json: string;
  rounding_mode: 'none' | 'nearest' | 'ending';
  rounding_nearest_step: number | null;
  rounding_ending: number | null;
  options_json: string;
  notes: ColumnType<string, string | undefined, string | undefined>;
  is_active: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ProductLocationStockTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  product_id: number;
  branch_id: number | null;
  location_id: number | null;
  qty: number;
  reserved_qty: ColumnType<number, number | undefined, number | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface StockMovementTable {
  import_receipt_id: ColumnType<number | null, number | null | undefined, number | null>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  product_id: number | null;
  movement_type: string;
  qty: number;
  before_qty: number;
  after_qty: number;
  reason: string;
  note: string;
  reference_type: string | null;
  reference_id: number | null;
  created_by: number | null;
  branch_id: number | null;
  location_id: number | null;
  unit_cost: number | null;
  total_cost: number | null;
  serial_tracking?: ColumnType<any, any, any>;
  batch_tracking?: ColumnType<any, any, any>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface StockTransferTable {
  has_transit_variance?: boolean;
  transit_variance_journal_entry_id?: number | null;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  doc_no: string | null;
  from_location_id: number;
  to_location_id: number | null;
  from_branch_id: number | null;
  to_branch_id: number | null;
  status: 'sent' | 'received' | 'cancelled';
  note: string;
  recipient_name: string | null;
  created_by: number | null;
  received_by: number | null;
  cancelled_by: number | null;
  received_at: Date | null;
  cancelled_at: Date | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface StockTransferItemTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  transfer_id: number;
  product_id: number;
  product_name: string;
  qty: number;
  /** Transit loss tracking: received_qty may be less than dispatched_qty (shrinkage in transit). */
  dispatched_qty?: ColumnType<number, number | undefined, number | undefined>;
  received_qty?: ColumnType<number, number | undefined, number | undefined>;
  variance_qty?: ColumnType<number, number | undefined, number | undefined>;
  variance_reason?: string | null;
  /** Snapshotted serial movements for a transfer line, including in-transit and loss reconciliation. */
  serial_tracking?: ColumnType<any, any, any>;
  /** Batch allocations with source and in-transit lot IDs. */
  batch_tracking?: ColumnType<any, any, any>;
}

export interface StockCountSessionTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  doc_no: string;
  branch_id: number | null;
  location_id: number | null;
  status: 'draft' | 'posting' | 'posted';
  note: string;
  counted_by: number | null;
  approved_by: number | null;
  posted_at: Date | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface StockCountItemTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  session_id: number;
  product_id: number;
  product_name: string;
  expected_qty: number;
  counted_qty: number;
  variance_qty: number;
  counted_serials?: ColumnType<any, any, any>;
  batch_counts?: ColumnType<any, any, any>;
  reason: string;
  note: string;
  posted_at?: Date | null;
}

export interface DamagedStockRecordTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  product_id: number;
  branch_id: number | null;
  location_id: number | null;
  qty: number;
  reason: string;
  note: string;
  created_by: number | null;
  unit_cost: number | null;
  total_cost: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface DeliveryRepresentativeTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  name: string;
  phone: string | null;
  full_name: string | null;
  national_id: string | null;
  address: string | null;
  vehicle_plate: string | null;
  pin_hash?: string | null;
  pin_salt?: string | null;
  rep_type?: 'freelance' | 'store_fleet' | 'delivery' | 'van' | 'both' | string | null;
  is_van_rep?: boolean;
  van_location_id?: number | null;
  is_active: boolean;
  employee_id?: number | null;
  permissions?: ColumnType<Record<string, any>, string | Record<string, any> | undefined, string | Record<string, any> | undefined>;
  metadata?: ColumnType<Record<string, any>, string | Record<string, any> | undefined, string | Record<string, any> | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface FleetVehicleTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  plate_number: string;
  model_name?: string | null;
  vehicle_type?: string;
  vin_chassis?: string | null;
  van_location_id?: number | null;
  branch_id?: number | null;
  current_odometer?: number;
  fuel_type?: string | null;
  license_expires_at?: string | null;
  status?: string;
  assigned_rep_id?: number | null;
  notes?: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface VanSalesTripTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  rep_id: number;
  vehicle_id?: number | null;
  shift_name?: string | null;
  van_location_id: number;
  source_warehouse_id: number;
  status: 'open' | 'settled' | string;
  opened_at: ColumnType<Date, string | undefined, never>;
  closed_at?: Date | null;
  start_odometer?: number | null;
  end_odometer?: number | null;
  loaded_amount?: number;
  sales_amount?: number;
  cash_collected?: number;
  credit_sales?: number;
  returns_amount?: number;
  cash_refunds?: number;
  variance?: number;
  settlement_status?: 'open' | 'submitted_by_rep' | 'settled' | string;
  submitted_at?: Date | null;
  supervisor_id?: number | null;
  settled_by?: number | null;
  stock_variance_amount?: number;
  stock_variance_details?: any | null;
  night_stock_approved?: boolean;
  night_stock_approved_by?: number | null;
  night_stock_notes?: string | null;
  distance_km?: number | null;
  total_instapay_sales?: number;
  total_instapay_collections?: number;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface VanFieldReturnTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  doc_no: string;
  trip_id: number;
  rep_id: number;
  customer_id: number;
  sale_id?: number | null;
  status: 'pending_approval' | 'approved' | 'rejected' | string;
  return_reason: 'damaged' | 'expired' | 'manufacturing_defect' | 'stagnant' | 'order_mismatch' | 'customer_request' | string;
  refund_method?: 'credit' | 'cash' | string;
  total_amount: number;
  items_json: ColumnType<string | any, string | any, string | any>;
  notes?: string | null;
  rejection_reason?: string | null;
  approved_by?: number | null;
  approved_at?: Date | string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface VanTripExpenseTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  trip_id: number;
  expense_type: string;
  amount: number;
  notes?: string | null;
  receipt_photo_url?: string | null;
  created_by_user_id?: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface VanTripPackagingMovementTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  trip_id: number;
  customer_id?: number | null;
  package_type: string;
  delivered_qty: number;
  returned_qty: number;
  notes?: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface DeliveryRepTargetTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  rep_id: number;
  period_month: string;
  target_amount: number;
  collection_target?: number | null;
  visits_target?: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface VanRepFinancialSettlementTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  rep_id: number;
  trip_id?: number | null;
  entry_type: 'cash_shortage' | 'stock_shortage' | 'cash_overage' | 'commission' | 'bonus' | 'cash_reimbursement' | 'waiver' | 'payroll_deduction' | string;
  amount: number;
  status: 'pending' | 'settled' | 'waived' | 'pushed_to_payroll' | string;
  settled_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  settled_by?: number | null;
  settlement_method?: 'cash' | 'payroll' | 'waiver' | string | null;
  notes?: string | null;
  receipt_voucher_no?: string | null;
  payroll_run_id?: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface VanLoadRequisitionTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  doc_no: string;
  rep_id: number;
  source_warehouse_id: number;
  status: 'pending' | 'approved' | 'rejected' | 'dispatched' | string;
  requested_items: ColumnType<string | any, string | any, string | any>;
  approved_items?: ColumnType<string | any | null, string | any | null, string | any | null>;
  notes?: string | null;
  rejection_reason?: string | null;
  reviewed_by?: number | null;
  reviewed_at?: Date | string | null;
  trip_id?: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface SalesTable {
  exchange_return_id?: number | null;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  table_number: string;
  order_type: string;
  doc_no: string | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  payment_type: 'cash' | 'credit';
  payment_channel: 'cash' | 'card' | 'wallet' | 'instapay' | 'mixed' | 'credit';
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  delivery_fee: number;
  delivery_fee_mode?: 'freelance_courier' | 'store_fleet' | string | null;
  prices_include_tax: boolean;
  total: number;
  paid_amount: number;
  applied_amount?: number;
  tendered_amount: number;
  change_amount: number;
  store_credit_used: number;
  status: string;
  note: string;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  cancelled_at: Date | null;
  cancelled_by: number | null;
  cancel_reason: string;
  delivery_rep_id: number | null;
  delivery_status: 'pending' | 'out_for_delivery' | 'delivered' | 'settled' | null;
  collection_status: 'cod' | 'prepaid_by_rep' | 'prepaid_online' | null;
  settled_at: Date | null;
  settled_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  eta_uuid: string | null;
  eta_status: Generated<string>;
  eta_submission_id: string | null;
  zatca_uuid?: string | null;
  zatca_hash?: string | null;
  zatca_prev_hash?: string | null;
  zatca_icv?: ColumnType<number, number | string | undefined, number | string | undefined>;
  zatca_status?: ColumnType<string, string | undefined, string | undefined>;
  zatca_qr?: string | null;
  zatca_ubl_xml?: string | null;
  zatca_cleared_xml?: string | null;
  zatca_submitted_at?: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  zatca_response_json?: ColumnType<any, any | undefined, any | undefined>;
  zatca_egs_id?: number | null;
  zatca_invoice_type?: string | null;
  is_credit_overridden?: boolean;
  credit_override_by_user_id?: number | null;
  credit_override_reason?: string | null;
  dining_course?: string | null;
  aggregator_channel?: string | null;
  aggregator_order_id?: string | null;
  terminal_id?: string | null;
  terminal_auth_code?: string | null;
  terminal_rrn?: string | null;
  card_scheme?: string | null;
  card_last_four?: string | null;
  pager_number?: string | null;
  service_charge?: number | null;
  tip_amount?: number | null;
  guest_count?: number | null;
  guest_check_printed_at?: ColumnType<Date, string | Date | undefined, string | Date | undefined> | null;
  dispatched_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  delivered_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  driver_cash_settled?: boolean;
  sale_origin?: string | null;
  van_trip_id?: number | null;
  transfer_reference?: string | null;
  transfer_receipt_url?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  recipient_role?: string | null;
  recipient_signature?: string | null;
}

export interface SaleItemTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  sale_id: number;
  product_id: number | null;
  product_name: string;
  product_name_en?: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
  unit_name: string;
  unit_multiplier: number;
  cost_price: number;
  net_unit_price?: number | null;
  net_line_total?: number | null;
  allocated_discount?: number | null;
  allocated_tax?: number | null;
  price_type: 'retail' | 'wholesale';
  consumer_price?: number | null;
  pricing_tier_type?: 'cash' | 'credit' | 'offer' | string | null;
  unit_offer_savings?: number | null;
  is_bonus?: boolean;
  bonus_reason?: string | null;
  notes: ColumnType<string, string | undefined, string | undefined>;
  modifiers: ColumnType<unknown, unknown | undefined, unknown | undefined>;
  serials?: any;
}

export interface SalePaymentTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  sale_id: number;
  payment_channel: 'cash' | 'card' | 'wallet' | 'instapay';
  amount: number;
  applied_amount?: number;
  tendered_amount?: number;
  change_amount?: number;
  terminal_id?: string | null;
  card_auth_code?: string | null;
  card_rrn?: string | null;
  card_scheme?: string | null;
  card_last_four?: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface HeldSaleTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  table_number: string;
  order_type: string;
  customer_id: number | null;
  payment_type: 'cash' | 'credit';
  payment_channel: 'cash' | 'card' | 'wallet' | 'instapay' | 'mixed' | 'credit';
  paid_amount: number;
  cash_amount: number;
  card_amount: number;
  discount: number;
  delivery_fee: number;
  note: string;
  search: string;
  price_type: 'retail' | 'wholesale';
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  delivery_rep_id: number | null;
  collection_status: 'cod' | 'prepaid_by_rep' | 'prepaid_online' | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  paid_online?: boolean;
  paid_online_amount?: number;
  paid_online_ref?: string | null;
}

export interface HeldSaleItemTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  held_sale_id: number;
  product_id: number | null;
  product_name: string;
  qty: number;
  unit_price: number;
  unit_name: string;
  unit_multiplier: number;
  price_type: 'retail' | 'wholesale';
  notes?: string;
  modifiers: ColumnType<unknown, unknown | undefined, unknown | undefined>;
  serials?: any;
  created_at: ColumnType<Date, string | undefined, never>;
}


export interface ExpenseTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  title: string;
  amount: number;
  cost_center_id?: number | null;
  expense_date: ColumnType<Date, string | undefined, string | undefined>;
  note: string;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface ReturnDocumentTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  doc_no: string | null;
  return_type: 'sale' | 'purchase';
  invoice_id: number | null;
  settlement_mode: string;
  refund_method: string;
  refund_allocations?: ColumnType<unknown | null, unknown | null | undefined, unknown | null | undefined>;
  exchange_sale_id: number | null;
  total: number;
  note: string;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  eta_uuid: string | null;
  eta_status: Generated<string>;
  eta_submission_id: string | null;
}

export interface ReturnItemTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  return_document_id: number;
  product_id: number | null;
  product_name: string;
  qty: number;
  unit_total: number;
  line_total: number;
  allocated_tax?: number | null;
  cost_price?: number | null;
  sale_item_id: number | null;
  purchase_item_id: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface TreasuryTransactionTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  txn_type: string;
  amount: number;
  request_key?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  payment_channel?: 'cash'|'bank'|'card'|'wallet'|'instapay';
  note: string;
  reference_type: string | null;
  reference_id: number | null;
  return_document_id: number | null;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface TreasuryTransferTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  from_account_id: number;
  to_account_id: number;
  amount: number;
  note: string;
  request_key: string;
  journal_entry_id: number | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface CashierShiftTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  doc_no?: string | null;
  opened_by: number;
  opening_cash?: number | null;
  opening_note?: string | null;
  status: string;
  expected_cash: number | null;
  counted_cash: number | null;
  variance?: number | null;
  variance_resolution?: string | null;
  variance_journal_entry_id?: number | null;
  variance_charged_to_user_id?: number | null;
  variance_approved_by?: number | null;
  variance_approved_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  close_note?: string | null;
  branch_id: number | null;
  location_id: number | null;
  closed_at: Date | null;
  closed_by: number | null;
  created_at?: ColumnType<Date, string | undefined, never>;
}

export interface PosAuditEventTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  event_type: string;
  user_id: number | null;
  sale_id: number | null;
  product_id: number | null;
  amount: number;
  reason: string;
  metadata: ColumnType<unknown, unknown | undefined, unknown | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface ServicesTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  name: string;
  amount: number;
  notes: string;
  service_date: ColumnType<Date, string | undefined, string | undefined>;
  payment_channel: string;
  branch_id: number | null;
  location_id: number | null;
  revision: number;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface CustomerPaymentTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  customer_id: number;
  amount: number;
  payment_channel?: ColumnType<'cash'|'bank'|'card'|'wallet'|'instapay', 'cash'|'bank'|'card'|'wallet'|'instapay'|undefined, 'cash'|'bank'|'card'|'wallet'|'instapay'|undefined>;
  note: string;
  branch_id: number | null;
  location_id: number | null;
  job_id?: number | null;
  created_by: number | null;
  transfer_reference?: string | null;
  transfer_receipt_url?: string | null;
  van_trip_id?: number | null;
  rep_id?: number | null;
  client_tx_id?: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface CustomerLedgerTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  customer_id: number;
  entry_type: string;
  amount: number;
  balance_after: number;
  note: string;
  reference_type: string | null;
  reference_id: number | null;
  return_document_id: number | null;
  branch_id: number | null;
  location_id: number | null;
  van_trip_id?: number | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
}


export interface PriceChangeRunTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  filters_json: string;
  operation_json: string;
  options_json: string;
  summary_json: string;
  affected_count: number;
  status: string;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  undone_at: ColumnType<Date | null, string | undefined, string | undefined>;
  undone_by: number | null;
}

export interface PriceChangeItemTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  run_id: number;
  product_id: number;
  old_retail_price: number;
  new_retail_price: number;
  old_wholesale_price: number;
  new_wholesale_price: number;
  has_active_offer: boolean;
  has_customer_price: boolean;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface PartnerContactTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  partner_type: string;
  partner_id: number;
  name: string;
  phone: ColumnType<string, string | undefined, string | undefined>;
  email: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface PartnerAddressTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  partner_type: string;
  partner_id: number;
  label: string;
  city: ColumnType<string, string | undefined, string | undefined>;
  address_line: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface CostCenterTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id?: ColumnType<string, string | undefined, string | undefined>;
  code: ColumnType<string, string | undefined, string | undefined>;
  name: string;
  dimension?: ColumnType<string, string | undefined, string | undefined>;
  budget_amount?: ColumnType<number, number | undefined, number | undefined>;
  parent_id?: number | null;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  description?: string | null;
  created_at?: ColumnType<Date, string | undefined, never>;
  updated_at?: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface CrmDealTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  title: string;
  stage: ColumnType<string, string | undefined, string | undefined>;
  expected_amount: ColumnType<number, number | undefined, number | undefined>;
  currency: ColumnType<string, string | undefined, string | undefined>;
  probability: ColumnType<number, number | undefined, number | undefined>;
  expected_close_date?: ColumnType<Date | string | null, string | null | undefined, string | null | undefined>;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  company_name?: string | null;
  source: ColumnType<string, string | undefined, string | undefined>;
  priority: ColumnType<string, string | undefined, string | undefined>;
  assigned_user_id?: number | null;
  customer_id?: number | null;
  lost_reason?: string | null;
  notes?: string | null;
  created_by?: number | null;
  created_at?: ColumnType<Date, string | undefined, never>;
  updated_at?: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface CrmActivityTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  deal_id: number;
  activity_type: ColumnType<string, string | undefined, string | undefined>;
  summary: string;
  due_date?: ColumnType<Date | string | null, string | null | undefined, string | null | undefined>;
  is_completed: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  created_by?: number | null;
  created_at?: ColumnType<Date, string | undefined, never>;
}

export interface AddonTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  name: string;
  price: number;
  cost_price: number;
  is_active: boolean;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface ProjectTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  code: ColumnType<string, string | undefined, string | undefined>;
  name: string;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ManufacturingBomTable {
  id: Generated<number>;
  product_id: number;
  quantity: number;
  overhead_cost: number;
  expected_cost: number;
  is_active: boolean;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
}

export interface ManufacturingBomLineTable {
  id: Generated<number>;
  bom_id: number;
  component_product_id: number;
  quantity: number;
  unit_name: string;
  unit_multiplier: number;
  waste_percentage: number;
  expected_cost: number;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ManufacturingWorkOrderTable {
  id: Generated<number>;
  doc_no: string | null;
  bom_id: number;
  status: 'draft' | 'in_progress' | 'done' | 'cancelled';
  quantity_to_produce: number;
  produced_quantity: number;
  source_location_id: number | null;
  destination_location_id: number | null;
  start_date: ColumnType<Date | null, string | null | undefined, string | null | undefined>;
  end_date: ColumnType<Date | null, string | null | undefined, string | null | undefined>;
  total_cost: number;
  completed_at: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  note: string;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
}

export interface ManufacturingWoConsumptionTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  work_order_id: number;
  component_product_id: number;
  quantity_consumed: number;
  unit_cost: number;
  line_total: number;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface ManufacturingWorkCenterTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  code: string;
  name: string;
  cost_per_hour: number;
  capacity: number;
  time_efficiency: number;
  status: string;
  notes: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ManufacturingWoOperationTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  work_order_id: number;
  work_center_id: number;
  operation_name: string;
  sequence: number;
  duration_hours: number;
  hourly_cost: number;
  total_cost: number;
  status: string;
  notes: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface PurchaseAttachmentTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  purchase_id: number;
  file_name: string;
  file_url: string;
  file_size: number;
  file_type: string;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface PurchaseTable {
  id: Generated<number>;
  doc_no: string | null;
  supplier_id: number | null;
  payment_type: 'cash' | 'credit';
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  prices_include_tax: boolean;
  total: number;
  paid_amount?: ColumnType<number, number | undefined, number | undefined>;
  note: string;
  status: string;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  cancelled_at: Date | null;
  cancelled_by: number | null;
  cancel_reason: ColumnType<string, string | undefined, string | undefined>;
  required_date: Date | null;
  currency: ColumnType<string, string | undefined, string | undefined>;
  company_name: ColumnType<string, string | undefined, string | undefined>;
  contact_id: number | null;
  shipping_address_id: number | null;
  cost_center_id: number | null;
  project_id: number | null;
  /** Explicit architectural foreign key to import_projects(id) UUID; leaves project_id for legacy/contracting. */
  import_project_id?: string | null;
  terms_template: ColumnType<string, string | undefined, string | undefined>;
  lifecycle_status?: ColumnType<string, string | undefined, string | undefined>;
  matched_status?: ColumnType<string, string | undefined, string | undefined>;
  landed_cost_total?: number | null;
  landed_cost_allocation_method?: 'value' | 'qty' | 'equal' | null;
  landed_cost_notes?: string | null;
  landed_cost_applied_at?: Date | null;
  /** Link back to the originating purchase order; required for the price leg of three-way match. */
  po_id?: number | null;
  grn_id?: number | null;
  three_way_match_status?: string;
  supplier_invoice_no?: string | null;
  duplicate_override_reason?: string | null;
  duplicate_overridden_by?: number | null;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface PurchaseItemTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  purchase_id: number;
  po_item_id?: number | null;
  grn_line_id?: number | null;
  grni_amount?: number | null;
  product_id: number | null;
  product_name: string;
  qty: number;
  unit_cost: number;
  line_total: number;
  unit_name: string;
  unit_multiplier: number;
  allocated_landed_cost?: number | null;
  landed_unit_cost?: number | null;
  received_qty?: ColumnType<number, number | undefined, number | undefined>;
  category_id: number | null;
  location_id: number | null;
  serials?: any;
  batch_number?: string | null;
}

export interface GoodsReceiptNoteTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  doc_no: string;
  purchase_order_id: number | null;
  supplier_id: number;
  location_id: number;
  received_at: ColumnType<Date, Date | string | undefined, Date | string>;
  received_by: number | null;
  inspected_by: number | null;
  supplier_delivery_note_ref: string | null;
  status: string;
  grni_journal_entry_id: number | null;
  notes: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface GoodsReceiptLineTable {
  id: Generated<number>;
  tenant_id: string;
  grn_id: number;
  purchase_order_item_id: number | null;
  product_id: number;
  ordered_qty: number | string;
  received_qty: number | string;
  accepted_qty: number | string;
  rejected_qty: number | string;
  rejection_reason: string | null;
  batch_number: string | null;
  expiry_date: Date | string | null;
  manufacturing_date: Date | string | null;
  unit_cost: number | string;
  quarantine_location_id: number | null;
  coa_document_id: number | null;
  notes: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface PurchaseThreeWayMatchTable {
  id: Generated<number>;
  tenant_id: string;
  purchase_id: number;
  purchase_order_id: number | null;
  grn_id: number | null;
  match_status: string;
  price_variance_amount: number | string;
  qty_variance_amount: number | string;
  tolerance_percentage: number | string;
  is_service_item: boolean;
  service_completion_ref: string | null;
  override_approved_by: number | null;
  override_reason: string | null;
  override_scope: string | null;
  blocking_codes: string[] | null;
  reconciliation_discrepancy: number | string;
  ppv_journal_entry_id: ColumnType<number | null, number | null | undefined, number | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface PurchaseLandedCostTable {
  id: Generated<number>;
  tenant_id: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  purchase_id: number;
  cost_type: 'freight' | 'customs' | 'handling' | 'insurance' | 'other';
  description: string;
  amount: number;
  vendor_id?: number | null;
  allocation_method: 'value' | 'qty' | 'equal';
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface SupplierPaymentTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  doc_no: string | null;
  supplier_id: number;
  amount: number;
  payment_channel?: 'cash'|'bank'|'card'|'wallet'|'instapay';
  note: string;
  branch_id: number | null;
  location_id: number | null;
  payment_date: ColumnType<Date, string | undefined, string | undefined>;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  currency?: ColumnType<string, string | undefined, string | undefined>;
  exchange_rate?: ColumnType<number, number | undefined, number | undefined>;
  forex_variance_egp?: ColumnType<number, number | undefined, number | undefined>;
  proforma_invoice_id?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  idempotency_key?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  /** Original currency amount; amount is always base currency EGP. */
  amount_foreign?: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  /** Closed payment method (import-payment-method.engine) + its evidence. NULL on legacy rows: method unrecorded, never backfilled. */
  payment_method?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  payment_reference?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  bank_swift_code?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  form4_number?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  form4_date?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  evidence_carrier_name?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  evidence_travel_date?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  evidence_handover_receipt?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  evidence_lc_number?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  evidence_lc_issuing_bank?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  evidence_lc_expiry?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  evidence_lc_documents?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  evidence_cad_proof?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  evidence_payment_terms?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  evidence_payment_due_date?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
}

export interface SupplierPaymentScheduleTable {
  id: Generated<number>;
  purchase_id: number | null;
  supplier_id: number;
  installment_no: number;
  due_date: ColumnType<string, string | undefined, string | undefined>;
  amount: number;
  paid_amount: number;
  status: string;
  note: string;
  paid_at: Date | null;
  created_by: number | null;
  updated_by: number | null;
  tenant_id: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  account_id: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface SupplierPaymentScheduleLogTable {
  id: Generated<number>;
  schedule_id: number;
  supplier_id: number;
  amount: number;
  payment_channel?: 'cash'|'bank'|'card'|'wallet'|'instapay';
  note: string;
  created_by: number | null;
  created_by_name: string;
  tenant_id: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  account_id: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface SupplierLedgerTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  supplier_id: number;
  entry_type: string;
  amount: number;
  balance_after: number;
  note: string;
  reference_type: string | null;
  reference_id: number | null;
  return_document_id: number | null;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface HrDepartmentTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  name: string;
  code: ColumnType<string, string | undefined, string | undefined>;
  description: string;
  is_active: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrJobTitleTable extends HrDepartmentTable {}

export interface HrPositionTable extends HrDepartmentTable {
  department_id: number | null;
  job_title_id: number | null;
  branch_id: number | null;
  location_id: number | null;
}

export interface HrEmployeeTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_no: string;
  pin_hash?: string | null;
  pin_salt?: string | null;
  national_id: string | null;
  user_id: number | null;
  first_name: string;
  last_name: string;
  display_name: string;
  status: 'active' | 'inactive' | 'deactivated' | 'terminated';
  department_id: number | null;
  job_title_id: number | null;
  position_id: number | null;
  branch_id: number | null;
  location_id: number | null;
  hire_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  compensation_type: 'monthly' | 'hourly';
  pay_frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  hourly_rate: number | null;
  expected_daily_hours: number | null;
  scheduled_check_in_time: string | null;
  scheduled_check_out_time: string | null;
  grace_minutes: number;
  overtime_policy: 'review_only' | 'disabled' | 'auto_approved';
  attendance_policy: 'strict' | 'flexible';
  commission_type: string;
  commission_value: number | null;
  commission_target: number | null;
  delay_policy: string;
  has_social_insurance: boolean;
  insurance_salary: number | null;
  has_income_tax: boolean;
  end_of_service_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  end_of_service_reason: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  iban?: string | null;
  bank_swift_code?: string | null;
  notes: ColumnType<string, string | undefined, string | undefined>;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrEmployeeContactTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  contact_type: string;
  value: string;
  label: string;
  is_primary: boolean;
  notes: ColumnType<string, string | undefined, string | undefined>;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrEmployeeDocumentTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  title: string;
  document_type: string;
  file_url: string;
  expiry_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  notes: ColumnType<string, string | undefined, string | undefined>;
  uploaded_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrEmploymentContractTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  contract_no: string;
  contract_type: string;
  status: 'draft' | 'active' | 'ended' | 'cancelled';
  start_date: ColumnType<string, string | undefined, string | undefined>;
  end_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  base_salary: number;
  currency: string;
  notes: ColumnType<string, string | undefined, string | undefined>;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrCompensationPackageTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  contract_id: number | null;
  package_name: string;
  allowance_amount: number;
  deduction_amount: number;
  effective_from: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  effective_to: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  notes: ColumnType<string, string | undefined, string | undefined>;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrEmployeeLoanTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  loan_no: string;
  loan_type: 'advance' | 'loan';
  principal_amount: number;
  paid_amount: number;
  remaining_amount: number;
  installment_count: number;
  installment_amount: number;
  repayment_mode: 'deduct_next_salary' | 'monthly_salary_installment' | 'manual_cash';
  monthly_installment_amount: number | null;
  salary_due_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  status: 'draft' | 'approved' | 'paid' | 'partially_repaid' | 'repaid' | 'cancelled';
  issue_date: ColumnType<string, string | undefined, string | undefined>;
  first_due_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  branch_id: number | null;
  location_id: number | null;
  notes: ColumnType<string, string | undefined, string | undefined>;
  approved_by: number | null;
  approved_at: Date | null;
  disbursed_by: number | null;
  disbursed_at: Date | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrEmployeeLoanInstallmentTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  loan_id: number;
  installment_no: number;
  due_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  amount: number;
  paid_amount: number;
  status: 'pending' | 'partial' | 'paid' | 'cancelled';
  paid_at: Date | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrEmployeeLedgerTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  entry_type: string;
  amount: number;
  balance_after: number;
  note: string;
  repayment_method: string | null;
  reference_type: string | null;
  reference_id: number | null;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface HrAttendanceRecordTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  work_date: ColumnType<string, string | undefined, string | undefined>;
  status: 'present' | 'absent' | 'late' | 'half_day' | 'leave' | 'excused' | 'early_leave';
  check_in_at: Date | null;
  check_out_at: Date | null;
  source: 'manual' | 'import';
  notes: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrAttendanceExceptionTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  attendance_record_id: number | null;
  work_date: ColumnType<string, string | undefined, string | undefined>;
  exception_type: 'early_check_in' | 'late_check_in' | 'early_check_out' | 'late_check_out' | 'missing_check_in' | 'missing_check_out';
  scheduled_time: string | null;
  actual_time: string | null;
  duration_minutes: number;
  status: 'pending' | 'approved' | 'skipped' | 'auto_calculated' | 'needs_review';
  approved_duration_minutes: number | null;
  note: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrLeaveTypeTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  name: string;
  code: string | null;
  description: string | null;
  is_paid: boolean;
  is_active: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrLeaveRequestTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  leave_type_id: number | null;
  leave_type: string | null;
  start_date: ColumnType<string, string | undefined, string | undefined>;
  end_date: ColumnType<string, string | undefined, string | undefined>;
  days_count: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string | null;
  notes: string | null;
  decision_notes: string | null;
  decided_by: number | null;
  decided_at: Date | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrEmployeeAssetTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  asset_type: string;
  asset_name: string;
  asset_code: string | null;
  serial_no: string | null;
  assigned_at: ColumnType<string, string | undefined, string | undefined>;
  returned_at: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  status: 'assigned' | 'returned' | 'lost' | 'damaged' | 'cancelled';
  notes: string | null;
  return_notes: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrPayrollRunTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  period_month: string;
  start_date: ColumnType<string | Date, string | Date | undefined, string | Date | undefined>;
  end_date: ColumnType<string | Date, string | Date | undefined, string | Date | undefined>;
  pay_frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  status: 'draft' | 'reviewed' | 'approved' | 'paid' | 'cancelled';
  notes: ColumnType<string, string | undefined, string | undefined>;
  created_by: number | null;
  reviewed_by: number | null;
  approved_by: number | null;
  paid_by: number | null;
  payment_channel: string | null;
  payment_reference: string | null;
  payment_notes: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  reviewed_at: Date | null;
  approved_at: Date | null;
  paid_at: Date | null;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrPayrollRunItemTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  run_id: number;
  employee_id: number;
  contract_id: number | null;
  base_salary: number;
  allowance_amount: number;
  deduction_amount: number;
  loan_deduction_amount: number;
  asset_recovery_deduction_amount: number;
  gross_pay: number;
  net_pay: number;
  status: 'draft' | 'reviewed' | 'approved' | 'excluded' | 'paid';
  notes: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrPayrollItemAdjustmentTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  payroll_item_id: number;
  adjustment_type: 'allowance' | 'deduction';
  label: string;
  amount: number;
  notes: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface HrSettingsTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  key: string;
  value: string;
  updated_by: number | null;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrHolidayTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  name: string;
  start_date: ColumnType<Date, string | Date, string | Date>;
  end_date: ColumnType<Date, string | Date, string | Date>;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}


export interface SaasPlanTable {
  id: Generated<number>;
  code: string;
  name: string;
  price: number;
  price_monthly: number | null;
  currency: string;
  billing_period_months: number;
  max_users: number | null;
  max_branches: number | null;
  feature_plan_id: string | null;
  pricing_band: number | null;
  pricing_level: number | null;
  is_active: boolean;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface IndustryProductTable {
  preset_id: string;
  commercial_name: string;
  band: number;
  has_pos: boolean;
  sell_offline: boolean;
  sector_feature_code: string | null;
  industry_profile_key: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface TenantSubscriptionTable {
  id: Generated<number>;
  tenant_id: string;
  plan_id: number;
  status: 'active' | 'past_due' | 'expired' | 'cancelled';
  starts_at: Date;
  ends_at: Date;
  grace_ends_at: Date | null;
  auto_renew: boolean;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface TenantSubscriptionPaymentTable {
  id: Generated<number>;
  tenant_id: string;
  subscription_id: number;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  paid_at: Date;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface DailyFinancialSummariesTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  summary_date: ColumnType<Date, string | Date, string | Date>;
  branch_id: number | null;
  location_id: number | null;
  sales_count: number;
  sales_total: number;
  sales_discount: number;
  cogs_total: number;
  returns_count: number;
  sales_returns_total: number;
  purchases_count: number;
  purchases_total: number;
  purchase_returns_total: number;
  expenses_count: number;
  expenses_total: number;
  services_count: number;
  services_total: number;
  gross_profit: number;
  net_profit: number;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | undefined, Date | string>;
}


export interface ImportProjectTable {
  id: Generated<string>;
  tenant_id: string;
  project_no: string;
  title: string;
  target_market: string | null;
  country_origin: string | null;
  country_destination: string | null;
  budget_currency: string | null;
  allocated_capital: ImportNumeric;
  target_roi_percentage: ImportNumeric;
  status: string;
  feasibility_data: any | null;
  closure_data?: any | null;
  closure_date?: Date | null;
  closed_by?: number | null;
  feasibility_converted_at?: Date | null;
  cash_flow_schedule?: any | null;
  initial_po_id?: string | null;
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ImportPartnerTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  phone?: string | null;
  capital_amount: ImportNumeric;
  profit_share_percentage: ImportNumeric;
  withdrawn_profit: ImportNumeric;
  partner_role?: string | null;
  total_contributed_capital?: ImportNumeric;
  total_withdrawn_capital?: ImportNumeric;
  total_approved_profits?: ImportNumeric;
  total_disbursed_profits?: ImportNumeric;
  created_at: Generated<Date>;
}

export interface ImportPartnerLedgerTable {
  id: Generated<string>;
  tenant_id: string;
  partner_id: string;
  type: string;
  amount: ImportNumeric;
  transaction_date: ImportDate;
  note?: string | null;
  created_by?: number | null;
  created_at: Generated<Date>;
  idempotency_key: string | null;
}

export interface ImportProjectPartnerTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  partner_id: string;
  capital_share_amount: ImportNumeric;
  profit_percentage: ImportNumeric;
  effective_from?: ImportDate;
  is_active?: boolean;
  notes?: string | null;
  created_at: Generated<Date>;
}

export interface ImportSupplierMetaTable {
  id: Generated<string>;
  tenant_id: string;
  supplier_id: number;
  chinese_name: string | null;
  city: string | null;
  province: string | null;
  moq_description: string | null;
  production_lead_time_days: number | null;
  verified_bank_details: any | null;
  incoterms_accepted: any | null;
  qc_rating: ImportNumeric;
  quality_certifications: any | null;
  audit_status: string;
  verified_at?: Date | null;
  verified_by?: number | null;
  verification_notes?: string | null;
  notes: string | null;
  updated_at: Generated<Date>;
}

export interface ImportSourcingTripTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string | null;
  trip_title: string;
  destination_city: string;
  start_date: ImportDate;
  end_date: ImportDate;
  budget_egp: ImportNumeric;
  actual_cost_egp: ImportNumeric;
  notes: string | null;
  findings: any | null;
  created_at: Generated<Date>;
}

export interface ImportProformaInvoiceTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string | null;
  supplier_id: number;
  pi_number: string;
  pi_date: ImportDate;
  currency: string;
  total_amount_foreign: ImportNumeric;
  incoterm: string | null;
  delivery_port: string | null;
  payment_terms: string | null;
  exchange_rate_contract: ImportNumeric;
  status: string;
  payment_status?: string;
  paid_amount_foreign?: ImportNumeric;
  po_number?: string | null;
  po_date?: ImportDate;
  po_status?: string | null;
  advance_percentage?: ImportNumeric;
  balance_percentage?: ImportNumeric;
  payment_milestones?: any | null;
  approved_by?: number | null;
  approved_at?: Date | null;
  notes: string | null;
  items: any | null;
  created_at: Generated<Date>;
}

export interface ImportQcInspectionTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string | null;
  shipment_id: string | null;
  stage: string;
  inspection_date: ImportDate;
  inspector_name: string | null;
  sample_size: number | null;
  passed_quantity: number | null;
  failed_quantity: number | null;
  defect_notes: string | null;
  status: string;
  report_file_url: string | null;
  created_at: Generated<Date>;
}

export interface ImportAciComplianceTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string | null;
  shipment_id: string | null;
  acid_number: string;
  acid_issue_date: ImportDate;
  acid_expiry_date: ImportDate;
  cargox_document_id: string | null;
  importer_tax_number: string | null;
  exporter_id: string | null;
  status: string;
  compliance_checklist: any | null;
  notes: string | null;
  created_at: Generated<Date>;
}

export interface ImportCustomsTariffTable {
  id: Generated<string>;
  tenant_id: string;
  hs_code: string;
  description_ar: string;
  description_en: string | null;
  duty_rate_percent: ImportNumeric;
  vat_rate_percent: ImportNumeric;
  regulatory_body: string | null;
  inspection_fees_percent: ImportNumeric;
  official_source?: string | null;
  effective_date?: ImportDate;
  is_official?: boolean;
  sector?: string | null;
  category_ar?: string | null;
  created_at: Generated<Date>;
}

export interface Database {
  daily_financial_summaries: DailyFinancialSummariesTable;
  saas_plans: SaasPlanTable;
  industry_products: IndustryProductTable;
  tenant_subscriptions: TenantSubscriptionTable;
  tenant_subscription_payments: TenantSubscriptionPaymentTable;
  _phase1_bootstrap: Phase1BootstrapTable;
  operation_executions: OperationExecutionTable;
  marketplace_webhook_events: MarketplaceWebhookEventTable;
  sessions: SessionTable;
  users: UserTable;
  tenants: TenantTable;
  password_reset_tokens: PasswordResetTokenTable;
  user_mfa: UserMfaTable;
  trial_signups: TrialSignupTable;
  settings: SettingTable;
  accounting_accounts: AccountingAccountTable;
  journal_entries: JournalEntryTable;
  journal_entry_lines: JournalEntryLineTable;
  bank_statements: BankStatementTable;
  bank_statement_lines: BankStatementLineTable;
  accounting_cheques: AccountingChequeTable;
  accounting_fiscal_years: AccountingFiscalYearTable;
  accounting_fiscal_periods: AccountingFiscalPeriodTable;
  withholding_tax_transactions: WithholdingTaxTransactionTable;
  cost_centers: CostCenterTable;
  crm_deals: CrmDealTable;
  crm_activities: CrmActivityTable;
  accounting_settings: AccountingSettingsTable;
  accounting_posting_failures: AccountingPostingFailureTable;
  audit_logs: AuditLogTable;
  branches: BranchTable;
  stock_locations: StockLocationTable;
  user_branches: UserBranchTable;
  product_categories: ProductCategoryTable;
  suppliers: SupplierTable;
  customers: CustomerTable;
  products: ProductTable;
  product_serials: ProductSerialTable;
  product_units: ProductUnitTable;
  product_offers: ProductOfferTable;
  product_customer_prices: ProductCustomerPriceTable;
  product_pricing_profiles: ProductPricingProfileTable;
  pricing_rules: PricingRuleTable;
  product_location_stock: ProductLocationStockTable;
  stock_movements: StockMovementTable;
  stock_transfers: StockTransferTable;
  stock_transfer_items: StockTransferItemTable;
  stock_count_sessions: StockCountSessionTable;
  stock_count_items: StockCountItemTable;
  damaged_stock_records: DamagedStockRecordTable;
  sales: SalesTable;
  sale_items: SaleItemTable;
  sale_line_stock_allocations: SaleLineStockAllocationTable;
  sale_pharmacy_batch_allocations: SalePharmacyBatchAllocationTable;
  sale_payments: SalePaymentTable;
  held_sales: HeldSaleTable;
  held_sale_items: HeldSaleItemTable;
  customer_payments: CustomerPaymentTable;
  customer_ledger: CustomerLedgerTable;
  expenses: ExpenseTable;
  return_documents: ReturnDocumentTable;
  return_items: ReturnItemTable;
  treasury_transactions: TreasuryTransactionTable;
  treasury_transfers: TreasuryTransferTable;
  cashier_shifts: CashierShiftTable;
  pos_audit_events: PosAuditEventTable;
  purchases: PurchaseTable;
  purchase_items: PurchaseItemTable;
  goods_receipt_notes: GoodsReceiptNoteTable;
  goods_receipt_lines: GoodsReceiptLineTable;
  purchase_three_way_matches: PurchaseThreeWayMatchTable;
  purchase_landed_costs: PurchaseLandedCostTable;
  purchase_orders: PurchaseOrderTable;
  purchase_order_items: PurchaseOrderItemTable;
  sales_orders: SalesOrderTable;
  sales_order_items: SalesOrderItemTable;
  manufacturing_unbuild_orders: ManufacturingUnbuildOrderTable;
  supplier_payments: SupplierPaymentTable;
  supplier_payment_schedules: SupplierPaymentScheduleTable;
  supplier_payment_schedule_logs: SupplierPaymentScheduleLogTable;
  supplier_ledger: SupplierLedgerTable;
  services: ServicesTable;
  hr_departments: HrDepartmentTable;
  hr_job_titles: HrJobTitleTable;
  hr_positions: HrPositionTable;
  hr_employees: HrEmployeeTable;
  hr_employee_contacts: HrEmployeeContactTable;
  hr_employee_documents: HrEmployeeDocumentTable;
  hr_employment_contracts: HrEmploymentContractTable;
  hr_compensation_packages: HrCompensationPackageTable;
  hr_employee_loans: HrEmployeeLoanTable;
  hr_employee_loan_installments: HrEmployeeLoanInstallmentTable;
  hr_employee_ledger: HrEmployeeLedgerTable;
  hr_attendance_records: HrAttendanceRecordTable;
  hr_attendance_exceptions: HrAttendanceExceptionTable;
  hr_leave_types: HrLeaveTypeTable;
  hr_leave_requests: HrLeaveRequestTable;
  hr_employee_assets: HrEmployeeAssetTable;
  hr_payroll_runs: HrPayrollRunTable;
  hr_payroll_run_items: HrPayrollRunItemTable;
  hr_payroll_item_adjustments: HrPayrollItemAdjustmentTable;
  hr_hr_settings: HrSettingsTable;
  hr_payroll_loan_deduction_allocations: HrPayrollLoanDeductionAllocationTable;
  hr_holidays: HrHolidayTable;
  price_change_runs: PriceChangeRunTable;
  price_change_items: PriceChangeItemTable;
  delivery_representatives: DeliveryRepresentativeTable;
  fleet_vehicles: FleetVehicleTable;
  van_sales_trips: VanSalesTripTable;
  van_field_returns: VanFieldReturnTable;
  van_trip_expenses: VanTripExpenseTable;
  van_trip_packaging_movements: VanTripPackagingMovementTable;
  delivery_rep_targets: DeliveryRepTargetTable;
  van_load_requisitions: VanLoadRequisitionTable;
  van_rep_financial_settlements: VanRepFinancialSettlementTable;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrAttendanceExceptionTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  attendance_record_id: number | null;
  work_date: ColumnType<string, string | undefined, string | undefined>;
  exception_type: 'early_check_in' | 'late_check_in' | 'early_check_out' | 'late_check_out' | 'missing_check_in' | 'missing_check_out';
  scheduled_time: string | null;
  actual_time: string | null;
  duration_minutes: number;
  status: 'pending' | 'approved' | 'skipped' | 'auto_calculated' | 'needs_review';
  approved_duration_minutes: number | null;
  note: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrLeaveTypeTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  name: string;
  code: string | null;
  description: string | null;
  is_paid: boolean;
  is_active: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrLeaveRequestTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  leave_type_id: number | null;
  leave_type: string | null;
  start_date: ColumnType<string, string | undefined, string | undefined>;
  end_date: ColumnType<string, string | undefined, string | undefined>;
  days_count: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string | null;
  notes: string | null;
  decision_notes: string | null;
  decided_by: number | null;
  decided_at: Date | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrEmployeeAssetTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  employee_id: number;
  asset_type: string;
  asset_name: string;
  asset_code: string | null;
  serial_no: string | null;
  assigned_at: ColumnType<string, string | undefined, string | undefined>;
  returned_at: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  status: 'assigned' | 'returned' | 'lost' | 'damaged' | 'cancelled';
  notes: string | null;
  return_notes: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrPayrollRunTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  period_month: string;
  status: 'draft' | 'reviewed' | 'approved' | 'paid' | 'cancelled';
  notes: ColumnType<string, string | undefined, string | undefined>;
  created_by: number | null;
  reviewed_by: number | null;
  approved_by: number | null;
  paid_by: number | null;
  payment_channel: string | null;
  payment_reference: string | null;
  payment_notes: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  reviewed_at: Date | null;
  approved_at: Date | null;
  paid_at: Date | null;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrPayrollRunItemTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  run_id: number;
  employee_id: number;
  contract_id: number | null;
  base_salary: number;
  allowance_amount: number;
  deduction_amount: number;
  loan_deduction_amount: number;
  asset_recovery_deduction_amount: number;
  gross_pay: number;
  net_pay: number;
  status: 'draft' | 'reviewed' | 'approved' | 'excluded' | 'paid';
  notes: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface HrPayrollItemAdjustmentTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  id: Generated<number>;
  payroll_item_id: number;
  adjustment_type: 'allowance' | 'deduction';
  label: string;
  amount: number;
  notes: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface HrSettingsTable {
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  key: string;
  value: string;
  updated_by: number | null;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface TenantTaxSettingsTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  provider: string;
  client_id: string | null;
  client_secret: string | null;
  tax_id: string | null;
  environment: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface HrPayrollLoanDeductionAllocationTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  payroll_run_id: number;
  payroll_run_item_id: number;
  employee_id: number;
  loan_id: number;
  installment_id: number;
  amount: number;
  ledger_id: number | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface Database {
  plans: PlanTable;
  features: FeatureTable;
  plan_features: PlanFeatureTable;
  _phase1_bootstrap: Phase1BootstrapTable;
  sessions: SessionTable;
  users: UserTable;
  tenants: TenantTable;
  trial_signups: TrialSignupTable;
  settings: SettingTable;
  accounting_accounts: AccountingAccountTable;
  journal_entries: JournalEntryTable;
  journal_entry_lines: JournalEntryLineTable;
  bank_statements: BankStatementTable;
  bank_statement_lines: BankStatementLineTable;
  accounting_settings: AccountingSettingsTable;
  accounting_posting_failures: AccountingPostingFailureTable;
  accounting_fiscal_years: AccountingFiscalYearTable;
  accounting_fiscal_periods: AccountingFiscalPeriodTable;
  audit_logs: AuditLogTable;
  branches: BranchTable;
  stock_locations: StockLocationTable;
  user_branches: UserBranchTable;
  product_categories: ProductCategoryTable;
  suppliers: SupplierTable;
  customers: CustomerTable;
  products: ProductTable;
  product_serials: ProductSerialTable;
  product_units: ProductUnitTable;
  product_offers: ProductOfferTable;
  product_customer_prices: ProductCustomerPriceTable;
  product_pricing_profiles: ProductPricingProfileTable;
  pricing_rules: PricingRuleTable;
  product_location_stock: ProductLocationStockTable;
  stock_movements: StockMovementTable;
  stock_transfers: StockTransferTable;
  stock_transfer_items: StockTransferItemTable;
  stock_count_sessions: StockCountSessionTable;
  stock_count_items: StockCountItemTable;
  damaged_stock_records: DamagedStockRecordTable;
  sales: SalesTable;
  sale_items: SaleItemTable;
  sale_line_stock_allocations: SaleLineStockAllocationTable;
  sale_payments: SalePaymentTable;
  held_sales: HeldSaleTable;
  held_sale_items: HeldSaleItemTable;
  customer_payments: CustomerPaymentTable;
  customer_ledger: CustomerLedgerTable;
  expenses: ExpenseTable;
  return_documents: ReturnDocumentTable;
  return_items: ReturnItemTable;
  treasury_transactions: TreasuryTransactionTable;
  treasury_transfers: TreasuryTransferTable;
  cashier_shifts: CashierShiftTable;
  purchases: PurchaseTable;
  purchase_items: PurchaseItemTable;
  purchase_landed_costs: PurchaseLandedCostTable;
  supplier_payments: SupplierPaymentTable;
  supplier_payment_schedules: SupplierPaymentScheduleTable;
  supplier_payment_schedule_logs: SupplierPaymentScheduleLogTable;
  supplier_ledger: SupplierLedgerTable;
  services: ServicesTable;
  hr_departments: HrDepartmentTable;
  hr_job_titles: HrJobTitleTable;
  hr_positions: HrPositionTable;
  hr_employees: HrEmployeeTable;
  hr_employee_contacts: HrEmployeeContactTable;
  hr_employee_documents: HrEmployeeDocumentTable;
  hr_employment_contracts: HrEmploymentContractTable;
  hr_compensation_packages: HrCompensationPackageTable;
  hr_employee_loans: HrEmployeeLoanTable;
  hr_employee_loan_installments: HrEmployeeLoanInstallmentTable;
  hr_employee_ledger: HrEmployeeLedgerTable;
  hr_attendance_records: HrAttendanceRecordTable;
  hr_attendance_exceptions: HrAttendanceExceptionTable;
  hr_leave_types: HrLeaveTypeTable;
  hr_leave_requests: HrLeaveRequestTable;
  hr_employee_assets: HrEmployeeAssetTable;
  hr_payroll_runs: HrPayrollRunTable;
  hr_payroll_run_items: HrPayrollRunItemTable;
  hr_payroll_item_adjustments: HrPayrollItemAdjustmentTable;
  hr_hr_settings: HrSettingsTable;
  hr_payroll_loan_deduction_allocations: HrPayrollLoanDeductionAllocationTable;
  hr_holidays: HrHolidayTable;
  price_change_runs: PriceChangeRunTable;
  price_change_items: PriceChangeItemTable;
  partner_contacts: PartnerContactTable;
  partner_addresses: PartnerAddressTable;
  cost_centers: CostCenterTable;
  projects: ProjectTable;
  purchase_attachments: PurchaseAttachmentTable;
  manufacturing_boms: ManufacturingBomTable;
  manufacturing_bom_lines: ManufacturingBomLineTable;
  manufacturing_work_orders: ManufacturingWorkOrderTable;
  manufacturing_wo_consumptions: ManufacturingWoConsumptionTable;
  manufacturing_work_centers: ManufacturingWorkCenterTable;
  manufacturing_wo_operations: ManufacturingWoOperationTable;
  hr_employee_adjustments: HrEmployeeAdjustmentTable;
  offline_releases: OfflineReleaseTable;
  style_code_counters: StyleCodeCounterTable;
  addons: AddonTable;
  tenant_tax_settings: TenantTaxSettingsTable;
  maintenance_tickets: MaintenanceTicketTable;
  maintenance_ticket_parts: MaintenanceTicketPartTable;
  trade_in_transactions: TradeInTransactionTable;
  pharmacy_drugs: PharmacyDrugTable;
  pharmacy_batches: PharmacyBatchTable;
  pharmacy_prescriptions: PharmacyPrescriptionTable;
  pharmacy_shortages: PharmacyShortageTable;
  pharmacy_clinical_services: PharmacyClinicalServiceTable;
  online_orders: OnlineOrderTable;
  storefront_media: StorefrontMediaTable;
  quotations: QuotationTable;
  quotation_items: QuotationItemTable;
  customer_loyalty_logs: CustomerLoyaltyLogTable;
  fixed_assets: FixedAssetTable;
  asset_depreciation_logs: AssetDepreciationLogTable;
  currency_exchange_rates: CurrencyExchangeRateTable;
  currency_exchange_rate_history: CurrencyExchangeRateHistoryTable;
  customer_installment_plans: CustomerInstallmentPlanTable;
  customer_installments: CustomerInstallmentTable;
  saas_client_diagnostics: SaasClientDiagnosticTable;
  product_reviews: ProductReviewTable;
  storefront_coupons: StorefrontCouponTable;
  storefront_delivery_zones: StorefrontDeliveryZoneTable;
  storefront_abandoned_carts: StorefrontAbandonedCartTable;
  accounting_cheques: AccountingChequeTable;
  withholding_tax_transactions: WithholdingTaxTransactionTable;
  sales_orders: SalesOrderTable;
  sales_order_items: SalesOrderItemTable;
  purchase_orders: PurchaseOrderTable;
  purchase_order_items: PurchaseOrderItemTable;
  manufacturing_unbuild_orders: ManufacturingUnbuildOrderTable;
  price_lists: PriceListTable;
  price_list_items: PriceListItemTable;
  purchase_rfqs: PurchaseRfqTable;
  purchase_rfq_items: PurchaseRfqItemTable;
  purchase_rfq_vendor_bids: PurchaseRfqVendorBidTable;
  payment_allocations: PaymentAllocationTable;
  warehouse_bins: WarehouseBinTable;
  product_bin_allocations: ProductBinAllocationTable;
  pos_modifier_groups: PosModifierGroupTable;
  pos_modifier_options: PosModifierOptionTable;
  product_pos_modifiers: ProductPosModifierTable;
  pos_delivery_aggregators: PosDeliveryAggregatorTable;
  pos_aggregator_orders: PosAggregatorOrderTable;
  restaurant_food_waste_logs: RestaurantFoodWasteLogTable;
  hr_end_of_service_settlements: HrEndOfServiceSettlementTable;
}
export interface HrEmployeeAdjustmentTable {
  id: Generated<number>;
  tenant_id: string;
  employee_id: number;
  adjustment_type: string;
  amount_type: string;
  amount: number;
  date: ColumnType<Date, string | undefined, string | undefined>;
  reason: string | null;
  status: string;
  applied_in_run_id: number | null;
  source_type: string | null;
  source_id: string | null;
  accounting_category: string | null;
  created_by: number;
  updated_by: number;
  created_at: ColumnType<Date, string | undefined, string | undefined>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface OfflineReleaseTable {
  id: Generated<number>;
  version: string;
  changelog: string;
  patch_url: string;
  is_active: boolean;
  passcode: string | null;
  requires_passcode: boolean;
  promoted_by: string | null;
  promoted_at: ColumnType<Date, string | undefined, string | undefined> | null;
  created_at: ColumnType<Date, string | undefined, string | undefined>;
}

export interface PlanTable {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface FeatureTable {
  id: string;
  code: string;
  name: string;
  module: string;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface PlanFeatureTable {
  plan_id: string;
  feature_code: string;
}

export interface PharmacyDrugTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  product_id: number | null;
  trade_name: string;
  trade_name_ar: string | null;
  active_ingredient: string;
  active_ingredient_ar: string | null;
  dosage_form: string;
  strength: string | null;
  manufacturer: string | null;
  drug_class: string | null;
  prescription_required: boolean;
  controlled_level: string;
  units_per_box: number;
  unit_name: string;
  strip_price: number | string;
  box_price: number | string;
  pregnancy_safety: string | null;
  storage_condition: string | null;
  barcode: string | null;
  indications: string | null;
  side_effects: string | null;
  created_at: ColumnType<Date, string | undefined, string | undefined>;
  updated_at: ColumnType<Date, string | undefined, string | undefined>;
}

export interface PharmacyBatchTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  product_id: number | null;
  drug_id: number | null;
  batch_number: string;
  expiry_date: string;
  quantity: number | string;
  unit_cost: number | string;
  location_id: number | null;
  supplier_name: string | null;
  status: string;
  notes: string | null;
  created_at: ColumnType<Date, string | undefined, string | undefined>;
  updated_at: ColumnType<Date, string | undefined, string | undefined>;
}

export interface SalePharmacyBatchAllocationTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  sale_id: number;
  sale_item_id: number;
  product_id: number;
  pharmacy_batch_id: number;
  quantity: number;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface PharmacyPrescriptionTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  prescription_no: string;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string | null;
  doctor_name: string | null;
  doctor_specialty: string | null;
  diagnosis: string | null;
  insurance_provider: string | null;
  insurance_card_no: string | null;
  approval_code: string | null;
  patient_copay_percent: number | string;
  total_amount: number | string;
  patient_amount: number | string;
  insurance_amount: number | string;
  status: string;
  items_json: string;
  dispensed_by: string | null;
  dispensed_at: ColumnType<Date, string | undefined, string | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | undefined, string | undefined>;
  updated_at: ColumnType<Date, string | undefined, string | undefined>;
}

export interface PharmacyShortageTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  product_name: string;
  active_ingredient: string | null;
  dosage_form: string | null;
  suggested_distributor: string | null;
  requested_quantity: number | string;
  priority: string;
  customer_name: string | null;
  customer_phone: string | null;
  status: string;
  notes: string | null;
  created_at: ColumnType<Date, string | undefined, string | undefined>;
  updated_at: ColumnType<Date, string | undefined, string | undefined>;
}

export interface PharmacyClinicalServiceTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  service_type: string;
  customer_name: string;
  customer_phone: string | null;
  metric_value_1: string | null;
  metric_value_2: string | null;
  pharmacist_notes: string | null;
  fee: number | string;
  created_at: ColumnType<Date, string | undefined, string | undefined>;
}

/** Migration 2040000000135 (SF-9): storefront images as binary, one row per tenant+content hash. */
export interface StorefrontMediaTable {
  id: Generated<number>;
  tenant_id: string;
  sha256: string;
  mime_type: string;
  byte_size: number;
  content: Buffer;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface OnlineOrderTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_notes: string | null;
  items_json: ColumnType<string, string | undefined, string | undefined>;
  subtotal: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  delivery_fee: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  total_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'review_required' | 'payment_failed';
  payment_method: string;
  payment_status?: ColumnType<'pending' | 'paid' | 'failed' | 'refunded', string | undefined, string | undefined>;
  gateway_provider?: string | null;
  gateway_transaction_id?: string | null;
  gateway_order_id?: string | null;
  gateway_response_json?: string | null;
  paid_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  pager_number?: string | null;
  coupon_code?: string | null;
  discount_amount?: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  delivery_zone_id?: number | null;
  delivery_zone_name?: string | null;
  branch_id: number | null;
  sale_id: number | null;
  shipping_carrier?: ColumnType<'internal' | 'bosta' | string, string | undefined, string | undefined>;
  bosta_delivery_id?: string | null;
  bosta_tracking_number?: string | null;
  bosta_status?: string | null;
  bosta_awb_url?: string | null;
  bosta_created_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  gcc_shipping_carrier?: string | null;
  gcc_shipping_id?: string | null;
  gcc_tracking_number?: string | null;
  gcc_shipping_status?: string | null;
  gcc_awb_url?: string | null;
  gcc_shipping_created_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  fulfillment_type?: ColumnType<'delivery' | 'pickup' | 'dine_in' | string, string | undefined, string | undefined>;
  country_code?: ColumnType<string, string | undefined, string | undefined>;
  pickup_branch_id?: number | null;
  access_token_hash?: string | null;
  kitchen_draft_sale_id?: number | null;
  // Present since migration 2040000000046 (QR table ordering); missing from this type until now.
  order_type?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  table_number?: string | null;
  stock_reserved?: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  reserved_branch_id?: number | null;
  reserved_location_id?: number | null;
  stock_reserved_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  idempotency_key?: string | null;
  dispatched_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  delivered_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  driver_cash_settled?: boolean;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface QuotationTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  quotation_number: string;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  branch_id: number | null;
  subtotal: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  discount_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  tax_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  total_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  valid_until: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted';
  sale_id: number | null;
  notes: string | null;
  terms_conditions: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface QuotationItemTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  quotation_id: number;
  product_id: number;
  product_name: string;
  unit_name: string | null;
  quantity: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  unit_price: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  discount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  total: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface CustomerLoyaltyLogTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  customer_id: number;
  points_change: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  balance_after: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  action_type: 'earn' | 'redeem' | 'manual_adjust' | 'return_clawback' | 'return_refund' | 'cancel_clawback' | 'edit_clawback' | 'cancel_refund' | 'edit_refund';
  sale_id: number | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface FixedAssetTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  code: string;
  name: string;
  category: ColumnType<string, string | undefined, string | undefined>;
  purchase_date: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  purchase_cost: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  salvage_value: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  useful_life_months: ColumnType<number, number | undefined, number | undefined>;
  depreciation_method: ColumnType<string, string | undefined, string | undefined>;
  accumulated_depreciation: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  status: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface AssetDepreciationLogTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  asset_id: number;
  period_date: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  depreciation_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  accumulated_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  book_value: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  journal_entry_id: number | null;
  note: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface CurrencyExchangeRateTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  currency_code: string;
  currency_name: string;
  exchange_rate: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  is_base: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  symbol: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface CurrencyExchangeRateHistoryTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  currency_code: string;
  exchange_rate: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  is_base: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  effective_from: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface CustomerInstallmentPlanTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  plan_number: string;
  sale_id: number | null;
  customer_id: number;
  total_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  down_payment: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  financed_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  interest_rate_percent: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  interest_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  total_with_interest: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  installment_count: ColumnType<number, number | undefined, number | undefined>;
  monthly_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  start_date: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  status: ColumnType<string, string | undefined, string | undefined>;
  notes: ColumnType<string, string | undefined, string | undefined>;
  branch_id: number | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface CustomerInstallmentTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  plan_id: number;
  sale_id: number | null;
  customer_id: number;
  installment_number: number;
  due_date: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  paid_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  status: ColumnType<string, string | undefined, string | undefined>;
  paid_at: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  payment_method: ColumnType<string, string | undefined, string | undefined>;
  receipt_no: string | null;
  notes: ColumnType<string, string | undefined, string | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface SaasClientDiagnosticTable {
  id: Generated<number>;
  client_name: string;
  client_identifier: string;
  app_version: ColumnType<string, string | undefined, string | undefined>;
  log_period: ColumnType<string, string | undefined, string | undefined>;
  error_count_500: ColumnType<number, number | undefined, number | undefined>;
  error_summary: ColumnType<Record<string, any> | null, string | Record<string, any> | null | undefined, string | Record<string, any> | null | undefined>;
  file_path: string;
  file_size_bytes: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  uploaded_at: ColumnType<Date, string | undefined, never>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface ProductReviewTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  product_id: number;
  rating: number;
  customer_name: string | null;
  customer_phone: string | null;
  comment: string | null;
  is_approved: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface StorefrontCouponTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  code: string;
  discount_type: 'percentage' | 'fixed' | 'free_shipping' | string;
  discount_value: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  min_order_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  max_discount_amount: ColumnType<number | string | null, number | string | null | undefined, number | string | null | undefined>;
  usage_limit: number | null;
  times_used: ColumnType<number, number | undefined, number | undefined>;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  start_date: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  end_date: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface StorefrontDeliveryZoneTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  name: string;
  delivery_fee: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  estimated_time: string | null;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  sort_order: ColumnType<number, number | undefined, number | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface StorefrontAbandonedCartTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  customer_name: string | null;
  customer_phone: string;
  country_code: ColumnType<string, string | undefined, string | undefined>;
  items_json: ColumnType<string, string | undefined, string | undefined>;
  subtotal: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  recovered: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface AccountingChequeTable {
  posting_sequence?: ColumnType<number, number | undefined, number | undefined>;
  id: Generated<number>;
  tenant_id: string;
  account_id: number | null;
  type: 'receivable' | 'payable';
  cheque_number: string;
  bank_name: string;
  branch_name: string | null;
  drawer_name: string | null;
  partner_type: string;
  partner_id: number | null;
  partner_name: string;
  base_amount: ColumnType<number | string | null, number | string | null | undefined, number | string | null | undefined>;
  base_currency: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  exchange_rate: ColumnType<number | string | null, number | string | null | undefined, number | string | null | undefined>;
  settlement_base_amount: ColumnType<number | string | null, number | string | null | undefined, number | string | null | undefined>;
  flagged_rate_variance: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  registered_exchange_rate: ColumnType<number | string | null, number | string | null | undefined, number | string | null | undefined>;
  last_action_date: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  currency: ColumnType<string, string | undefined, string | undefined>;
  issue_date: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
  due_date: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
  status: ColumnType<string, string | undefined, string | undefined>;
  deposit_bank_id: number | null;
  deposit_date: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  cleared_date: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  bounced_date: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  bounced_reason: string | null;
  bounced_fee: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  endorsed_to_supplier_id: number | null;
  endorsed_to_supplier_name: string | null;
  journal_entry_id: number | null;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface AccountingFiscalYearTable {
  id: Generated<number>;
  tenant_id: string;
  name: string;
  code: string | null;
  start_date: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
  end_date: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
  status: ColumnType<'open' | 'closed', 'open' | 'closed' | undefined, 'open' | 'closed' | undefined>;
  closing_entry_id: number | null;
  net_profit_loss: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  total_revenue: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  total_expense: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  retained_earnings_account_id: number | null;
  closed_at: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  closed_by: number | null;
  closing_notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface AccountingFiscalPeriodTable {
  id: Generated<number>;
  tenant_id: string;
  fiscal_year_id: number;
  period_number: number;
  name: string;
  code: string | null;
  start_date: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
  end_date: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
  status: ColumnType<'open' | 'closed', 'open' | 'closed' | undefined, 'open' | 'closed' | undefined>;
  closed_at: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  closed_by: number | null;
  closing_notes: string | null;
  /**
   * FP-5: قيمة `accounting_settings.lock_date_all` قبل أن يرفعها إقفال هذه الفترة.
   * تُستعاد عند إعادة الفتح، فلا يمحو إقفال شهرٍ قفلاً يدوياً أقدم منه.
   */
  previous_lock_date_all: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface WithholdingTaxTransactionTable {
  id: Generated<number>;
  tenant_id: string;
  direction: ColumnType<'payable' | 'receivable', 'payable' | 'receivable' | undefined, 'payable' | 'receivable' | undefined>;
  source_type: ColumnType<string, string | undefined, string | undefined>;
  source_id: number | null;
  invoice_number: string;
  invoice_date: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
  partner_type: ColumnType<string, string | undefined, string | undefined>;
  partner_id: number | null;
  partner_name: string;
  tax_id_number: string | null;
  file_number: string | null;
  tax_office_code: string | null;
  partner_address: string | null;
  wht_type: ColumnType<string, string | undefined, string | undefined>;
  wht_rate: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  base_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  tax_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  quarter: string;
  tax_year: number;
  status: ColumnType<string, string | undefined, string | undefined>;
  payment_reference: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface SalesOrderTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  order_number: string;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  branch_id: number | null;
  subtotal: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  discount_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  tax_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  total_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  status: ColumnType<string, string | undefined, string | undefined>;
  reservation_expires_at: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  delivery_date: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  sale_id: number | null;
  quotation_id: number | null;
  rep_id?: number | null;
  warehouse_location_id?: number | null;
  order_source?: ColumnType<string, string | undefined, string | undefined>;
  payment_terms?: ColumnType<string, string | undefined, string | undefined>;
  supervisor_approved_at?: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  supervisor_approved_by?: number | null;
  supervisor_rejection_reason?: string | null;
  notes: string | null;
  terms_conditions: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface SalesOrderItemTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  sales_order_id: number;
  product_id: number;
  product_name: string;
  unit_name: string | null;
  quantity: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  reserved_quantity: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  delivered_quantity: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  unit_price: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  consumer_price?: ColumnType<number | string | null, number | string | null | undefined, number | string | null | undefined>;
  pricing_tier_type?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  unit_multiplier?: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  unit_offer_savings?: ColumnType<number | string | null, number | string | null | undefined, number | string | null | undefined>;
  discount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  total: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface PurchaseOrderTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  order_number: string;
  supplier_id: number | null;
  supplier_name: string;
  supplier_phone: string | null;
  warehouse_id: number | null;
  warehouse_name: string | null;
  subtotal: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  tax_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  discount_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  total_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  status: ColumnType<string, string | undefined, string | undefined>;
  expected_delivery_date: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  converted_purchase_id: number | null;
  notes: string | null;
  terms_conditions: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface PurchaseOrderItemTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  purchase_order_id: number;
  product_id: number;
  product_name: string;
  unit_name: string | null;
  quantity: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  received_quantity: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  unit_cost: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  tax_rate: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  discount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  total: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface ManufacturingUnbuildOrderTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  unbuild_number: string;
  product_id: number;
  product_name: string;
  bom_id: number;
  quantity: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  warehouse_id: number;
  status: ColumnType<string, string | undefined, string | undefined>;
  total_cost: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface PriceListTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  name: string;
  code: string;
  currency: ColumnType<string, string | undefined, string | undefined>;
  type: ColumnType<string, string | undefined, string | undefined>; // percentage, fixed_override, markup_cost
  default_discount_percent: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  is_default: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface PriceListItemTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  price_list_id: number;
  product_id: number | null;
  product_name: string | null;
  category_id: number | null;
  min_quantity: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  fixed_price: ColumnType<number | string | null, number | string | null | undefined, number | string | null | undefined>;
  discount_percent: ColumnType<number | string | null, number | string | null | undefined, number | string | null | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface PurchaseRfqTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  rfq_number: string;
  title: string;
  status: ColumnType<string, string | undefined, string | undefined>;
  deadline_date: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  expected_delivery_date: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  winning_supplier_id: number | null;
  winning_supplier_name: string | null;
  converted_po_id: number | null;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface PurchaseRfqItemTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  rfq_id: number;
  product_id: number;
  product_name: string;
  unit_name: string | null;
  target_quantity: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  specifications: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface PurchaseRfqVendorBidTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  rfq_id: number;
  rfq_item_id: number;
  supplier_id: number;
  supplier_name: string;
  supplier_phone: string | null;
  quoted_unit_cost: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  tax_rate: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  delivery_lead_days: ColumnType<number, number | undefined, number | undefined>;
  payment_terms: string | null;
  is_winner: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface PaymentAllocationTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  partner_type: string; // 'customer' | 'supplier'
  partner_id: number;
  payment_type: string; // 'customer_payment' | 'supplier_payment' | 'direct'
  payment_id: number | null;
  invoice_type: string; // 'sale' | 'purchase'
  invoice_id: number;
  allocated_amount: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  allocation_date: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface WarehouseBinTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  location_id: number;
  code: string;
  barcode: string;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  capacity: ColumnType<number | string | null, number | string | null | undefined, number | string | null | undefined>;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ProductBinAllocationTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  bin_id: number;
  product_id: number;
  quantity: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  is_primary: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface PosModifierGroupTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  name: string;
  name_en: string | null;
  selection_type: ColumnType<string, string | undefined, string | undefined>; // 'single' | 'multiple'
  is_mandatory: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  min_selections: ColumnType<number, number | undefined, number | undefined>;
  max_selections: ColumnType<number, number | undefined, number | undefined>;
  display_order: ColumnType<number, number | undefined, number | undefined>;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  is_splittable_in_half: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface PosModifierOptionTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  group_id: number;
  name: string;
  name_en: string | null;
  price: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  cost_price: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  is_default: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  display_order: ColumnType<number, number | undefined, number | undefined>;
  component_product_id: number | null | undefined;
  consumption_qty: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  unit_name: string | null | undefined;
  portion_allowed: ColumnType<string, string | undefined, string | undefined>;
  preparation_time_minutes: ColumnType<number, number | undefined, number | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface ProductPosModifierTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  product_id: number;
  modifier_group_id: number;
  is_splittable_in_half?: boolean | null;
  default_options_ids?: any;
  excluded_options_ids?: any;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface PosDeliveryAggregatorTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  code: string;
  name: string;
  name_en: string | null;
  commission_rate: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  price_markup_percentage: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  price_markup_fixed: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  auto_accept_orders: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  api_key: string | null;
  webhook_secret: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface PosAggregatorOrderTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  aggregator_id: number;
  external_order_id: string;
  display_number: string | null;
  branch_id: number | null;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  subtotal: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  delivery_fee: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  aggregator_commission: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  net_payout: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  order_payload: ColumnType<any, string | Record<string, any> | undefined, string | Record<string, any> | undefined>;
  sale_id: number | null;
  kds_ticket_id: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface RestaurantFoodWasteLogTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  branch_id: number;
  product_id: number;
  quantity: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  cost_price: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  total_cost: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  reason: string;
  notes: string | null;
  logged_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface HrEndOfServiceSettlementTable {
  id: Generated<number>;
  tenant_id: string;
  settlement_no: string;
  employee_id: number;
  settlement_date: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  hire_date: ColumnType<Date, string | Date, string | Date>;
  termination_date: ColumnType<Date, string | Date, string | Date>;
  contract_type: ColumnType<string, string | undefined, string | undefined>;
  termination_reason: ColumnType<string, string | undefined, string | undefined>;
  law_type: ColumnType<string, string | undefined, string | undefined>;
  service_years: ColumnType<number, number | string | undefined, number | string | undefined>;
  service_months: ColumnType<number, number | undefined, number | undefined>;
  service_days: ColumnType<number, number | undefined, number | undefined>;
  last_basic_salary: ColumnType<number, number | string | undefined, number | string | undefined>;
  last_total_salary: ColumnType<number, number | string | undefined, number | string | undefined>;
  gratuity_percentage: ColumnType<number, number | string | undefined, number | string | undefined>;
  gratuity_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  remaining_leave_days: ColumnType<number, number | string | undefined, number | string | undefined>;
  leave_encashment_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  pending_salary_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  notice_period_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  other_entitlements_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  unpaid_loans_deduction: ColumnType<number, number | string | undefined, number | string | undefined>;
  assets_deduction: ColumnType<number, number | string | undefined, number | string | undefined>;
  other_deductions: ColumnType<number, number | string | undefined, number | string | undefined>;
  net_settlement_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  custody_cleared: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  clearance_checklist: ColumnType<any, any | undefined, any | undefined>;
  clearance_notes: string | null;
  status: ColumnType<string, string | undefined, string | undefined>;
  journal_entry_id: number | null;
  payment_method: string | null;
  treasury_or_bank_account_id: number | null;
  notes: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface TamperAuditLogTable {
  id: Generated<string>;
  tenant_id: string;
  table_name: string;
  record_id: string;
  operation: string;
  old_values: ColumnType<any, string | Record<string, any> | null | undefined, never>;
  new_values: ColumnType<any, string | Record<string, any> | null | undefined, never>;
  changed_fields: ColumnType<any, string | Record<string, any> | null | undefined, never>;
  user_id: number | null;
  user_username: string | null;
  db_user: string | null;
  client_ip: string | null;
  prev_hash: string | null;
  row_hash: string;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface ApprovalRuleTable {
  id: Generated<string>;
  tenant_id: string;
  module: string;
  min_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  max_amount: ColumnType<number | null, number | string | null | undefined, number | string | null | undefined>;
  tier_level: ColumnType<number, number | undefined, number | undefined>;
  required_role: ColumnType<string, string | undefined, string | undefined>;
  approver_user_id: number | null;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ApprovalRequestTable {
  id: Generated<string>;
  tenant_id: string;
  module: string;
  record_id: ColumnType<string, string | number, string | number>;
  record_ref: string;
  amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  currency: ColumnType<string, string | undefined, string | undefined>;
  current_tier: ColumnType<number, number | undefined, number | undefined>;
  max_tier: ColumnType<number, number | undefined, number | undefined>;
  status: ColumnType<string, string | undefined, string | undefined>;
  requested_by: number;
  requested_by_name: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ApprovalRequestLogTable {
  id: Generated<string>;
  tenant_id: string;
  request_id: string;
  tier_level: number;
  action: string;
  action_by: number;
  action_by_name: string | null;
  action_role: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface CostCenterAllocationTable {
  id: Generated<string>;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface CostCenterAllocationSplitTable {
  id: Generated<string>;
  tenant_id: string;
  allocation_id: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  cost_center_id: ColumnType<number | string, number | string | undefined, number | string | undefined>;
  percentage: ColumnType<number, number | string | undefined, number | string | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface ForexRevaluationRunTable {
  id: Generated<string>;
  tenant_id: string;
  period_date: ColumnType<string, string | Date, string | Date>;
  currency_code: string;
  book_exchange_rate: ColumnType<number, number | string | undefined, number | string | undefined>;
  closing_exchange_rate: ColumnType<number, number | string | undefined, number | string | undefined>;
  foreign_balance_total: ColumnType<number, number | string | undefined, number | string | undefined>;
  unrealized_gain_loss: ColumnType<number, number | string | undefined, number | string | undefined>;
  journal_entry_id: number | null;
  journal_entry_no: string | null;
  status: ColumnType<string, string | undefined, string | undefined>;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface ForexRevaluationLineTable {
  id: Generated<string>;
  tenant_id: string;
  run_id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  foreign_balance: ColumnType<number, number | string | undefined, number | string | undefined>;
  book_local_value: ColumnType<number, number | string | undefined, number | string | undefined>;
  revalued_local_value: ColumnType<number, number | string | undefined, number | string | undefined>;
  unrealized_difference: ColumnType<number, number | string | undefined, number | string | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface ZatcaEgsUnitTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: number | null;
  device_uuid: string;
  device_name: string;
  custom_id: string | null;
  private_key_pem: string;
  public_key_pem: string;
  csr_content: string | null;
  compliance_csid: string | null;
  compliance_secret: string | null;
  compliance_request_id: string | null;
  production_csid: string | null;
  production_secret: string | null;
  status: 'unregistered' | 'compliance_passed' | 'production_active' | 'revoked';
  last_icv: ColumnType<number, number | string | undefined, number | string | undefined>;
  last_invoice_hash: string;
  environment: 'sandbox' | 'simulation' | 'production';
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ZatcaTransmissionLogTable {
  id: Generated<string>;
  tenant_id: string;
  sale_id: number;
  egs_id: number | null;
  action_type: 'reporting' | 'clearance' | 'compliance_check';
  environment: 'sandbox' | 'simulation' | 'production';
  request_uuid: string;
  invoice_hash: string;
  http_status: number | null;
  response_status: string | null;
  validation_results: ColumnType<any, any | undefined, any | undefined>;
  raw_response: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface ShippingPortTable {
  id: Generated<string>;
  tenant_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  country_code: string;
  country_name: string;
  port_type: ColumnType<'sea' | 'air' | 'land', string | undefined, string | undefined>;
  iata_code: string | null;
  icao_code: string | null;
  is_active: boolean;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ShippingLineTable {
  id: Generated<string>;
  tenant_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  carrier_type: ColumnType<'shipping_line' | 'airline' | 'trucking' | 'freight_forwarder' | 'overseas_agent', string | undefined, string | undefined>;
  airline_prefix: string | null;
  trade_lanes: string | null;
  country_name: string | null;
  country_code: string | null;
  city_name: string | null;
  contact_person: string | null;
  email: string | null;
  rfq_email: string | null;
  booking_email: string | null;
  phone: string | null;
  whatsapp: string | null;
  wechat: string | null;
  services_offered: string | null;
  supported_ports: string | null;
  tracking_url_template: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeInquiryTable {
  id: Generated<string>;
  tenant_id: string;
  inquiry_number: string;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  direction: 'import' | 'export' | 'cross_trade';
  transport_mode: 'sea' | 'air' | 'road' | 'multimodal';
  air_cargo_type: string | null;
  pol_id: string | null;
  pol_code: string;
  pol_name: string;
  pod_id: string | null;
  pod_code: string;
  pod_name: string;
  incoterm: string;
  cargo_mode: string;
  container_type: string;
  container_count: number;
  commodity_description: string;
  cargo_nature: string;
  gross_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  volumetric_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  chargeable_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  total_cbm: ColumnType<number, number | string | undefined, number | string | undefined>;
  package_count: number | null;
  flight_number: string | null;
  flight_date: string | null;
  mawb_number: string | null;
  hawb_number: string | null;
  cbm: ColumnType<number, number | string | undefined, number | string | undefined>;
  cargo_ready_date: string | null;
  target_delivery_date: string | null;
  target_free_days: number;
  payment_term: 'prepaid' | 'collect';
  status: 'received' | 'rfq_created' | 'quoted' | 'converted_to_job' | 'cancelled';
  rfq_id: string | null;
  quotation_id: string | null;
  job_id: string | null;
  notes: string | null;
  portal_submitted?: boolean;
  portal_customer_notes?: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeRfqTable {
  id: Generated<string>;
  tenant_id: string;
  rfq_number: string;
  inquiry_id: string | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  direction: 'import' | 'export' | 'cross_trade';
  transport_mode: 'sea' | 'air' | 'road' | 'multimodal';
  pol_id: string | null;
  pol_code: string;
  pol_name: string;
  pod_id: string | null;
  pod_code: string;
  pod_name: string;
  incoterm: string;
  cargo_mode: string;
  container_type: string;
  container_count: number;
  commodity_description: string;
  cargo_nature: string;
  air_cargo_type: string | null;
  gross_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  volumetric_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  chargeable_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  total_cbm: ColumnType<number, number | string | undefined, number | string | undefined>;
  package_count: number | null;
  flight_number: string | null;
  flight_date: string | null;
  mawb_number: string | null;
  hawb_number: string | null;
  cargo_ready_date: string | null;
  target_free_days: number;
  payment_term: 'prepaid' | 'collect';
  target_line_ids: any;
  status: 'draft' | 'sent' | 'bids_received' | 'awarded' | 'cancelled';
  notes: string | null;
  urgency_level: 'standard' | 'urgent';
  cut_off_deadline: string | null;
  auto_awarded: boolean;
  target_rate_max: number | null;
  public_quote_token: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeRfqBidTable {
  id: Generated<string>;
  tenant_id: string;
  rfq_id: string;
  shipping_line_id: string | null;
  shipping_line_name: string;
  ocean_freight: ColumnType<number, number | string | undefined, number | string | undefined>;
  currency: string;
  thc_origin: ColumnType<number, number | string | undefined, number | string | undefined>;
  thc_destination: ColumnType<number, number | string | undefined, number | string | undefined>;
  baf_charges: ColumnType<number, number | string | undefined, number | string | undefined>;
  other_charges: ColumnType<number, number | string | undefined, number | string | undefined>;
  total_freight_cost: ColumnType<number, number | string | undefined, number | string | undefined>;
  transit_time_days: number;
  free_days: number;
  validity_date: string | null;
  submission_channel: 'email_auto' | 'carrier_portal' | 'manual';
  raw_bid_data: any;
  is_awarded: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  awarded_at: Date | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeRateCardTable {
  id: Generated<string>;
  tenant_id: string;
  shipping_line_id: string | null;
  carrier_name: string;
  transport_mode: 'sea' | 'air' | 'road' | 'multimodal';
  pol_code: string;
  pol_name: string;
  pod_code: string;
  pod_name: string;
  cargo_mode: string;
  container_type: string;
  rate_basis: string;
  min_charge: ColumnType<number, number | string | undefined, number | string | undefined>;
  ocean_freight: ColumnType<number, number | string | undefined, number | string | undefined>;
  currency: string;
  thc_origin: ColumnType<number, number | string | undefined, number | string | undefined>;
  thc_destination: ColumnType<number, number | string | undefined, number | string | undefined>;
  baf_charges: ColumnType<number, number | string | undefined, number | string | undefined>;
  other_charges: ColumnType<number, number | string | undefined, number | string | undefined>;
  total_freight_cost: ColumnType<number, number | string | undefined, number | string | undefined>;
  transit_time_days: number;
  free_days: number;
  valid_from: string;
  valid_until: string;
  source: 'manual' | 'carrier_bid';
  source_bid_id: string | null;
  status: 'active' | 'expired' | 'draft';
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeQuotationTable {
  id: Generated<string>;
  tenant_id: string;
  quotation_number: string;
  inquiry_id: string | null;
  rfq_id: string | null;
  bid_id: string | null;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  transport_mode: 'sea' | 'air' | 'road' | 'multimodal';
  air_cargo_type: string | null;
  gross_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  volumetric_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  chargeable_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  total_cbm: ColumnType<number, number | string | undefined, number | string | undefined>;
  package_count: number | null;
  flight_number: string | null;
  flight_date: string | null;
  mawb_number: string | null;
  hawb_number: string | null;
  payment_term: 'prepaid' | 'collect';
  base_cost: ColumnType<number, number | string | undefined, number | string | undefined>;
  currency: string;
  margin_type: 'fixed' | 'percentage';
  margin_value: ColumnType<number, number | string | undefined, number | string | undefined>;
  final_total: ColumnType<number, number | string | undefined, number | string | undefined>;
  exchange_rate: ColumnType<number, number | string | undefined, number | string | undefined>;
  final_total_local: ColumnType<number, number | string | undefined, number | string | undefined>;
  valid_until: string | null;
  quote_roe?: ColumnType<number | null, number | string | null | undefined, number | string | null | undefined>;
  roe_clause_text?: string | null;
  is_split_currency?: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  foreign_currency?: string | null;
  foreign_currency_amount?: ColumnType<number | null, number | string | null | undefined, number | string | null | undefined>;
  local_currency_amount?: ColumnType<number | null, number | string | null | undefined, number | string | null | undefined>;
  acid_number?: string | null;
  status: 'draft' | 'sent' | 'approved' | 'rejected' | 'converted_to_job';
  converted_job_id: string | null;
  customer_approved_at?: Date | null;
  customer_approval_notes?: string | null;
  customer_approval_reference?: string | null;
  customer_approval_ip?: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeJobTable {
  id: Generated<string>;
  tenant_id: string;
  job_number: string;
  inquiry_id: string | null;
  quotation_id: string | null;
  rfq_id: string | null;
  customer_id: number | null;
  customer_name: string;
  direction: 'import' | 'export' | 'cross_trade';
  transport_mode: 'sea' | 'air' | 'road' | 'multimodal';
  air_cargo_type: string | null;
  gross_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  volumetric_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  chargeable_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  total_cbm: ColumnType<number, number | string | undefined, number | string | undefined>;
  package_count: number | null;
  flight_number: string | null;
  flight_date: string | null;
  mawb_number: string | null;
  hawb_number: string | null;
  payment_term: 'prepaid' | 'collect';
  shipping_line_id: string | null;
  shipping_line_name: string;
  booking_number: string | null;
  vessel_name: string | null;
  voyage_number: string | null;
  pol_code: string;
  pol_name: string;
  pod_code: string;
  pod_name: string;
  etd: string | null;
  eta: string | null;
  port_cut_off: Date | null;
  bl_type: 'original' | 'telex_release' | 'sea_waybill';
  mbl_number: string | null;
  hbl_number: string | null;
  shipper_details: string | null;
  consignee_details: string | null;
  notify_party: string | null;
  milestone_status: ColumnType<string, string | undefined, string | undefined>;
  delivery_order_released: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  delivery_order_released_at: Date | null;
  delivered_to_client_at: Date | null;
  delivery_address: string | null;
  cost_center_id: string | null;
  client_invoiced_total: ColumnType<number, number | string | undefined, number | string | undefined>;
  client_paid_total: ColumnType<number, number | string | undefined, number | string | undefined>;
  payment_status: ColumnType<'unpaid' | 'partially_paid' | 'paid', 'unpaid' | 'partially_paid' | 'paid' | undefined, 'unpaid' | 'partially_paid' | 'paid' | undefined>;
  paid_at: Date | null;
  carrier_cost_total: ColumnType<number, number | string | undefined, number | string | undefined>;
  other_costs_total: ColumnType<number, number | string | undefined, number | string | undefined>;
  net_profit: ColumnType<number, number | string | undefined, number | string | undefined>;
  tracking_token: string | null;
  parent_job_id?: string | null;
  is_consolidation_master?: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  sub_job_count?: ColumnType<number, number | undefined, number | undefined>;
  acid_number?: string | null;
  acid_issue_date?: string | null;
  acid_expiry_date?: string | null;
  foreign_exporter_id?: string | null;
  importer_tax_id?: string | null;
  quote_roe?: ColumnType<number | null, number | string | null | undefined, number | string | null | undefined>;
  actual_roe?: ColumnType<number | null, number | string | null | undefined, number | string | null | undefined>;
  forex_gain_loss?: ColumnType<number | null, number | string | null | undefined, number | string | null | undefined>;
  roe_clause_agreed?: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  si_cutoff_date?: Date | null;
  vgm_cutoff_date?: Date | null;
  port_cutoff_date?: Date | null;
  status: ColumnType<'active' | 'completed' | 'cancelled', 'active' | 'completed' | 'cancelled' | undefined, 'active' | 'completed' | 'cancelled' | undefined>;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeContainerTable {
  id: Generated<string>;
  tenant_id: string;
  job_id: string;
  container_number: string;
  container_type: string;
  seal_number: string | null;
  gross_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  cbm: ColumnType<number, number | string | undefined, number | string | undefined>;
  gated_in_at: Date | null;
  vessel_loaded_at: Date | null;
  discharged_at: Date | null;
  gated_out_at: Date | null;
  empty_returned_at: Date | null;
  free_days: number;
  return_deadline: string | null;
  is_overdue: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  overdue_days: ColumnType<number, number | undefined, number | undefined>;
  demurrage_rate_per_day: ColumnType<number, number | string | undefined, number | string | undefined>;
  demurrage_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  deposit_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  deposit_currency: string;
  deposit_status: 'not_required' | 'held_by_line' | 'pending_return_proof' | 'refunded_to_treasury';
  deposit_treasury_id: number | null;
  empty_return_proof_url: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeCustomsDeclarationTable {
  id: Generated<string>;
  tenant_id: string;
  job_id: string;
  declaration_number: string | null;
  declaration_type: 'import' | 'export';
  customs_authority: string | null;
  broker_name: string | null;
  submitted_date: string | null;
  cleared_date: string | null;
  status: 'pending' | 'submitted' | 'cleared' | 'held' | 'rejected';
  total_customs_value: ColumnType<number, number | string | undefined, number | string | undefined>;
  total_duty_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  currency: string;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeCustomsDeclarationItemTable {
  id: Generated<string>;
  tenant_id: string;
  declaration_id: string;
  hs_code: string;
  commodity_description: string;
  quantity: ColumnType<number, number | string | undefined, number | string | undefined>;
  unit: string;
  customs_value: ColumnType<number, number | string | undefined, number | string | undefined>;
  duty_rate_percent: ColumnType<number, number | string | undefined, number | string | undefined>;
  duty_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface MaritimeJobMilestoneTable {
  id: Generated<string>;
  tenant_id: string;
  job_id: string;
  milestone_key: string;
  milestone_title: string;
  occurred_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  location: string | null;
  notes: string | null;
  recorded_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface MaritimeCarrierInvoiceTable {
  id: Generated<string>;
  tenant_id: string;
  job_id: string | number;
  shipping_line_id: string | number | null;
  carrier_name: string;
  invoice_number: string;
  invoice_date: ColumnType<string, string | Date | undefined, string | Date | undefined>;
  currency: string;
  total_invoiced_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  ocean_freight: ColumnType<number, number | string | undefined, number | string | undefined>;
  thc_charges: ColumnType<number, number | string | undefined, number | string | undefined>;
  baf_charges: ColumnType<number, number | string | undefined, number | string | undefined>;
  detention_demurrage: ColumnType<number, number | string | undefined, number | string | undefined>;
  other_charges: ColumnType<number, number | string | undefined, number | string | undefined>;
  rate_card_id: string | number | null;
  contracted_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  variance_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  variance_pct: ColumnType<number, number | string | undefined, number | string | undefined>;
  audit_status: 'pending' | 'matched' | 'overcharge' | 'undercharge' | 'no_contract' | 'approved_override' | 'disputed';
  override_approved_by: number | null;
  override_approved_at: Date | null;
  override_reason: string | null;
  journal_entry_id: number | null;
  payment_status: 'unpaid' | 'partially_paid' | 'paid' | 'held_for_dispute';
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeCarrierDisputeTable {
  id: Generated<string>;
  tenant_id: string;
  dispute_number: string;
  invoice_id: string | number;
  job_id: string | number;
  carrier_name: string;
  disputed_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  currency: string;
  dispute_reason: string;
  dispute_status: 'draft' | 'submitted' | 'accepted' | 'rejected' | 'partially_accepted';
  resolution_notes: string | null;
  credit_note_number: string | null;
  credit_note_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  created_by: number | null;
  resolved_by: number | null;
  resolved_at: Date | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeQuotationChargeTable {
  id: Generated<string>;
  tenant_id: string;
  quotation_id: string;
  charge_code: string;
  charge_name_ar: string;
  charge_name_en: string;
  currency: string;
  unit_rate: ColumnType<number, number | string | undefined, number | string | undefined>;
  quantity: ColumnType<number, number | string | undefined, number | string | undefined>;
  total_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  is_local_charge: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  tax_rate_percent: ColumnType<number, number | string | undefined, number | string | undefined>;
  tax_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface MaritimeJobChargeTable {
  id: Generated<string>;
  tenant_id: string;
  job_id: string;
  charge_code: string;
  charge_name_ar: string;
  charge_name_en: string;
  currency: string;
  cost_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  sell_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  profit_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  is_local_charge: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  tax_rate_percent: ColumnType<number, number | string | undefined, number | string | undefined>;
  tax_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  is_invoiced: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface MaritimeJobDocumentTable {
  id: Generated<string>;
  tenant_id: string;
  job_id: string;
  doc_type: string;
  title: string;
  file_name: string;
  file_url: string;
  file_size_bytes: ColumnType<number, number | undefined, number | undefined>;
  mime_type: string;
  notes: string | null;
  uploaded_by: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface MaritimeAgentSettlementTable {
  id: Generated<string>;
  tenant_id: string;
  agent_id: string | null;
  agent_name: string;
  job_id: string | null;
  job_number: string | null;
  settlement_type: 'debit_note' | 'credit_note' | 'profit_share' | 'offset_clearing';
  currency: string;
  amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  profit_share_percent: ColumnType<number, number | string | undefined, number | string | undefined>;
  local_equivalent_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  exchange_rate: ColumnType<number, number | string | undefined, number | string | undefined>;
  reference_number: string | null;
  status: 'pending' | 'approved' | 'cleared' | 'disputed';
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeInlandTruckingTripTable {
  id: Generated<string>;
  tenant_id: string;
  job_id: string;
  trip_number: string;
  container_number: string | null;
  trucking_company: string;
  driver_name: string;
  driver_phone: string | null;
  truck_plate: string;
  trailer_plate: string | null;
  origin_port_terminal: string;
  delivery_destination: string;
  dispatch_date: Date | null;
  delivery_date: Date | null;
  trip_status: 'assigned' | 'loading' | 'in_transit' | 'delivered' | 'empty_returned';
  cost_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  sell_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  currency: string;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeCarrierApiEventTable {
  id: Generated<string>;
  tenant_id: string;
  carrier_code: string;
  tracking_number: string;
  event_type: string;
  event_location: string | null;
  event_time: Date;
  raw_payload: any;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface ContractingProjectTable {
  id: Generated<string>;
  tenant_id: string;
  code: string;
  name: string;
  client_id: number | null;
  client_name: string;
  status: ColumnType<'planning' | 'active' | 'suspended' | 'completed' | 'handed_over', string | undefined, string | undefined>;
  contract_value: ColumnType<number, number | string | undefined, number | string | undefined>;
  revised_contract_value: ColumnType<number, number | string | undefined, number | string | undefined>;
  down_payment_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  down_payment_recovered: ColumnType<number, number | string | undefined, number | string | undefined>;
  retention_percent: ColumnType<number, number | string | undefined, number | string | undefined>;
  retention_total_held: ColumnType<number, number | string | undefined, number | string | undefined>;
  retention_released: ColumnType<number, number | string | undefined, number | string | undefined>;
  start_date: string | null;
  expected_end_date: string | null;
  actual_end_date: string | null;
  site_location_id: number | null;
  cost_center_id: number | null;
  project_manager: string | null;
  location_address: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingDocumentTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  doc_number: string;
  title: string;
  discipline: string;
  doc_type: 'drawing' | 'specification' | 'contract' | 'correspondence' | 'method_statement' | 'other';
  current_revision_id: string | null;
  status: 'draft' | 'for_review' | 'approved' | 'superseded' | 'void';
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingDocumentRevisionTable {
  id: Generated<string>;
  tenant_id: string;
  document_id: string;
  rev_code: string;
  file_ref: string | null;
  review_status: 'for_review' | 'approved' | 'approved_as_noted' | 'revise_resubmit' | 'rejected' | 'superseded';
  issued_date: string;
  reviewed_by: string | null;
  review_date: string | null;
  review_comments: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingDocumentDistributionTable {
  id: Generated<string>;
  tenant_id: string;
  document_id: string;
  revision_id: string;
  recipient_name: string;
  recipient_role: 'internal' | 'consultant' | 'owner' | 'subcontractor' | 'authority' | 'other';
  distribution_method: 'email' | 'whatsapp' | 'hand' | 'portal' | 'other';
  distributed_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  acknowledged_at: ColumnType<Date, string | Date | undefined, string | Date | undefined> | null;
  notes: string | null;
  created_by: number | null;
}

export interface ContractingMeetingMinuteTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  minute_number: string;
  meeting_type: string;
  meeting_date: string;
  location: string | null;
  attendees: ColumnType<unknown, string | undefined, string | undefined>;
  agenda: string | null;
  summary: string | null;
  prepared_by: string | null;
  status: 'draft' | 'issued';
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingMeetingActionItemTable {
  id: Generated<string>;
  tenant_id: string;
  minute_id: string;
  description: string;
  owner_name: string | null;
  due_date: string | null;
  status: 'open' | 'closed';
  linked_rfi_id: string | null;
  linked_change_order_id: string | null;
  closed_at: ColumnType<Date, string | Date | undefined, string | Date | undefined> | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingBoqItemTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  item_code: string;
  description: string;
  category: string;
  unit: string;
  contract_qty: ColumnType<number, number | string | undefined, number | string | undefined>;
  revised_qty: ColumnType<number, number | string | undefined, number | string | undefined>;
  unit_price: ColumnType<number, number | string | undefined, number | string | undefined>;
  total_price: ColumnType<number, number | string | undefined, number | string | undefined>;
  estimated_unit_cost: ColumnType<number, number | string | undefined, number | string | undefined>;
  executed_qty: ColumnType<number, number | string | undefined, number | string | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingChangeOrderTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  change_order_number: string;
  title: string;
  reason: string;
  impact_type: 'cost_only' | 'time_only' | 'cost_and_time';
  cost_impact: ColumnType<number, number | string | undefined, number | string | undefined>;
  time_impact_days: number;
  status: ColumnType<'draft' | 'pending_approval' | 'approved' | 'rejected', string | undefined, string | undefined>;
  approved_by: string | null;
  approved_at: Date | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingInvoiceTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  ipc_number: string;
  ipc_type: ColumnType<'client' | 'subcontractor', string | undefined, string | undefined>;
  subcontract_id: string | null;
  subcontractor_id: number | null;
  subcontractor_name: string;
  sequence_order: number;
  period_start: string | null;
  period_end: string | null;
  previous_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  current_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  stored_materials_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  cumulative_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  advance_recovery_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  retention_held_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  other_deductions: ColumnType<number, number | string | undefined, number | string | undefined>;
  gross_work_done_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  escalation_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  mos_added_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  mos_released_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  mos_balance_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  backcharge_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  ld_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  material_excess_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  shared_resource_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  direct_payment_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  carried_forward_debit_in?: ColumnType<number, number | string | undefined, number | string | undefined>;
  carried_forward_debit_out?: ColumnType<number, number | string | undefined, number | string | undefined>;
  taxable_base_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  vat_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  wht_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  social_insurance_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  claimed_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  certified_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  certification_due_date?: string | null;
  payment_due_date?: string | null;
  linked_client_invoice_id?: string | null;
  calc_engine_version?: string;
  calc_inputs_snapshot?: any;
  net_payable: ColumnType<number, number | string | undefined, number | string | undefined>;
  status: ColumnType<'draft' | 'under_review' | 'approved' | 'paid', string | undefined, string | undefined>;
  journal_entry_id: number | null;
  approved_by: string | null;
  approved_at: Date | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingInvoiceItemTable {
  id: Generated<string>;
  tenant_id: string;
  invoice_id: string;
  boq_item_id: string | null;
  wir_id?: string | null;
  description: string;
  unit: string;
  unit_price: ColumnType<number, number | string | undefined, number | string | undefined>;
  previous_qty: ColumnType<number, number | string | undefined, number | string | undefined>;
  current_qty: ColumnType<number, number | string | undefined, number | string | undefined>;
  claimed_qty?: ColumnType<number, number | string | undefined, number | string | undefined>;
  certified_qty?: ColumnType<number, number | string | undefined, number | string | undefined>;
  stored_materials_qty: ColumnType<number, number | string | undefined, number | string | undefined>;
  cumulative_qty: ColumnType<number, number | string | undefined, number | string | undefined>;
  completion_percent: ColumnType<number, number | string | undefined, number | string | undefined>;
  current_total: ColumnType<number, number | string | undefined, number | string | undefined>;
  cumulative_total: ColumnType<number, number | string | undefined, number | string | undefined>;
  variance_reason?: string | null;
  progress_stage?: string | null;
  stage_weight_pct?: ColumnType<number | null, number | string | null | undefined, number | string | null | undefined>;
  change_order_id?: string | null;
  notes: string | null;
}

export interface ContractingSubcontractTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  subcontractor_id: number;
  contract_number: string;
  contract_type?: ColumnType<'supply_and_apply' | 'labor_only' | 'supply_only' | 'labor_plus_consumables', string | undefined, string | undefined>;
  scope_of_work: string;
  total_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  retention_percent: ColumnType<number, number | string | undefined, number | string | undefined>;
  advance_pct?: ColumnType<number, number | string | undefined, number | string | undefined>;
  advance_amount?: ColumnType<number, number | string | undefined, number | string | undefined>;
  advance_recovery_start_pct?: ColumnType<number, number | string | undefined, number | string | undefined>;
  advance_recovery_end_pct?: ColumnType<number, number | string | undefined, number | string | undefined>;
  retention_limit_pct?: ColumnType<number, number | string | undefined, number | string | undefined>;
  penalty_per_day?: ColumnType<number, number | string | undefined, number | string | undefined>;
  ld_cap_pct?: ColumnType<number, number | string | undefined, number | string | undefined>;
  liability_cap_amount?: ColumnType<number | null, number | string | null | undefined, number | string | null | undefined>;
  wht_rate?: ColumnType<number, number | string | undefined, number | string | undefined>;
  social_insurance_pct?: ColumnType<number, number | string | undefined, number | string | undefined>;
  payment_linkage_mode?: ColumnType<'independent' | 'pay_when_paid' | 'pay_when_certified', string | undefined, string | undefined>;
  payment_terms_days?: number;
  tail_reserve_pct?: ColumnType<number, number | string | undefined, number | string | undefined>;
  wastage_allowance_pct?: ColumnType<number, number | string | undefined, number | string | undefined>;
  mos_admissible_pct?: ColumnType<number, number | string | undefined, number | string | undefined>;
  mos_cap_pct?: ColumnType<number, number | string | undefined, number | string | undefined>;
  assignment_permitted?: boolean;
  dlp_months?: number;
  revised_contract_sum?: ColumnType<number, number | string | undefined, number | string | undefined>;
  revised_completion_date?: string | null;
  approved_eot_days?: number;
  baseline_frozen_at?: Date | null;
  start_date: string | null;
  end_date: string | null;
  status: ColumnType<'active' | 'completed' | 'terminated', string | undefined, string | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingIpcDeductionTable {
  id: Generated<string>;
  tenant_id: string;
  invoice_id: string;
  deduction_type: string;
  source_table: string | null;
  source_id: string | null;
  amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  vat_treatment: string;
  debit_note_ref: string | null;
  notice_ref: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  description: string;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface ContractingSubcontractorTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string | null;
  name: string;
  trade_specialty: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  commercial_reg: string | null;
  national_id: string | null;
  bank_name: string | null;
  bank_iban: string | null;
  contact_person: string | null;
  rating: ColumnType<number, number | string | undefined, number | string | undefined>;
  status: ColumnType<'active' | 'suspended' | 'blacklisted', string | undefined, string | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingRetentionRecordTable {
  id: Generated<number>;
  tenant_id: string;
  project_id: string;
  subcontract_id: string | null;
  party_type: string;
  party_id: number | null;
  party_name: string;
  held_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  released_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  retention_percent: ColumnType<number, number | string | undefined, number | string | undefined>;
  ipc_invoice_id: string | null;
  release_due_date: ColumnType<string | null, string | Date | null | undefined, string | Date | null | undefined>;
  status: ColumnType<string, string | undefined, string | undefined>;
  guarantee_certificate_ref: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingSubcontractorPaymentTable {
  request_key?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  request_fingerprint?: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  id: Generated<number>;
  tenant_id: string;
  project_id: string | null;
  subcontractor_id: number;
  subcontract_id: string | null;
  invoice_id: string | null;
  payment_number: string;
  payment_date: string;
  amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  payment_method: ColumnType<'cash' | 'bank_transfer' | 'check', string | undefined, string | undefined>;
  payment_category: ColumnType<'advance' | 'progress' | 'retention' | 'operational_advance', string | undefined, string | undefined>;
  status: ColumnType<'completed' | 'cancelled', string | undefined, string | undefined>;
  reference_number: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingSiteDailyLogTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  log_date: string;
  weather_conditions: string | null;
  labor_count: number;
  subcontractor_labor_count: number;
  equipment_on_site: string | null;
  work_performed: string;
  delays_or_obstacles: string | null;
  materials_received: string | null;
  logged_by: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingRfiTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  rfi_number: string;
  subject: string;
  question: string;
  assigned_to: string | null;
  status: ColumnType<'open' | 'pending_reply' | 'answered' | 'closed', string | undefined, string | undefined>;
  answer: string | null;
  answered_by: string | null;
  answered_at: Date | null;
  date_requested: string;
  date_required: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingScheduleTaskTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  task_code: string;
  task_name: string;
  wbs_code: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  progress_percent: ColumnType<number, number | string | undefined, number | string | undefined>;
  predecessor_id: string | null;
  is_critical_path: boolean;
  status: ColumnType<'not_started' | 'in_progress' | 'completed' | 'delayed', string | undefined, string | undefined>;
  boq_item_id: string | null;
  assigned_team: string | null;
  planned_manpower_count: ColumnType<number, number | undefined, number | undefined>;
  planned_equipment_count: ColumnType<number, number | undefined, number | undefined>;
  resource_trade: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingMaterialRequisitionTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  requisition_number: string;
  boq_item_id: string | null;
  warehouse_id: number | null;
  product_id: number | null;
  item_name: string;
  unit: string;
  quantity: ColumnType<number, number | string | undefined, number | string | undefined>;
  unit_cost: ColumnType<number, number | string | undefined, number | string | undefined>;
  total_cost: ColumnType<number, number | string | undefined, number | string | undefined>;
  issue_date: string;
  recipient_name: string | null;
  status: ColumnType<'issued' | 'draft' | 'approved', string | undefined, string | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ContractingGuaranteeTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  subcontract_id: string | null;
  subcontractor_id: string | null;
  guarantee_number: string;
  guarantee_type: ColumnType<'advance_payment' | 'performance' | 'retention' | 'maintenance' | 'bid_bond', string | undefined, string | undefined>;
  issuing_bank: string;
  amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  currency: string;
  issue_date: string;
  expiry_date: string;
  claim_expiry_date: string | null;
  reduction_schedule: ColumnType<any, any | undefined, any | undefined>;
  status: ColumnType<'active' | 'expired' | 'released' | 'confiscated_invoked' | 'cancelled', string | undefined, string | undefined>;
  document_url: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeCargoInsuranceTable {
  id: Generated<string>;
  tenant_id: string;
  job_id: string | number;
  policy_number: string;
  insurance_company: string;
  insured_value: ColumnType<number, number | string | undefined, number | string | undefined>;
  premium_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  currency: string;
  coverage_type: 'all_risks' | 'clauses_a' | 'clauses_b' | 'clauses_c';
  issue_date: string;
  expiry_date: string | null;
  status: 'draft' | 'active' | 'claimed' | 'cancelled' | 'expired';
  claim_amount: ColumnType<number, number | string | undefined, number | string | undefined>;
  claim_status: string | null;
  claim_notes: string | null;
  certificate_url: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface MaritimeWarehouseReceiptTable {
  id: Generated<string>;
  tenant_id: string;
  receipt_number: string;
  job_id: string | number;
  location_id: string | number | null;
  received_date: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  package_count: number;
  gross_weight_kg: ColumnType<number, number | string | undefined, number | string | undefined>;
  cbm: ColumnType<number, number | string | undefined, number | string | undefined>;
  bay_rack_bin: string | null;
  warehouse_status: 'in_storage' | 'inspected' | 'released' | 'transferred';
  released_at: Date | null;
  released_by: number | null;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface Database {
  tamper_audit_logs: TamperAuditLogTable;
  approval_rules: ApprovalRuleTable;
  approval_requests: ApprovalRequestTable;
  approval_request_logs: ApprovalRequestLogTable;
  cost_center_allocations: CostCenterAllocationTable;
  cost_center_allocation_splits: CostCenterAllocationSplitTable;
  forex_revaluation_runs: ForexRevaluationRunTable;
  forex_revaluation_lines: ForexRevaluationLineTable;
  zatca_egs_units: ZatcaEgsUnitTable;
  zatca_transmission_logs: ZatcaTransmissionLogTable;
  shipping_ports: ShippingPortTable;
  shipping_lines: ShippingLineTable;
  maritime_inquiries: MaritimeInquiryTable;
  maritime_rfqs: MaritimeRfqTable;
  maritime_rfq_bids: MaritimeRfqBidTable;
  maritime_rate_cards: MaritimeRateCardTable;
  maritime_customs_declarations: MaritimeCustomsDeclarationTable;
  maritime_customs_declaration_items: MaritimeCustomsDeclarationItemTable;
  maritime_quotations: MaritimeQuotationTable;
  maritime_jobs: MaritimeJobTable;
  maritime_containers: MaritimeContainerTable;
  maritime_job_milestones: MaritimeJobMilestoneTable;
  maritime_carrier_invoices: MaritimeCarrierInvoiceTable;
  maritime_carrier_disputes: MaritimeCarrierDisputeTable;
  maritime_cargo_insurances: MaritimeCargoInsuranceTable;
  maritime_warehouse_receipts: MaritimeWarehouseReceiptTable;
  maritime_quotation_charges: MaritimeQuotationChargeTable;
  maritime_job_charges: MaritimeJobChargeTable;
  maritime_job_documents: MaritimeJobDocumentTable;
  maritime_agent_settlements: MaritimeAgentSettlementTable;
  maritime_inland_trucking_trips: MaritimeInlandTruckingTripTable;
  maritime_carrier_api_events: MaritimeCarrierApiEventTable;
  contracting_projects: ContractingProjectTable;
  contracting_documents: ContractingDocumentTable;
  contracting_document_revisions: ContractingDocumentRevisionTable;
  contracting_document_distributions: ContractingDocumentDistributionTable;
  contracting_meeting_minutes: ContractingMeetingMinuteTable;
  contracting_meeting_action_items: ContractingMeetingActionItemTable;
  contracting_boq_items: ContractingBoqItemTable;
  contracting_change_orders: ContractingChangeOrderTable;
  contracting_invoices: ContractingInvoiceTable;
  contracting_retention_records: ContractingRetentionRecordTable;
  contracting_invoice_items: ContractingInvoiceItemTable;
  contracting_subcontracts: ContractingSubcontractTable;
  contracting_subcontractors: ContractingSubcontractorTable;
  contracting_subcontractor_payments: ContractingSubcontractorPaymentTable;
  contracting_guarantees: ContractingGuaranteeTable;
  contracting_site_daily_logs: ContractingSiteDailyLogTable;
  contracting_rfis: ContractingRfiTable;
  contracting_schedule_tasks: ContractingScheduleTaskTable;
  contracting_material_requisitions: ContractingMaterialRequisitionTable;
  ai_knowledge_sources: AiKnowledgeSourceTable;
  ai_knowledge_chunks: AiKnowledgeChunkTable;
  ai_chat_sessions: AiChatSessionTable;
  ai_chat_messages: AiChatMessageTable;
}

export interface AiKnowledgeSourceTable {
  id: Generated<number>;
  tenant_id: string;
  title: string;
  source_type: string;
  content_hash: string | null;
  raw_text: string | null;
  file_url: string | null;
  file_size: number;
  status: string;
  chunk_count: number;
  token_count: number;
  metadata: Record<string, unknown> | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface AiKnowledgeChunkTable {
  id: Generated<number>;
  tenant_id: string;
  source_id: number;
  chunk_index: number;
  content: string;
  embedding: number[] | null;
  token_count: number;
  metadata: Record<string, unknown> | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface AiChatSessionTable {
  id: string;
  tenant_id: string;
  user_id: number | null;
  title: string;
  is_active: boolean;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface AiChatMessageTable {
  id: Generated<number>;
  session_id: string;
  tenant_id: string;
  role: string;
  content: string;
  reasoning_steps: Array<Record<string, unknown>> | null;
  tool_calls: Array<Record<string, unknown>> | null;
  suggested_questions: string[] | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface ArDunningLevelsTable {
  id: string;
  tenant_id: string;
  level_order: number;
  level_name: string;
  days_past_due: number;
  auto_block_sales: boolean;
  action_type: string;
  template_text: string;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ArCollectionCasesTable {
  id: string;
  tenant_id: string;
  customer_id: number;
  current_level_id: string | null;
  total_overdue: number;
  oldest_overdue_days: number;
  status: string;
  promised_payment_date: string | null;
  promised_amount: number | null;
  assigned_collector_id: number | null;
  last_contact_date: ColumnType<Date, string | Date | undefined, string | Date | undefined> | null;
  next_followup_date: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ArCollectionLogsTable {
  id: string;
  tenant_id: string;
  case_id: string;
  interaction_type: string;
  result_status: string;
  details: string | null;
  promised_date: string | null;
  promised_amount: number | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface Database {
  ar_dunning_levels: ArDunningLevelsTable;
  ar_collection_cases: ArCollectionCasesTable;
  ar_collection_logs: ArCollectionLogsTable;
  custom_bi_pivot_reports: CustomBiPivotReportsTable;
  commercial_subscriptions: CommercialSubscriptionTable;
  commercial_subscription_lines: CommercialSubscriptionLinesTable;
  warehouse_packages: WarehousePackageTable;
  warehouse_package_items: WarehousePackageItemTable;
  quality_control_points: QualityControlPointsTable;
  quality_inspections: QualityInspectionsTable;
  quality_non_conformance_reports: QualityNonConformanceReportsTable;
  recruitment_job_openings: RecruitmentJobOpeningsTable;
  recruitment_applicants: RecruitmentApplicantsTable;
  reordering_rules: ReorderingRulesTable;
  daily_commercial_rollups: DailyCommercialRollupTable;
}

export interface CommercialSubscriptionTable {
  id: string;
  tenant_id: string;
  contract_number: string;
  customer_id: number;
  billing_period: string; // 'monthly' | 'quarterly' | 'semi_annual' | 'annual'
  next_billing_date: string;
  auto_renew: boolean;
  recurring_amount: number;
  status: string; // 'draft' | 'active' | 'paused' | 'canceled' | 'expired'
  payment_method: string;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  last_generated_invoice_id: number | null;
  last_generated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined> | null;
  invoices_count: number;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface CommercialSubscriptionLinesTable {
  id: string;
  tenant_id: string;
  subscription_id: string;
  product_id: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  total_price: number;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface CustomBiPivotReportsTable {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  dataset: string;
  row_dimension: string;
  col_dimension: string | null;
  metric: string;
  date_from: string | null;
  date_to: string | null;
  filters: any | null;
  created_by: number | null;
  is_favorite: boolean;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface WarehousePackageTable {
  id: string;
  tenant_id: string;
  package_number: string;
  package_type: string; // 'pallet' | 'box' | 'carton' | 'crate'
  parent_package_id: string | null;
  warehouse_id: number | null;
  location_id: number | null;
  status: string; // 'sealed' | 'opened' | 'shipped' | 'consumed'
  gross_weight_kg: number | null;
  net_weight_kg: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface WarehousePackageItemTable {
  id: string;
  tenant_id: string;
  package_id: string;
  product_id: number;
  quantity: number;
  unit_name: string | null;
  batch_number: string | null;
  serial_numbers: any | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface QualityControlPointsTable {
  id: string;
  tenant_id: string;
  name: string;
  product_id: number | null;
  trigger_stage: string; // 'receipt' | 'manufacturing' | 'delivery' | 'internal'
  test_type: string; // 'pass_fail' | 'measure' | 'checklist'
  norm_measure_min: number | null;
  norm_measure_max: number | null;
  measure_unit: string | null;
  instructions: string | null;
  is_mandatory: boolean;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface QualityInspectionsTable {
  id: string;
  tenant_id: string;
  point_id: string | null;
  reference_doc_type: string; // 'goods_receipt' | 'work_order' | 'delivery' | 'adhoc'
  reference_doc_id: string;
  product_id: number;
  inspected_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  measured_value: number | null;
  status: string; // 'passed' | 'failed' | 'conditional'
  inspector_id: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface QualityNonConformanceReportsTable {
  id: string;
  tenant_id: string;
  ncr_number: string;
  inspection_id: string | null;
  product_id: number;
  defect_description: string;
  severity: string; // 'minor' | 'major' | 'critical'
  root_cause: string | null;
  disposition_action: string; // 'quarantine_scrap' | 'return_to_vendor' | 'rework' | 'concession_accept'
  status: string; // 'open' | 'investigating' | 'resolved' | 'closed'
  resolution_notes: string | null;
  assigned_to: string | null;
  closed_at: ColumnType<Date, string | Date | undefined, string | Date | undefined> | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface RecruitmentJobOpeningsTable {
  id: string;
  tenant_id: string;
  job_code: string;
  title: string;
  department: string;
  experience_years_min: number;
  headcount: number;
  hired_count: number;
  description: string | null;
  requirements: string | null;
  status: string; // 'draft' | 'published' | 'closed'
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface RecruitmentApplicantsTable {
  id: string;
  tenant_id: string;
  job_id: string | null;
  applicant_number: string;
  full_name: string;
  email: string | null;
  phone: string;
  expected_salary: number | null;
  experience_years: number;
  stage: string; // 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'
  rating: number;
  talent_pool_tag: string | null;
  cv_url: string | null;
  interview_notes: string | null;
  hired_employee_id: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface ReorderingRulesTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: string;
  product_id: number;
  warehouse_id: number | null;
  branch_id: number | null;
  min_qty: number;
  max_qty: number;
  qty_multiple: number;
  preferred_supplier_id: number | null;
  action_mode: string;
  is_active: boolean;
  last_run_at: ColumnType<Date, string | Date | undefined, string | Date | undefined> | null;
  last_trigger_status: string | null;
  last_generated_po_id: number | null;
  notes: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface DailyCommercialRollupTable {
  id: Generated<number>;
  tenant_id: string;
  rollup_date: ColumnType<Date, string | Date, string | Date>;
  branch_id: number | null;
  branch_key: number;
  sales_count: number;
  sales_total: number;
  cash_sales_total: number;
  credit_sales_total: number;
  cogs_total: number;
  gross_profit: number;
  returns_count: number;
  returns_total: number;
  expenses_total: number;
  net_profit: number;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface RestaurantTableReservationTable {
  id: Generated<number>;
  tenant_id: string;
  branch_id: number | null;
  table_number: string;
  guest_name: string;
  guest_phone: string | null;
  guest_count: number;
  reservation_time: ColumnType<Date, string | Date, string | Date>;
  status: 'confirmed' | 'seated' | 'cancelled' | 'no_show';
  special_requests: string | null;
  created_by: number | null;
  reservation_type?: 'reservation' | 'waitlist' | string;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface RestaurantTableServiceCallTable {
  id: Generated<number>;
  tenant_id: string;
  branch_id: number | null;
  table_number: string;
  call_type: 'waiter' | 'bill' | 'water' | 'clean' | string;
  status: 'pending' | 'resolved';
  created_at: ColumnType<Date, string | Date | undefined, never>;
  resolved_at?: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  bill_amount?: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  tip_amount?: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  payment_reference?: string | null;
  payment_status?: string | null;
}

export interface PosKitchenPrinterTable {
  id: Generated<number>;
  tenant_id: string;
  branch_id: number | null;
  name: string;
  station_code: string;
  ip_address: string | null;
  port: number;
  paper_width: string;
  is_active: boolean;
  category_ids: unknown;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface Restaurant86ItemTable {
  id: Generated<number>;
  tenant_id: string;
  branch_id: number | null;
  product_id: number | string;
  product_name: string;
  component_product_id: number | string | null;
  is_86ed: boolean;
  reason: string | null;
  auto_restore_at: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  created_by: number | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface RestaurantTipPoolTable {
  id: Generated<number>;
  tenant_id: string;
  branch_id: number | null;
  shift_date: ColumnType<string, string | undefined, string | undefined>;
  shift_name: string;
  total_cash_tips: number;
  total_card_tips: number;
  total_tips: number;
  distribution_method: string;
  status: string;
  notes: string | null;
  distributed_by: number | null;
  distributed_at: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface RestaurantTipPoolDistributionTable {
  id: Generated<number>;
  tenant_id: string;
  pool_id: number;
  employee_id: number;
  employee_name: string;
  role_name: string;
  hours_worked: number;
  point_weight: number;
  allocated_amount: number;
  is_paid: boolean;
  paid_at: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface RestaurantTableZoneTable {
  id: Generated<number>;
  tenant_id: string;
  branch_id: number | null;
  zone_code: string;
  name: string;
  sort_order: number;
  capacity_seats: number;
  table_numbers: unknown;
  minimum_spend?: number;
  is_active: boolean;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface RestaurantPrepSheetTable {
  id: Generated<number>;
  tenant_id: string;
  branch_id: number | null;
  prep_date: ColumnType<string, string | undefined, string | undefined>;
  shift_type: string;
  status: string;
  prepared_by: number | null;
  completed_at: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface RestaurantPrepSheetItemTable {
  id: Generated<number>;
  tenant_id: string;
  prep_sheet_id: number;
  product_id: number | string;
  product_name: string;
  unit_name: string;
  par_level: number;
  current_on_hand: number;
  prep_required: number;
  prep_actual: number;
  shelf_life_hours?: number;
  storage_temp?: string;
  status: string;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface RestaurantStampCardTable {
  id: Generated<number>;
  tenant_id: string;
  customer_id: number | string;
  program_name: string;
  target_stamps: number;
  current_stamps: number;
  total_completed_cards: number;
  reward_description: string | null;
  last_stamped_at: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface RestaurantManagerCompTable {
  id: Generated<number>;
  tenant_id: string;
  branch_id: number | null;
  sale_id: number | string | null;
  table_number: string | null;
  comp_type: string;
  manager_name: string;
  amount: number;
  items_summary: string | null;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface RestaurantTableRatingTable {
  id: Generated<number>;
  tenant_id: string;
  branch_id: number | null;
  table_number: string;
  sale_id: number | string | null;
  rating: number;
  feedback_category: string | null;
  notes: string | null;
  is_rescued: boolean;
  rescued_by: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface RestaurantDriveThruOrderTable {
  id: Generated<number>;
  tenant_id: string;
  branch_id: number | null;
  vehicle_plate: string;
  vehicle_desc: string | null;
  sale_id: number | string | null;
  status: string; // 'order_taken', 'at_window', 'completed', 'cancelled'
  order_time: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
  window_arrival_time: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  completed_time: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  sos_seconds: number | null;
  total_amount: number;
  notes: string | null;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface RestaurantUpsellRuleTable {
  id: Generated<number>;
  tenant_id: string;
  trigger_product_id: number | string | null;
  trigger_category_name: string | null;
  suggested_product_id: number | string;
  suggested_product_name: string;
  title: string;
  discount_amount: number;
  is_active: boolean;
  created_at: ColumnType<Date, string | Date | undefined, never>;
}

export interface RestaurantTableLayoutTable {
  id: Generated<number>;
  tenant_id: string;
  branch_id: number | null;
  table_number: string;
  zone_code: string | null;
  shape: string; // 'square', 'round', 'rectangle', 'booth'
  x_pos: number;
  y_pos: number;
  width: number | null;
  height: number | null;
  seats: number;
  rotation: number | null;
  is_active: boolean;
  created_at: ColumnType<Date, string | Date | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface FmcgPromotionTable {
  id: Generated<number>;
  tenant_id: string;
  name: string;
  code: string;
  promo_type: 'mix_and_match' | 'tiered_qty' | 'invoice_threshold' | string;
  apply_type: 'free_bonus' | 'discount_percent' | 'discount_amount' | string;
  buy_conditions: ColumnType<any, any, any>;
  reward: ColumnType<any, any, any>;
  customer_types: ColumnType<any, any, any>;
  start_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  end_date: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  is_active: ColumnType<boolean, boolean | undefined, boolean>;
  max_applications_per_order: ColumnType<number, number | undefined, number>;
  priority: ColumnType<number, number | undefined, number>;
  notes: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface VanStoreVisitTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: number;
  trip_id: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  rep_id: number;
  customer_id: number;
  customer_name: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  check_in_at: ColumnType<Date, string | undefined, never>;
  check_out_at: ColumnType<Date | null, string | Date | null | undefined, string | Date | null | undefined>;
  dwell_time_seconds: ColumnType<number, number | undefined, number>;
  check_in_lat: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  check_in_lng: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  is_geofence_valid: ColumnType<boolean, boolean | undefined, boolean>;
  geofence_distance_meters: ColumnType<number, number | undefined, number>;
  has_sale: ColumnType<boolean, boolean | undefined, boolean>;
  sale_id: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  sale_amount: ColumnType<number, number | string | undefined, number | string>;
  has_collection: ColumnType<boolean, boolean | undefined, boolean>;
  collection_amount: ColumnType<number, number | string | undefined, number | string>;
  no_sale_reason: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  no_sale_notes: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  store_inventory: ColumnType<any, any, any>;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface VanTradeMarketingSurveyTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: number;
  visit_id: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  trip_id: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  rep_id: number;
  customer_id: number;
  survey_type: 'cooler_inspection' | 'asset_tracking' | 'competitor_survey' | string;
  asset_id: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  asset_name: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  asset_condition: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  is_pure_company_products: ColumnType<boolean, boolean | undefined, boolean>;
  temperature_celsius: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  cleanliness_rating: ColumnType<number, number | undefined, number>;
  photo_url: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  competitor_name: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  competitor_product: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  competitor_price: ColumnType<number | null, number | string | null | undefined, number | string | null | undefined>;
  competitor_offer_details: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  notes: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  metadata: ColumnType<any, any, any>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface VanRepLiveBreadcrumbTable {
  id: Generated<number>;
  tenant_id: string;
  account_id: number;
  trip_id: number;
  rep_id: number;
  latitude: number;
  longitude: number;
  speed_kmh: ColumnType<number, number | undefined, number>;
  battery_level: ColumnType<number, number | undefined, number>;
  recorded_at: ColumnType<Date, string | undefined, never>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface VanDamagedSwapTable {
  id: Generated<number>;
  tenant_id: ColumnType<string, string | undefined, string | undefined>;
  account_id: ColumnType<string, string | undefined, string | undefined>;
  trip_id: number;
  customer_id: number;
  damaged_product_id: number;
  damaged_qty: number;
  damage_reason: string;
  replacement_product_id: number;
  replacement_qty: number;
  price_difference: ColumnType<number, number | undefined, number>;
  notes?: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | Date | undefined, string | Date | undefined>;
}

export interface Database {
  restaurant_table_reservations: RestaurantTableReservationTable;
  pos_kitchen_printers: PosKitchenPrinterTable;
  restaurant_table_service_calls: RestaurantTableServiceCallTable;
  restaurant_86_items: Restaurant86ItemTable;
  restaurant_tip_pools: RestaurantTipPoolTable;
  restaurant_tip_pool_distributions: RestaurantTipPoolDistributionTable;
  restaurant_table_zones: RestaurantTableZoneTable;
  restaurant_prep_sheets: RestaurantPrepSheetTable;
  restaurant_prep_sheet_items: RestaurantPrepSheetItemTable;
  restaurant_stamp_cards: RestaurantStampCardTable;
  restaurant_manager_comps: RestaurantManagerCompTable;
  restaurant_table_ratings: RestaurantTableRatingTable;
  restaurant_drive_thru_orders: RestaurantDriveThruOrderTable;
  restaurant_upsell_rules: RestaurantUpsellRuleTable;
  restaurant_table_layouts: RestaurantTableLayoutTable;
  fmcg_promotions: FmcgPromotionTable;
  van_store_visits: VanStoreVisitTable;
  van_trade_marketing_surveys: VanTradeMarketingSurveyTable;
  van_rep_live_breadcrumbs: VanRepLiveBreadcrumbTable;
  van_damaged_swaps: VanDamagedSwapTable;
}




// Import inventory tables are explicitly typed; shipment UUIDs never enter numeric references.
type ImportNumeric = ColumnType<number | string | null, number | string | null | undefined, number | string | null>;
type ImportDate = ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null>;
export interface ImportShipmentTable {
  id: Generated<string>;
  tenant_id: string;
  container_number: string;
  supplier_id: ColumnType<number | null, number | null | undefined, number | null>;
  bill_of_lading: string | null;
  arrival_date: ImportDate;
  shipping_date: ImportDate;
  shipped_date: ImportDate;
  eta_date: ImportDate;
  clearance_date: ImportDate;
  shipping_cost_usd: ImportNumeric;
  customs_cost_egp: ImportNumeric;
  internal_transport_cost_egp: ImportNumeric;
  exchange_rate_at_arrival: ImportNumeric;
  pricing_exchange_rate: ImportNumeric;
  status: ColumnType<string | null, string | undefined, string>;
  shipping_expense_id: number | null;
  customs_expense_id: number | null;
  transport_expense_id: number | null;
  project_id?: string | null;
  freight_type?: string | null;
  container_size?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  cbm_volume?: ImportNumeric;
  gross_weight_kg?: ImportNumeric;
  carrier_name?: string | null;
  free_demurrage_days?: number | null;
  demurrage_start_date?: ImportDate;
  demurrage_rate_per_day?: ImportNumeric;
  actual_demurrage_fees?: ImportNumeric;
  customs_declaration_no?: string | null;
  vat_refundable_egp?: ImportNumeric;
  is_consolidated?: boolean | null;
  cost_allocation_method?: string | null;
  late_expenses_total_egp?: ImportNumeric;
  late_cogs_adjustment_egp?: ImportNumeric;
  late_inventory_adjustment_egp?: ImportNumeric;
  freight_job_id?: string | null;
  broker_id?: string | null;
  container_status?: string | null;
  gate_out_date?: ImportDate;
  unstuffing_date?: ImportDate;
  empty_returned_date?: ImportDate;
  created_at: Generated<Date>;
}
export interface ImportShipmentItemTable {
  id: Generated<string>;
  tenant_id: string;
  shipment_id: string;
  product_id: number;
  quantity: number;
  factory_unit_price_usd: ImportNumeric;
  allocated_overhead_egp: ImportNumeric;
  landed_cost_egp: ImportNumeric;
  received_quantity: ImportNumeric;
  shortage_handling_method: ColumnType<string | null, string | undefined, string>;
  target_margin_percent: ImportNumeric;
  target_retail_margin: ImportNumeric;
  target_wholesale_margin: ImportNumeric;
  gross_weight_kg_unit?: ImportNumeric;
  cbm_unit?: ImportNumeric;
  total_weight_kg?: ImportNumeric;
  total_cbm?: ImportNumeric;
  allocated_duty_egp?: ImportNumeric;
  allocated_freight_egp?: ImportNumeric;
  allocated_other_expenses_egp?: ImportNumeric;
  created_at: Generated<Date>;
}
export interface ImportInventoryReceiptTable {
  id: Generated<number>;
  tenant_id: string;
  shipment_id: string;
  state: 'posted' | 'legacy_review_required';
  review_reason: string | null;
  posted_at: Date | null;
  created_by: number | null;
  created_at: Generated<Date>;
  journal_entry_id: number | null;
}

export interface ImportQuotationTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string | null;
  supplier_id: number;
  quotation_no: string;
  inquiry_date: ImportDate;
  expiry_date: ImportDate;
  incoterm: string | null;
  currency: string;
  item_name: string;
  product_id: number | null;
  unit_price_foreign: ImportNumeric;
  moq: number | null;
  production_lead_days: number | null;
  port_of_loading: string | null;
  estimated_freight_usd: ImportNumeric;
  estimated_customs_rate_percent: ImportNumeric;
  estimated_landed_cost_egp: ImportNumeric;
  status: string;
  selection_reason: string | null;
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ImportSampleOrderTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string | null;
  supplier_id: number;
  sample_code: string;
  item_name: string;
  sample_cost_foreign: ImportNumeric;
  freight_cost_foreign: ImportNumeric;
  currency: string;
  request_date: ImportDate;
  received_date: ImportDate;
  courier_tracking_no: string | null;
  quality_score: ImportNumeric;
  decision: string;
  reference_sample_approved: boolean;
  defect_analysis: string | null;
  photo_urls: any | null;
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ImportCustomsBrokerTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  license_no: string | null;
  phone: string | null;
  email: string | null;
  customs_ports: any | null;
  tax_number: string | null;
  commercial_registry: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ImportBrokerAdvanceTable {
  id: Generated<string>;
  serial_id: Generated<number>;
  tenant_id: string;
  broker_id: string;
  project_id: string | null;
  shipment_id: string | null;
  advance_no: string;
  amount_egp: ImportNumeric;
  disbursement_date: ImportDate;
  payment_method: string | null;
  treasury_account_id: number | null;
  status: string;
  settled_amount_egp: ImportNumeric;
  remaining_amount_egp: ImportNumeric;
  notes: string | null;
  created_by: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ImportBrokerExpenseTable {
  id: Generated<string>;
  serial_id: Generated<number>;
  tenant_id: string;
  broker_id: string;
  advance_id: string | null;
  project_id: string | null;
  shipment_id: string | null;
  receipt_no: string;
  expense_date: ImportDate;
  category: string;
  amount_egp: ImportNumeric;
  is_capitalized: boolean;
  is_refundable_vat: boolean;
  attachment_url: string | null;
  is_verified: boolean;
  verified_by: number | null;
  verified_at: Date | null;
  notes: string | null;
  created_at: Generated<Date>;
}

export interface ImportLateExpenseEventTable {
  id: Generated<number>;
  tenant_id: string;
  shipment_id: string;
  title: string;
  total_amount_egp: ImportNumeric;
  inventory_amount_egp: ImportNumeric;
  cogs_amount_egp: ImportNumeric;
  journal_entry_id: number | null;
  created_by: number | null;
  created_at: Generated<Date>;
  idempotency_key: string | null;
}

export interface ImportContainerRefundEventTable {
  id: Generated<string>;
  serial_id: Generated<number>;
  tenant_id: string;
  deposit_id: string;
  idempotency_key: string;
  refunded_amount_egp: ImportNumeric;
  deductions_amount_egp: ImportNumeric;
  treasury_account_id: number | null;
  journal_entry_id: number | null;
  created_by: number | null;
  created_at: Generated<Date>;
}

export interface ImportContainerDepositTable {
  id: Generated<string>;
  serial_id: Generated<number>;
  tenant_id: string;
  project_id: string | null;
  shipment_id: string;
  container_no: string;
  shipping_line: string;
  deposit_amount_egp: ImportNumeric;
  payment_date: ImportDate;
  expected_return_date: ImportDate;
  actual_return_date: ImportDate;
  refund_status: string;
  refunded_amount_egp: ImportNumeric;
  deductions_amount_egp: ImportNumeric;
  deduction_reason: string | null;
  treasury_account_id: number | null;
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ImportContainerPreorderTable {
  id: Generated<string>;
  serial_id: Generated<number>;
  tenant_id: string;
  preorder_no: string;
  project_id: string | null;
  shipment_id: string;
  customer_id: number;
  product_id: number;
  reserved_quantity: ImportNumeric;
  unit_price_egp: ImportNumeric;
  total_price_egp: ImportNumeric;
  deposit_amount_egp: ImportNumeric;
  refunded_amount_egp: ImportNumeric;
  deposit_treasury_account_id: number | null;
  status: string;
  sale_invoice_id: number | null;
  expected_delivery_date: ImportDate;
  notes: string | null;
  created_by: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ImportInventoryLotTable {
  id: Generated<string>;
  tenant_id: string;
  lot_number: string;
  project_id: string | null;
  shipment_id: string;
  shipment_item_id: string | null;
  product_id: number;
  location_id: number | null;
  initial_quantity: ImportNumeric;
  remaining_quantity: ImportNumeric;
  unit_landed_cost_egp: ImportNumeric;
  status: string;
  receipt_date: ImportDate;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ImportSaleAllocationTable {
  id: Generated<string>;
  tenant_id: string;
  sale_id: number;
  sale_item_id: number | null;
  lot_id: string;
  project_id: string | null;
  shipment_id: string | null;
  product_id: number;
  quantity: ImportNumeric;
  unit_sale_price_egp: ImportNumeric;
  unit_cost_egp: ImportNumeric;
  gross_margin_egp: ImportNumeric;
  allocation_type?: string;
  reversal_of_allocation_id?: string | null;
  created_at: Generated<Date>;
}

export interface ImportFxAcquisitionTable {
  id: Generated<string>;
  tenant_id: string;
  currency: string;
  foreign_amount: ImportNumeric;
  egp_cost: ImportNumeric;
  effective_exchange_rate: ImportNumeric;
  acquisition_date: ImportDate;
  source: string;
  bank_account_id: number | null;
  notes: string | null;
  created_at: Generated<Date>;
}

export interface ImportDocumentTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string | null;
  shipment_id: string | null;
  document_type: string;
  file_name: string;
  file_url: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  issue_date: ImportDate;
  expiry_date: ImportDate;
  is_verified: boolean;
  verified_by: number | null;
  verified_at: Date | null;
  notes: string | null;
  created_by: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ImportApprovalRequestTable {
  id: Generated<string>;
  tenant_id: string;
  module: string;
  action_type: string;
  reference_id: string;
  requested_by: number;
  approved_by: number | null;
  status: string;
  request_payload: any | null;
  rejection_reason: string | null;
  created_at: Generated<Date>;
  decided_at: Date | null;
}

export interface ImportReconciliationExceptionTable {
  id: Generated<string>;
  tenant_id: string;
  exception_type: string;
  severity: string;
  project_id: string | null;
  shipment_id: string | null;
  discrepancy_amount_egp: ImportNumeric;
  details: any | null;
  status: string;
  resolved_by: number | null;
  resolution_notes: string | null;
  resolved_at: Date | null;
  created_at: Generated<Date>;
}

export interface Database {
  import_shipments: ImportShipmentTable;
  import_shipment_items: ImportShipmentItemTable;
  import_inventory_receipts: ImportInventoryReceiptTable;
  import_partners: ImportPartnerTable;
  import_partner_ledger: ImportPartnerLedgerTable;
  import_projects: ImportProjectTable;
  import_project_partners: ImportProjectPartnerTable;
  import_suppliers_meta: ImportSupplierMetaTable;
  import_sourcing_trips: ImportSourcingTripTable;
  import_proforma_invoices: ImportProformaInvoiceTable;
  import_qc_inspections: ImportQcInspectionTable;
  import_aci_compliance: ImportAciComplianceTable;
  import_customs_tariffs: ImportCustomsTariffTable;
  import_quotations: ImportQuotationTable;
  import_sample_orders: ImportSampleOrderTable;
  import_customs_brokers: ImportCustomsBrokerTable;
  import_broker_advances: ImportBrokerAdvanceTable;
  import_broker_expenses: ImportBrokerExpenseTable;
  import_container_deposits: ImportContainerDepositTable;
  import_container_refund_events: ImportContainerRefundEventTable;
  import_late_expense_events: ImportLateExpenseEventTable;
  import_preorder_refund_events: {
    id: Generated<string>;
    serial_id: Generated<number>;
    tenant_id: string;
    preorder_id: string;
    idempotency_key: string;
    amount_egp: ImportNumeric;
    treasury_account_id: number;
    journal_entry_id: number | null;
    created_by: number | null;
    created_at: Generated<Date>;
  };
  import_partner_project_payouts: {
    id: Generated<number>;
    tenant_id: string;
    partner_id: string;
    project_id: string;
    treasury_transaction_id: number;
    amount_egp: ImportNumeric;
    created_by: number | null;
    created_at: Generated<Date>;
  };
  import_container_preorders: ImportContainerPreorderTable;
  import_inventory_lots: ImportInventoryLotTable;
  import_sale_allocations: ImportSaleAllocationTable;
  import_fx_acquisitions: ImportFxAcquisitionTable;
  import_documents: ImportDocumentTable;
  import_approval_requests: ImportApprovalRequestTable;
  import_reconciliation_exceptions: ImportReconciliationExceptionTable;
}
