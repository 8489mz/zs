import { Button } from '@/shared/ui/button';
import { DownloadIcon, PackageIcon, PlusCircleIcon } from '@/shared/components/icons/AppIcons';
import { FormSection } from '@/shared/components/form-section';
import { ItemRowInputs } from './shipment-item-row-inputs';
import type { useTranslation } from 'react-i18next';
import type { ShipmentDetails } from '../api/shipments.api';

export interface ShipmentDetailsReceiptItemsProps {
  data: ShipmentDetails;
  handleReverseReceipt: (e: React.FormEvent) => Promise<void>;
  reversalApprovalId: string;
  setReversalApprovalId: React.Dispatch<React.SetStateAction<string>>;
  reversalReason: string;
  setReversalReason: React.Dispatch<React.SetStateAction<string>>;
  reverseReceiptMutation: { isPending: boolean };
  handleResolveLegacy: (e: React.FormEvent) => Promise<void>;
  resolveApprovalId: string;
  setResolveApprovalId: React.Dispatch<React.SetStateAction<string>>;
  resolveReason: string;
  setResolveReason: React.Dispatch<React.SetStateAction<string>>;
  resolveLegacyMutation: { isPending: boolean };
  t: ReturnType<typeof useTranslation>['t'];
  handleImportProjectItems: () => Promise<void>;
  importProjectItemsMutation: { isPending: boolean };
  handleApplyPrices: () => Promise<void>;
  applyPricesMutation: { isPending: boolean };
  setIsAddItemOpen: React.Dispatch<React.SetStateAction<boolean>>;
  globalWholesaleMargin: string;
  setGlobalWholesaleMargin: React.Dispatch<React.SetStateAction<string>>;
  globalRetailMargin: string;
  setGlobalRetailMargin: React.Dispatch<React.SetStateAction<string>>;
  handleApplyGlobalMargins: () => Promise<void>;
  id: string;
}

