import type { PosPriceType } from '@/features/pos/types/pos.types';
import type { Product } from '@/types/domain';
import type { PaymentChannel, PaymentType, PosDraftSnapshot } from '@/features/pos/hooks/usePosWorkspace';

export function normalizePaymentChannel(
  paymentType: PaymentType,
  cashAmount: number,
  cardAmount: number,
  transferAmount: number,
  currentChannel?: PaymentChannel,
): PaymentChannel {
  if (paymentType === 'credit') return 'credit';

  const cash = Number(cashAmount || 0);
  const card = Number(cardAmount || 0);
  const transfer = Number(transferAmount || 0);
  const channelsCount = (cash > 0 ? 1 : 0) + (card > 0 ? 1 : 0) + (transfer > 0 ? 1 : 0);

  if (channelsCount === 1) {
    if (card > 0) return 'card';
    if (transfer > 0) return currentChannel === 'wallet' ? 'wallet' : 'instapay';
    return 'cash';
  }

  if (channelsCount > 1) {
    // Keep transfer sub-channel when transfer is part of a split so submit
    // preserves 'wallet' vs 'instapay' choice.
    if (transfer > 0 && (currentChannel === 'wallet' || currentChannel === 'instapay')) {
      return currentChannel;
    }
    return 'mixed';
  }

  if (currentChannel === 'cash' || currentChannel === 'card' || currentChannel === 'wallet' || currentChannel === 'instapay' || currentChannel === 'mixed') {
    return currentChannel;
  }

  return 'cash';
}

export function paymentLabel(paymentType: PaymentType, paymentChannel: string) {
  if (paymentType === 'credit') return 'آجل';
  if (paymentChannel === 'mixed') return 'مختلط';
  if (paymentChannel === 'wallet') return 'محفظة إلكترونية';
  if (paymentChannel === 'instapay') return 'InstaPay';
  if (paymentChannel === 'card') return 'فيزا';
  return 'نقدي';
}

export function computeDraftTotal(draft: PosDraftSnapshot) {
  return draft.cart.reduce((sum, item) => {
    const modifiersTotal = (item.modifiers || []).reduce((modSum: number, mod: any) => modSum + Number(mod.price || 0) * Number(mod.qty || 1), 0);
    return sum + (Number(item.qty || 0) * (Number(item.price || 0) + modifiersTotal));
  }, 0) - Number(draft.discount || 0);
}

export function matchProductByCode(products: Product[], rawCode: string) {
  const code = String(rawCode || '').trim().toLowerCase();
  if (!code) return { status: 'empty' as const };

  const matches: Array<{ product: Product; unitId?: string; unitName?: string | null; multiplier: number; kind: 'product' | 'unit' }> = [];
  const len = products.length;

  for (let i = 0; i < len; i++) {
    const product = products[i];
    const pBarcode = product.barcode ? String(product.barcode).trim().toLowerCase() : '';
    const pSku = product.sku ? String(product.sku).trim().toLowerCase() : '';

    if (pBarcode === code || pSku === code) {
      matches.push({ product, unitName: null, multiplier: 1, kind: 'product' });
    }

    const units = product.units;
    if (units && units.length > 0) {
      for (let j = 0; j < units.length; j++) {
        const unit = units[j];
        if (unit.barcode && String(unit.barcode).trim().toLowerCase() === code) {
          matches.push({
            product,
            unitId: unit.id || '',
            unitName: unit.name || null,
            multiplier: Number(unit.multiplier || 1) || 1,
            kind: 'unit',
          });
        }
      }
    }
  }

  if (!matches.length) return { status: 'not-found' as const };
  const preferredUnits = matches.filter((entry) => entry.kind === 'unit');
  if (preferredUnits.length > 1) return { status: 'ambiguous' as const, matches: preferredUnits };
  const uniqueProductIds = Array.from(new Set(matches.map((entry) => entry.product.id)));
  if (uniqueProductIds.length > 1) return { status: 'ambiguous' as const, matches };
  const preferred = preferredUnits[0] || matches[0];
  return { status: 'matched' as const, match: preferred };
}

export function buildSaleLineKey(product: Product, priceType: PosPriceType) {
  const saleUnit = product.units?.find((entry) => entry.isSaleUnit) || product.units?.[0];
  return `${product.id}::${saleUnit?.id || saleUnit?.name || ''}::${priceType}`;
}
