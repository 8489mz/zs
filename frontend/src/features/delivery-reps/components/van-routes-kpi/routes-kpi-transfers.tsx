import { useTranslation } from 'react-i18next';
import type { InterVanTransferRecord } from '../../api/van-sales.api';
import { ArrowLeftIcon } from '@/shared/components/icons/AppIcons';

export interface RoutesKpiTransfersProps {
  transfers: InterVanTransferRecord[];
  isTransfersLoading: boolean;
}

export function RoutesKpiTransfers({
  transfers,
  isTransfersLoading,
}: RoutesKpiTransfersProps) {
  const { t: __t } = useTranslation();
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s31', __t('delivery_reps.van_routes_kpi_admin_tab.s31', "شريط الرقابة المباشرة: مناقلات البضاعة بين سيارات التوزيع في الميدان"))}
          </h3>
          <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#64748b' }}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s32', __t('delivery_reps.van_routes_kpi_admin_tab.s32', "توثيق فوري لأي عملية إسناد أو مناقلة بضاعة بين سيارتين في الشارع بموافقة الطرفين"))}
          </p>
        </div>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#170e5e' }}>
          {__t('delivery_reps.van_routes_kpi_admin_tab.s33', __t('delivery_reps.van_routes_kpi_admin_tab.s33', "إجمالي الحركات:"))} {transfers.length}
        </span>
      </div>

      {isTransfersLoading ? (
        <div style={{ padding: '50px', textAlign: 'center', color: '#94a3b8' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s34', __t('delivery_reps.van_routes_kpi_admin_tab.s34', "جاري تحميل مناقلات الشارع..."))}</div>
      ) : transfers.length === 0 ? (
        <div style={{ padding: '50px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
          {__t('delivery_reps.van_routes_kpi_admin_tab.s35', __t('delivery_reps.van_routes_kpi_admin_tab.s35', "لا توجد عمليات مناقلة بين السيارات حتى الآن اليوم."))}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
              <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s36', __t('delivery_reps.van_routes_kpi_admin_tab.s36', "رقم المناقلة"))}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s37', __t('delivery_reps.van_routes_kpi_admin_tab.s37', "السيارة المصدر (المحوّل)"))}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'center' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s38', __t('delivery_reps.van_routes_kpi_admin_tab.s38', "اتجاه الحركة"))}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s39', __t('delivery_reps.van_routes_kpi_admin_tab.s39', "السيارة المستلمة"))}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s40', __t('delivery_reps.van_routes_kpi_admin_tab.s40', "الأصناف المنقولة"))}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'center' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s41', __t('delivery_reps.van_routes_kpi_admin_tab.s41', "إجمالي القطع"))}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'center' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s42', __t('delivery_reps.van_routes_kpi_admin_tab.s42', "الحالة"))}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s43', __t('delivery_reps.van_routes_kpi_admin_tab.s43', "التاريخ والوقت"))}</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 800, color: '#170e5e' }}>
                  {t.transferNo}
                </td>
                <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>
                  {t.fromRepName}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: '#0284c7',
                      background: '#f0f9ff',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    <ArrowLeftIcon size={12} /> {__t('delivery_reps.van_routes_kpi_admin_tab.s44', __t('delivery_reps.van_routes_kpi_admin_tab.s44', "مناقلة"))}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>
                  {t.toRepName}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {t.items.slice(0, 2).map((it, idx) => (
                      <span key={idx} style={{ color: '#334155' }}>
                        • {it.productName} ({it.qty} {__t('delivery_reps.van_routes_kpi_admin_tab.s45', __t('delivery_reps.van_routes_kpi_admin_tab.s45', "قطعة)"))}
                      </span>
                    ))}
                    {t.items.length > 2 && (
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>+{t.items.length - 2} {__t('delivery_reps.van_routes_kpi_admin_tab.s46', __t('delivery_reps.van_routes_kpi_admin_tab.s46', "أصناف أخرى"))}</span>
                    )}
                  </div>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>
                  {t.totalQty}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background:
                        t.status === 'accepted'
                          ? '#dcfce7'
                          : t.status === 'rejected'
                          ? '#fee2e2'
                          : '#fef3c7',
                      color:
                        t.status === 'accepted'
                          ? '#15803d'
                          : t.status === 'rejected'
                          ? '#b91c1c'
                          : '#b45309',
                    }}
                  >
                    {t.status === 'accepted'
                      ? __t('delivery_reps.van_routes_kpi_admin_tab.s47', __t('delivery_reps.van_routes_kpi_admin_tab.s47', "تم القبول والاستلام"))
                      : t.status === 'rejected'
                      ? __t('delivery_reps.van_routes_kpi_admin_tab.s48', __t('delivery_reps.van_routes_kpi_admin_tab.s48', "مرفوضة من المندوب"))
                      : __t('delivery_reps.van_routes_kpi_admin_tab.s49', __t('delivery_reps.van_routes_kpi_admin_tab.s49', "بانتظار موافقة المستلم"))}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', fontSize: '11px', color: '#64748b' }}>
                  {new Date(t.createdAt).toLocaleDateString('ar-EG', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
