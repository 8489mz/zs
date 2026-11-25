import { AppError } from '../../../common/errors/app-error';
import { ensureUniqueFlowItems } from '../../../common/utils/financial-integrity';
import { CreateReturnDto } from '../dto/create-return.dto';

export function normalizeReturnItems(payload: CreateReturnDto): Array<{
  productId: number;
  productName: string;
  qty: number;
  saleItemId?: number;
  purchaseItemId?: number;
  batchId?: number;
  serials?: string[];
}> {
  const normalized = (payload.items || []).map((item) => ({
    productId: Number(item.productId || 0),
    productName: String(item.productName || '').trim(),
    qty: Number(item.qty || 0),
    saleItemId: item.saleItemId ? Number(item.saleItemId) : undefined,
    purchaseItemId: item.purchaseItemId ? Number(item.purchaseItemId) : undefined,
    batchId: item.batchId ? Number(item.batchId) : undefined,
    serials: item.serials,
  }));

  if (
    normalized.some(
      (item) =>
        !Number.isSafeInteger(item.productId) || item.productId <= 0 || !Number.isFinite(item.qty) || item.qty <= 0,
    )
  ) {
    throw new AppError('Return contains invalid product or quantity', 'RETURN_ITEM_INVALID', 400);
  }
  if (!normalized.length) {
    throw new AppError('Return must include at least one valid item', 'RETURN_ITEMS_REQUIRED', 400);
  }

  ensureUniqueFlowItems(
    normalized.map((item) => ({
      productId: item.productId,
      qty: item.qty,
      lineId: payload.type === 'sale' ? item.saleItemId : item.purchaseItemId,
    })),
    'RETURN_DUPLICATE_PRODUCT',
    'Return must not contain duplicate products',
  );

  if (payload.type === 'purchase' && payload.settlementMode === 'store_credit') {
    throw new AppError('Purchase return cannot settle through store credit', 'PURCHASE_RETURN_SETTLEMENT_INVALID', 400);
  }

  return normalized;
}
