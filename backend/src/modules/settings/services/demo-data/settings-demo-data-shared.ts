export interface SeedDemoDataDto {
  activityType?: string;
  password?: string;
  wipeExisting?: boolean;
  seedSales?: boolean;
  seedOnlineOrders?: boolean;
}

export interface DemoCredential {
  username: string;
  temporaryPassword: string;
  mustChangePassword: true;
}
