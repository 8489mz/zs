import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

/*
 * D10: GccCreateShipmentDto is a decorated class IN PLACE (Rule 5) —
 * the ship-order site takes the class now. GccShippingSettings stays
 * an interface (the settings site takes the SaveGccShippingSettingsDto
 * class in dto/gcc-shipping-write.dto.ts). ALL shipment fields are
 * optional: the service defaults every one from the order and the
 * saved settings.
 */
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

export class GccCreateShipmentDto {
  @IsOptional()
  @IsEnum(['aramex', 'smsa'])
  carrier?: GccCarrier;

  @IsOptional()
  @IsEnum(['Parcel', 'Document'])
  packageType?: 'Parcel' | 'Document';

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsNumber()
  piecesCount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  codAmount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  receiverName?: string;

  @IsOptional()
  @IsString()
  receiverPhone?: string;

  @IsOptional()
  @IsString()
  receiverCountry?: string;

  @IsOptional()
  @IsString()
  receiverCity?: string;

  @IsOptional()
  @IsString()
  receiverAddress?: string;

  @IsOptional()
  @IsString()
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
