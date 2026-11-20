import React from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { PackageIcon } from '@/shared/components/icons/AppIcons';
import type { TFunction } from 'i18next';
import type { VanSettleTabProps } from './van-settle-types';
// formatTime is imported (not a prop): the span uses it once, prep §3 omits it
// from the props and the S8 mount does not pass it — see build-s11-v51.cjs.
import { formatTime } from './settle-helpers';

export interface ReturnsListProps {
  returns: NonNullable<VanSettleTabProps['returns']>;
  getReturnStatusBadge: (status: string) => { label: string; bg: string; color: string };
  t: TFunction;
}

export const ReturnsList: React.FC<ReturnsListProps> = ({ returns, getReturnStatusBadge, t }) => {
  return (
    <>
          {/* 3. FIELD RETURNS */}
            {returns.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
                <PackageIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s76', "لا توجد أذونات مرتجعات بضاعة مسجلة اليوم")}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {returns.map((ret) => {
                  const statusBadge = getReturnStatusBadge(ret.status);
                  const isCashRefund = ret.refundMethod === 'cash';
                  return (
                    <div
                      key={ret.id}
                      style={{
                        backgroundColor: '#f8fafc',
                        borderRadius: '10px',
                        padding: '10px 12px',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e' }}>
                          {t('delivery_reps.van_settle_tab.s77', "إذن مرتجع #")}{ret.docNo}
                        </span>
                        <span style={{ fontSize: '13.5px', fontWeight: 900, color: '#dc2626' }}>
                          {Number(ret.totalAmount).toFixed(2)} <CurrencySymbol />
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '11.5px' }}>
                        <span style={{ color: '#334155', fontWeight: 700 }}>
                          {t('delivery_reps.van_settle_tab.s78', "العميل:")} {ret.customerName || t('delivery_reps.van_settle_tab.s79', "عميل مباشر")}
                        </span>
                        <span
                          style={{
                            backgroundColor: isCashRefund ? '#fee2e2' : '#fef3c7',
                            color: isCashRefund ? '#b91c1c' : '#b45309',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontWeight: 800,
                            fontSize: '10.5px',
                          }}
                        >
                          {isCashRefund ? t('delivery_reps.van_settle_tab.s80', "دفع نقدي كاش من السيارة") : t('delivery_reps.van_settle_tab.s81', "خصم من رصيد العميل (آجل)")}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#64748b' }}>
                        <span>{t('delivery_reps.van_settle_tab.s82', "السبب:")} {ret.returnReason || t('delivery_reps.van_settle_tab.s83', "بضاعة راكدة / استبدال")}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              backgroundColor: statusBadge.bg,
                              color: statusBadge.color,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              fontWeight: 700,
                              fontSize: '10px',
                            }}
                          >
                            {statusBadge.label}
                          </span>
                          <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                            {formatTime(ret.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
    </>
  );
};
