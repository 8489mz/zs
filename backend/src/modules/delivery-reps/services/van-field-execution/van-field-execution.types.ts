export interface CheckInVisitPayload {
  tripId?: number | null;
  customerId: number;
  customerName?: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface RecordNoSalePayload {
  noSaleReason: string;
  noSaleNotes?: string;
}

export interface RecordStoreInventoryPayload {
  items: Array<{
    productId: number;
    productName: string;
    qtyOnShelf: number;
    expiryDate?: string | null;
  }>;
}

export interface CheckOutVisitPayload {
  hasSale?: boolean;
  saleId?: number | null;
  saleAmount?: number;
  hasCollection?: boolean;
  collectionAmount?: number;
}

export interface TradeSurveyPayload {
  tripId?: number | null;
  customerId: number;
  visitId?: number | null;
  surveyType: 'cooler_inspection' | 'asset_tracking' | 'competitor_survey';
  assetId?: string | null;
  assetName?: string | null;
  assetCondition?: string | null;
  isPureCompanyProducts?: boolean;
  temperatureCelsius?: number | null;
  cleanlinessRating?: number;
  photoUrl?: string | null;
  competitorName?: string | null;
  competitorProduct?: string | null;
  competitorPrice?: number | null;
  competitorOfferDetails?: string | null;
  notes?: string | null;
  metadata?: Record<string, any>;
}

export interface BreadcrumbPayload {
  tripId: number;
  latitude: number;
  longitude: number;
  speedKmh?: number;
  batteryLevel?: number;
}
