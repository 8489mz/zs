// Inbound modals (create + FNSKU) —
// pure move from SettingsMarketplacesSection.tsx (slice S7). The hook owns
// the inbound-modal state + createInboundMutation + handlePrintFnskuLabels
// (147L); the two modal components render the M6/M7 DialogShell JSX.
// The facade calls useMarketplaceInboundModals() once (with
// inboundShipmentsQuery, for the createInboundMutation.onSuccess refetch)
// and renders the two modals. `t` is local — each modal calls
// useTranslation() itself. The modal state lives WITH its modal's slice:
// S4/S6 tabs receive only the setters as props (setShowInboundModal,
// setPrintFnskuModal); the facade destructures those two setters next to
// the hook call (S5/S8 precedent) so the S4/S6 renders' bare-name props
// stay bound — no render-site change needed at merge.
// availableProducts (facade kernel) + mappings (S4) are component props.
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { toast } from '@/shared/components/system-alert';
import {
  marketplaceSyncApi,
  MarketplaceSkuMapping,
  FbaInboundItem,
} from '@/features/storefront/api/marketplace-sync.api';
import type { Product } from '@/types/domain';
import {
  XIcon,
  TruckIcon,
  PrinterIcon,
} from '@/shared/components/icons/AppIcons';

export interface UseMarketplaceInboundModalsParams {
  inboundShipmentsQuery: { refetch: () => Promise<unknown> };
}

