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
