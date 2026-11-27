/**
 * cart-logic — pure move from VanPreSalesTab.tsx (pristine L457-585).
 * Cart handlers (handleUpdateProductUnits, handleCartDelta,
 * handlePaymentTermsChange) + cart totals memos (cartGrossSubtotal,
 * cartNetTotal, cartDiscountAmount, totalPieces) as ONE hook
 * `usePreSalesCartLogic`, so memoization is preserved and every call site
 * stays byte-identical.
 *
 * DESIGN NOTE (deviation from prep §3): prep sketches the handlers as
 * standalone exported functions with explicit params. That would rewrite
 * ~30 call sites, most of which live in JSX sections that S4/S7/S10
 * generate from pristine — the merge would have to reconcile rewritten
 * call sites inside other slices. The hook takes the same state as ONE
 * options object (values byte-identical) and returns the handlers +
 * totals; the facade calls it once and passes the results down as props.
 * Handler/memo bodies below are byte-identical to pristine (same 2-space
 * indent — the hook body sits at the same nesting level as the component
 * body was). 1 roundMoney site (L580) moves byte-identical.
 */
import {useMemo, type Dispatch, type SetStateAction} from 'react';
import type { PreSalesCartLine } from './van-pre-sales-types';
import type { PreSalesCatalogItem } from '../../api/van-sales.api';
import { calculateItemPrice } from './calculate-item-price';
import { roundMoney } from '../../utils/van-money.utils';
import { toast } from '@/shared/components/system-alert';

export interface PreSalesCartLogicOptions {
  cart: PreSalesCartLine[];
  setCart: Dispatch<SetStateAction<PreSalesCartLine[]>>;
  paymentTerms: 'cash' | 'credit';
  setPaymentTerms: Dispatch<SetStateAction<'cash' | 'credit'>>;
  catalogProducts: PreSalesCatalogItem[];
}

export interface PreSalesCartLogic {
  handleUpdateProductUnits: (product: PreSalesCatalogItem, targetCartons: number, targetPieces: number) => void;
  handleCartDelta: (productId: number, unitType: 'carton' | 'piece', delta: number) => void;
  handlePaymentTermsChange: (newTerms: 'cash' | 'credit') => void;
  cartGrossSubtotal: number;
  cartNetTotal: number;
  cartDiscountAmount: number;
  totalPieces: number;
}

