export type MaritimeDirection = 'import' | 'export' | 'cross_trade';
export type MaritimePaymentTerm = 'prepaid' | 'collect';
export type MaritimeIncoterm = 'FOB' | 'EXW' | 'CFR' | 'CIF' | 'DDP' | 'DAP' | 'FCA';
export type MaritimeCargoMode = 'FCL' | 'LCL' | 'Breakbulk';
export type MaritimeContainerType = '20GP' | '40GP' | '40HC' | '20RF' | '40RF' | '45HC' | 'OpenTop' | 'FlatRack';
export type MaritimeCargoNature = 'general' | 'hazardous_dg' | 'temperature_controlled' | 'fragile';
export type MaritimeBlType = 'original' | 'telex_release' | 'sea_waybill';
export type TransportMode = 'sea' | 'air' | 'road' | 'multimodal';
export type AirCargoType = 'general' | 'perishable' | 'dangerous_goods' | 'valuable' | 'live_animals' | 'pharma';
export type InsuranceCoverageType = 'all_risks' | 'clauses_a' | 'clauses_b' | 'clauses_c';
export type InsuranceStatus = 'draft' | 'active' | 'claimed' | 'cancelled' | 'expired';
export type WarehouseReceiptStatus = 'in_storage' | 'inspected' | 'released' | 'transferred';

export type MaritimeInquiryStatus = 'received' | 'rfq_created' | 'quoted' | 'converted_to_job' | 'cancelled';
export type MaritimeRfqStatus = 'draft' | 'sent' | 'bids_received' | 'awarded' | 'cancelled';
export type MaritimeQuotationStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'converted_to_job';
export type MaritimeJobStatus = 'active' | 'completed' | 'cancelled';

export type DcsaMilestoneKey = 
  | 'BOOK'  // Booking confirmed
  | 'GTI'   // Gate-in at POL
  | 'LOAD'  // Vessel Loaded
  | 'DEPT'  // Vessel Departed (ETD)
  | 'ARRI'  // Vessel Arrived (ETA)
  | 'DISC'  // Container Discharged
  | 'CUST'  // Customs Cleared
  | 'GTO'   // Gate-out for Delivery / D/O Released
  | 'DLVR'  // Cargo Delivered to Customer
  | 'RETN'; // Empty Container Returned

export type CargoIqMilestoneKey =
  | 'BKD'   // Booking confirmed
  | 'RCS'   // Cargo Received from Shipper
  | 'MAN'   // Manifested on Flight
  | 'DEP'   // Flight Departed
  | 'ARR'   // Flight Arrived
  | 'RCF'   // Cargo Received from Flight
  | 'CUST'  // Customs Cleared
  | 'NFD'   // Consignee Notified
  | 'AWD'   // Documents / D.O Delivered
  | 'DLV';  // Cargo Delivered to Consignee

export type RoadMilestoneKey =
  | 'TRK_ASSIGN'   // Truck & driver assigned
  | 'TRK_GATE_IN'  // Arrived at origin / Gate In
  | 'TRK_LOADED'   // Cargo loaded & lashed
  | 'TRK_DISPATCH' // Truck departed / En route
  | 'TRK_BORDER'   // Customs border / Waypoint
  | 'TRK_ARRIVED'  // Arrived at destination
  | 'TRK_UNLOADED' // Cargo unloaded
  | 'TRK_POD';     // Proof of delivery / Signed CMR

export type ShipmentMilestoneKey = DcsaMilestoneKey | CargoIqMilestoneKey | RoadMilestoneKey | string;

export interface RoadMilestoneDefinition {
  key: RoadMilestoneKey;
  title_ar: string;
  title_en: string;
  category: 'origin' | 'transit' | 'destination' | 'pod';
}

