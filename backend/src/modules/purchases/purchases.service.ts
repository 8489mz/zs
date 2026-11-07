import { Injectable } from '@nestjs/common';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { CreateCustomerPaymentDto, CreateSupplierPaymentDto } from './dto/create-party-payment.dto';
import { UpsertPurchaseDto } from './dto/upsert-purchase.dto';
import { PurchasesQueryService } from './services/purchases-query.service';
import { PurchasesWriteService } from './services/purchases-write.service';
import { PurchasesReorderService, GenerateDraftOrdersPayload } from './services/purchases-reorder.service';

@Injectable()
export class PurchasesService {
  constructor(
    private readonly queryService: PurchasesQueryService,
    private readonly writeService: PurchasesWriteService,
    private readonly reorderService: PurchasesReorderService,
  ) {}

  listPurchases(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.queryService.listPurchases(query, auth);
  }

  getPurchaseById(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.queryService.getPurchaseById(id, auth);
  }

  checkDuplicateBill(candidate: any, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.queryService.checkDuplicateBill(candidate, auth) as unknown as Promise<Record<string, unknown>>;
  }

  getPurchaseAttachment(purchaseId: number, attachmentId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.queryService.getPurchaseAttachment(purchaseId, attachmentId, auth);
  }

  createPurchase(payload: UpsertPurchaseDto, auth: AuthContext, idempotencyKey?: string): Promise<Record<string, unknown>> {
    return this.writeService.createPurchase(payload, auth, idempotencyKey);
  }

  updatePurchase(id: number, payload: UpsertPurchaseDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.writeService.updatePurchase(id, payload, auth);
  }

  cancelPurchase(id: number, reason: string, auth: AuthContext, managerPin?: string): Promise<Record<string, unknown>> {
    return this.writeService.cancelPurchase(id, reason, auth, managerPin);
  }

  listSupplierPayments(auth: AuthContext, query?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.queryService.listSupplierPayments(auth, query);
  }

  getSupplierPaymentById(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.queryService.getSupplierPaymentById(id, auth);
  }

  createSupplierPayment(payload: CreateSupplierPaymentDto, auth: AuthContext, idempotencyKey?: string): Promise<Record<string, unknown>> {
    return this.writeService.createSupplierPayment(payload, auth, idempotencyKey);
  }

  createCustomerPayment(payload: CreateCustomerPaymentDto, auth: AuthContext, idempotencyKey?: string): Promise<Record<string, unknown>> {
    return this.writeService.createCustomerPayment(payload, auth, idempotencyKey);
  }

  receivePurchaseGoods(
    purchaseId: number,
    receivedItems: { itemId: number; receivedQty: number; serials?: any[] }[],
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.writeService.receivePurchaseGoods(purchaseId, receivedItems, auth);
  }

  getReorderSuggestions(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reorderService.getReorderSuggestions(auth, query) as unknown as Promise<Record<string, unknown>>;
  }

  generateDraftPurchaseOrders(payload: GenerateDraftOrdersPayload, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reorderService.generateDraftPurchaseOrders(auth, payload);
  }
}
