import { useEffect, useRef } from 'react';
import type { PosItem } from '@/features/pos/types/pos.types';
import type { PaymentChannel, PaymentType } from '@/features/pos/hooks/usePosWorkspace';
import type { Sale } from '@/types/domain';
import { broadcastCustomerDisplayState } from '@/features/pos/lib/pos-customer-display-bridge';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import type {
  CustomerDisplayItem,
  CustomerDisplayPayload,
  CustomerDisplayStatus,
} from '@/features/pos/types/pos-customer-display.types';

interface PosCustomerDisplayBroadcasterParams {
  cart: PosItem[];
  totals: {
    subTotal: number;
    discountAmount?: number;
    discountValue?: number;
    taxAmount: number;
    total: number;
  };
  customer?: {
    name: string;
    phone?: string;
    loyaltyPoints?: number;
  } | null;
  paymentType: PaymentType;
  paymentChannel: PaymentChannel;
  paidAmount: number;
  changeAmount: number;
  digits: MoneyDigits;
  lastSale: Sale | null;
  postSaleSaleKey?: string;
  storeName?: string;
  branchName?: string;
}

export function usePosCustomerDisplayBroadcaster({
  cart,
  totals,
  customer,
  paymentType,
  paymentChannel,
  paidAmount,
  changeAmount,
  lastSale,
  postSaleSaleKey,
  storeName,
  branchName,
  digits,
}: PosCustomerDisplayBroadcasterParams): void {
  const lastCompletedSaleKeyRef = useRef<string>('');

  useEffect(() => {
    const isRecentlyCompleted = Boolean(
      lastSale &&
      cart.length === 0 &&
      postSaleSaleKey &&
      String(lastSale.docNo || lastSale.id || '') === postSaleSaleKey &&
      lastCompletedSaleKeyRef.current !== postSaleSaleKey
    );

    let status: CustomerDisplayStatus = 'idle';

    if (isRecentlyCompleted && lastSale) {
      status = 'completed';
    } else if (cart.length > 0) {
      if (
        paidAmount > 0 ||
        paymentChannel === 'instapay' ||
        paymentChannel === 'wallet' ||
        paymentChannel === 'card'
      ) {
        status = 'payment';
      } else {
        status = 'scanning';
      }
    } else {
      status = 'idle';
    }

    const items: CustomerDisplayItem[] = cart.map((item) => ({
      id: item.productId || item.lineKey,
      name: item.name,
      qty: item.qty,
      price: item.price,
      lineTotal: item.qty * item.price,
      barcode: item.sourceBarcode || item.itemCode,
    }));

    const itemCount = cart.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);

    let qrData: string | undefined;
    let qrLabel: string | undefined;

    if (paymentChannel === 'instapay') {
      qrData = `instapay://pay?amount=${roundMoneyValue(totals.total, digits).toFixed(digits)}&ref=${encodeURIComponent(storeName || 'POS')}`;
      qrLabel = 'امسح للدفع الفوري عبر InstaPay';
    } else if (paymentChannel === 'wallet') {
      qrData = `wallet://pay?amount=${roundMoneyValue(totals.total, digits).toFixed(digits)}&store=${encodeURIComponent(storeName || 'Store')}`;
      qrLabel = 'امسح للدفع عبر المحفظة الإلكترونية (Vodafone Cash, Etisalat...)';
    }

    const payload: CustomerDisplayPayload = {
      status,
      storeName: storeName || 'Z-Systems Store',
      branchName: branchName || '',
      items,
      subtotal: roundMoneyValue(totals.subTotal, digits),
      discount: roundMoneyValue((totals.discountAmount ?? totals.discountValue) || 0, digits),
      tax: roundMoneyValue(totals.taxAmount, digits),
      total: roundMoneyValue(totals.total, digits),
      itemCount,
      customer: customer ? {
        name: customer.name,
        phone: customer.phone,
        loyaltyPoints: customer.loyaltyPoints,
      } : null,
      payment: cart.length > 0 ? {
        channel: paymentChannel,
        paymentType,
        paidAmount,
        change: changeAmount,
        total: totals.total,
        qrData,
        qrLabel,
      } : null,
      completedSale: (status === 'completed' && lastSale) ? {
        docNo: String(lastSale.docNo || lastSale.id || ''),
        total: Number(lastSale.total || totals.total || 0),
        paidAmount: Number(lastSale.paidAmount || 0),
        change: Number((lastSale as any).change ?? (Number(lastSale.paidAmount || 0) - Number(lastSale.total || 0))),
      } : null,
      updatedAt: Date.now(),
    };

    broadcastCustomerDisplayState(payload);
  }, [
    cart,
    totals,
    customer,
    paymentType,
    paymentChannel,
    paidAmount,
    changeAmount,
    lastSale,
    postSaleSaleKey,
    storeName,
    branchName,
    digits,
  ]);
}