export function useMarketplaceInboundModals({ inboundShipmentsQuery }: UseMarketplaceInboundModalsParams) {

  // Inbound Shipments State (FBA / FBN)
  const [showInboundModal, setShowInboundModal] = useState<boolean>(false);
  const [inboundForm, setInboundForm] = useState<{
    marketplace: 'amazon' | 'noon';
    fulfillmentCenterId: string;
    trackingNumber: string;
    notes: string;
    selectedProductId: number;
    quantity: string;
    boxNumber: string;
    items: FbaInboundItem[];
  }>({
    marketplace: 'amazon',
    fulfillmentCenterId: 'CAI1',
    trackingNumber: '',
    notes: '',
    selectedProductId: 0,
    quantity: '10',
    boxNumber: '1',
    items: [],
  });

  // FNSKU Label Printing State
  const [printFnskuModal, setPrintFnskuModal] = useState<{
    productName: string;
    marketplaceSku: string;
    barcode?: string;
    condition: string;
    marketplace: string;
    format: 'thermal_50x30' | 'thermal_40x25' | 'a4_44up';
    copies: number;
  } | null>(null);

  const createInboundMutation = useMutation({
    mutationFn: (data: any) => marketplaceSyncApi.createInboundShipment(data),
    onSuccess: (res) => {
      toast.success(`تم إنشاء إذن توريد ${res.marketplace.toUpperCase()} بنجاح برقم ${res.shipmentNumber}`);
      setShowInboundModal(false);
      inboundShipmentsQuery.refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'فشل إنشاء إذن التوريد'),
  });

  const handlePrintFnskuLabels = () => {
    if (!printFnskuModal) return;
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      toast.error('يرجى السماح بالنوافذ المنبثقة للطباعة');
      return;
    }

    const { productName, marketplaceSku, format, copies, condition } = printFnskuModal;
    const isA4 = format === 'a4_44up';
    const is50x30 = format === 'thermal_50x30';

    const labelHtml = `
      <div class="label-box">
        <div class="sku-code">${marketplaceSku}</div>
        <div class="barcode-svg">
          <svg viewBox="0 0 160 45" style="width: 100%; height: 34px;">
            <rect x="0" y="0" width="4" height="40" fill="#000"/>
            <rect x="7" y="0" width="2" height="40" fill="#000"/>
            <rect x="12" y="0" width="5" height="40" fill="#000"/>
            <rect x="20" y="0" width="2" height="40" fill="#000"/>
            <rect x="25" y="0" width="3" height="40" fill="#000"/>
            <rect x="31" y="0" width="6" height="40" fill="#000"/>
            <rect x="40" y="0" width="2" height="40" fill="#000"/>
            <rect x="45" y="0" width="4" height="40" fill="#000"/>
            <rect x="52" y="0" width="2" height="40" fill="#000"/>
            <rect x="57" y="0" width="5" height="40" fill="#000"/>
            <rect x="65" y="0" width="3" height="40" fill="#000"/>
            <rect x="71" y="0" width="2" height="40" fill="#000"/>
            <rect x="76" y="0" width="4" height="40" fill="#000"/>
            <rect x="83" y="0" width="2" height="40" fill="#000"/>
            <rect x="88" y="0" width="6" height="40" fill="#000"/>
            <rect x="97" y="0" width="3" height="40" fill="#000"/>
            <rect x="103" y="0" width="2" height="40" fill="#000"/>
            <rect x="108" y="0" width="5" height="40" fill="#000"/>
            <rect x="116" y="0" width="2" height="40" fill="#000"/>
            <rect x="121" y="0" width="4" height="40" fill="#000"/>
            <rect x="128" y="0" width="2" height="40" fill="#000"/>
            <rect x="133" y="0" width="6" height="40" fill="#000"/>
            <rect x="142" y="0" width="2" height="40" fill="#000"/>
            <rect x="147" y="0" width="4" height="40" fill="#000"/>
            <rect x="154" y="0" width="4" height="40" fill="#000"/>
          </svg>
        </div>
        <div class="prod-title">${productName}</div>
        <div class="condition-tag">${condition}</div>
      </div>
    `;

    const labels = Array.from({ length: copies }, () => labelHtml).join('');

    const pageSize = isA4 ? 'A4 portrait' : is50x30 ? '50mm 30mm' : '40mm 25mm';
    const pageMargin = isA4 ? '8mm' : '0';

    const layoutCss = isA4
      ? `
        .grid-container {
          display: grid;
          grid-template-columns: repeat(4, 48.5mm);
          grid-auto-rows: 25.4mm;
          gap: 0;
          justify-content: center;
        }
        .label-box {
          box-sizing: border-box;
          width: 48.5mm;
          height: 25.4mm;
          padding: 1.5mm;
          text-align: center;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
      `
      : `
        .grid-container {
          display: block;
        }
        .label-box {
          box-sizing: border-box;
          width: ${is50x30 ? '50mm' : '40mm'};
          height: ${is50x30 ? '30mm' : '25mm'};
          padding: 1.5mm;
          text-align: center;
          page-break-after: always;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
      `;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>FNSKU Labels - ${marketplaceSku}</title>
          <style>
            @page {
              size: ${pageSize};
              margin: ${pageMargin};
            }
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 0;
              -webkit-print-color-adjust: exact;
            }
            ${layoutCss}
            .sku-code {
              font-size: 8pt;
              font-weight: bold;
              letter-spacing: 0.5px;
            }
            .barcode-svg {
              margin: 1px 0;
            }
            .prod-title {
              font-size: 6pt;
              line-height: 1.1;
              max-height: 13px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            .condition-tag {
              font-size: 5.5pt;
              font-weight: bold;
              text-transform: uppercase;
            }
          </style>
        </head>
        <body>
          <div class="grid-container">
            ${labels}
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return {
    showInboundModal,
    setShowInboundModal,
    inboundForm,
    setInboundForm,
    createInboundMutation,
    printFnskuModal,
    setPrintFnskuModal,
    handlePrintFnskuLabels,
  };
}

export interface CreateInboundShipmentModalProps {
  inboundModals: ReturnType<typeof useMarketplaceInboundModals>;
  availableProducts: Product[];
  mappings: MarketplaceSkuMapping[];
}

