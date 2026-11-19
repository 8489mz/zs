import { useTranslation } from 'react-i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { MaritimeJob } from '../../api/maritime-freight.api';
import { printFreightInvoice, printJobProfitabilitySheet } from '../../utils/maritime-documents';

interface JobFinanceSummaryProps {
  job: MaritimeJob;
  ledgerEntries: any[];
  isSettlingFromBalance: boolean;
  handleSettleFromBalance: () => Promise<void>;
  submitOnce: (key: string, action: () => Promise<void>) => Promise<void>;
  handleOpenIssueInvoice: () => void;
  handleOpenRecordExpense: () => void;
}

export function JobFinanceSummary({ job, ledgerEntries, isSettlingFromBalance, handleSettleFromBalance, submitOnce, handleOpenIssueInvoice, handleOpenRecordExpense }: JobFinanceSummaryProps) {
  const { t } = useTranslation();
  const { currencySymbol } = useSystemCurrency();
  const revenue = Number(job.client_invoiced_total || 0);
  const carrierCost = Number(job.carrier_cost_total || 0);
  const otherCosts = Number(job.other_costs_total || 0);
  const totalCost = carrierCost + otherCosts;
  const netProfit = Number(job.net_profit || (revenue - totalCost));
  const marginPercent = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : '0.0';
  const containerDeposits = job.containers?.reduce((acc, c) => acc + (Number(c.deposit_amount) || 0), 0) || 0;

  return (
    <>
      {/* شريط الإجراءات المالية السريعة */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#170e5e' }}>
          {t('maritime_freight.job_details_modal.s144', "الإجراءات المالية وتصدير الفواتير والسندات")}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => printFreightInvoice(job)}
            style={{
              padding: '6px 14px',
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AppIcons.FileText size={14} />
            <span>{t('maritime_freight.job_details_modal.s145', "طباعة فاتورة الشحن")}</span>
          </button>
          <button
            type="button"
            onClick={() => printJobProfitabilitySheet(job, ledgerEntries)}
            style={{
              padding: '6px 14px',
              background: '#047857',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AppIcons.CheckShield size={14} />
            <span>{t('maritime_freight.job_details_modal.s146', "كشف الربحية (P&L)")}</span>
          </button>
          <button
            type="button"
            onClick={handleOpenIssueInvoice}
            style={{
              padding: '6px 14px',
              background: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {t('maritime_freight.job_details_modal.s147', "إصدار فاتورة مبيعات للعميل")}
          </button>
          <button
            type="button"
            onClick={handleOpenRecordExpense}
            style={{
              padding: '6px 14px',
              background: '#f1f5f9',
              color: '#1e293b',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {t('maritime_freight.job_details_modal.s148', "تسجيل سند مصروفات الخط/الميناء")}
          </button>
        </div>
      </div>

      {/* شريط تسوية رصيد العميل الدائن المتاح */}
      {Number(job.customerAvailableCredit || 0) > 0 && (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '10px',
            padding: '12px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#166534' }}>
              {t('maritime_freight.job_details_modal.s149', "رصيد العميل المتاح للخصم (دفعات مقدمة / على الحساب):")} {currencySymbol} {Number(job.customerAvailableCredit || 0).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.74rem', color: '#15803d', marginTop: '2px' }}>
              {t('maritime_freight.job_details_modal.s150', "العميل (")}{job.customer_name}{t('maritime_freight.job_details_modal.s151', ") قام بسداد مبالغ على حسابه العام، ويمكنك تسوية نولون هذه الشحنة مباشرة دون الحاجة لطلب تحويل إضافي.")}
            </div>
          </div>

          {job.payment_status === 'paid' ? (
            <span style={{ padding: '5px 12px', background: '#dcfce7', color: '#15803d', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700 }}>
              {t('maritime_freight.job_details_modal.s152', "الشحنة مسددة بالكامل")}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => submitOnce('settle', handleSettleFromBalance)}
              disabled={isSettlingFromBalance}
              style={{
                padding: '7px 16px',
                background: '#166534',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: isSettlingFromBalance ? 'not-allowed' : 'pointer',
              }}
            >
              {isSettlingFromBalance ? t('maritime_freight.job_details_modal.s153', "جاري التسوية...") : t('maritime_freight.job_details_modal.s154', "سداد الشحنة من الرصيد المتاح")}
            </button>
          )}
        </div>
      )}

      {/* 1. الثلاث بطاقات المالية المعتمدة (Clean White KPI Cards bound to system currency) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {/* Card 1: Revenue */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            borderTop: '3px solid #170e5e',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.job_details_modal.s155', "إجمالي الفاتورة للعميل")}</span>
            <span style={{
              padding: '2px 8px',
              background: job.payment_status === 'paid' ? '#dcfce7' : job.payment_status === 'partially_paid' ? '#fef3c7' : '#eff6ff',
              color: job.payment_status === 'paid' ? '#15803d' : job.payment_status === 'partially_paid' ? '#b45309' : '#1e40af',
              borderRadius: '6px',
              fontSize: '0.7rem',
              fontWeight: 700,
            }}>
              {job.payment_status === 'paid' ? t('maritime_freight.job_details_modal.s156', "مسدد بالكامل") : job.payment_status === 'partially_paid' ? `مسدد: ${Number(job.client_paid_total || 0).toLocaleString()}` : t('maritime_freight.job_details_modal.s157', "غير مسدد")}
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#170e5e', letterSpacing: '-0.02em' }}>
            {currencySymbol} {revenue.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
            {t('maritime_freight.job_details_modal.s158', "مبيعات الشحن والخدمات البحرية")}
          </div>
        </div>

        {/* Card 2: Cost */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            borderTop: '3px solid #ef4444',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.job_details_modal.s159', "تكلفة الخط والموانئ")}</span>
            <span style={{ padding: '2px 8px', background: '#fef2f2', color: '#b91c1c', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700 }}>
              Direct Cost
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 900, color: totalCost > 0 ? '#b91c1c' : '#0f172a', letterSpacing: '-0.02em' }}>
            {currencySymbol} {totalCost.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
            {t('maritime_freight.job_details_modal.s160', "نولون بحري ومصروفات محطات الموانئ")}
          </div>
        </div>

        {/* Card 3: Net Profit */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            borderTop: '3px solid #10b981',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.job_details_modal.s161', "صافي ربح العملية")}</span>
            <span style={{ padding: '2px 8px', background: '#f0fdf4', color: '#166534', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700 }}>
              {t('maritime_freight.job_details_modal.s162', "هامش:")} {marginPercent}%
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 900, color: netProfit >= 0 ? '#15803d' : '#b91c1c', letterSpacing: '-0.02em' }}>
            {currencySymbol} {netProfit.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
            {t('maritime_freight.job_details_modal.s163', "المساهمة الصافية في أرباح التشغيل")}
          </div>
        </div>
      </div>

      {/* 2. جدول البيان المالي وتفكيك التكاليف والإيرادات */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '8px 14px',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}>
            {t('maritime_freight.job_details_modal.s164', "بيان وتفكيك الحسابات التقديرية والفعلية للعملية")}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
            {t('maritime_freight.job_details_modal.s165', "العملة الأساسية للنظام: (")}{currencySymbol})
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'right' }}>
              <th style={{ padding: '8px 14px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s166', "بند الحساب")}</th>
              <th style={{ padding: '8px 14px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s167', "الطرف والجهة")}</th>
              <th style={{ padding: '8px 14px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s168', "التصنيف المحاسبي")}</th>
              <th style={{ padding: '8px 14px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s169', "المبلغ")}</th>
              <th style={{ padding: '8px 14px', fontWeight: 700, textAlign: 'center' }}>{t('maritime_freight.job_details_modal.s170', "الحالة")}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 14px', fontWeight: 700, color: '#170e5e' }}>{t('maritime_freight.job_details_modal.s171', "إيراد الشحن البحري للعميل (Ocean Freight Billed)")}</td>
              <td style={{ padding: '8px 14px', color: '#334155' }}>{job.customer_name}</td>
              <td style={{ padding: '8px 14px', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s172', "إيراد تشغيلي معتمد")}</td>
              <td style={{ padding: '8px 14px', fontWeight: 800, color: '#170e5e' }}>{currencySymbol} {revenue.toLocaleString()}</td>
              <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                <span style={{ padding: '2px 8px', background: '#eff6ff', color: '#1e40af', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s173', "مفوتر بالكامل")}</span>
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 14px', fontWeight: 700, color: '#0f172a' }}>{t('maritime_freight.job_details_modal.s174', "نولون الخط الملاحي الأساسي (Carrier Ocean Freight)")}</td>
              <td style={{ padding: '8px 14px', color: '#334155' }}>{job.shipping_line_name || t('maritime_freight.job_details_modal.s175', "غير محدد")}</td>
              <td style={{ padding: '8px 14px', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s176', "تكلفة شحن مباشرة")}</td>
              <td style={{ padding: '8px 14px', fontWeight: 800, color: totalCost > 0 ? '#b91c1c' : '#64748b' }}>{currencySymbol} {carrierCost.toLocaleString()}</td>
              <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                <span style={{ padding: '2px 8px', background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s177', "مطابقة الخط")}</span>
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 14px', fontWeight: 700, color: '#0f172a' }}>{t('maritime_freight.job_details_modal.s178', "مصروفات الموانئ والمناولة (Port & THC Charges)")}</td>
              <td style={{ padding: '8px 14px', color: '#334155' }}>{job.pol_name} ← {job.pod_name}</td>
              <td style={{ padding: '8px 14px', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s179', "خدمات موانئ وتداول")}</td>
              <td style={{ padding: '8px 14px', fontWeight: 800, color: otherCosts > 0 ? '#b91c1c' : '#64748b' }}>
                {otherCosts > 0 ? `${currencySymbol} ${otherCosts.toLocaleString()}` : t('maritime_freight.job_details_modal.s180', "ضمن النولون")}
              </td>
              <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                <span style={{ padding: '2px 8px', background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s181', "تسوية مباشرة")}</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '8px 14px', fontWeight: 700, color: '#0f172a' }}>{t('maritime_freight.job_details_modal.s182', "تأمين الحاويات المسترد (Container Deposit)")}</td>
              <td style={{ padding: '8px 14px', color: '#334155' }}>{t('maritime_freight.job_details_modal.s183', "خزينة أمانات الخط الملاحي")}</td>
              <td style={{ padding: '8px 14px', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s184', "أمانات مستردة (خارج الأرباح)")}</td>
              <td style={{ padding: '8px 14px', fontWeight: 800, color: '#475569' }}>
                {currencySymbol} {containerDeposits.toLocaleString()}
              </td>
              <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                <span style={{ padding: '2px 8px', background: '#f0fdf4', color: '#166534', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s185', "تحت التسوية")}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