export function usePreSalesCartLogic({
  cart,
  setCart,
  paymentTerms,
  setPaymentTerms,
  catalogProducts,
}: PreSalesCartLogicOptions): PreSalesCartLogic {
  // Update Carton and Piece Quantities for an item
  const handleUpdateProductUnits = (
    product: PreSalesCatalogItem,
    targetCartons: number,
    targetPieces: number,
  ) => {
    const mult = product.packagingUnit?.multiplier || 1;
    const isCartonItem = Boolean(product.packagingUnit && mult > 1);
    const safeCartons = isCartonItem ? Math.max(0, targetCartons) : 0;
    const safePieces = Math.max(0, targetPieces);
    const totalBaseQty = safeCartons * mult + safePieces;

    if (totalBaseQty > product.warehouseAvailable) {
      toast.warning(`أقصى رصيد متاح للحجز من "${product.name}" بالمخزن هو ${product.warehouseAvailable} قطعة`);
      return;
    }

    setCart((prev) => {
      const existingIdx = prev.findIndex((l) => l.productId === product.id);

      if (totalBaseQty <= 0) {
        if (existingIdx >= 0) {
          return prev.filter((l) => l.productId !== product.id);
        }
        return prev;
      }

      const piecePricing = calculateItemPrice(product, paymentTerms, totalBaseQty, 1);
      const cartonPricing = isCartonItem ? calculateItemPrice(product, paymentTerms, totalBaseQty, mult) : null;

      const newCartLine: PreSalesCartLine = {
        productId: product.id,
        productName: product.name,
        unitName: isCartonItem ? (safeCartons > 0 ? (product.packagingUnit?.name || 'كرتونة') : 'قطعة') : 'قطعة',
        unitMultiplier: mult,
        quantity: totalBaseQty,
        cartons: safeCartons,
        pieces: safePieces,
        packagingUnitName: product.packagingUnit?.name || 'كرتونة',
        cartonMultiplier: mult,
        pieceListPrice: piecePricing.listPrice,
        cartonListPrice: cartonPricing ? cartonPricing.listPrice : piecePricing.listPrice * mult,
        pieceCashDiscount: piecePricing.cashDiscountPerUnit,
        cartonCashDiscount: cartonPricing ? cartonPricing.cashDiscountPerUnit : piecePricing.cashDiscountPerUnit * mult,
        pieceUnitPrice: piecePricing.effectivePrice,
        cartonUnitPrice: cartonPricing ? cartonPricing.effectivePrice : piecePricing.effectivePrice * mult,
        unitPrice: piecePricing.effectivePrice,
        consumerPrice: piecePricing.consumerPrice,
        pricingTierType: piecePricing.tierType,
        unitOfferSavings: piecePricing.savings,
        warehouseAvailable: product.warehouseAvailable,
      };

      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = newCartLine;
        return next;
      } else {
        return [...prev, newCartLine];
      }
    });
  };

  // Quick increment/decrement from Cart
  const handleCartDelta = (productId: number, unitType: 'carton' | 'piece', delta: number) => {
    const line = cart.find((l) => l.productId === productId);
    if (!line) return;
    const prod = catalogProducts.find((p) => p.id === productId);
    if (!prod) return;

    if (unitType === 'carton') {
      handleUpdateProductUnits(prod, line.cartons + delta, line.pieces);
    } else {
      handleUpdateProductUnits(prod, line.cartons, line.pieces + delta);
    }
  };

  // Change payment terms (Cash / Credit) & refresh cart prices immediately
  const handlePaymentTermsChange = (newTerms: 'cash' | 'credit') => {
    setPaymentTerms(newTerms);
    setCart((prev) =>
      prev.map((line) => {
        const catItem = catalogProducts.find((p) => p.id === line.productId);
        if (!catItem) return line;
        const totalBase = line.quantity;
        const piecePricing = calculateItemPrice(catItem, newTerms, totalBase, 1);
        const cartonPricing = line.cartonMultiplier > 1 ? calculateItemPrice(catItem, newTerms, totalBase, line.cartonMultiplier) : null;
        return {
          ...line,
          pieceListPrice: piecePricing.listPrice,
          cartonListPrice: cartonPricing ? cartonPricing.listPrice : piecePricing.listPrice * line.cartonMultiplier,
          pieceCashDiscount: piecePricing.cashDiscountPerUnit,
          cartonCashDiscount: cartonPricing ? cartonPricing.cashDiscountPerUnit : piecePricing.cashDiscountPerUnit * line.cartonMultiplier,
          pieceUnitPrice: piecePricing.effectivePrice,
          cartonUnitPrice: cartonPricing ? cartonPricing.effectivePrice : piecePricing.effectivePrice * line.cartonMultiplier,
          unitPrice: piecePricing.effectivePrice,
          pricingTierType: piecePricing.tierType,
          unitOfferSavings: piecePricing.savings,
        };
      }),
    );
  };

  // Cart totals: Gross (Credit), Cash Discount, and Net Payable
  const cartGrossSubtotal = useMemo(() => {
    return cart.reduce((sum, line) => {
      if (line.cartonMultiplier > 1 && (line.cartons > 0 || line.pieces > 0)) {
        return sum + (line.cartons * line.cartonListPrice + line.pieces * line.pieceListPrice);
      }
      return sum + line.quantity * line.pieceListPrice;
    }, 0);
  }, [cart]);

  const cartNetTotal = useMemo(() => {
    return cart.reduce((sum, line) => {
      if (line.cartonMultiplier > 1 && (line.cartons > 0 || line.pieces > 0)) {
        return sum + (line.cartons * line.cartonUnitPrice + line.pieces * line.pieceUnitPrice);
      }
      return sum + line.quantity * line.pieceUnitPrice;
    }, 0);
  }, [cart]);

  const cartDiscountAmount = useMemo(() => {
    return Math.max(0, roundMoney(cartGrossSubtotal - cartNetTotal));
  }, [cartGrossSubtotal, cartNetTotal]);

  const totalPieces = useMemo(() => {
    return cart.reduce((sum, line) => sum + line.quantity, 0);
  }, [cart]);
  return {
    handleUpdateProductUnits,
    handleCartDelta,
    handlePaymentTermsChange,
    cartGrossSubtotal,
    cartNetTotal,
    cartDiscountAmount,
    totalPieces,
  };
}
