import { VanPreSalesService } from '../services/van-pre-sales.service';

export class VanSalesDriverPreSalesSlice {
  constructor(
    private readonly vanPreSalesService: VanPreSalesService,
    private readonly verifyDriver: (
      authHeader: string,
    ) => Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string }>,
  ) {}

  async listPreSalesCatalog(authHeader: string, warehouseLocationId?: string, search?: string, categoryId?: string) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanPreSalesService.listWarehouseCatalog(
      driver.tenantId,
      warehouseLocationId ? Number(warehouseLocationId) : undefined,
      { search, categoryId: categoryId ? Number(categoryId) : undefined },
      driver.repId,
    );
  }

  async createPreSalesOrder(authHeader: string, body: any) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanPreSalesService.createPreSalesOrder(driver.repId, driver.tenantId, driver.accountId, body);
  }

  async listMyPreSalesOrders(authHeader: string, status?: string, dateFrom?: string, dateTo?: string, search?: string) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanPreSalesService.listPreSalesOrders(driver.tenantId, {
      repId: driver.repId,
      status,
      dateFrom,
      dateTo,
      search,
    });
  }

  async getMyPreSalesOrderDetails(authHeader: string, id: number) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanPreSalesService.getPreSalesOrderDetails(id, driver.tenantId, driver.repId);
  }
}
