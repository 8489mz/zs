import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import type { useTranslation } from 'react-i18next';
import type { useNavigate } from 'react-router-dom';
import type { ShipmentDetails } from '../api/shipments.api';

export interface ShipmentDetailsHeaderProps {
  data: ShipmentDetails;
  t: ReturnType<typeof useTranslation>['t'];
  setGrnLocationId: React.Dispatch<React.SetStateAction<string>>;
  receiptLocationId: string;
  setIsGrnOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLateExpenseOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsPreordersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAutopsyOpen: React.Dispatch<React.SetStateAction<boolean>>;
  navigate: ReturnType<typeof useNavigate>;
}

export function ShipmentDetailsHeader(props: ShipmentDetailsHeaderProps) {
  const { data, t, setGrnLocationId, receiptLocationId, setIsGrnOpen, setIsLateExpenseOpen, setIsPreordersOpen, setIsAutopsyOpen, navigate } = props;
  return (
    <>
    <PageHeader
      title={`حاوية رقم: ${data.container_number}`}
      description={
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <span>{t('import_sales.shipment_details_page.s5', "الحالة:")} <strong>{data.status}</strong></span>
          <span>{t('import_sales.shipment_details_page.s6', "المصنع:")} <strong>{data.supplier_name || t('import_sales.shipment_details_page.s7', "غير محدد")}</strong></span>
          <span>{t('import_sales.shipment_details_page.s8', "بوليصة الشحن (B/L):")} <strong>{data.bill_of_lading || t('import_sales.shipment_details_page.s9', "غير محدد")}</strong></span>
          {(data as any).project_title && (
            <span>مشروع الاستيراد: <strong>{(data as any).project_no} - {(data as any).project_title}</strong></span>
          )}
          {(data as any).freight_type && (
            <span>الشحن: <strong>{(data as any).freight_type} ({(data as any).container_size || '40HQ'})</strong></span>
          )}
          {(data as any).port_of_loading && (
            <span>المسار: <strong>{(data as any).port_of_loading} &larr; {(data as any).port_of_discharge || 'Alexandria'}</strong></span>
          )}
          {data.inventory_receipt && (
            <span style={{ backgroundColor: data.inventory_receipt.state === 'posted' ? '#dcfce7' : '#fef3c7', color: data.inventory_receipt.state === 'posted' ? '#15803d' : '#92400e', padding: '2px 8px', borderRadius: 4, fontWeight: 700, border: '1px solid #bbf7d0', fontSize: '0.78rem' }}>
              سند استلام مخزني: #{data.inventory_receipt.id} ({data.inventory_receipt.state === 'posted' ? 'مرحل' : 'مجمد بانتظار المراجعة'})
            </span>
          )}
          {data.inventory_receipt?.journal_entry_id && (
            <span style={{ backgroundColor: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 4, fontWeight: 700, border: '1px solid #c7d2fe', fontSize: '0.78rem' }}>
              قيد اليومية العامة: #JE-{data.inventory_receipt.journal_entry_id}
            </span>
          )}
        </div>
      }
      actions={
        <div className="actions compact-actions">
          {/* GRN approval is never offered once the receipt is posted:
              the posted badge above already shows the receipt state,
              and the backend refuses a posted-receipt approval
              fail-closed (INV-IMPORT-GRN-APPROVAL-POSTED-GATE). */}
          {data.inventory_receipt?.state !== 'posted' && (
            <Button variant="secondary" onClick={() => { setGrnLocationId(receiptLocationId || ''); setIsGrnOpen(true); }} style={{ borderColor: '#15803d', color: '#15803d', fontWeight: 600 }}>محضر فحص واستلام (GRN)</Button>
          )}
          {data.status === 'Arrived' && (
            <Button variant="secondary" onClick={() => setIsLateExpenseOpen(true)} style={{ borderColor: '#b45309', color: '#b45309', fontWeight: 600 }}>مصروف متأخر بعد الوصول</Button>
          )}
          <Button variant="secondary" onClick={() => setIsPreordersOpen(true)} style={{ borderColor: '#0284c7', color: '#0369a1', fontWeight: 600 }}>حجوزات البضاعة العايمة</Button>
          <Button variant="secondary" onClick={() => setIsAutopsyOpen(true)} style={{ borderColor: '#170e5e', color: '#170e5e', fontWeight: 700 }}>تشريح أرباح الحاوية (P&L)</Button>
          <Button variant="secondary" onClick={() => navigate('/import-sales/shipments')}>{t('import_sales.shipment_details_page.s10', "عودة للقائمة")}</Button>
        </div>
      }
    />

    {(data as any).demurrageRisk?.isOverdue && (
      <div style={{ backgroundColor: '#fee2e2', border: '1px solid #fca5a5', padding: '10px 16px', borderRadius: 10, color: '#b91c1c', fontWeight: 700, fontSize: '12.5px', marginBottom: 14 }}>
        تحذير تشغيلي: تجاوزت الحاوية فترة السماح للأرضيات بـ {(data as any).demurrageRisk.overdueDays} يوم! غرامات تأخير تقديرية: {(data as any).demurrageRisk.estimatedFeesEgp?.toLocaleString()} ج.م
        {(data as any).demurrageRisk.assumptions && ((data as any).demurrageRisk.assumptions.exchangeRateAssumed || (data as any).demurrageRisk.assumptions.dailyRateAssumed || (data as any).demurrageRisk.assumptions.freeDaysAssumed) && (
          <> (بافتراض: سعر صرف {(data as any).demurrageRisk.assumptions.exchangeRate}، رسم يومي {(data as any).demurrageRisk.assumptions.dailyRateUsd}$، سماح {(data as any).demurrageRisk.assumptions.freeDays} يوم — سجل القيم الفعلية على الشحنة لعرض تقدير دقيق)</>
        )}
      </div>
    )}
    {!(data as any).demurrageRisk?.isOverdue && (data as any).demurrageRisk?.daysRemaining !== null && (
      <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '10px 16px', borderRadius: 10, color: '#166534', fontWeight: 600, fontSize: '12.5px', marginBottom: 14 }}>
        فترة سماح الأرضيات: متبقي {(data as any).demurrageRisk.daysRemaining} يوم قبل بدء احتساب غرامات التأخير اليومية
      </div>
    )}
    </>
  );
}
