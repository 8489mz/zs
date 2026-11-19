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
  sourceFileName?: string;
  sourceSheetName?: string;
  rawRowIdx?: number;
  components: TenderItemComponent[];
  wastePercent: number;
  overheadPercent: number;
  profitMarkupPercent: number;
  notes?: string;
  drawingLength?: number;
  drawingWidth?: number;
  drawingHeight?: number;
  drawingCount?: number;
}
