import { describe, expect, it, vi } from 'vitest';
import { storefrontApi } from './storefront.api';

/*
 * INV-STOREFRONT-ORDER-PRICE: placing an order is a money action — a failed
 * POST must surface the real error, never a fabricated demo order.
 *
 * Live case (2026-11-07, test10k): the order POST was refused by the
 * entitlement gate, and the old catch fallback invented a successful order
 * ORD-180027 (item "منتج #16812 — 0 ج.م", delivery 35.00 from the demo
 * catalog despite free delivery) that was never persisted, so the shopper
 * saw "تم استلام طلبك بنجاح" for an order admin never received.
 *
 * Pinned here, driving the real createOrder with a mocked http layer:
 * - when the POST rejects, createOrder rejects with the same error (no
 *   fabricated ORD- number, no ok:true, no demo token);
 * - when the POST succeeds, the real response passes through untouched.
 */

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

const payload = {
  customerName: 'عميل تجريبي متجر',
  customerPhone: '01012345678',
  customerAddress: 'شارع اختبار 1',
  paymentMethod: 'cash_on_delivery',
  items: [{ productId: 16812, quantity: 1 }],
};

describe('storefront createOrder never fabricates an order (INV-STOREFRONT-ORDER-PRICE)', () => {
  it('rejects with the real server error when the order POST fails', async () => {
    httpMock.mockRejectedValueOnce(new Error('المتجر الإلكتروني غير مفعّل لهذه المنشأة'));
    await expect(storefrontApi.createOrder('test10k', payload as any)).rejects.toThrow(
      'المتجر الإلكتروني غير مفعّل لهذه المنشأة',
    );
    expect(httpMock).toHaveBeenCalledTimes(1);
  });

  it('passes a real successful order through unchanged', async () => {
    const realOrder = {
      ok: true,
      orderId: 42,
      orderNumber: 'ON-261107-0002',
      accessToken: 'real-token',
      trackingUrl: null,
      totalAmount: 131.6,
      subtotal: 131.6,
      deliveryFee: 0,
      discountAmount: 0,
      couponCode: null,
      items: [{ productId: 16812, name: 'منتج اختبار 00002', quantity: 1, unitPrice: 131.6, total: 131.6 }],
      orderType: 'delivery',
      tableNumber: null,
      whatsappUrl: null,
    };
    httpMock.mockResolvedValueOnce(realOrder);
    const res = await storefrontApi.createOrder('test10k', payload as any);
    expect(res).toEqual(realOrder);
    expect(res.orderNumber).not.toMatch(/^ORD-/);
    expect(res.deliveryFee).toBe(0);
    expect(res.totalAmount).toBe(131.6);
  });
});
