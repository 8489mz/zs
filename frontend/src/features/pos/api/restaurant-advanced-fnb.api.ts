import { http } from '@/lib/http';

export interface Restaurant86Item {
  id: number;
  product_id: number;
  product_name: string;
  component_product_id?: number | null;
  is_86ed: boolean;
  reason?: string;
  auto_restore_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TipPoolDistribution {
  id: number;
  pool_id: number;
  employee_id: number;
  employee_name: string;
  role_name: string;
  hours_worked: number;
  point_weight: number;
  allocated_amount: number;
  is_paid: boolean;
}

export interface RestaurantTipPool {
  id: number;
  shift_date: string;
  shift_name: string;
  total_cash_tips: number;
  total_card_tips: number;
  total_tips: number;
  distribution_method: 'roles' | 'hours' | 'equal';
  status: 'draft' | 'distributed' | 'cancelled';
  notes?: string;
  created_at: string;
  distributions: TipPoolDistribution[];
}

export interface RestaurantTableZone {
  id: number;
  zone_code: string;
  name: string;
  sort_order: number;
  capacity_seats: number;
  table_numbers: string[] | string;
  minimum_spend?: number;
  is_active?: boolean;
}

export interface RestaurantPrepSheetItem {
  id: number;
  prep_sheet_id: number;
  product_id: number;
  product_name: string;
  unit_name: string;
  par_level: number;
  current_on_hand: number;
  prep_required: number;
  prep_actual: number;
  shelf_life_hours?: number;
  storage_temp?: string;
  status: 'pending' | 'prepped';
}

export interface RestaurantPrepSheet {
  id: number;
  prep_date: string;
  shift_type: 'morning' | 'evening' | 'night';
  status: 'in_progress' | 'completed';
  notes?: string;
  created_at: string;
  items: RestaurantPrepSheetItem[];
}

export interface RestaurantStampCard {
  id: number;
  customer_id: number;
  program_name: string;
  target_stamps: number;
  current_stamps: number;
  total_completed_cards: number;
  reward_description?: string;
  last_stamped_at?: string;
}

export interface PlateCostFluctuation {
  productId: number;
  productName: string;
  sellingPrice: number;
  standardCost: number;
  liveCost: number;
  costInflationPct: number;
  currentMarginPct: number;
  suggestedPrice: number;
  isAlert: boolean;
}

export interface RestaurantManagerComp {
  id: number;
  sale_id?: number | null;
  table_number?: string | null;
  comp_type: 'vip_guest' | 'customer_complaint' | 'staff_meal' | 'promotional_tasting';
  manager_name: string;
  amount: number;
  items_summary?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface RestaurantTableRating {
  id: number;
  table_number: string;
  sale_id?: number | null;
  rating: number;
  feedback_category?: string | null;
  notes?: string | null;
  is_rescued: boolean;
  rescued_by?: string | null;
  created_at: string;
}

export interface RestaurantDriveThruOrder {
  id: number;
  vehicle_plate: string;
  vehicle_desc?: string | null;
  sale_id?: number | null;
  status: 'order_taken' | 'at_window' | 'completed' | 'cancelled';
  order_time: string;
  window_arrival_time?: string | null;
  completed_time?: string | null;
  sos_seconds?: number | null;
  liveSosSeconds?: number;
  sosSeverity?: 'normal' | 'warning' | 'critical';
  total_amount: number;
  notes?: string | null;
}

export interface RestaurantUpsellRule {
  id: number;
  trigger_product_id?: number | null;
  trigger_category_name?: string | null;
  suggested_product_id: number;
  suggested_product_name: string;
  title: string;
  discount_amount: number;
  is_active: boolean;
}

export interface MinimumSpendCalculation {
  hasDeficit: boolean;
  deficitAmount: number;
  minimumSpend: number;
  foodAndBeverageTotal: number;
  finalTotal: number;
}

const apiGet = <T>(url: string, params?: Record<string, any>): Promise<T> => {
  let query = '';
  if (params) {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
    });
    const qs = sp.toString();
    if (qs) query = `?${qs}`;
  }
  return http<T>(`${url}${query}`);
};

const apiPost = <T = any>(url: string, body?: any): Promise<T> => {
  return http<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
};

const apiPatch = <T = any>(url: string, body?: any): Promise<T> => {
  return http<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
};

