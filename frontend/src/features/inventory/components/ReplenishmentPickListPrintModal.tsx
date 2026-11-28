import { useTranslation } from 'react-i18next';
import React, { useRef } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';

export interface PickListItem {
  productId: number;
  productName: string;
  barcode: string;
  qty: number;
  cartonMultiplier?: number;
  cartonName?: string;
  cartonsCount?: number;
  warehouseStock?: number;
}

interface ReplenishmentPickListPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  docNo: string;
  fromLocationName: string;
  toLocationName: string;
  items: PickListItem[];
  createdByName?: string;
  carrierName?: string;
}

export const ReplenishmentPickListPrintModal: React.FC<ReplenishmentPickListPrintModalProps> = ({
  isOpen,
  onClose,
  docNo,
  fromLocationName,
  toLocationName,
  items,
  createdByName = 'كاشير المحل',
  carrierName,
}) => {
  const { t } = useTranslation();
  const printAreaRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handlePrint = () => {
    const printContent = printAreaRef.current;
    if (!printContent) return;

    const printWindow = window.open('', '_blank', 'width=800,height=900');
    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>أمر صرف وتجهيز بضاعة - ${docNo}</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              direction: rtl;
              margin: 20px;
              color: #1e293b;
              font-size: 13px;
              line-height: 1.5;
            }
            .header-box {
              border-bottom: 2px solid #0f172a;
              padding-bottom: 12px;
              margin-bottom: 16px;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .title {
              font-size: 20px;
              font-weight: 800;
              color: #170e5e;
              margin: 0;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 8px;
              background-color: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              padding: 12px;
              margin-bottom: 16px;
              font-size: 12px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 20px;
            }
            th, td {
              border: 1px solid #cbd5e1;
              padding: 8px 10px;
              text-align: right;
            }
            th {
              background-color: #f1f5f9;
              font-weight: bold;
            }
            .checkbox-cell {
              width: 30px;
              text-align: center;
            }
            .box {
              width: 16px;
              height: 16px;
              border: 1px solid #64748b;
              display: inline-block;
            }
            .summary-bar {
              display: flex;
              justify-content: space-between;
              background-color: #f8fafc;
              border: 1px dashed #cbd5e1;
              padding: 10px 14px;
              border-radius: 6px;
              font-weight: bold;
              margin-bottom: 30px;
            }
            .signatures {
              display: grid;
              grid-template-columns: 1fr 1fr 1fr;
              gap: 24px;
              margin-top: 36px;
              text-align: center;
            }
            .sig-line {
              border-bottom: 1px dashed #94a3b8;
              height: 40px;
              margin-top: 10px;
            }
            @media print {
              body { margin: 0; }
              @page { margin: 1cm; size: A4 portrait; }
            }
          </style>
        </head>
        <body>
          <div class="header-box">
            <div>
              <h1 class="title">أمر صرف وتجهيز بضاعة للمحل</h1>
              <div style="font-size: 12px; color: #64748b; margin-top: 4px;">كشف نقل معتمد - منظومة Z-Systems</div>
            </div>
            <div style="font-family: monospace; font-size: 14px; font-weight: bold; background: #f1f5f9; padding: 4px 10px; border-radius: 6px; border: 1px solid #cbd5e1;">
              ${docNo}
            </div>
          </div>

          <div class="meta-grid">
            <div><strong>المستودع المصدر:</strong> ${fromLocationName}</div>
            <div><strong>صالة عرض المحل (الوجهة):</strong> ${toLocationName}</div>
            <div><strong>تاريخ وأمر الإذن:</strong> ${new Date().toLocaleDateString('ar-EG')} - ${new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</div>
            <div><strong>المشرف المسؤول:</strong> ${createdByName}</div>
            ${carrierName ? `<div style="grid-column: 1 / -1;"><strong>الناقل / حامل العهدة:</strong> ${carrierName}</div>` : ''}
          </div>

          <table>
            <thead>
              <tr>
                <th class="checkbox-cell">تم</th>
                <th style="width: 35px; text-align: center;">#</th>
                <th>اسم الصنف والباركود</th>
                <th style="text-align: center; width: 110px;">الكمية المطلوبة</th>
                <th style="text-align: center; width: 140px;">التعبئة والكراتين</th>
              </tr>
            </thead>
            <tbody>
              ${items
                .map(
                  (item, idx) => `
                <tr>
                  <td class="checkbox-cell"><span class="box"></span></td>
                  <td style="text-align: center; font-family: monospace;">${idx + 1}</td>
                  <td>
                    <div style="font-weight: bold;">${item.productName}</div>
                    ${item.barcode ? `<div style="font-size: 11px; color: #64748b; font-family: monospace;">${item.barcode}</div>` : ''}
                  </td>
                  <td style="text-align: center; font-weight: bold; font-size: 14px;">
                    ${item.qty} <span style="font-size: 11px; font-weight: normal;">قطعة</span>
                  </td>
                  <td style="text-align: center;">
                    ${
                      item.cartonsCount && item.cartonName
                        ? `<strong>${item.cartonsCount}</strong> ${item.cartonName}`
                        : '-'
                    }
                  </td>
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>

          <div class="summary-bar">
            <span>إجمالي الأصناف: ${items.length} صنف</span>
            <span style="color: #170e5e;">إجمالي عدد القطع: ${items.reduce((s, it) => s + it.qty, 0)} قطعة</span>
          </div>

          <div class="signatures">
            <div>
              <div>توقيع أمين المستودع (المُسلِّم)</div>
              <div class="sig-line"></div>
            </div>
            <div>
              <div>توقيع الناقل / حامل العهدة${carrierName ? ` (${carrierName})` : ''}</div>
              <div class="sig-line"></div>
            </div>
            <div>
              <div>توقيع المستلم بالفرع (المطابقة)</div>
              <div class="sig-line"></div>
            </div>
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };

  const totalPieces = items.reduce((sum, it) => sum + it.qty, 0);
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-EG', { year: 'numeric', month: 'numeric', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  return (
    <StandardDialog
      open={isOpen}
      onClose={onClose}
      title={t('inventory.replenishment_pick_list_print_modal.s0', "أمر تحميل وصرف بضاعة للمستودع")}
      subtitle={`إذن معتمد رسمي رقم #${docNo}`}
      size="lg"
      footerActions={
        <StandardDialogFooter
          onCancel={onClose}
          cancelLabel={t('inventory.replenishment_pick_list_print_modal.s1', "إغلاق")}
          primaryLabel={t('inventory.replenishment_pick_list_print_modal.s2', "طباعة فورية للعامل")}
          onPrimary={handlePrint}
        />
      }
    >
      <div style={{ backgroundColor: '#f1f5f9', padding: '16px', borderRadius: '8px' }}>
        <div
          ref={printAreaRef}
          style={{
              backgroundColor: '#ffffff',
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              color: '#0f172a',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0f172a', paddingBottom: '12px', marginBottom: '16px' }}>
              <div>
                <h1 style={{ fontSize: '18px', fontWeight: 900, color: '#170e5e', margin: 0 }}>
                  {t('inventory.replenishment_pick_list_print_modal.s3', "أمر صرف وتجهيز بضاعة للمحل")}
                </h1>
                <p style={{ fontSize: '11px', color: '#64748b', margin: '3px 0 0' }}>{t('inventory.replenishment_pick_list_print_modal.s4', "كشف نقل معتمد - منظومة Z-Systems")}</p>
              </div>
              <div style={{ fontFamily: 'monospace' }}>
                <span style={{ backgroundColor: '#f1f5f9', color: '#0f172a', padding: '4px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 800, border: '1px solid #cbd5e1' }}>
                  {docNo}
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '12px' }}>
              <div>
                <span style={{ color: '#64748b' }}>{t('inventory.replenishment_pick_list_print_modal.s5', "من المستودع المصدر:")} </span>
                <strong style={{ color: '#0f172a' }}>{fromLocationName}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>{t('inventory.replenishment_pick_list_print_modal.s6', "إلى صالة المحل:")} </span>
                <strong style={{ color: '#0f172a' }}>{toLocationName}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>{t('inventory.replenishment_pick_list_print_modal.s7', "التاريخ والوقت:")} </span>
                <span style={{ fontWeight: 600, color: '#334155' }}>{dateStr} - {timeStr}</span>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>{t('inventory.replenishment_pick_list_print_modal.s8', "المشرف المعتمد:")} </span>
                <span style={{ fontWeight: 600, color: '#334155' }}>{createdByName}</span>
              </div>
              {carrierName && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: '#64748b' }}>الناقل / حامل العهدة: </span>
                  <strong style={{ color: '#170e5e' }}>{carrierName}</strong>
                </div>
              )}
            </div>

            <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #cbd5e1', textAlign: 'right', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', color: '#334155' }}>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', width: '40px', textAlign: 'center' }}>{t('inventory.replenishment_pick_list_print_modal.s9', "تم")}</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', width: '36px', textAlign: 'center' }}>#</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px' }}>{t('inventory.replenishment_pick_list_print_modal.s10', "اسم الصنف والباركود")}</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center', width: '120px' }}>{t('inventory.replenishment_pick_list_print_modal.s11', "الكمية المطلوبة بدقة")}</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center', width: '130px' }}>{t('inventory.replenishment_pick_list_print_modal.s12', "التعبئة المقترحة")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.productId} style={{ borderBottom: '1px solid #cbd5e1' }}>
                      <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-block', width: '16px', height: '16px', border: '1.5px solid #64748b', borderRadius: '3px' }} />
                      </td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center', fontFamily: 'monospace', color: '#64748b' }}>
                        {idx + 1}
                      </td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '8px' }}>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{item.productName}</div>
                        {item.barcode && (
                          <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace', marginTop: '2px' }}>{item.barcode}</div>
                        )}
                      </td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>
                        <strong style={{ fontSize: '14px', color: '#0f172a' }}>{item.qty}</strong>{' '}
                        <span style={{ fontSize: '11px', color: '#64748b' }}>{t('inventory.replenishment_pick_list_print_modal.s13', "قطعة")}</span>
                      </td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>
                        {item.cartonsCount && item.cartonName ? (
                          <span style={{ backgroundColor: '#eff6ff', color: '#1e40af', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', border: '1px solid #dbeafe' }}>
                            {item.cartonsCount} {item.cartonName}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '11px' }}>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '10px 14px', fontWeight: 800, fontSize: '12px', marginBottom: '24px' }}>
              <span>{t('inventory.replenishment_pick_list_print_modal.s14', "إجمالي الأصناف:")} {items.length} {t('inventory.replenishment_pick_list_print_modal.s15', "صنف")}</span>
              <span style={{ color: '#170e5e', fontSize: '13px' }}>{t('inventory.replenishment_pick_list_print_modal.s16', "إجمالي القطع المنصرفة:")} {totalPieces} {t('inventory.replenishment_pick_list_print_modal.s17', "قطعة")}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', borderTop: '1px solid #e2e8f0', paddingTop: '16px', fontSize: '12px' }}>
              <div style={{ textAlign: 'center' }}>
                <span style={{ color: '#475569', fontWeight: 700 }}>{t('inventory.replenishment_pick_list_print_modal.s18', "توقيع أمين المستودع (المُسلِّم)")}</span>
                <div style={{ marginTop: '30px', borderBottom: '1px dashed #94a3b8', marginInline: '12px' }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ color: '#475569', fontWeight: 700 }}>توقيع الناقل / حامل العهدة{carrierName ? ` (${carrierName})` : ''}</span>
                <div style={{ marginTop: '30px', borderBottom: '1px dashed #94a3b8', marginInline: '12px' }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ color: '#475569', fontWeight: 700 }}>{t('inventory.replenishment_pick_list_print_modal.s19', "توقيع المستلم بالفرع (المطابقة)")}</span>
                <div style={{ marginTop: '30px', borderBottom: '1px dashed #94a3b8', marginInline: '12px' }} />
              </div>
            </div>
          </div>
        </div>
      </StandardDialog>
  );
};

