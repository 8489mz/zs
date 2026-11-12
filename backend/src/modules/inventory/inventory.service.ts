import { Injectable } from '@nestjs/common';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { CreateDamagedStockDto } from './dto/create-damaged-stock.dto';
import { CreateStockCountSessionDto, RecountStockCountItemDto } from './dto/create-stock-count-session.dto';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { InventoryAdjustmentDto } from './dto/inventory-adjustment.dto';
import { InventoryAdjustmentService } from './services/inventory-adjustment.service';
import { InventoryCountService } from './services/inventory-count.service';
import { InventoryScopeService } from './services/inventory-scope.service';
import { InventoryTransferService } from './services/inventory-transfer.service';

@Injectable()
export class InventoryService {
  constructor(
    private readonly scopeService: InventoryScopeService,
    private readonly transferService: InventoryTransferService,
    private readonly countService: InventoryCountService,
    private readonly adjustmentService: InventoryAdjustmentService,
  ) {}

  listLocations(auth: AuthContext, includeInactive?: boolean): Promise<Record<string, unknown>> {
    return this.scopeService.listLocations(auth, includeInactive);
  }

  getLocationCategories(locationId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.scopeService.getLocationCategories(locationId, auth);
  }

  getLocationCategoryProducts(locationId: number, categoryId: number | 'all', auth: AuthContext): Promise<Record<string, unknown>> {
    return this.scopeService.getLocationCategoryProducts(locationId, categoryId, auth);
  }

  assignProductsToLocation(locationId: number, productIds: number[], auth: AuthContext): Promise<{ success: boolean }> {
    return this.scopeService.assignProductsToLocation(locationId, productIds, auth);
  }

  removeProductFromLocation(locationId: number, productId: number, auth: AuthContext): Promise<{ success: boolean }> {
    return this.scopeService.removeProductFromLocation(locationId, productId, auth);
  }

  getAllLocationStocks(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.scopeService.getAllLocationStocks(auth);
  }

  // INV-ADJUST-SINGLE-QTY-BASIS: read-only availability for the
  // adjustment dialog prefill, on the same available basis the
  // adjustment targets. Thin delegation; the ledger owns the math.
  getProductLocationAvailability(productId: number, locationId: number | null, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.adjustmentService.getProductLocationAvailability(productId, locationId, auth);
  }

  getAdvancedOverview(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.scopeService.getAdvancedOverview(auth);
  }

  listStockTransfers(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.transferService.listStockTransfers(query, auth);
  }

  listStockMovements(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.countService.listStockMovements(query, auth);
  }

  createStockTransfer(payload: CreateStockTransferDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.transferService.createStockTransfer(payload, auth);
  }

  transferCategory(payload: { categoryId: number; fromLocationId: number; toLocationId: number; notes?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.transferService.transferCategory(payload, auth);
  }

  internalTransferProducts(payload: any, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.transferService.internalTransferProducts(payload, auth);
  }

  internalTransferCategory(payload: any, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.transferService.internalTransferCategory(payload, auth);
  }

  receiveStockTransfer(transferId: number, auth: AuthContext, receiptPayload?: { items?: Array<{ itemId: number; receivedQty: number }>; varianceReason?: string; approvalSecret?: string }): Promise<Record<string, unknown>> {
    return this.transferService.receiveStockTransfer(transferId, auth, receiptPayload);
  }

  cancelStockTransfer(transferId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.transferService.cancelStockTransfer(transferId, auth);
  }

  listStockCountSessions(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.countService.listStockCountSessions(query, auth);
  }

  createStockCountSession(payload: CreateStockCountSessionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.countService.createStockCountSession(payload, auth);
  }

  postStockCountSession(sessionId: number, auth: AuthContext, adminPassword?: string): Promise<Record<string, unknown>> {
    return this.countService.postStockCountSession(sessionId, auth, adminPassword);
  }

  deleteStockCountSession(sessionId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.countService.deleteStockCountSession(sessionId, auth);
  }

  recountPendingStockCountItem(sessionId: number, itemId: number, payload: RecountStockCountItemDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.countService.recountPendingStockCountItem(sessionId, itemId, payload, auth);
  }

  listDamagedStock(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.countService.listDamagedStock(query, auth);
  }

  createDamagedStock(payload: CreateDamagedStockDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.countService.createDamagedStock(payload, auth);
  }

  createInventoryAdjustment(payload: InventoryAdjustmentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.adjustmentService.createInventoryAdjustment(payload, auth);
  }
}