export function ShipmentDetailsReceiptItems(props: ShipmentDetailsReceiptItemsProps) {
  const { data, handleReverseReceipt, reversalApprovalId, setReversalApprovalId, reversalReason, setReversalReason, reverseReceiptMutation, handleResolveLegacy, resolveApprovalId, setResolveApprovalId, resolveReason, setResolveReason, resolveLegacyMutation, t, handleImportProjectItems, importProjectItemsMutation, handleApplyPrices, applyPricesMutation, setIsAddItemOpen, globalWholesaleMargin, setGlobalWholesaleMargin, globalRetailMargin, setGlobalRetailMargin, handleApplyGlobalMargins, id } = props;
  return (
    <>
    {data.inventory_receipt && (
    <FormSection
      title="تصحيح سند الاستلام المعتمد"
      description="عكس سند مرحل أو اعتماد سند قديم مجمد — كلاهما يتطلب موافقة Maker-Checker مربوطة بهذه الشحنة وسندها، ولا يتم أي تعديل صامت."
    >
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '0.84rem', color: '#334155' }}>
          سند الاستلام #{data.inventory_receipt.id} — الحالة: <strong>{data.inventory_receipt.state === 'posted' ? 'مرحل' : 'مجمد بانتظار المراجعة'}</strong>
          {data.inventory_receipt.review_reason && <> — سبب التجميد: {data.inventory_receipt.review_reason}</>}
          {' — '}أنشئ طلب الاعتماد من مركز الموافقات بنوع عكس/مراجعة الاستلام ومرجع الشحنة الحالي، ثم نفذه هنا بمعرف الاعتماد.
        </div>
        {data.inventory_receipt.state === 'posted' ? (
          <form onSubmit={handleReverseReceipt} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label>معرف طلب الاعتماد المعتمد</label>
              <input type="text" className="input" value={reversalApprovalId} onChange={e => setReversalApprovalId(e.target.value)} placeholder="معرف الاعتماد المربوط بهذا السند" />
            </div>
            <div className="form-group">
              <label>سبب العكس (10 أحرف على الأقل)</label>
              <input type="text" className="input" value={reversalReason} onChange={e => setReversalReason(e.target.value)} placeholder="مثال: تم الاستلام في المخزن الخطأ" />
            </div>
            <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" variant="secondary" disabled={reverseReceiptMutation.isPending} style={{ borderColor: '#b91c1c', color: '#b91c1c', fontWeight: 700 }}>
                {reverseReceiptMutation.isPending ? 'جاري عكس الاستلام...' : 'عكس سند الاستلام المرحل'}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleResolveLegacy} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label>معرف طلب الاعتماد المعتمد</label>
              <input type="text" className="input" value={resolveApprovalId} onChange={e => setResolveApprovalId(e.target.value)} placeholder="معرف الاعتماد المربوط بهذا السند" />
            </div>
            <div className="form-group">
              <label>سبب المراجعة (10 أحرف على الأقل)</label>
              <input type="text" className="input" value={resolveReason} onChange={e => setResolveReason(e.target.value)} placeholder="مثال: تم التحقق من القيد والحركة المخزنية" />
            </div>
            <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" variant="secondary" disabled={resolveLegacyMutation.isPending} style={{ borderColor: '#92400e', color: '#92400e', fontWeight: 700 }}>
                {resolveLegacyMutation.isPending ? 'جاري مراجعة الاستلام...' : 'اعتماد الاستلام القديم بعد التحقق'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </FormSection>
    )}

    <FormSection
      title={t('import_sales.shipment_details_page.s29', "أصناف الحاوية وتحديد أسعار البيع")}
      description={t('import_sales.shipment_details_page.s30', "جميع المنتجات التي تم استلامها داخل هذه الحاوية. يمكنك تعديل الكمية المستلمة فعلياً وهامش الربح.")}
      actions={
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {data.project_id && data.items.length === 0 && (
            <Button
              variant="primary"
              onClick={handleImportProjectItems}
              disabled={importProjectItemsMutation.isPending || data.status === 'Arrived'}
              style={{
                backgroundColor: '#15803d',
                borderColor: '#166534',
                color: '#ffffff',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <DownloadIcon size={15} />
              <span>{importProjectItemsMutation.isPending ? 'جاري سحب الأصناف...' : 'سحب أصناف المشروع تلقائياً'}</span>
            </Button>
          )}
          <Button variant="secondary" onClick={handleApplyPrices} disabled={applyPricesMutation.isPending || data.items.length === 0}>
            {t('import_sales.shipment_details_page.s31', "تطبيق واعتماد الأسعار للمخزن")}
          </Button>
          <Button variant="secondary" onClick={() => setIsAddItemOpen(true)} disabled={data.status === 'Arrived'}>{t('import_sales.shipment_details_page.s32', "إضافة صنف +")}</Button>
        </div>
      }
    >
      <div style={{ padding: '0.75rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('import_sales.shipment_details_page.s33', "هامش الجملة الموحد %")}</label>
          <input type="number" className="input no-spin-arrows" style={{ width: '100px', height: '32px', fontSize: '12px', MozAppearance: 'textfield' }} value={globalWholesaleMargin} onChange={e => setGlobalWholesaleMargin(e.target.value)} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('import_sales.shipment_details_page.s34', "هامش القطاعي الموحد %")}</label>
          <input type="number" className="input no-spin-arrows" style={{ width: '100px', height: '32px', fontSize: '12px', MozAppearance: 'textfield' }} value={globalRetailMargin} onChange={e => setGlobalRetailMargin(e.target.value)} />
        </div>
        <Button variant="secondary" onClick={handleApplyGlobalMargins} style={{ height: '32px', fontSize: '12px' }}>{t('import_sales.shipment_details_page.s35', "تطبيق على كل الأصناف")}</Button>
      </div>

      <div style={{ width: '100%', overflowX: 'hidden' }}>
        <table
          className="table"
          style={{
            width: '100%',
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
            fontSize: '12px'
          }}
        >
          <colgroup>
            <col style={{ width: '24%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
              <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>الصنف</th>
              <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>كمية الشحن</th>
              <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>سعر المصنع</th>
              <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>تكلفة الواصل</th>
              <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>المستلم</th>
              <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>هامش جملة</th>
              <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>هامش قطاعي</th>
              <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#1e3a8a' }}>سعر الجملة</th>
              <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#15803d' }}>سعر القطاعي</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map(item => (
              <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '8px 8px', textAlign: 'right', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, fontSize: '11.5px', color: '#0f172a', lineHeight: 1.35, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                    {item.product_name || item.product_id}
                  </div>
                </td>
                <td style={{ padding: '8px 4px', textAlign: 'center', verticalAlign: 'middle', fontWeight: 700, fontSize: '12px', color: '#334155' }}>
                  {item.quantity}
                </td>
                <td style={{ padding: '8px 4px', textAlign: 'center', verticalAlign: 'middle', fontWeight: 600, fontSize: '11.5px', color: '#475569' }}>
                  ${Number(item.factory_unit_price_usd).toFixed(2)}
                </td>
                <td style={{ padding: '8px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 800, fontSize: '11.5px', color: '#047857' }}>
                    {Number(item.landed_cost_egp).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 500 }}>ج.م</div>
                </td>
                <ItemRowInputs
                  item={item}
                  shipmentId={id!}
                  arrivalRate={Number(data.exchange_rate_at_arrival) || 1}
                  pricingRate={Number(data.pricing_exchange_rate) || Number(data.exchange_rate_at_arrival) || 1}
                  isArrived={data.status === 'Arrived'}
                />
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
                  <div style={{ maxWidth: '520px', margin: '0 auto', textAlign: 'center' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto', color: '#64748b' }}>
                      <PackageIcon size={24} />
                    </div>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '0.94rem', fontWeight: 800, color: '#1e293b' }}>
                      لا توجد أصناف مسجلة في هذه الحاوية بعد
                    </h4>
                    <p style={{ margin: '0 0 16px 0', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                      {data.project_id
                        ? 'هذه الحاوية مربوطة بمشروع استيراد معتمد. يمكنك سحب كافة الأصناف بأسعار المصنع وكمياتها بضغطة زر واحدة، أو تسجيل أصناف فردية يدوياً.'
                        : 'قم بإضافة الأصناف المشحونة داخل الحاوية لاحتساب تكلفتها الاستيرادية وتحديد أسعار البيع.'}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      {data.project_id && (
                        <Button
                          variant="primary"
                          onClick={handleImportProjectItems}
                          disabled={importProjectItemsMutation.isPending || data.status === 'Arrived'}
                          style={{ backgroundColor: '#15803d', borderColor: '#166534', color: '#ffffff', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          <DownloadIcon size={15} />
                          <span>{importProjectItemsMutation.isPending ? 'جاري سحب الأصناف...' : 'سحب أصناف المشروع تلقائياً'}</span>
                        </Button>
                      )}
                      <Button variant="secondary" onClick={() => setIsAddItemOpen(true)} disabled={data.status === 'Arrived'} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <PlusCircleIcon size={15} />
                        <span>إضافة صنف يدوياً +</span>
                      </Button>
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </FormSection>
    </>
  );
}
