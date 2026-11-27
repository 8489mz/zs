import { storefrontApi } from '@/features/storefront/api/storefront.api';
import { persistDraftSnapshot, loadPosWorkspaceStorage } from '@/features/pos/lib/pos.persistence';
import type { PosItem } from '@/features/pos/types/pos.types';

export async function loadOnlineOrderIntoPosCart(orderId: number, navigate?: (to: string) => void) {
  const data = await storefrontApi.preparePos(orderId);

  const posItems: PosItem[] = data.items.map((it) => ({
    lineKey: `${it.productId}::default::retail`,
    productId: String(it.productId),
    name: it.name,
    unitId: 'default',
    unitName: it.unitName || 'قطعة',
    unitMultiplier: 1,
    price: Number(it.price),
    costPrice: Number(it.costPrice || 0),
    qty: Number(it.qty || 1),
    stockLimit: Number(it.stockQty || 9999),
    currentStock: Number(it.stockQty || 9999),
    minStock: 0,
    priceType: 'retail',
  }));

  const baseNote = data.customerNotes && data.customerNotes.trim()
    ? data.customerNotes.trim()
    : `طلب متجر إلكتروني #${data.orderNumber}`;
  const noteText = data.couponCode ? `${baseNote} - كوبون ${data.couponCode}` : baseNote;

  const existingStorage = loadPosWorkspaceStorage();
  const existingDraft = existingStorage.draft;
  let finalCart = posItems;
  let finalDiscount = Number(data.discountAmount || 0);

  // If the active draft is for the same table and has items, merge them instead of overwriting!
  if (
    data.orderType === 'dine_in' &&
    data.tableNumber &&
    existingDraft &&
    String(existingDraft.tableNumber || '').trim() === String(data.tableNumber).trim() &&
    Array.isArray(existingDraft.cart) &&
    existingDraft.cart.length > 0
  ) {
    const merged = [...existingDraft.cart];
    for (const newItem of posItems) {
      const idx = merged.findIndex(
        (m) => String(m.productId) === String(newItem.productId) && m.unitId === newItem.unitId && m.price === newItem.price
      );
      if (idx !== -1) {
        merged[idx] = {
          ...merged[idx],
          qty: Number(merged[idx].qty || 0) + Number(newItem.qty || 0),
        };
      } else {
        merged.push(newItem);
      }
    }
    finalCart = merged;
    finalDiscount = Number(existingDraft.discount || 0) + Number(data.discountAmount || 0);
  }

  persistDraftSnapshot({
    cart: finalCart,
    customerId: data.customerId ? String(data.customerId) : (existingDraft?.customerId || ''),
    customerName: data.customerName || existingDraft?.customerName || '',
    customerPhone: data.customerPhone || existingDraft?.customerPhone || '',
    customerAddress: data.customerAddress || existingDraft?.customerAddress || '',
    quickCustomerName: data.customerName || existingDraft?.quickCustomerName || '',
    quickCustomerPhone: data.customerPhone || existingDraft?.quickCustomerPhone || '',
    quickCustomerAddress: data.customerAddress || existingDraft?.quickCustomerAddress || '',
    deliveryFee: Number(data.deliveryFee || 0),
    discount: finalDiscount,
    orderType: data.orderType === 'dine_in'
      ? 'dine_in'
      : ((data.orderType as string) === 'takeaway' || (data.orderType as string) === 'pickup' ? 'takeaway' : 'delivery'),
    note: existingDraft?.note && existingDraft.note !== noteText ? `${existingDraft.note} • ${noteText}` : noteText,
    paymentType: 'cash',
    paymentChannel: data.paymentMethod === 'instapay_wallet' ? 'instapay' : 'cash',
    paidAmount: 0,
    cashAmount: 0,
    cardAmount: 0,
    transferAmount: 0,
    search: '',
    priceType: 'retail',
    tableNumber: data.orderType === 'dine_in' ? (data.tableNumber || '') : '',
    branchId: '',
    locationId: '',
    deliveryRepId: '',
    onlineOrderId: data.orderId,
  } as any);

  try {
    localStorage.setItem('zs_pos_online_order_id', String(data.orderId));
    localStorage.setItem('zs_pos_online_order_number', String(data.orderNumber));
  } catch {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('zs_pos_reload_draft', {
        detail: { orderId: data.orderId, tableNumber: data.tableNumber },
      })
    );
  }

  if (navigate) {
    navigate('/pos');
  }
  return data;
}
