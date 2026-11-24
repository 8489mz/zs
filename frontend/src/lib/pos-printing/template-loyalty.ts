import { getGlobalCurrencySymbol, getGlobalSystemCurrency } from '../currencies';
import type { AppSettings } from '@/types/domain';
import { getPrintOption } from '@/lib/pos-printing/shared';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

export function renderLoyaltySummary(options: {
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  loyaltyPointsBalance?: number;
  settings?: Partial<AppSettings> | null;
  compact?: boolean;
}) {
  const showLoyalty = getPrintOption(options.settings, 'printShowLoyaltyPoints', false);
  if (!showLoyalty) return '';

  const earned = Number(options.loyaltyPointsEarned || 0);
  const redeemed = Number(options.loyaltyPointsRedeemed || 0);
  const balance = options.loyaltyPointsBalance !== undefined && options.loyaltyPointsBalance !== null ? Number(options.loyaltyPointsBalance) : undefined;

  if (earned <= 0 && redeemed <= 0 && (balance === undefined || balance <= 0)) {
    return '';
  }

  const pointValue = Number(options.settings?.loyaltyPointRedeemValue ?? 0.1);
  // INV-FE1-FRONTEND-BOOK-DIGITS: loyalty balance value rounds at
  // the tenant's book digits (receipt settings currency, global
  // fallback) — the old 2dp truncated 3dp tenants' balances.
  const balanceCurrency = balance !== undefined ? roundMoneyValue(balance * pointValue, currencyMoneyDigits(options.settings?.currency || getGlobalSystemCurrency())) : null;

  return `
    <section class="invoice-card invoice-loyalty-card${options.compact ? ' compact' : ''}" style="margin: 4px 0; padding: 5px 7px; border: 1px dashed #000; border-radius: 4px; font-size: ${options.compact ? '9.5px' : '11px'}; color: #000; line-height: 1.4;">
      <div style="font-weight: 800; border-bottom: 1px dotted #cbd5e1; padding-bottom: 2px; margin-bottom: 2px; display: flex; justify-content: space-between;">
        <span>برنامج نقاط ومكافآت الولاء</span>
      </div>
      ${earned > 0 ? `
        <div style="display: flex; justify-content: space-between;">
          <span>النقاط المكتسبة:</span>
          <strong>+${earned.toLocaleString()} نقطة</strong>
        </div>
      ` : ''}
      ${redeemed > 0 ? `
        <div style="display: flex; justify-content: space-between;">
          <span>النقاط المستبدلة:</span>
          <strong>-${redeemed.toLocaleString()} نقطة</strong>
        </div>
      ` : ''}
      ${balance !== undefined ? `
        <div style="display: flex; justify-content: space-between; font-weight: 800; margin-top: 1px; border-top: 1px dashed #e2e8f0; padding-top: 1px;">
          <span>رصيد نقاطك الكلي:</span>
          <strong>${balance.toLocaleString()} نقطة${balanceCurrency !== null ? ` (${balanceCurrency.toLocaleString()} ${getGlobalCurrencySymbol()})` : ''}</strong>
        </div>
      ` : ''}
    </section>
  `;
}
