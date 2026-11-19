export interface TenantScope {
  tenantId: string;
  branchId?: number | null;
  userId?: number | null;
  // INV-REST-FNB-CLAIMS-POST: the comp/tip gates need the caller's identity.
  // accountId is the tenant account scope the journal posts under; role /
  // permissions are the caller's own, read from the session — never from
  // the request body. The controller forwards them from req.authContext.
  accountId?: string | null;
  username?: string | null;
  role?: string | null;
  permissions?: string[];
}

export interface Toggle86ItemDto {
  productId: number;
  productName: string;
  componentProductId?: number | null;
  is86ed: boolean;
  reason?: string;
  autoRestoreHours?: number;
}

export interface CalculateTipPoolDto {
  shiftDate: string;
  shiftName?: string;
  totalCashTips?: number;
  totalCardTips?: number;
  distributionMethod: 'roles' | 'hours' | 'equal';
  staff: {
    employeeId: number;
    employeeName: string;
    roleName: string;
    hoursWorked: number;
    pointWeight?: number;
  }[];
  notes?: string;
}

export interface SaveTableZoneDto {
  id?: number;
  zoneCode: string;
  name: string;
  sortOrder?: number;
  capacitySeats?: number;
  tableNumbers: string[];
  minimumSpend?: number;
}

export interface GeneratePrepSheetDto {
  prepDate: string;
  shiftType?: 'morning' | 'evening' | 'night';
  notes?: string;
  items?: {
    productId: number;
    productName: string;
    unitName: string;
    parLevel: number;
  }[];
}
