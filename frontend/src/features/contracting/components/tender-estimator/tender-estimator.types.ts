export interface TenderItemComponent {
  componentCode: string;
  componentName: string;
  unit: string;
  qtyPerUnit: number;
  unitRate: number;
  componentType: 'material' | 'labor' | 'equipment' | 'subcontractor';
}

export interface TenderItem {
  id: string;
  itemCode: string;
  description: string;
  unit: string;
  estimatedQty: number;
  trade: string;
  components: TenderItemComponent[];
  wastePercent: number;
  overheadPercent: number;
  profitMarkupPercent: number;
  notes?: string;
  // Dimensions for CAD takeoff mode
  drawingLength?: number;
  drawingWidth?: number;
  drawingHeight?: number;
  drawingCount?: number;
}

export interface BrickPreset {
  id: string;
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  tradeType: 'masonry_m2' | 'masonry_m3';
  unit: string;
  ratePerM2OrM3: number;
  sandPerUnit: number;
  cementPerUnit: number;
  description: string;
}
