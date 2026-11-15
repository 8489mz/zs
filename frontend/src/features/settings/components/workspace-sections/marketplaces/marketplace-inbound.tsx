// Marketplace inbound shipments tab (FBA/FBN workflow) —
// pure move from SettingsMarketplacesSection.tsx (slice S6). The hook owns
// the inbound shipments query + packing-slip handler; the tab component
// renders the tab JSX. The facade calls useMarketplaceInbound() once and
// passes hook values as props. Modal setters (S7/S8) arrive as props — the
// modal state lives with its modal's slice, never duplicated here.
import { useTranslation } from 'react-i18next';
import React from 'react';
import { useQuery, type UseMutationResult } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import { formatDateTimeArabic } from '@/lib/format';
import {
  marketplaceSyncApi,
  type FbaInboundShipment,
  type FbaDiscrepancyClaimReport,
} from '@/features/storefront/api/marketplace-sync.api';
import {
  CheckIcon,
  PlusIcon,
  DownloadIcon,
  TruckIcon,
  PrinterIcon,
} from '@/shared/components/icons/AppIcons';

export function useMarketplaceInbound() {
  const inboundShipmentsQuery = useQuery({
    queryKey: ['marketplace-inbound-shipments'],
    queryFn: () => marketplaceSyncApi.getInboundShipments(),
  });

  const handleExportPackingSlip = async (shipmentId: string) => {
    try {
      const res = await marketplaceSyncApi.exportPackingSlip(shipmentId);
      const blob = new Blob([res.data], { type: res.contentType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('تم تحميل كشف التعبئة (Packing Slip) بنجاح');
    } catch (err: any) {
      toast.error(err?.message || 'فشل تحميل كشف التعبئة');
    }
  };

  return {
    inboundShipmentsQuery,
    handleExportPackingSlip,
  };
}

export interface MarketplaceInboundTabProps {
  inbound: ReturnType<typeof useMarketplaceInbound>;
  setShowInboundModal: React.Dispatch<React.SetStateAction<boolean>>;
  setPrintFnskuModal: React.Dispatch<
    React.SetStateAction<{
      productName: string;
      marketplaceSku: string;
      barcode?: string;
      condition: string;
      marketplace: string;
      format: 'thermal_50x30' | 'thermal_40x25' | 'a4_44up';
      copies: number;
    } | null>
  >;
  setReceiveShipmentModal: React.Dispatch<React.SetStateAction<FbaInboundShipment | null>>;
  setReceiveFormItems: React.Dispatch<React.SetStateAction<{ [sku: string]: string }>>;
  loadClaimReportMutation: UseMutationResult<FbaDiscrepancyClaimReport, any, string, unknown>;
}

export const MarketplaceInboundTab: React.FC<MarketplaceInboundTabProps> = ({
  inbound,
  setShowInboundModal,
  setPrintFnskuModal,
  setReceiveShipmentModal,
  setReceiveFormItems,
  loadClaimReportMutation,
}) => {
  const { t } = useTranslation();
  const { inboundShipmentsQuery, handleExportPackingSlip } = inbound;
  return (
    <>
      {/* ========================================================================= */}
      {/* TAB: FBA / FBN INBOUND SHIPMENTS WORKFLOW */}
      {/* ========================================================================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Summary KPI Cards */}
          {(() => {
            const list = inboundShipmentsQuery.data || [];
            const totalShipments = list.length;
            const amazonCount = list.filter((s) => s.marketplace === 'amazon').length;
            const noonCount = list.filter((s) => s.marketplace === 'noon').length;
            const totalUnits = list.reduce((sum, s) => sum + (s.totalUnits || 0), 0);
            const totalBoxes = list.reduce((sum, s) => sum + (s.totalBoxes || 0), 0);

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s257', "إجمالي أذونات التوريد للمستودعات")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {totalShipments} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s258', "شحنة")}</span>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#92400e', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s259', "شحنات أمازون FBA")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#92400e', marginTop: '4px' }}>
                    {amazonCount} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s260', "إذن شحن")}</span>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#854d0e', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s261', "شحنات نون FBN")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#854d0e', marginTop: '4px' }}>
                    {noonCount} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s262', "إذن شحن")}</span>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#15803d', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s263', "إجمالي القطع المشحونة للمراكز")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                    {totalUnits.toLocaleString('en-US')} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s264', "قطعة (")}{totalBoxes} {t('settings.workspace_sections.settings_marketplaces_section.s265', "كرتونة)")}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Main Card */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <TruckIcon size={18} color="#170e5e" />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s266', "أذونات الشحن والتوريد لمستودعات FBA و FBN")}</span>
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s267', "إدارة وتجهيز الشحنات المرسلة لمراكز Fulfillment By Amazon و Fulfillment By Noon، حجز المخزون، وتصدير كشوف التعبئة للكراتين (Packing Slips).")}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  variant="primary"
                  onClick={() => setShowInboundModal(true)}
                  style={{ background: '#170e5e', color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                >
                  <PlusIcon size={14} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s268', "إنشاء إذن توريد جديد (FBA/FBN)")}</span>
                </Button>
              </div>
            </div>

            {/* Inbound Shipments Table */}
            {inboundShipmentsQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s269', "جاري تحميل أذونات التوريد...")}</div>
            ) : !inboundShipmentsQuery.data || inboundShipmentsQuery.data.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ textAlign: 'center', padding: '36px 20px', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1' }}>
                  <TruckIcon size={32} color="#94a3b8" style={{ margin: '0 auto 8px', display: 'block' }} />
                  <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '15px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s270', "لا توجد أذونات شحن أو توريد مسجلة حتى الآن")}</div>
                  <p style={{ fontSize: '12.5px', color: '#64748b', maxWidth: '540px', margin: '6px auto 16px', lineHeight: 1.5 }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s271', "يمكنك إنشاء إذن توريد جديد لحجز المخزون من مستودعك المحلي وتصدير ملصقات الكراتين المتوافقة مع مراكز توزيع أمازون FBA ونون FBN.")}
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => setShowInboundModal(true)}
                    style={{ background: '#170e5e', color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                  >
                    <PlusIcon size={14} />
                    <span>{t('settings.workspace_sections.settings_marketplaces_section.s272', "إنشاء أول إذن توريد الآن (FBA/FBN)")}</span>
                  </Button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>1</span>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{t('settings.workspace_sections.settings_marketplaces_section.s273', "حجز المخزون المحلي")}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s274', "إنشاء الإذن يحجز الكميات المحددة فوراً داخل الـ ERP لحمايتها من البيع في الفروع أو الكاشير.")}
                    </p>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>2</span>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{t('settings.workspace_sections.settings_marketplaces_section.s275', "توزيع الكراتين والوجهة")}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s276', "تحديد مركز الشحن (مثل مستودع أمازون العاشر من رمضان CAI1 أو نون EG01) وتوزيع القطع بالكرتونة.")}
                    </p>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>3</span>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{t('settings.workspace_sections.settings_marketplaces_section.s277', "كشف التعبئة وبوليصة الكرتونة")}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s278', "طباعة كشف المحتويات الرسمي (Packing Slip) وملصقات الكراتين الخارجية للتحقق عند الاستلام.")}
                    </p>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>4</span>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{t('settings.workspace_sections.settings_marketplaces_section.s279', "طباعة باركود القطع FNSKU")}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s280', "توليد باركودات القطع الحرارية بمقاس 50x30 أو 40x25 ولصقها على كل وحدة قبل الإغلاق.")}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s281', "رقم الإذن")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s282', "المنصة والوجهة")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s283', "مركز التوزيع (FC)")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s284', "الكراتين / القطع")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s285', "رقم التتبع / البوليصة")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s286', "الحالة")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s287', "تاريخ الإنشاء")}</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s288', "كشف التعبئة")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inboundShipmentsQuery.data.map((shipment) => (
                      <tr key={shipment.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px', fontWeight: 800, color: '#170e5e', fontFamily: 'monospace' }}>
                          {shipment.shipmentNumber}
                        </td>

                        <td style={{ padding: '12px' }}>
                          <span
                            style={{
                              background: shipment.marketplace === 'amazon' ? '#fef3c7' : '#fef9c3',
                              color: shipment.marketplace === 'amazon' ? '#92400e' : '#854d0e',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontWeight: 700,
                              fontSize: '11px',
                            }}
                          >
                            {shipment.marketplace === 'amazon' ? t('settings.workspace_sections.settings_marketplaces_section.s289', "أمازون FBA") : t('settings.workspace_sections.settings_marketplaces_section.s290', "نون FBN")}
                          </span>
                        </td>

                        <td style={{ padding: '12px', fontWeight: 600, color: '#334155' }}>
                          {shipment.fulfillmentCenterId}
                        </td>

                        <td style={{ padding: '12px' }}>
                          <span style={{ fontWeight: 800, color: '#0f172a' }}>{shipment.totalUnits} {t('settings.workspace_sections.settings_marketplaces_section.s291', "قطعة")}</span>
                          <span style={{ color: '#64748b', fontSize: '11.5px', marginRight: '6px' }}>({shipment.totalBoxes} {t('settings.workspace_sections.settings_marketplaces_section.s292', "كرتونة)")}</span>
                        </td>

                        <td style={{ padding: '12px', fontFamily: 'monospace', color: shipment.trackingNumber ? '#0f172a' : '#94a3b8' }}>
                          {shipment.trackingNumber || '—'}
                        </td>

                        <td style={{ padding: '12px' }}>
                          {shipment.status === 'draft' ? (
                            <span style={{ background: '#f8fafc', color: '#64748b', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s293', "مسودة وتجهيز")}
                            </span>
                          ) : shipment.status === 'shipped' ? (
                            <span style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s294', "تم الشحن في الطريق")}
                            </span>
                          ) : (shipment.totalDiscrepancyUnits || 0) > 0 ? (
                            <div>
                              <span style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, display: 'inline-block' }}>
                                {t('settings.workspace_sections.settings_marketplaces_section.s295', "عجز:")} {shipment.totalDiscrepancyUnits} {t('settings.workspace_sections.settings_marketplaces_section.s296', "قطعة (")}{shipment.discrepancyLossAmount || 0} {t('settings.workspace_sections.settings_marketplaces_section.s297', "ج.م)")}
                              </span>
                              <div style={{ marginTop: '3px' }}>
                                <button
                                  type="button"
                                  onClick={() => loadClaimReportMutation.mutate(shipment.id)}
                                  style={{ border: 'none', background: 'transparent', color: '#b91c1c', textDecoration: 'underline', cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}
                                >
                                  {t('settings.workspace_sections.settings_marketplaces_section.s298', "تقرير المطالبة بالتعويض")}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s299', "تم الاستلام بالكامل")}
                            </span>
                          )}
                        </td>

                        <td style={{ padding: '12px', color: '#64748b', fontSize: '11.5px' }}>
                          {formatDateTimeArabic(shipment.createdAt)}
                        </td>

                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '5px', justifyContent: 'center', flexWrap: 'wrap' }}>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                const initItems: { [sku: string]: string } = {};
                                shipment.items.forEach((it) => {
                                  initItems[it.marketplaceSku] = String(it.quantityReceived ?? it.quantityShipped);
                                });
                                setReceiveFormItems(initItems);
                                setReceiveShipmentModal(shipment);
                              }}
                              style={{ fontSize: '11px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                              title={t('settings.workspace_sections.settings_marketplaces_section.s300', "تسجيل الفحص ومطابقة الكميات المستلمة في مستودع المنصة")}
                            >
                              <CheckIcon size={12} />
                              <span>{shipment.status === 'received' ? t('settings.workspace_sections.settings_marketplaces_section.s301', "تعديل الفحص") : t('settings.workspace_sections.settings_marketplaces_section.s302', "فحص واستلام")}</span>
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() => {
                                const firstItem = shipment.items[0];
                                setPrintFnskuModal({
                                  productName: firstItem?.productName || shipment.shipmentNumber,
                                  marketplaceSku: firstItem?.marketplaceSku || shipment.shipmentNumber,
                                  barcode: firstItem?.barcode,
                                  condition: 'NEW',
                                  marketplace: shipment.marketplace,
                                  format: 'thermal_50x30',
                                  copies: firstItem?.quantityShipped || 10,
                                });
                              }}
                              style={{ fontSize: '11px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                              title={t('settings.workspace_sections.settings_marketplaces_section.s303', "طباعة ملصقات وباركودات FNSKU للقطع المشحونة")}
                            >
                              <PrinterIcon size={12} />
                              <span>{t('settings.workspace_sections.settings_marketplaces_section.s304', "طباعة FNSKU")}</span>
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() => handleExportPackingSlip(shipment.id)}
                              style={{ fontSize: '11px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                              title={t('settings.workspace_sections.settings_marketplaces_section.s305', "تحميل كشف التعبئة المخصص لكراتين المنصة")}
                            >
                              <DownloadIcon size={12} />
                              <span>{t('settings.workspace_sections.settings_marketplaces_section.s306', "كشف التعبئة")}</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
    </>
  );
};