export const CreateInboundShipmentModal: React.FC<CreateInboundShipmentModalProps> = ({ inboundModals, availableProducts, mappings }) => {
  const { t } = useTranslation();
  const {
    showInboundModal,
    setShowInboundModal,
    inboundForm,
    setInboundForm,
    createInboundMutation,
  } = inboundModals;
  return (
    <>
      {/* ========================================================================= */}
      {/* MODAL 6: CREATE FBA / FBN INBOUND SHIPMENT MODAL */}
      {/* ========================================================================= */}
      <DialogShell
        open={showInboundModal}
        onClose={() => setShowInboundModal(false)}
        width="min(760px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s594', "إنشاء إذن توريد جديد FBA / FBN")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TruckIcon size={18} color="#170e5e" />
              <span>{t('settings.workspace_sections.settings_marketplaces_section.s595', "إنشاء إذن توريد وشحن لمستودعات FBA و FBN")}</span>
            </h4>
            <button
              type="button"
              onClick={() => setShowInboundModal(false)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Top Form Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s596', "المنصة الوجهة")}
                </label>
                <select
                  value={inboundForm.marketplace}
                  onChange={(e) => {
                    const mp = e.target.value as 'amazon' | 'noon';
                    setInboundForm({
                      ...inboundForm,
                      marketplace: mp,
                      fulfillmentCenterId: mp === 'amazon' ? 'CAI1' : 'EGP1',
                    });
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="amazon">{t('settings.workspace_sections.settings_marketplaces_section.s597', "أمازون (FBA - Fulfillment By Amazon)")}</option>
                  <option value="noon">{t('settings.workspace_sections.settings_marketplaces_section.s598', "نون (FBN - Fulfillment By Noon)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s599', "مركز التوزيع المستلم (FC)")}
                </label>
                <input
                  type="text"
                  value={inboundForm.fulfillmentCenterId}
                  onChange={(e) => setInboundForm({ ...inboundForm, fulfillmentCenterId: e.target.value })}
                  placeholder={inboundForm.marketplace === 'amazon' ? t('settings.workspace_sections.settings_marketplaces_section.s600', "مثال: CAI1 أو CAI2") : t('settings.workspace_sections.settings_marketplaces_section.s601', "مثال: EGP1 أو EGP2")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s602', "رقم الشحنة الخارجي / التتبع")}
                </label>
                <input
                  type="text"
                  value={inboundForm.trackingNumber}
                  onChange={(e) => setInboundForm({ ...inboundForm, trackingNumber: e.target.value })}
                  placeholder={t('settings.workspace_sections.settings_marketplaces_section.s603', "مثال: FBA17XXXXXX أو PO-89231")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>

            {/* Add Items Box */}
            <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s604', "إضافة الأصناف المشحونة إلى الكراتين:")}</div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 240px' }}>
                  <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '3px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s605', "اختيار الصنف")}</label>
                  <select
                    value={inboundForm.selectedProductId}
                    onChange={(e) => setInboundForm({ ...inboundForm, selectedProductId: Number(e.target.value) })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff' }}
                  >
                    <option value={0}>{t('settings.workspace_sections.settings_marketplaces_section.s606', "-- اختر صنفاً للشحن --")}</option>
                    {availableProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.barcode || (p as any).style_code || (p as any).styleCode || `#${p.id}`})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '3px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s607', "رقم الكرتونة")}</label>
                  <input
                    type="number"
                    min="1"
                    value={inboundForm.boxNumber}
                    onChange={(e) => setInboundForm({ ...inboundForm, boxNumber: e.target.value })}
                    style={{ width: '80px', padding: '7px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
                  />
                </div>

                {/* Strict RTL Stepper: Plus on RIGHT, Minus on LEFT! */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '3px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s608', "الكمية المشحونة")}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const cur = Math.max(1, Number(inboundForm.quantity) || 1);
                        setInboundForm({ ...inboundForm, quantity: String(cur + 1) });
                      }}
                      style={{ width: '30px', height: '32px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 800, cursor: 'pointer', fontSize: '14px', color: '#0f172a' }}
                      title={t('settings.workspace_sections.settings_marketplaces_section.s609', "زيادة الكمية")}
                    >
                      +
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={inboundForm.quantity}
                      onChange={(e) => setInboundForm({ ...inboundForm, quantity: e.target.value })}
                      style={{ width: '60px', height: '32px', textAlign: 'center', padding: '4px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px', fontWeight: 800 }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const cur = Math.max(1, Number(inboundForm.quantity) || 1);
                        setInboundForm({ ...inboundForm, quantity: String(Math.max(1, cur - 1)) });
                      }}
                      style={{ width: '30px', height: '32px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 800, cursor: 'pointer', fontSize: '14px', color: '#0f172a' }}
                      title={t('settings.workspace_sections.settings_marketplaces_section.s610', "إنقاص الكمية")}
                    >
                      −
                    </button>
                  </div>
                </div>

                <Button
                  variant="primary"
                  onClick={() => {
                    if (!inboundForm.selectedProductId) {
                      toast.error(t('settings.workspace_sections.settings_marketplaces_section.s611', "يرجى اختيار صنف أولاً"));
                      return;
                    }
                    const prod = availableProducts.find((p) => Number(p.id) === Number(inboundForm.selectedProductId));
                    if (!prod) return;
                    const qty = Number(inboundForm.quantity) || 1;
                    const box = Number(inboundForm.boxNumber) || 1;

                    const mapping = mappings.find((m) => Number(m.productId) === Number(prod.id) && m.marketplace === inboundForm.marketplace);
                    const sku = mapping ? mapping.marketplaceSku : prod.barcode || (prod as any).style_code || `SKU-${prod.id}`;

                    const newItem: FbaInboundItem = {
                      productId: Number(prod.id),
                      marketplaceSku: sku,
                      productName: prod.name,
                      barcode: prod.barcode || undefined,
                      quantityShipped: qty,
                      boxNumber: box,
                    };

                    setInboundForm({
                      ...inboundForm,
                      items: [...inboundForm.items, newItem],
                      selectedProductId: 0,
                      quantity: '10',
                    });
                    toast.success(`تمت إضافة ${qty} قطعة من ${prod.name}`);
                  }}
                  style={{ background: '#170e5e', color: '#ffffff', height: '32px', fontSize: '12px' }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s612', "+ إضافة للشحنة")}
                </Button>
              </div>

              {/* Items List Table */}
              {inboundForm.items.length > 0 ? (
                <div style={{ marginTop: '8px', border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden', background: '#ffffff' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '6px 10px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s613', "الصنف")}</th>
                        <th style={{ padding: '6px 10px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s614', "كود المنصة (SKU / FNSKU)")}</th>
                        <th style={{ padding: '6px 10px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s615', "رقم الكرتونة")}</th>
                        <th style={{ padding: '6px 10px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s616', "الكمية")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s617', "إجراء")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inboundForm.items.map((it, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 10px', fontWeight: 600 }}>{it.productName}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#170e5e' }}>{it.marketplaceSku}</td>
                          <td style={{ padding: '6px 10px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s618', "كرتونة #")}{it.boxNumber || 1}</td>
                          <td style={{ padding: '6px 10px', fontWeight: 800, color: '#15803d' }}>{it.quantityShipped} {t('settings.workspace_sections.settings_marketplaces_section.s619', "قطعة")}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => {
                                const newItems = [...inboundForm.items];
                                newItems.splice(idx, 1);
                                setInboundForm({ ...inboundForm, items: newItems });
                              }}
                              style={{ border: 'none', background: 'transparent', color: '#b91c1c', cursor: 'pointer', fontSize: '12px' }}
                            >
                              {t('settings.workspace_sections.settings_marketplaces_section.s620', "حذف")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700 }}>
                    <span>{t('settings.workspace_sections.settings_marketplaces_section.s621', "إجمالي الأصناف:")} {inboundForm.items.length}</span>
                    <span style={{ color: '#15803d' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s622', "إجمالي القطع المشحونة:")} {inboundForm.items.reduce((s, it) => s + it.quantityShipped, 0)} {t('settings.workspace_sections.settings_marketplaces_section.s623', "قطعة")}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '12px', color: '#94a3b8', fontSize: '12px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s624', "لم يتم إضافة أصناف للشحنة بعد. اختر صنفاً وحدد الكمية ثم اضغط \"+ إضافة للشحنة\".")}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s625', "ملاحظات إذن التوريد")}
              </label>
              <textarea
                rows={2}
                value={inboundForm.notes}
                onChange={(e) => setInboundForm({ ...inboundForm, notes: e.target.value })}
                placeholder={t('settings.workspace_sections.settings_marketplaces_section.s626', "ملاحظات لفرق التجهيز أو مستلمي المستودع...")}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', resize: 'vertical' }}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button variant="secondary" onClick={() => setShowInboundModal(false)}>
              {t('settings.workspace_sections.settings_marketplaces_section.s627', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!inboundForm.fulfillmentCenterId.trim()) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s628', "يرجى إدخال كود مركز التوزيع المستلم"));
                  return;
                }
                if (inboundForm.items.length === 0) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s629', "يرجى إضافة صنف واحد على الأقل للشحنة"));
                  return;
                }

                const totalUnits = inboundForm.items.reduce((s, it) => s + it.quantityShipped, 0);
                const boxSet = new Set(inboundForm.items.map((it) => it.boxNumber || 1));

                createInboundMutation.mutate({
                  marketplace: inboundForm.marketplace,
                  fulfillmentCenterId: inboundForm.fulfillmentCenterId,
                  items: inboundForm.items,
                  totalUnits,
                  totalBoxes: boxSet.size || 1,
                  trackingNumber: inboundForm.trackingNumber.trim() || undefined,
                  notes: inboundForm.notes.trim() || undefined,
                  status: 'draft',
                });
              }}
              disabled={createInboundMutation.isPending}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {createInboundMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s630', "جاري إنشاء إذن التوريد...") : t('settings.workspace_sections.settings_marketplaces_section.s631', "تأكيد إنشاء إذن التوريد وحجز الكميات")}
            </Button>
          </div>
        </div>
      </DialogShell>
    </>
  );
};

export interface FnskuBarcodeModalProps {
  inboundModals: ReturnType<typeof useMarketplaceInboundModals>;
}

export const FnskuBarcodeModal: React.FC<FnskuBarcodeModalProps> = ({ inboundModals }) => {
  const { t } = useTranslation();
  const {
    printFnskuModal,
    setPrintFnskuModal,
    handlePrintFnskuLabels,
  } = inboundModals;
  return (
    <>
      {/* ========================================================================= */}
      {/* MODAL 7: FNSKU BARCODE THERMAL PRINTING MODAL */}
      {/* ========================================================================= */}
      <DialogShell
        open={!!printFnskuModal}
        onClose={() => setPrintFnskuModal(null)}
        width="min(540px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s632', "طباعة ملصقات الباركود FNSKU")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s633', "طباعة ملصقات الباركود FNSKU / FBN للوحدات")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s634', "طباعة باركودات التتبع للوحدات الفردية قبل شحنها لمستودعات أمازون ونون")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPrintFnskuModal(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {printFnskuModal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Product Info Card */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', fontSize: '12.5px' }}>
                <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>{printFnskuModal.productName}</div>
                <div style={{ display: 'flex', gap: '16px', color: '#64748b', fontSize: '12px' }}>
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s635', "كود المنصة:")} <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{printFnskuModal.marketplaceSku}</strong></span>
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s636', "المنصة:")} <strong style={{ color: '#0f172a', textTransform: 'uppercase' }}>{printFnskuModal.marketplace}</strong></span>
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s637', "الحالة:")} <strong style={{ color: '#16a34a' }}>{printFnskuModal.condition}</strong></span>
                </div>
              </div>

              {/* Print Configuration Form */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s638', "مقاس ونوع الملصق")}
                  </label>
                  <select
                    value={printFnskuModal.format}
                    onChange={(e) => setPrintFnskuModal({ ...printFnskuModal, format: e.target.value as any })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff' }}
                  >
                    <option value="thermal_50x30">{t('settings.workspace_sections.settings_marketplaces_section.s639', "رول حراري 50 × 30 مم (أمازون / Xprinter)")}</option>
                    <option value="thermal_40x25">{t('settings.workspace_sections.settings_marketplaces_section.s640', "رول حراري 40 × 25 مم (نون / Zebra)")}</option>
                    <option value="a4_44up">{t('settings.workspace_sections.settings_marketplaces_section.s641', "ورقة A4 ملصقات جاهزة (44 ملصق بالورقة)")}</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s642', "عدد النسخ (الملصقات)")}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => setPrintFnskuModal({ ...printFnskuModal, copies: printFnskuModal.copies + 1 })}
                      style={{ width: '32px', height: '32px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontSize: '16px', fontWeight: 700 }}
                      title={t('settings.workspace_sections.settings_marketplaces_section.s643', "زيادة")}
                    >
                      +
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={printFnskuModal.copies}
                      onChange={(e) => setPrintFnskuModal({ ...printFnskuModal, copies: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      style={{ width: '60px', height: '32px', textAlign: 'center', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '13px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setPrintFnskuModal({ ...printFnskuModal, copies: Math.max(1, printFnskuModal.copies - 1) })}
                      style={{ width: '32px', height: '32px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontSize: '16px', fontWeight: 700 }}
                      title={t('settings.workspace_sections.settings_marketplaces_section.s644', "إنقاص")}
                    >
                      -
                    </button>
                  </div>
                </div>
              </div>

              {/* Label Visual Live Preview */}
              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s645', "معاينة الملصق على الطبيعة (Live Label Preview)")}
                </label>
                <div style={{ display: 'flex', justifyContent: 'center', padding: '16px', background: '#f1f5f9', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #000000',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      width: '210px',
                      textAlign: 'center',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '1px' }}>
                      {printFnskuModal.marketplaceSku}
                    </div>
                    {/* SVG Barcode Graphic */}
                    <div style={{ margin: '4px 0' }}>
                      <svg viewBox="0 0 160 38" style={{ width: '100%', height: '30px' }}>
                        <rect x="0" y="0" width="3" height="38" fill="#000" />
                        <rect x="5" y="0" width="2" height="38" fill="#000" />
                        <rect x="9" y="0" width="4" height="38" fill="#000" />
                        <rect x="15" y="0" width="2" height="38" fill="#000" />
                        <rect x="19" y="0" width="5" height="38" fill="#000" />
                        <rect x="26" y="0" width="2" height="38" fill="#000" />
                        <rect x="30" y="0" width="4" height="38" fill="#000" />
                        <rect x="36" y="0" width="2" height="38" fill="#000" />
                        <rect x="40" y="0" width="5" height="38" fill="#000" />
                        <rect x="47" y="0" width="3" height="38" fill="#000" />
                        <rect x="52" y="0" width="2" height="38" fill="#000" />
                        <rect x="56" y="0" width="4" height="38" fill="#000" />
                        <rect x="62" y="0" width="2" height="38" fill="#000" />
                        <rect x="66" y="0" width="5" height="38" fill="#000" />
                        <rect x="73" y="0" width="3" height="38" fill="#000" />
                        <rect x="78" y="0" width="2" height="38" fill="#000" />
                        <rect x="82" y="0" width="4" height="38" fill="#000" />
                        <rect x="88" y="0" width="2" height="38" fill="#000" />
                        <rect x="92" y="0" width="6" height="38" fill="#000" />
                        <rect x="100" y="0" width="2" height="38" fill="#000" />
                        <rect x="104" y="0" width="4" height="38" fill="#000" />
                        <rect x="110" y="0" width="2" height="38" fill="#000" />
                        <rect x="114" y="0" width="5" height="38" fill="#000" />
                        <rect x="121" y="0" width="3" height="38" fill="#000" />
                        <rect x="126" y="0" width="2" height="38" fill="#000" />
                        <rect x="130" y="0" width="4" height="38" fill="#000" />
                        <rect x="136" y="0" width="2" height="38" fill="#000" />
                        <rect x="140" y="0" width="5" height="38" fill="#000" />
                        <rect x="147" y="0" width="3" height="38" fill="#000" />
                        <rect x="152" y="0" width="4" height="38" fill="#000" />
                      </svg>
                    </div>
                    <div style={{ fontSize: '9.5px', color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {printFnskuModal.productName}
                    </div>
                    <div style={{ fontSize: '8.5px', fontWeight: 700, color: '#16a34a', marginTop: '2px' }}>
                      {printFnskuModal.condition}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <Button variant="secondary" onClick={() => setPrintFnskuModal(null)}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s646', "إلغاء")}
                </Button>
                <Button
                  variant="primary"
                  onClick={handlePrintFnskuLabels}
                  style={{ background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <PrinterIcon size={16} />
                  {t('settings.workspace_sections.settings_marketplaces_section.s647', "طباعة")} {printFnskuModal.copies} {t('settings.workspace_sections.settings_marketplaces_section.s648', "ملصق الآن")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogShell>
    </>
  );
};
