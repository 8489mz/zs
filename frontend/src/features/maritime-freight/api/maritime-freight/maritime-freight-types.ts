export interface ShippingPort {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  country_code: string;
  country_name: string;
  port_type?: 'sea' | 'air' | 'road';
  iata_code?: string | null;
  icao_code?: string | null;
  is_active: boolean;
}

export interface ShippingLine {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  carrier_type?: 'shipping_line' | 'overseas_agent' | 'airline' | 'trucking';
  airline_prefix?: string | null;
  trade_lanes?: string | null;
  country_name?: string | null;
  country_code?: string | null;
  city_name?: string | null;
  contact_person: string | null;
  email: string | null;
  rfq_email: string | null;
  booking_email?: string | null;
  phone: string | null;
  whatsapp?: string | null;
  wechat?: string | null;
  services_offered?: string | null;
  supported_ports?: string | null;
  tracking_url_template: string | null;
  is_active: boolean;
  notes?: string | null;
}

export interface ContainerTypeSpec {
  code: string;
  name_ar: string;
  name_en: string;
  category: 'dry' | 'reefer' | 'special';
  length_feet: number;
  max_payload_kg: number;
  tare_weight_kg: number;
  max_cbm: number;
  internal_length_m: number;
  internal_width_m: number;
  internal_height_m: number;
  door_width_m: number;
  door_height_m: number;
  description_ar: string;
}

export interface IncotermRule {
  code: string;
  name_ar: string;
  name_en: string;
  rule_type: 'any_mode' | 'sea_inland_waterway';
  seller_pays_export_customs: boolean;
  seller_pays_origin_thc: boolean;
  seller_pays_ocean_freight: boolean;
  seller_pays_destination_thc: boolean;
  seller_pays_import_customs: boolean;
  seller_pays_insurance: boolean;
  risk_transfer_point_ar: string;
  description_ar: string;
}

export interface PortTerminal {
  code: string;
  name_ar: string;
  name_en: string;
  port_code: string;
  terminal_operator: string;
  terminal_type: 'container' | 'general_cargo' | 'bulk';
  notes?: string;
}

export interface ReferenceDataResponse {
  containerTypes: ContainerTypeSpec[];
  incoterms: IncotermRule[];
  portTerminals: PortTerminal[];
}

export interface MaritimeRfqBid {
  id: string;
  rfq_id: string;
  shipping_line_id: string | null;
  shipping_line_name: string;
  ocean_freight: number;
  currency: string;
  thc_origin: number;
  thc_destination: number;
  baf_charges: number;
  other_charges: number;
  total_freight_cost: number;
  transit_time_days: number;
  free_days: number;
  validity_date: string | null;
  submission_channel: string;
  is_awarded: boolean;
  awarded_at: string | null;
  notes: string | null;
  isBestValue?: boolean;
}

export interface MaritimeRfq {
  id: string;
  rfq_number: string;
  direction: 'import' | 'export' | 'cross_trade';
  transport_mode?: 'sea' | 'air' | 'road' | 'multimodal';
  air_cargo_type?: string | null;
  gross_weight_kg?: number;
  volumetric_weight_kg?: number;
  chargeable_weight_kg?: number;
  total_cbm?: number;
  package_count?: number;
  flight_number?: string | null;
  flight_date?: string | null;
  mawb_number?: string | null;
  hawb_number?: string | null;
  pol_code: string;
  pol_name: string;
  pod_code: string;
  pod_name: string;
  incoterm: string;
  cargo_mode: string;
  container_type: string;
  container_count: number;
  commodity_description: string;
  cargo_nature: string;
  cargo_ready_date: string | null;
  target_free_days: number;
  payment_term: 'prepaid' | 'collect';
  target_line_ids: number[];
  status: 'draft' | 'sent' | 'bids_received' | 'awarded' | 'cancelled';
  customer_id?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  inquiry_id?: string | null;
  notes: string | null;
  urgency_level?: 'standard' | 'urgent';
  cut_off_deadline?: string | null;
  auto_awarded?: boolean;
  target_rate_max?: number | null;
  created_at: string;
  bidsCount?: number;
  bestBid?: MaritimeRfqBid | null;
  bids?: MaritimeRfqBid[];
}