export const ROAD_FREIGHT_MILESTONES: RoadMilestoneDefinition[] = [
  { key: 'TRK_ASSIGN', title_ar: 'تعيين الشاحنة والسائق', title_en: 'Truck & Driver Assigned', category: 'origin' },
  { key: 'TRK_GATE_IN', title_ar: 'وصول الشاحنة لموقع التحميل', title_en: 'Arrived at Origin / Gate In', category: 'origin' },
  { key: 'TRK_LOADED', title_ar: 'إتمام التحميل وتربيط البضاعة', title_en: 'Cargo Loaded & Lashed', category: 'origin' },
  { key: 'TRK_DISPATCH', title_ar: 'انطلاق الشاحنة على الطريق (En Route)', title_en: 'Truck Dispatched / En Route', category: 'transit' },
  { key: 'TRK_BORDER', title_ar: 'الوصول للمنفذ الجمركي / معبر الحدود', title_en: 'Border Clearance / Waypoint', category: 'transit' },
  { key: 'TRK_ARRIVED', title_ar: 'وصول الشاحنة لموقع العميل المستلم', title_en: 'Arrived at Destination', category: 'destination' },
  { key: 'TRK_UNLOADED', title_ar: 'إتمام تفريغ البضاعة ومطابقة الطرود', title_en: 'Cargo Unloaded', category: 'destination' },
  { key: 'TRK_POD', title_ar: 'توقيع بوليصة الشحن وإثبات التسليم (POD)', title_en: 'Proof of Delivery / Signed CMR', category: 'pod' },
];

export interface DcsaMilestoneDefinition {
  key: DcsaMilestoneKey;
  title_ar: string;
  title_en: string;
  category: 'equipment' | 'transport' | 'shipment';
}

export const DCSA_STANDARD_MILESTONES: DcsaMilestoneDefinition[] = [
  { key: 'BOOK', title_ar: 'تأكيد الحجز الملاحي', title_en: 'Booking Confirmed', category: 'shipment' },
  { key: 'GTI', title_ar: 'دخول الحاوية ساحة ميناء الشحن', title_en: 'Gated-in Origin Port', category: 'equipment' },
  { key: 'LOAD', title_ar: 'شحن وتحميل الحاوية على السفينة', title_en: 'Vessel Loaded', category: 'equipment' },
  { key: 'DEPT', title_ar: 'إبحار السفينة (تاريخ الإبحار الفعلي)', title_en: 'Vessel Departed (ETD)', category: 'transport' },
  { key: 'ARRI', title_ar: 'وصول السفينة لميناء المقصد (ETA)', title_en: 'Vessel Arrived (ETA)', category: 'transport' },
  { key: 'DISC', title_ar: 'تفريغ الحاوية على رصيف الميناء', title_en: 'Container Discharged', category: 'equipment' },
  { key: 'CUST', title_ar: 'إنهاء الإفراج الجمركي والمطابقة', title_en: 'Customs Cleared', category: 'shipment' },
  { key: 'GTO', title_ar: 'خروج الحاوية وتسليم إذن الإفراج (D/O)', title_en: 'Gated-out / Delivery Order Released', category: 'equipment' },
  { key: 'DLVR', title_ar: 'وصول البضاعة وتسليمها للعميل', title_en: 'Cargo Delivered to Customer', category: 'shipment' },
  { key: 'RETN', title_ar: 'إعادة الحاوية فارغة لساحة الخط الملاحي', title_en: 'Empty Container Returned', category: 'equipment' },
];

export interface RfqEmailDispatchPayload {
  rfqNumber: string;
  carrierName: string;
  carrierEmail: string;
  pol: string;
  pod: string;
  cargoMode: string;
  containerType: string;
  containerCount: number;
  commodity: string;
  crd: string;
  freeDays: number;
  incoterm: string;
  direction: string;
  magicLinkUrl: string;
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

export const DEFAULT_PIPELINE_CONFIG: MaritimePipelineConfig = {
  enableSeaFreight: true,
  enableAirFreight: true,
  enableRoadFreight: true,
  automationMode: 'hybrid',
  defaultMarginType: 'fixed',
  defaultMarginValue: 200,
  marginFloor: 150,
  rfqCutOffHoursStandard: 24,
  rfqCutOffHoursUrgent: 6,
  earlyAwardingEnabled: true,
  earlyAwardingMinFreeDays: 14,
  requireManualRfqDispatch: false,
  requireManualAwardAndMargin: true,
  requireManualQuoteDispatch: false,
  autoSendWhatsAppQuote: true,
  autoSendEmailQuote: true,
};

