import { type MoneyDigits, roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';

// ============================================================================
// FIELD RETURNS GOVERNANCE ENGINE (محرك حوكمة وتدقيق المرتجعات الميدانية)
// ============================================================================

export interface FieldReturnEvaluationItem {
  productId: number;
  productName?: string;
  qty: number;
  unitPrice: number;
  saleItemId?: number;
}

export interface FieldReturnOriginalSaleItem {
  saleItemId: number;
  productId: number;
  productName?: string;
  soldQty: number;
  unitPrice: number;
  lineTotal: number;
  alreadyReturnedQty: number;
}

export interface FieldReturnOriginalSale {
  saleId: number;
  docNo?: string;
  customerId: number;
  repId?: number | null;
  items: FieldReturnOriginalSaleItem[];
}

export interface RepCustomerSalesHistoryProduct {
  productId: number;
  productName?: string;
  totalSoldQty: number;
  maxNetUnitPrice: number;
  alreadyReturnedQty: number;
}

export interface FieldReturnEvaluationParams {
  // REQUIRED (D4): the return total and net-unit caps round at the
  // tenant's book digits.
  moneyDigits: MoneyDigits;
  repId: number;
  customerId: number;
  items: FieldReturnEvaluationItem[];
  refundMethod?: 'credit' | 'cash';
  tripCashCollected?: number;
  // If linked return:
  linkedSale?: FieldReturnOriginalSale | null;
  // If unlinked return:
  repCustomerSalesHistory?: RepCustomerSalesHistoryProduct[];
}

export interface FieldReturnEvaluationResult {
  allowed: boolean;
  reasonCode?: string;
  errorMessageAr?: string;
  httpStatus?: number;
  totalAmount: number;
}

/**
 * Evaluates field customer return request under strict adversarial governance.
 * Blocks:
 * 1. Empty or non-positive quantities / negative prices.
 * 2. Cross-customer returns (sale customer !== return customer).
 * 3. Cross-rep returns (rep A attempting to return goods from rep B's invoice).
 * 4. Phantom items not present in original invoice.
 * 5. Price tampering: Unit return price higher than net discounted sale price.
 * 6. Over-quantity returns: Return quantity exceeding remaining returnable qty (sold - prior returns).
 * 7. Unlinked returns without rep historical sales to customer.
 * 8. Cash refund exceeding actual cash collected by rep in current trip.
 */
export function evaluateFieldReturnGovernance(
  params: FieldReturnEvaluationParams,
): FieldReturnEvaluationResult {
  if (!params.items || !params.items.length) {
    return {
      allowed: false,
      reasonCode: 'EMPTY_RETURN_ITEMS',
      errorMessageAr: 'يجب تحديد صنف واحد على الأقل للمرتجع',
      httpStatus: 400,
      totalAmount: 0,
    };
  }

  let totalAmount = 0;
  for (const item of params.items) {
    const q = Number(item.qty || 0);
    const p = Number(item.unitPrice || 0);
    if (q <= 0) {
      return {
        allowed: false,
        reasonCode: 'INVALID_RETURN_QTY',
        errorMessageAr: 'كمية المرتجع يجب أن تكون أكبر من صفر',
        httpStatus: 400,
        totalAmount: 0,
      };
    }
    if (p < 0) {
      return {
        allowed: false,
        reasonCode: 'INVALID_RETURN_PRICE',
        errorMessageAr: 'سعر المرتجع غير صالح',
        httpStatus: 400,
        totalAmount: 0,
      };
    }
    totalAmount += q * p;
  }
  totalAmount = roundBookMoney(totalAmount, params.moneyDigits);

  // Linked Return Flow
  if (params.linkedSale) {
    const sale = params.linkedSale;
    if (Number(sale.customerId) !== Number(params.customerId)) {
      return {
        allowed: false,
        reasonCode: 'SALE_CUSTOMER_MISMATCH',
        errorMessageAr: 'الفاتورة المحددة لا تخص هذا العميل',
        httpStatus: 400,
        totalAmount,
      };
    }

    if (sale.repId != null && Number(sale.repId) !== Number(params.repId)) {
      return {
        allowed: false,
        reasonCode: 'SALE_REP_MISMATCH',
        errorMessageAr: 'لا يمكن عمل مرتجع على فاتورة تخص مندوباً آخر — عهد وحسابات كل مندوب معزولة تماماً',
        httpStatus: 403,
        totalAmount,
      };
    }

    for (const item of params.items) {
      const line = item.saleItemId
        ? sale.items.find((sl) => Number(sl.saleItemId) === Number(item.saleItemId))
        : sale.items.find((sl) => Number(sl.productId) === Number(item.productId));

      if (!line) {
        return {
          allowed: false,
          reasonCode: 'ITEM_NOT_IN_SALE',
          errorMessageAr: `الصنف #${item.productId} لم يتم العثور عليه في الفاتورة الأصلية`,
          httpStatus: 400,
          totalAmount,
        };
      }

      const soldQty = Number(line.soldQty || 0);
      const lineTotal = Number(line.lineTotal || 0);
      const netUnit = soldQty > 0 ? roundBookMoney(lineTotal / soldQty, params.moneyDigits) : 0;

      if (Number(item.unitPrice) > netUnit + 0.05) {
        return {
          allowed: false,
          reasonCode: 'RETURN_PRICE_EXCEEDS_NET',
          errorMessageAr: `سعر المرتجع (${item.unitPrice}) يتجاوز السعر الصافي بعد الخصم بالفاتورة الأصلية (${netUnit})`,
          httpStatus: 400,
          totalAmount,
        };
      }

      const alreadyReturned = Number(line.alreadyReturnedQty || 0);
      const remainingReturnableQty = Number((soldQty - alreadyReturned).toFixed(3));
      if (Number(item.qty) > remainingReturnableQty + 0.001) {
        return {
          allowed: false,
          reasonCode: 'RETURN_QTY_EXCEEDS_SOLD',
          errorMessageAr: `الكمية المطلوب ردها (${item.qty}) تتجاوز المتبقي القابل للرد من الفاتورة الأصلية (${Math.max(0, remainingReturnableQty)}) — بيع ${soldQty}، مرتجع سابقاً ${alreadyReturned}`,
          httpStatus: 400,
          totalAmount,
        };
      }
    }
  } else {
    // Unlinked Return Flow
    const history = params.repCustomerSalesHistory || [];
    if (!history.length) {
      return {
        allowed: false,
        reasonCode: 'NO_REP_SALES_HISTORY_FOR_RETURN',
        errorMessageAr: 'لا يمكن تسجيل مرتجع بدون فاتورة لعميل لم يسبق لهذا المندوب البيع له',
        httpStatus: 403,
        totalAmount,
      };
    }

    for (const item of params.items) {
      const pid = Number(item.productId);
      const hist = history.find((h) => Number(h.productId) === pid);

      if (!hist || hist.totalSoldQty <= 0) {
        return {
          allowed: false,
          reasonCode: 'RETURN_QTY_EXCEEDS_SOLD',
          errorMessageAr: `الكمية المطلوب ردها (${item.qty}) للصنف #${pid} تتجاوز إجمالي ما باعه هذا المندوب للعميل صافي المرتجعات السابقة (0)`,
          httpStatus: 400,
          totalAmount,
        };
      }

      const remainingQty = Number((hist.totalSoldQty - hist.alreadyReturnedQty).toFixed(3));
      if (Number(item.qty) > remainingQty + 0.001) {
        return {
          allowed: false,
          reasonCode: 'RETURN_QTY_EXCEEDS_SOLD',
          errorMessageAr: `الكمية المطلوب ردها (${item.qty}) للصنف #${pid} تتجاوز إجمالي ما باعه هذا المندوب للعميل صافي المرتجعات السابقة (${Math.max(0, remainingQty)})`,
          httpStatus: 400,
          totalAmount,
        };
      }

      if (Number(item.unitPrice) > Number(hist.maxNetUnitPrice) + 0.05) {
        return {
          allowed: false,
          reasonCode: 'RETURN_PRICE_EXCEEDS_NET',
          errorMessageAr: `سعر المرتجع (${item.unitPrice}) يتجاوز السعر الصافي الذي بيع به الصنف للعميل (${hist.maxNetUnitPrice})`,
          httpStatus: 400,
          totalAmount,
        };
      }
    }
  }

  // Cash Refund Protection
  if ((params.refundMethod || 'credit') === 'cash') {
    const currentTripCash = Number(params.tripCashCollected || 0);
    if (totalAmount > currentTripCash + 0.01) {
      return {
        allowed: false,
        reasonCode: 'INSUFFICIENT_REP_CASH_FOR_REFUND',
        errorMessageAr: `رصيد النقدية المحصلة بعهدة المندوب بالرحلة (${currentTripCash} ج.م) لا يكفي لصرف مرتجع نقدي فوري بقيمة (${totalAmount} ج.م)`,
        httpStatus: 400,
        totalAmount,
      };
    }
  }

  return {
    allowed: true,
    totalAmount,
  };
}
