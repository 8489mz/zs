// Marketplace inbound receiving + discrepancy-claim modals (M8/M9) —
// pure move from SettingsMarketplacesSection.tsx (slice S8). The hook owns
// the receiving/claim state and the two mutations; the two modal components
// render the M8/M9 DialogShells. The facade calls
// useMarketplaceInboundReceiving(inboundShipmentsQuery) once and passes hook
// values as props. The receiving mutation refetches the S6 inbound query on
// success — that query arrives as a hook parameter, never by import.
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { toast } from '@/shared/components/system-alert';
import {
  marketplaceSyncApi,
  FbaInboundShipment,
  FbaDiscrepancyClaimReport,
} from '@/features/storefront/api/marketplace-sync.api';
import {
  XIcon,
  CopyIcon,
} from '@/shared/components/icons/AppIcons';

export function useMarketplaceInboundReceiving(inboundShipmentsQuery: { refetch: () => void }) {
  // Receiving Modal State
  const [receiveShipmentModal, setReceiveShipmentModal] = useState<FbaInboundShipment | null>(null);
  const [receiveFormItems, setReceiveFormItems] = useState<{ [sku: string]: string }>({});

  // Discrepancy Claim Report State
  const [claimReportModal, setClaimReportModal] = useState<FbaDiscrepancyClaimReport | null>(null);
  const [claimLanguage, setClaimLanguage] = useState<'ar' | 'en'>('en');

  const receiveShipmentMutation = useMutation({
    mutationFn: (data: { id: string; receivedItems: { productId: number; marketplaceSku: string; quantityReceived: number }[] }) =>
      marketplaceSyncApi.recordShipmentReceiving(data.id, data.receivedItems),
    onSuccess: (res) => {
      toast.success(`تم تسجيل فحص واستلام الشحنة ${res.shipmentNumber}. الفاقد المرصود: ${res.totalDiscrepancyUnits || 0} قطعة`);
      setReceiveShipmentModal(null);
      inboundShipmentsQuery.refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'فشل تسجيل فحص واستلام الشحنة'),
  });

  const loadClaimReportMutation = useMutation({
    mutationFn: (shipmentId: string) => marketplaceSyncApi.getDiscrepancyClaim(shipmentId),
    onSuccess: (res) => {
      setClaimReportModal(res);
    },
    onError: (err: any) => toast.error(err?.message || 'فشل استخراج تقرير المطالبة'),
  });

  return {
    receiveShipmentModal,
    setReceiveShipmentModal,
    receiveFormItems,
    setReceiveFormItems,
    claimReportModal,
    setClaimReportModal,
    claimLanguage,
    setClaimLanguage,
    receiveShipmentMutation,
    loadClaimReportMutation,
  };
}

export interface ReceiveShipmentModalProps {
  receiving: ReturnType<typeof useMarketplaceInboundReceiving>;
}