export interface MaritimePipelineConfig {
  enableSeaFreight?: boolean;
  enableAirFreight?: boolean;
  enableRoadFreight?: boolean;
  automationMode: 'manual' | 'hybrid' | 'full_autonomous';
  defaultMarginType: 'fixed' | 'percentage';
  defaultMarginValue: number;
  marginFloor: number;
  rfqCutOffHoursStandard: number;
  rfqCutOffHoursUrgent: number;
  earlyAwardingEnabled: boolean;
  earlyAwardingMinFreeDays: number;
  requireManualRfqDispatch: boolean;
  requireManualAwardAndMargin: boolean;
  requireManualQuoteDispatch: boolean;
  autoSendWhatsAppQuote: boolean;
  autoSendEmailQuote: boolean;
}

export interface MaritimeQuotation {
  id: string;
  quotation_number: string;
  rfq_id: string | null;
  bid_id: string | null;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  transport_mode?: 'sea' | 'air' | 'road' | 'multimodal';
  air_cargo_type?: string | null;
  gross_weight_kg?: number;
  volumetric_weight_kg?: number;
  chargeable_weight_kg?: number;
  total_cbm?: number;
  package_count?: number;
  flight_number?: string | null;
  flight_date?: string | null;
  mawb_number?: string | null;
  hawb_number?: string | null;
  payment_term: 'prepaid' | 'collect';
  base_cost: number;
  currency: string;
  margin_type: 'fixed' | 'percentage';
  margin_value: number;
  final_total: number;
  exchange_rate: number;
  final_total_local: number;
  valid_until: string | null;
  status: 'draft' | 'sent' | 'approved' | 'rejected' | 'converted_to_job';
  converted_job_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface MaritimeContainer {
  id: string;
  job_id: string;
  container_number: string;
  container_type: string;
  seal_number: string | null;
  gross_weight_kg: number;
  cbm: number;
  free_days: number;
  return_deadline: string | null;
  is_overdue: boolean;
  overdue_days: number;
  demurrage_rate_per_day: number;
  demurrage_amount: number;
  deposit_amount: number;
  deposit_currency: string;
  deposit_status: 'not_required' | 'held_by_line' | 'pending_return_proof' | 'refunded_to_treasury' | 'forfeited';
  deposit_treasury_id: number | null;
  empty_return_proof_url: string | null;
  gated_in_at: string | null;
  vessel_loaded_at: string | null;
  discharged_at: string | null;
  gated_out_at: string | null;
  empty_returned_at: string | null;
  notes: string | null;
  daysRemaining?: number | null;
  statusColor?: 'green' | 'yellow' | 'red' | 'gray';
  job_number?: string;
  customer_name?: string;
  shipping_line_name?: string;
  vessel_name?: string;
  delivery_order_released?: boolean;
}

export interface CreateMaritimeContainerPayload {
  [key: string]: unknown;
  jobId: string;
  containerNumber: string;
  containerType: string;
  sealNumber?: string;
  grossWeightKg?: number;
  cbm?: number;
  freeDays: number;
  returnDeadline?: string;
  demurrageRatePerDay?: number;
  depositAmount?: number;
  depositCurrency?: string;
  notes?: string;
}

export interface UpdateMaritimeContainerPayload {
  [key: string]: unknown;
  sealNumber?: string;
  seal_number?: string | null;
  dischargedAt?: string;
  discharged_at?: string | null;
  gatedOutAt?: string;
  gated_out_at?: string | null;
  emptyReturnedAt?: string;
  freeDays?: number;
  returnDeadline?: string;
  demurrageRatePerDay?: number;
  depositAmount?: number;
  depositCurrency?: string;
  depositStatus?: MaritimeContainer['deposit_status'];
  emptyReturnProofUrl?: string;
  notes?: string | null;
}

export interface MaritimeMilestone {
  id: string;
  job_id: string;
  milestone_key: string;
  milestone_title: string;
  occurred_at: string;
  location: string | null;
  notes: string | null;
}

export interface MaritimeJob {
  id: string;
  job_number: string;
  quotation_id: string | null;
  rfq_id: string | null;
  customer_id: number | null;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  direction: 'import' | 'export' | 'cross_trade';
  transport_mode?: 'sea' | 'air' | 'road' | 'multimodal';
  air_cargo_type?: string | null;
  gross_weight_kg?: number;
  volumetric_weight_kg?: number;
  chargeable_weight_kg?: number;
  total_cbm?: number;
  package_count?: number;
  flight_number?: string | null;
  flight_date?: string | null;
  mawb_number?: string | null;
  hawb_number?: string | null;
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
  port_cut_off: string | null;
  bl_type: 'original' | 'telex_release' | 'sea_waybill';
  mbl_number: string | null;
  hbl_number: string | null;
  shipper_details: string | null;
  consignee_details: string | null;
  notify_party: string | null;
  milestone_status: string;
  delivery_order_released: boolean;
  delivery_order_released_at: string | null;
  cost_center_id: string | null;
  client_invoiced_total: number;
  client_paid_total?: number;
  payment_status?: 'unpaid' | 'partially_paid' | 'paid';
  paid_at?: string | null;
  carrier_cost_total: number;
  other_costs_total: number;
  net_profit: number;
  tracking_token: string | null;
  customerBalance?: number;
  customerAvailableCredit?: number;
  status: 'active' | 'completed' | 'cancelled';
  acid_number?: string | null;
  acid_issue_date?: string | null;
  acid_expiry_date?: string | null;
  foreign_exporter_id?: string | null;
  importer_tax_id?: string | null;
  quote_roe?: number | null;
  actual_roe?: number | null;
  forex_gain_loss?: number;
  roe_clause_agreed?: boolean;
  si_cutoff_date?: string | null;
  vgm_cutoff_date?: string | null;
  port_cutoff_date?: string | null;
  parent_job_id?: string | null;
  master_job_id?: string | null;
  is_consolidation_master?: boolean;
  is_consolidation?: boolean;
  sub_job_count?: number;
  cbm?: number;
  cargo_description?: string | null;
  commodity_description?: string | null;
  delivery_address?: string | null;
  notes: string | null;
  created_at: string;
  containersCount?: number;
  hasOverdueContainers?: boolean;
  containers?: MaritimeContainer[];
  milestones?: MaritimeMilestone[];
  insurances?: CargoInsurance[];
  warehouseReceipts?: WarehouseReceipt[];
}

export interface CargoInsurance {
  id: string;
  job_id: string;
  policy_number: string;
  insurance_company: string;
  insured_value: number;
  premium_amount: number;
  currency: string;
  coverage_type: 'all_risks' | 'clauses_a' | 'clauses_b' | 'clauses_c';
  issue_date: string;
  expiry_date: string | null;
  status: 'draft' | 'active' | 'claimed' | 'cancelled' | 'expired';
  claim_amount: number;
  claim_status: string | null;
  claim_notes: string | null;
  certificate_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface WarehouseReceipt {
  id: string;
  receipt_number: string;
  job_id: string;
  location_id: string | null;
  received_date: string;
  package_count: number;
  gross_weight_kg: number;
  cbm: number;
  bay_rack_bin: string | null;
  warehouse_status: 'in_storage' | 'inspected' | 'released' | 'transferred';
  released_at: string | null;
  released_by: number | null;
  notes: string | null;
  created_at: string;
}

export interface MaritimeInlandTruckingTrip {
  id: string | number;
  job_id?: string | number;
  trip_number?: string;
  trucking_company: string;
  driver_name?: string;
  driver_phone?: string;
  truck_plate_number?: string;
  truck_plate?: string;
  container_number?: string;
  pickup_location?: string;
  delivery_location?: string;
  origin_port_terminal?: string;
  delivery_destination?: string;
  status: string;
  scheduled_pickup_time?: string;
  scheduled_delivery_time?: string;
  actual_pickup_time?: string;
  actual_delivery_time?: string;
  cost_amount?: number;
  sell_amount?: number;
  currency?: string;
  cargo_description?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface MaritimeJobDocument {
  id: string | number;
  job_id: string | number;
  document_type: string;
  title: string;
  document_number?: string | null;
  issue_date?: string | null;
  expiry_date?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_size_bytes?: number | null;
  mime_type?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}
