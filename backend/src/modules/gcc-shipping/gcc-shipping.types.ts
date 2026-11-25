export type GccCarrier = 'aramex' | 'smsa';

export interface GccShippingSettings {
  enabled: boolean;
  activeCarrier: GccCarrier;
  environment: 'sandbox' | 'production';

  // Aramex Credentials
  aramexAccountNumber?: string;
  aramexAccountPin?: string;
  aramexAccountEntity?: string; // e.g. 'RUH' / 'DXB' / 'KWI' / 'DOH'
  aramexCountryCode?: string; // 'SA', 'AE', 'KW', 'QA', 'BH', 'OM'
  aramexUserName?: string;
  aramexPassword?: string;

  // SMSA Express Credentials
  smsaPassKey?: string;
  smsaCustomsCurrency?: string; // 'SAR', 'AED', 'KWD', 'QAR'

  // Shipper / Warehouse Pickup Address in GCC
  pickupBusinessName?: string;
  pickupContactPerson?: string;
  pickupPhone?: string;
  pickupCountry?: string; // 'Saudi Arabia', 'United Arab Emirates', 'Kuwait', 'Qatar', 'Bahrain', 'Oman'
  pickupCity?: string; // 'الرياض', 'جدة', 'الدمام', 'دبي', 'أبو ظبي', 'الدوحة', 'الكويت'
  pickupAddress?: string;
}

export interface GccCreateShipmentDto {
  carrier?: GccCarrier;
  packageType?: 'Parcel' | 'Document';
  weight?: number; // In KG
  piecesCount?: number;
  description?: string;
  codAmount?: number; // Cash On Delivery in local currency
  currency?: string; // SAR, AED, KWD, QAR
  receiverName?: string;
  receiverPhone?: string;
  receiverCountry?: string;
  receiverCity?: string;
  receiverAddress?: string;
  notes?: string;
}

export interface GccShipmentResponse {
  ok: boolean;
  carrier: GccCarrier;
  shipmentId: string;
  trackingNumber: string;
  status: string;
  awbUrl?: string;
  isSandbox: boolean;
  currency: string;
  codAmount: number;
  message?: string;
  createdDate?: string;
}

export interface GccTrackingEvent {
  state: string;
  timestamp: string;
  location?: string;
  description?: string;
}

export interface GccTrackingResponse {
  ok: boolean;
  carrier: GccCarrier;
  trackingNumber: string;
  currentStatus: string;
  destinationCity?: string;
  originCity?: string;
  lastUpdated?: string;
  history: GccTrackingEvent[];
  officialTrackingUrl: string;
}

export interface GccAwbPrintData {
  trackingNumber: string;
  carrier: GccCarrier;
  carrierLabel: string;
  barcodeValue: string;
  createdDate: string;
  shipper: {
    name: string;
    phone: string;
    city: string;
    address: string;
    country: string;
  };
  receiver: {
    name: string;
    phone: string;
    city: string;
    address: string;
    country: string;
  };
  codAmount: number;
  currency: string;
  weight: number;
  pieces: number;
  description: string;
  notes?: string;
}
