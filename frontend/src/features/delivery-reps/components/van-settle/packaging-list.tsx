import React from 'react';
import { ClockIcon, PackageIcon } from '@/shared/components/icons/AppIcons';
import type { TFunction } from 'i18next';
import type { VanPackagingMovement } from '../../api/van-sales.api';

export interface PackagingListProps {
  // VanPackagingMovement[] is exactly S1's return type
  // (NonNullable<VanSettleTabProps['packagingMovements']>) and S8's own
  // prop type; the facade always passes a defined array (safePackaging
  // memo, never undefined). The brief's literal
  // NonNullable<VanSettleTabProps['safePackaging']> is a grep-proven error:
  // VanSettleTabProps has no 'safePackaging' member.
  safePackaging: VanPackagingMovement[];
  formatTime: (iso?: string) => string;
  t: TFunction;
}

export const PackagingList: React.FC<PackagingListProps> = ({ safePackaging = [], formatTime, t }) => {
  return (
    <>
    {/* 5. RETURNABLE PACKAGING & EMPTIES MOVEMENTS */}
      {safePackaging.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
          <PackageIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
          <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s90', "لا توجد حركات فوارغ أو صناديق مسجلة في هذه الرحلة")}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {safePackaging.map((pkg: any) => {
            const pType = pkg.packageType || pkg.packagingType;
            const delivered = pkg.deliveredQty ?? pkg.qtyOut ?? 0;
            const returned = pkg.returnedQty ?? pkg.qtyIn ?? 0;
            return (
              <div
                key={pkg.id}
                style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                      {pType === 'crate_plastic' || pType === 'plastic_crate' ? t('delivery_reps.van_settle_tab.s91', "صناديق بلاستيك") :
                       pType === 'wooden_pallet' || pType === 'pallet' || pType === 'box_wooden' ? t('delivery_reps.van_settle_tab.s92', "طبالي خشبية (بالتات)") :
                       pType === 'cylinder_gas' || pType === 'gas_cylinder' ? t('delivery_reps.van_settle_tab.s93', "أسطوانات غاز") : t('delivery_reps.van_settle_tab.s94', "فوارغ أخرى")}
                    </span>
                    {pkg.customerName && (
                      <span style={{ fontSize: '11px', color: '#475569', fontWeight: 600 }}>
                        ({pkg.customerName})
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                    <span style={{ color: '#94a3b8', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <ClockIcon size={12} color="#94a3b8" />
                      {formatTime(pkg.createdAt)}
                    </span>
                    {pkg.notes && (
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        • {pkg.notes}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 800 }}>
                  {delivered > 0 && (
                    <span style={{ color: '#c2410c', backgroundColor: '#fff7ed', padding: '2px 6px', borderRadius: '4px' }}>
                      {t('delivery_reps.van_settle_tab.s95', "صادر:")} {delivered}
                    </span>
                  )}
                  {returned > 0 && (
                    <span style={{ color: '#15803d', backgroundColor: '#f0fdf4', padding: '2px 6px', borderRadius: '4px' }}>
                      {t('delivery_reps.van_settle_tab.s96', "وارد:")} {returned}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};