export const ReceiveShipmentModal: React.FC<ReceiveShipmentModalProps> = ({ receiving }) => {
  const { t } = useTranslation();
  const {
    receiveShipmentModal,
    setReceiveShipmentModal,
    receiveFormItems,
    setReceiveFormItems,
    receiveShipmentMutation,
  } = receiving;
  return (
    <>
      {/* ========================================================================= */}
      {/* MODAL 8: RECEIVING & DISCREPANCIES CHECK-IN MODAL */}
      {/* ========================================================================= */}
      <DialogShell
        open={!!receiveShipmentModal}
        onClose={() => setReceiveShipmentModal(null)}
        width="min(760px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s649', "تسجيل استلام الشحنة وفحص الفروقات")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s650', "تسجيل استلام الشحنة وفحص عجز المستودع (Receiving & Discrepancies)")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s651', "إذن توريد رقم:")} <strong style={{ color: '#0f172a' }}>{receiveShipmentModal?.shipmentNumber}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s652', "| المستودع المستلم:")}{' '}
                <strong style={{ color: '#0f172a' }}>{receiveShipmentModal?.fulfillmentCenterId}</strong> ({receiveShipmentModal?.marketplace.toUpperCase()})
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReceiveShipmentModal(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {receiveShipmentModal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s653', "الصنف / كود المنصة")}</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s654', "الكمية المشحونة")}</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s655', "الكمية المستلمة فعلياً")}</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s656', "الفارق / العجز")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiveShipmentModal.items.map((it) => {
                      const receivedVal = parseInt(receiveFormItems[it.marketplaceSku] ?? String(it.quantityReceived ?? it.quantityShipped), 10) || 0;
                      const diff = receivedVal - it.quantityShipped;

                      return (
                        <tr key={it.marketplaceSku} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{it.productName}</div>
                            <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>{it.marketplaceSku}</div>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#0f172a' }}>
                            {it.quantityShipped}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <button
                                type="button"
                                onClick={() =>
                                  setReceiveFormItems({
                                    ...receiveFormItems,
                                    [it.marketplaceSku]: String(receivedVal + 1),
                                  })
                                }
                                style={{ width: '26px', height: '26px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 700 }}
                              >
                                +
                              </button>
                              <input
                                type="number"
                                min={0}
                                value={receivedVal}
                                onChange={(e) =>
                                  setReceiveFormItems({
                                    ...receiveFormItems,
                                    [it.marketplaceSku]: e.target.value,
                                  })
                                }
                                style={{ width: '55px', height: '26px', textAlign: 'center', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '12px' }}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setReceiveFormItems({
                                    ...receiveFormItems,
                                    [it.marketplaceSku]: String(Math.max(0, receivedVal - 1)),
                                  })
                                }
                                style={{ width: '26px', height: '26px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 700 }}
                              >
                                -
                              </button>
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            {diff < 0 ? (
                              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#fee2e2', color: '#dc2626', fontWeight: 700 }}>
                                {t('settings.workspace_sections.settings_marketplaces_section.s657', "عجز")} {Math.abs(diff)} {t('settings.workspace_sections.settings_marketplaces_section.s658', "قطعة")}
                              </span>
                            ) : diff === 0 ? (
                              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#dcfce7', color: '#16a34a', fontWeight: 700 }}>
                                {t('settings.workspace_sections.settings_marketplaces_section.s659', "مطابق 100%")}
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#dbeafe', color: '#2563eb', fontWeight: 700 }}>
                                {t('settings.workspace_sections.settings_marketplaces_section.s660', "زيادة +")}{diff} {t('settings.workspace_sections.settings_marketplaces_section.s661', "قطعة")}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Summary Calculation */}
              {(() => {
                const totalShipped = receiveShipmentModal.items.reduce((s, it) => s + it.quantityShipped, 0);
                const totalReceived = receiveShipmentModal.items.reduce((s, it) => {
                  const val = parseInt(receiveFormItems[it.marketplaceSku] ?? String(it.quantityReceived ?? it.quantityShipped), 10) || 0;
                  return s + val;
                }, 0);
                const totalDiscrepancy = Math.max(0, totalShipped - totalReceived);

                return (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12.5px' }}>
                    <div>
                      <span>{t('settings.workspace_sections.settings_marketplaces_section.s662', "إجمالي المشحون:")} <strong>{totalShipped}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s663', "قطعة")}</span>
                      <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
                      <span>{t('settings.workspace_sections.settings_marketplaces_section.s664', "المستلم الفعلي:")} <strong style={{ color: '#16a34a' }}>{totalReceived}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s665', "قطعة")}</span>
                    </div>
                    <div>
                      {totalDiscrepancy > 0 ? (
                        <span style={{ color: '#dc2626', fontWeight: 800 }}>
                          {t('settings.workspace_sections.settings_marketplaces_section.s666', "إجمالي الفاقد والعجز:")} {totalDiscrepancy} {t('settings.workspace_sections.settings_marketplaces_section.s667', "قطعة مفقودة")}
                        </span>
                      ) : (
                        <span style={{ color: '#16a34a', fontWeight: 800 }}>
                          {t('settings.workspace_sections.settings_marketplaces_section.s668', "الشحنة مطابقة بالكامل دون أي عجز")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <Button variant="secondary" onClick={() => setReceiveShipmentModal(null)}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s669', "إلغاء")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    const receivedItems = receiveShipmentModal.items.map((it) => ({
                      productId: it.productId,
                      marketplaceSku: it.marketplaceSku,
                      quantityReceived: parseInt(receiveFormItems[it.marketplaceSku] ?? String(it.quantityReceived ?? it.quantityShipped), 10) || 0,
                    }));
                    receiveShipmentMutation.mutate({
                      id: receiveShipmentModal.id,
                      receivedItems,
                    });
                  }}
                  disabled={receiveShipmentMutation.isPending}
                  style={{ background: '#170e5e', color: '#ffffff' }}
                >
                  {receiveShipmentMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s670', "جاري تسجيل الاستلام...") : t('settings.workspace_sections.settings_marketplaces_section.s671', "تأكيد الاستلام وحفظ تقرير الفروقات")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogShell>
    </>
  );
};

export interface DiscrepancyClaimReportModalProps {
  receiving: ReturnType<typeof useMarketplaceInboundReceiving>;
}

export const DiscrepancyClaimReportModal: React.FC<DiscrepancyClaimReportModalProps> = ({ receiving }) => {
  const { t } = useTranslation();
  const {
    claimReportModal,
    setClaimReportModal,
    claimLanguage,
    setClaimLanguage,
  } = receiving;
  return (
    <>
      {/* ========================================================================= */}
      {/* MODAL 9: DISCREPANCY & SAFE-T CLAIM REPORT MODAL */}
      {/* ========================================================================= */}
      <DialogShell
        open={!!claimReportModal}
        onClose={() => setClaimReportModal(null)}
        width="min(800px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s672', "تقرير ومطالبة التعويض Safe-T / Dispute")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s673', "تقرير المطالبة المالية وفروقات الشحنة (Safe-T / Dispute Claim)")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s674', "مطالبة رسمية جاهزة للتقديم لفريق دعم البائعين لدى")} {claimReportModal?.marketplace.toUpperCase()} {t('settings.workspace_sections.settings_marketplaces_section.s675', "للشحنة")} {claimReportModal?.shipmentNumber}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setClaimReportModal(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {claimReportModal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Claim Overview Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '11.5px', color: '#991b1b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s676', "إجمالي القطع المفقودة (العجز)")}</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626', marginTop: '2px' }}>
                    {claimReportModal.missingUnits} {t('settings.workspace_sections.settings_marketplaces_section.s677', "قطعة")}
                  </div>
                </div>

                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '11.5px', color: '#166534', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s678', "إجمالي قيمة التعويض المطالب به")}</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a', marginTop: '2px' }}>
                    {claimReportModal.estimatedReimbursementAmount.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s679', "ج.م")}
                  </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s680', "المستودع المستلم")}</div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {claimReportModal.fulfillmentCenterId}
                  </div>
                </div>
              </div>

              {/* Language Switcher & Claim Template Text */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <button
                    type="button"
                    onClick={() => setClaimLanguage('en')}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: 'none',
                      background: claimLanguage === 'en' ? '#ffffff' : 'transparent',
                      color: claimLanguage === 'en' ? '#170e5e' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    English (Amazon / Noon Support)
                  </button>
                  <button
                    type="button"
                    onClick={() => setClaimLanguage('ar')}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: 'none',
                      background: claimLanguage === 'ar' ? '#ffffff' : 'transparent',
                      color: claimLanguage === 'ar' ? '#170e5e' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    {t('settings.workspace_sections.settings_marketplaces_section.s681', "العربية (صيغة محلية)")}
                  </button>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const textToCopy = claimLanguage === 'en' ? claimReportModal.generatedClaimTemplateEn : claimReportModal.generatedClaimTemplateAr;
                    navigator.clipboard.writeText(textToCopy);
                    toast.success(t('settings.workspace_sections.settings_marketplaces_section.s682', "تم نسخ نص المطالبة بالكامل إلى الحافظة بنجاح"));
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <CopyIcon size={14} />
                  {t('settings.workspace_sections.settings_marketplaces_section.s683', "نسخ نص التقرير والمطالبة")}
                </Button>
              </div>

              {/* Claim Body Box */}
              <div
                dir={claimLanguage === 'en' ? 'ltr' : 'rtl'}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '16px',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                  color: '#1e293b',
                }}
              >
                {claimLanguage === 'en' ? claimReportModal.generatedClaimTemplateEn : claimReportModal.generatedClaimTemplateAr}
              </div>

              {/* Items Breakdown Table */}
              <div>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s684', "تفاصيل الأصناف التي بها عجز:")}
                </div>
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <tr>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('settings.workspace_sections.settings_marketplaces_section.s685', "الصنف")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('settings.workspace_sections.settings_marketplaces_section.s686', "كود المنصة (SKU)")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s687', "مشحون")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s688', "مستلم")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s689', "العجز")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('settings.workspace_sections.settings_marketplaces_section.s690', "سعر التكلفة")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('settings.workspace_sections.settings_marketplaces_section.s691', "مبلغ التعويض")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claimReportModal.items.map((it: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 10px', fontWeight: 600 }}>{it.productName}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#64748b' }}>{it.marketplaceSku}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'center' }}>{it.shipped}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'center', color: '#16a34a' }}>{it.received}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>
                            {it.missing}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>{it.costPrice} {t('settings.workspace_sections.settings_marketplaces_section.s692', "ج.م")}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                            {it.claimAmount.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s693', "ج.م")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <Button variant="secondary" onClick={() => setClaimReportModal(null)}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s694', "إغلاق")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    const textToCopy = claimLanguage === 'en' ? claimReportModal.generatedClaimTemplateEn : claimReportModal.generatedClaimTemplateAr;
                    navigator.clipboard.writeText(textToCopy);
                    toast.success(t('settings.workspace_sections.settings_marketplaces_section.s695', "تم نسخ نص المطالبة إلى الحافظة"));
                  }}
                  style={{ background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <CopyIcon size={16} />
                  {t('settings.workspace_sections.settings_marketplaces_section.s696', "نسخ نص المطالبة لتقديمه للدعم")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogShell>
    </>
  );
};