export const restaurantAdvancedFnbApi = {
  // 1. Fast 86 Engine
  get86Items: async (branchId?: number): Promise<Restaurant86Item[]> => {
    const params = branchId ? { branchId } : undefined;
    return apiGet<Restaurant86Item[]>('/api/sales/restaurant/86-items', params);
  },

  toggle86Item: async (dto: {
    productId: number;
    productName: string;
    is86ed: boolean;
    reason?: string;
    autoRestoreHours?: number;
  }): Promise<{ success: boolean; message: string }> => {
    return apiPost('/api/sales/restaurant/86-items/toggle', dto);
  },

  // 2. Tip Pooling & Distribution
  getTipPools: async (shiftDate?: string): Promise<RestaurantTipPool[]> => {
    const params = shiftDate ? { shiftDate } : undefined;
    return apiGet<RestaurantTipPool[]>('/api/sales/restaurant/tip-pools', params);
  },

  calculateTipPool: async (dto: {
    shiftDate: string;
    shiftName?: string;
    totalCashTips?: number;
    totalCardTips?: number;
    distributionMethod: 'roles' | 'hours' | 'equal';
    staff: Array<{
      employeeId: number;
      employeeName: string;
      roleName: string;
      hoursWorked: number;
      pointWeight?: number;
    }>;
    notes?: string;
  }): Promise<{ pool: RestaurantTipPool; distributions: TipPoolDistribution[]; totalTips: number }> => {
    return apiPost('/api/sales/restaurant/tip-pools/calculate', dto);
  },

  confirmTipDistribution: async (poolId: number): Promise<{ success: boolean; message: string }> => {
    return apiPost(`/api/sales/restaurant/tip-pools/${poolId}/distribute`, {});
  },

  // 3. Multi-Zone Floor Plan
  getZones: async (branchId?: number): Promise<RestaurantTableZone[]> => {
    const params = branchId ? { branchId } : undefined;
    return apiGet<RestaurantTableZone[]>('/api/sales/restaurant/zones', params);
  },

  saveZone: async (dto: {
    id?: number;
    zoneCode: string;
    name: string;
    sortOrder?: number;
    capacitySeats?: number;
    tableNumbers: string[];
    minimumSpend?: number;
  }): Promise<{ success: boolean; message: string }> => {
    return apiPost('/api/sales/restaurant/zones', dto);
  },

  // 4. Central Prep Kitchen & Prep Sheets
  getPrepSheets: async (prepDate?: string): Promise<RestaurantPrepSheet[]> => {
    const params = prepDate ? { prepDate } : undefined;
    return apiGet<RestaurantPrepSheet[]>('/api/sales/restaurant/prep-sheets', params);
  },

  generatePrepSheet: async (dto: {
    prepDate: string;
    shiftType?: 'morning' | 'evening' | 'night';
    notes?: string;
  }): Promise<{ sheet: RestaurantPrepSheet; items: RestaurantPrepSheetItem[] }> => {
    return apiPost('/api/sales/restaurant/prep-sheets/generate', dto);
  },

  recordPrepProduction: async (itemId: number, actualQty: number): Promise<{ success: boolean; message: string }> => {
    return apiPost(`/api/sales/restaurant/prep-sheets/items/${itemId}/record`, { actualQty });
  },

  // 5. Digital Stamp Card Loyalty
  getStampCard: async (customerId: number): Promise<RestaurantStampCard> => {
    return apiGet<RestaurantStampCard>(`/api/sales/restaurant/stamp-cards/${customerId}`);
  },

  addCustomerStamp: async (customerId: number, count: number = 1): Promise<{
    success: boolean;
    currentStamps: number;
    targetStamps: number;
    rewardUnlocked: boolean;
    message: string;
  }> => {
    return apiPost(`/api/sales/restaurant/stamp-cards/${customerId}/stamp`, { count });
  },

  // 6. Live Plate Cost Radar
  getPlateCostRadar: async (): Promise<PlateCostFluctuation[]> => {
    return apiGet<PlateCostFluctuation[]>('/api/sales/restaurant/plate-cost-radar');
  },

  // 7. Manager Comps & VIP On-The-House
  getManagerComps: async (): Promise<RestaurantManagerComp[]> => {
    return apiGet<RestaurantManagerComp[]>('/api/sales/restaurant/manager-comps');
  },

  recordManagerComp: async (dto: {
    saleId?: number;
    tableNumber?: string;
    compType: 'vip_guest' | 'customer_complaint' | 'staff_meal' | 'promotional_tasting';
    managerName: string;
    amount: number;
    itemsSummary?: string;
    notes?: string;
  }): Promise<{ success: boolean; comp: RestaurantManagerComp; message: string }> => {
    return apiPost('/api/sales/restaurant/manager-comps', dto);
  },

  // 8. Table QR Rating & Rescue Alert
  recordTableRating: async (dto: {
    tableNumber: string;
    saleId?: number;
    rating: number;
    feedbackCategory?: string;
    notes?: string;
  }): Promise<{ success: boolean; rating: RestaurantTableRating; isRescueAlertTriggered: boolean; message: string }> => {
    return apiPost('/api/sales/restaurant/table-ratings', dto);
  },

  resolveRescueAlert: async (ratingId: number, managerName: string): Promise<{ success: boolean; message: string }> => {
    return apiPost(`/api/sales/restaurant/table-ratings/${ratingId}/rescue`, { managerName });
  },

  // 9. Table Minimum Spend
  calculateMinimumSpend: async (currentTotal: number, minimumSpend: number): Promise<MinimumSpendCalculation> => {
    return apiPost<MinimumSpendCalculation>('/api/sales/restaurant/minimum-spend/calculate', { currentTotal, minimumSpend });
  },

  // 10. Drive-Thru Lane & Speed of Service
  getDriveThruOrders: async (): Promise<{
    orders: RestaurantDriveThruOrder[];
    activeCount: number;
    averageSosSeconds: number;
  }> => {
    return apiGet('/api/sales/restaurant/drive-thru');
  },

  createDriveThruOrder: async (dto: {
    vehiclePlate: string;
    vehicleDesc?: string;
    totalAmount?: number;
    notes?: string;
  }): Promise<{ success: boolean; order: RestaurantDriveThruOrder; message: string }> => {
    return apiPost('/api/sales/restaurant/drive-thru', dto);
  },

  updateDriveThruStatus: async (
    id: number,
    status: 'order_taken' | 'at_window' | 'completed' | 'cancelled',
  ): Promise<{ success: boolean; message: string }> => {
    return apiPatch(`/api/sales/restaurant/drive-thru/${id}/status`, { status });
  },

  // 11. Smart Upselling & Cross-Selling
  getUpsellRecommendations: async (triggerProductId?: number, categoryName?: string): Promise<RestaurantUpsellRule[]> => {
    const params: any = {};
    if (triggerProductId) params.triggerProductId = triggerProductId;
    if (categoryName) params.categoryName = categoryName;
    return apiGet<RestaurantUpsellRule[]>('/api/sales/restaurant/upsell', params);
  },

  createUpsellRule: async (dto: {
    triggerProductId?: number;
    triggerCategoryName?: string;
    suggestedProductId: number;
    suggestedProductName: string;
    title: string;
    discountAmount?: number;
  }): Promise<{ success: boolean; rule: RestaurantUpsellRule; message: string }> => {
    return apiPost('/api/sales/restaurant/upsell', dto);
  },

  // 12. Visual Floor Plan Canvas & Table Layouts
  getTableLayouts: async (branchId?: number): Promise<TableLayout[]> => {
    const params = branchId ? { branchId } : undefined;
    return apiGet<TableLayout[]>('/api/sales/restaurant/table-layouts', params);
  },

  saveTableLayouts: async (layouts: TableLayout[], branchId?: number): Promise<TableLayout[]> => {
    return apiPost<TableLayout[]>('/api/sales/restaurant/table-layouts', { layouts, branchId });
  },

  deleteTableLayout: async (id: number): Promise<{ success: boolean }> => {
    return apiPost<{ success: boolean }>(`/api/sales/restaurant/table-layouts/${id}/delete`, {});
  },

  // INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I35): whole-table transfer of a
  // held draft — renames ONLY held_sales.table_number server-side.
  renameHeldDraftTable: async (id: number, tableNumber: string): Promise<unknown> => {
    return apiPost(`/api/sales/restaurant/held-drafts/${id}/rename-table`, { tableNumber });
  },
};

export interface TableLayout {
  id?: number;
  table_number: string;
  zone_code?: string;
  shape: 'square' | 'round' | 'rectangle' | 'booth';
  x_pos: number;
  y_pos: number;
  width?: number;
  height?: number;
  seats: number;
  rotation?: number;
  is_active?: boolean;
}

