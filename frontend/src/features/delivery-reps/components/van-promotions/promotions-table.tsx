import { useTranslation } from 'react-i18next';
import type { FmcgPromotion } from '../../api/van-sales.api';
import { PROMO_TYPE_LABELS } from './van-promotions-consts';
import {
  EditIcon,
  TrashIcon,
  LayersIcon,
} from '@/shared/components/icons/AppIcons';

export interface PromotionsTableProps {
  isLoading: boolean;
  filteredPromotions: FmcgPromotion[];
  toggleActiveMutation: { mutate: (payload: { id: number; isActive: boolean }) => void };
  openEditDialog: (promo: FmcgPromotion) => void;
  handleDelete: (promo: FmcgPromotion) => Promise<void>;
}

export function PromotionsTable({
  isLoading,
  filteredPromotions,
  toggleActiveMutation,
  openEditDialog,
  handleDelete,
}: PromotionsTableProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '12.5px' }}>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('delivery_reps.van_promotions_admin_tab.s18', "العرض والكود")}</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('delivery_reps.van_promotions_admin_tab.s19', "نوع العرض")}</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('delivery_reps.van_promotions_admin_tab.s20', "شروط الشراء والتفعيل")}</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('delivery_reps.van_promotions_admin_tab.s21', "المكافأة الممنوحة")}</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('delivery_reps.van_promotions_admin_tab.s22', "فترة الصلاحية")}</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('delivery_reps.van_promotions_admin_tab.s23', "الحالة")}</th>
              <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'center' }}>{t('delivery_reps.van_promotions_admin_tab.s24', "الإجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} style={{ padding: '36px', textAlign: 'center', color: '#94a3b8' }}>
                  {t('delivery_reps.van_promotions_admin_tab.s25', "جاري تحميل العروض الترويجية...")}
                </td>
              </tr>
            ) : filteredPromotions.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <LayersIcon size={32} style={{ color: '#cbd5e1' }} />
                    <div style={{ fontWeight: 600, color: '#64748b' }}>{t('delivery_reps.van_promotions_admin_tab.s26', "لا توجد عروض ترويجية مسجلة حالياً")}</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                      {t('delivery_reps.van_promotions_admin_tab.s27', "اضغط على «إضافة عرض ترويجي» لبدء برمجة باقات الخلطات وبونص الكميات")}
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              filteredPromotions.map((p) => {
                let conditionSummary = '';
                if (p.promoType === 'mix_and_match') {
                  const conds = Array.isArray(p.buyConditions) ? p.buyConditions : [p.buyConditions];
                  conditionSummary = conds.map((c: any) => `${c.minQty}x ${c.productName || `صنف #${c.productId}`}`).join(' + ');
                } else if (p.promoType === 'tiered_qty') {
                  const cond = Array.isArray(p.buyConditions) ? p.buyConditions[0] : p.buyConditions;
                  conditionSummary = `شراء ${cond?.minQty || 1} قطعة فأكثر من ${cond?.productName || t('delivery_reps.van_promotions_admin_tab.s28', "الصنف")}`;
                } else if (p.promoType === 'invoice_threshold') {
                  conditionSummary = `فاتورة تتجاوز ${Number(p.buyConditions?.minInvoiceTotal || 0).toLocaleString()} ج.م`;
                }

                let rewardSummary = '';
                if (p.applyType === 'free_bonus') {
                  rewardSummary = `بونص: ${p.reward?.bonusQty || 1}x ${p.reward?.bonusProductName || t('delivery_reps.van_promotions_admin_tab.s29', "صنف مجاني")} (0.00 ج.م)`;
                } else if (p.applyType === 'discount_percent') {
                  rewardSummary = `خصم ${p.reward?.discountPercent}%`;
                } else if (p.applyType === 'discount_amount') {
                  rewardSummary = `خصم ${p.reward?.discountAmount} ج.م`;
                }

                return (
                  <tr
                    key={p.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{p.name}</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', fontFamily: 'monospace' }}>
                        {p.code}
                      </div>
                    </td>

                    <td style={{ padding: '14px 16px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 600,
                          backgroundColor:
                            p.promoType === 'mix_and_match'
                              ? '#eef2ff'
                              : p.promoType === 'tiered_qty'
                              ? '#fef3c7'
                              : '#f0fdf4',
                          color:
                            p.promoType === 'mix_and_match'
                              ? '#3730a3'
                              : p.promoType === 'tiered_qty'
                              ? '#92400e'
                              : '#166534',
                        }}
                      >
                        {PROMO_TYPE_LABELS[p.promoType] || p.promoType}
                      </span>
                    </td>

                    <td style={{ padding: '14px 16px', maxWidth: '240px' }}>
                      <div style={{ fontSize: '12.5px', color: '#1e293b', fontWeight: 500 }}>
                        {conditionSummary || '—'}
                      </div>
                    </td>

                    <td style={{ padding: '14px 16px' }}>
                      <div
                        style={{
                          fontSize: '12.5px',
                          fontWeight: 700,
                          color: p.applyType === 'free_bonus' ? '#16a34a' : '#170e5e',
                        }}
                      >
                        {rewardSummary || '—'}
                      </div>
                    </td>

                    <td style={{ padding: '14px 16px', color: '#64748b', fontSize: '11.5px' }}>
                      {p.startDate || p.endDate ? (
                        <div>
                          <div>{t('delivery_reps.van_promotions_admin_tab.s30', "من:")} {p.startDate || t('delivery_reps.van_promotions_admin_tab.s31', "البداية")}</div>
                          <div>{t('delivery_reps.van_promotions_admin_tab.s32', "إلى:")} {p.endDate || t('delivery_reps.van_promotions_admin_tab.s33', "حتى إشعار آخر")}</div>
                        </div>
                      ) : (
                        t('delivery_reps.van_promotions_admin_tab.s34', "مستمر دائم")
                      )}
                    </td>

                    <td style={{ padding: '14px 16px' }}>
                      <button
                        type="button"
                        onClick={() => toggleActiveMutation.mutate({ id: p.id, isActive: !p.isActive })}
                        style={{
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          padding: '3px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor: p.isActive ? '#dcfce7' : '#f1f5f9',
                          color: p.isActive ? '#15803d' : '#64748b',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <span
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor: p.isActive ? '#16a34a' : '#94a3b8',
                          }}
                        />
                        {p.isActive ? t('delivery_reps.van_promotions_admin_tab.s35', "مفعل") : t('delivery_reps.van_promotions_admin_tab.s36', "معطل")}
                      </button>
                    </td>

                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => openEditDialog(p)}
                          title={t('delivery_reps.van_promotions_admin_tab.s37', "تعديل العرض")}
                          style={{
                            border: '1px solid #e2e8f0',
                            backgroundColor: '#ffffff',
                            borderRadius: '6px',
                            padding: '5px 8px',
                            cursor: 'pointer',
                            color: '#475569',
                          }}
                        >
                          <EditIcon size={14} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          title={t('delivery_reps.van_promotions_admin_tab.s38', "حذف العرض")}
                          style={{
                            border: '1px solid #fee2e2',
                            backgroundColor: '#fff5f5',
                            borderRadius: '6px',
                            padding: '5px 8px',
                            cursor: 'pointer',
                            color: '#dc2626',
                          }}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
