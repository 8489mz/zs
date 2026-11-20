import React from 'react';
import { Button } from '@/shared/ui/button';
import { ShieldCheckIcon } from '@/shared/components/icons/AppIcons';
import type { TFunction } from 'i18next';
import type { VanSettleTabProps } from './van-settle-types';
import type { VanStockItem } from '../../api/van-sales.api';

export interface SettleSubmitProps {
  unloadRemaining: boolean;
  onUnloadRemainingChange: (val: boolean) => void;
  nightStockApproved: boolean;
  setNightStockApproved: (v: boolean) => void;
  requireSupervisorPin: boolean;
  supervisorPin: string;
  setSupervisorPin: (v: string) => void;
  pinError: string;
  setPinError: (v: string) => void;
  onSubmitSettle: VanSettleTabProps['onSubmitSettle'];
  isSubmitting: boolean;
  countedStockMap: Record<number, string>;
  inventory: VanStockItem[];
  t: TFunction;
}

export const SettleSubmit: React.FC<SettleSubmitProps> = ({
  unloadRemaining,
  onUnloadRemainingChange,
  nightStockApproved,
  setNightStockApproved,
  requireSupervisorPin,
  supervisorPin,
  setSupervisorPin,
  pinError,
  setPinError,
  onSubmitSettle,
  isSubmitting,
  countedStockMap,
  inventory,
  t,
}) => {
  return (
    <>
        {/* Unload Remaining Inventory Checkbox */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
          }}
        >
          <input
            type="checkbox"
            id="unloadCheck"
            checked={unloadRemaining}
            onChange={(e) => onUnloadRemainingChange(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#170e5e' }}
          />
          <label htmlFor="unloadCheck" style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
            {t('delivery_reps.van_settle_tab.s52', "تفريغ البضاعة المتبقية في السيارة (")}{inventory.length} {t('delivery_reps.van_settle_tab.s53', "صنف) وإعادتها للمستودع تلقائياً")}
          </label>
        </div>

        {/* INV-VAN-SELF-SETTLE-PIN-REQUIRED: explicit supervisor approval
        to keep remaining stock in the van overnight. Shown only when
        stock would stay in the van (not unloading). Defaults off — the
        supervisor ticks it and authorizes it with the PIN; without it
        the settlement is refused (NIGHT_STOCK_UNAPPROVED). */}
        {!unloadRemaining && inventory.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              backgroundColor: '#fffbeb',
              borderRadius: '8px',
              border: '1px solid #fde68a',
            }}
          >
            <input
              type="checkbox"
              id="nightStockCheck"
              checked={nightStockApproved}
              onChange={(e) => setNightStockApproved(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#170e5e' }}
            />
            <label htmlFor="nightStockCheck" style={{ fontSize: '11.5px', fontWeight: 700, color: '#92400e', cursor: 'pointer' }}>
              {t('delivery_reps.van_settle_tab.s59', "إبقاء البضاعة المتبقية في السيارة لليوم التالي بموافقة صريحة من المشرف (يُعتمد برمز PIN المشرف)")}
            </label>
          </div>
        )}

        {/* Maker-Checker Supervisor PIN Authorization for Final Settlement */}
        {requireSupervisorPin && (
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: '#eef2ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <ShieldCheckIcon size={16} color="#170e5e" strokeWidth={2} />
              </div>
              <div>
                <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#170e5e' }}>
                  {t('delivery_reps.van_settle_tab.s54', "رمز اعتماد المشرف أو أمين الخزينة (Supervisor PIN):")}
                </div>
                <div style={{ fontSize: '10px', color: '#64748b' }}>
                  {t('delivery_reps.van_settle_tab.s55', "إلزامي لإبراء العهدة واستلام الكاش طبقاً لمبدأ فصل المهام الرقابي (Maker-Checker)")}
                </div>
              </div>
            </div>
            <input
              id="supervisor_pin_input"
              name="supervisor_authorization_pin"
              type="password"
              autoComplete="new-password"
              data-lpignore="true"
              data-form-type="other"
              maxLength={6}
              value={supervisorPin}
              onChange={(e) => {
                setSupervisorPin(e.target.value);
                if (pinError) setPinError('');
              }}
              placeholder={t('delivery_reps.van_settle_tab.s56', "PIN المشرف")}
              style={{
                width: '120px',
                height: '36px',
                borderRadius: '8px',
                border: '1.5px solid #cbd5e1',
                fontSize: '14px',
                fontWeight: 800,
                textAlign: 'center',
                letterSpacing: '2px',
                backgroundColor: '#ffffff',
                color: '#0f172a',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>
        )}

        {pinError && (
          <div
            style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '6px 10px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontWeight: 700,
            }}
          >
            {pinError}
          </div>
        )}

        {/* Submit Settle Action */}
        <Button
          variant="primary"
          onClick={() => {
            if (requireSupervisorPin && !supervisorPin.trim()) {
              setPinError(t('delivery_reps.van_settle_tab.s57', "يرجى إدخال الرمز السري للمشرف أو أمين الخزينة (PIN) لاعتماد تصفية اليومية واستلام الكاش"));
              return;
            }
            setPinError('');

            const countedStockArray = Object.keys(countedStockMap).length > 0
              ? inventory.map((inv) => ({
                  productId: inv.productId,
                  countedQty: countedStockMap[inv.productId] !== undefined && countedStockMap[inv.productId] !== ''
                    ? Number(countedStockMap[inv.productId])
                    : Number(inv.qty),
                }))
              : undefined;

            onSubmitSettle(supervisorPin.trim() || undefined, countedStockArray, !unloadRemaining && nightStockApproved);
          }}
          disabled={isSubmitting}
          style={{
            backgroundColor: '#170e5e',
            color: '#ffffff',
            height: '42px',
            fontSize: '13px',
            fontWeight: 800,
            borderRadius: '8px',
          }}
        >
          {isSubmitting
            ? t('delivery_reps.van_settle_tab.s58', "جاري التصفية والتوريد...")
            : requireSupervisorPin
            ? t('delivery_reps.van_settle_tab.s59', "تأكيد التصفية واعتماد الـ PIN وتوريد الكاش")
            : t('delivery_reps.van_settle_tab.s60', "تأكيد التصفية وإغلاق اليومية وتوريد الكاش")}
        </Button>
    </>
  );
};
