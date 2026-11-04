import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { maritimeApi, MaritimeCarrierInvoice } from '../api/maritime-freight.api';
import { printCarrierDisputeNote } from '../utils/maritime-documents';

interface FreightAuditTabProps {
  onOpenJobModal?: (jobId: string) => void;
}

export function FreightAuditTab({ onOpenJobModal }: FreightAuditTabProps) {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<MaritimeCarrierInvoice[]>([]);
  const [summary, setSummary] = useState({
    totalInvoices: 0,
    totalInvoicedAmount: 0,
    matchedCount: 0,
    overchargeCount: 0,
    disputedCount: 0,
    totalOverchargeAmount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog states for Maker-Checker Override & Disputes
  const [overrideTarget, setOverrideTarget] = useState<MaritimeCarrierInvoice | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);

  const [disputeTarget, setDisputeTarget] = useState<MaritimeCarrierInvoice | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputedAmount, setDisputedAmount] = useState('');
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);

  const loadInvoices = async () => {
    try {
      setLoading(true);
      const res = await maritimeApi.listAllCarrierInvoices({
        auditStatus: statusFilter === 'all' ? undefined : statusFilter,
        search: searchQuery.trim() || undefined,
      });
      setInvoices(res.invoices || []);
      if (res.summary) {
        setSummary(res.summary);
      }
    } catch (err: any) {
      toast.error('فشل تحميل سجل تدقيق فواتير النواقل');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInvoices();
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadInvoices();
  };

  const handleOpenOverride = (inv: MaritimeCarrierInvoice) => {
    setOverrideTarget(inv);
    setOverrideReason('');
  };

  const handleConfirmOverride = async () => {
    if (!overrideTarget) return;
    if (!overrideReason.trim()) {
      toast.warning('يجب كتابة سبب اعتماد التجاوز المالي');
      return;
    }

    try {
      setIsSubmittingOverride(true);
      const res = await maritimeApi.overrideCarrierInvoice(overrideTarget.id, overrideReason.trim());
      toast.success(res.message || 'تم اعتماد التجاوز وترحيل القيد المحاسبي بنجاح');
      setOverrideTarget(null);
      void loadInvoices();
    } catch (err: any) {
      toast.error(err?.message || 'فشل اعتماد التجاوز المالي للفاتورة');
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  const handleOpenDispute = (inv: MaritimeCarrierInvoice) => {
    setDisputeTarget(inv);
    setDisputeReason(`اعتراض على فروقات نولون الفاتورة #${inv.invoiceNumber} بقيمة زيادة ${inv.currency} ${inv.varianceAmount}`);
    setDisputedAmount(String(inv.varianceAmount || inv.totalInvoicedAmount));
  };

  const handleConfirmDispute = async () => {
    if (!disputeTarget) return;
    if (!disputeReason.trim()) {
      toast.warning('يجب إدخال سبب النزاع المالي ومذكرة الاعتراض');
      return;
    }

    try {
      setIsSubmittingDispute(true);
      const res = await maritimeApi.createCarrierDispute(disputeTarget.id, {
        reason: disputeReason.trim(),
        disputedAmount: Number(disputedAmount) || undefined,
      });
      toast.success(res.message || 'تم إنشاء مذكرة النزاع وتجميد الفاتورة بنجاح');
      setDisputeTarget(null);
      void loadInvoices();
    } catch (err: any) {
      toast.error(err?.message || 'فشل إنشاء مذكرة النزاع المالي');
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const handlePrintDispute = (inv: MaritimeCarrierInvoice) => {
    if (!inv.dispute) {
      toast.warning('لا توجد مذكرة نزاع مسجلة لهذه الفاتورة');
      return;
    }
    const fakeJob: any = {
      id: inv.jobId,
      job_number: inv.jobNumber || `JOB-${inv.jobId}`,
      customer_name: inv.customerName || '—',
      shipping_line_name: inv.carrierName,
      pol_name: inv.polName || '—',
      pod_name: inv.podName || '—',
      ocean_freight_cost: inv.oceanFreight,
    };
    printCarrierDisputeNote(fakeJob, inv, inv.dispute);
  };

  const filteredInvoices = useMemo(() => {
    if (!searchQuery.trim()) return invoices;
    const q = searchQuery.toLowerCase();
    return invoices.filter(
      (inv) =>
        inv.invoiceNumber?.toLowerCase().includes(q) ||
        inv.carrierName?.toLowerCase().includes(q) ||
        inv.jobNumber?.toLowerCase().includes(q) ||
        inv.customerName?.toLowerCase().includes(q)
    );
  }, [invoices, searchQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }} dir="rtl">
      {/* 1. بطاقات المؤشرات المالية لتدقيق النواقل (Audit KPIs) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '12px',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '12px 16px',
            minHeight: '88px',
            boxSizing: 'border-box',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#64748b' }}>
              {t('maritime_freight.freight_audit_tab.s0', "إجمالي فواتير النواقل المدققة")}
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#0f172a', marginTop: '3px', lineHeight: 1.2 }}>
              {summary.totalInvoices} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.freight_audit_tab.s1', "فاتورة")}</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '3px' }}>
              {t('maritime_freight.freight_audit_tab.s2', "إجمالي المبالغ: $")}{Number(summary.totalInvoicedAmount || 0).toLocaleString()}
            </div>
          </div>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: '#eff6ff',
              border: '1px solid #dbeafe',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#1e40af',
              flexShrink: 0,
            }}
          >
            <AppIcons.FileText size={18} />
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '12px 16px',
            minHeight: '88px',
            boxSizing: 'border-box',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#64748b' }}>
              {t('maritime_freight.freight_audit_tab.s3', "فواتير مطابقة للتعرفة (Matched)")}
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#0f172a', marginTop: '3px', lineHeight: 1.2 }}>
              {summary.matchedCount} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.freight_audit_tab.s4', "مطابقة")}</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '3px' }}>
              {summary.totalInvoices > 0 ? `${Math.round((summary.matchedCount / summary.totalInvoices) * 100)}% معدل التوافق` : '0%'}
            </div>
          </div>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: '#f0fdf4',
              border: '1px solid #dcfce7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#15803d',
              flexShrink: 0,
            }}
          >
            <AppIcons.CheckCircle size={18} />
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '12px 16px',
            minHeight: '88px',
            boxSizing: 'border-box',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#64748b' }}>
              {t('maritime_freight.freight_audit_tab.s5', "فواتير بزيادة غير معتمدة (Overcharge)")}
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#0f172a', marginTop: '3px', lineHeight: 1.2 }}>
              {summary.overchargeCount} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.freight_audit_tab.s6', "فاتورة")}</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: summary.overchargeCount > 0 ? '#b91c1c' : '#64748b', fontWeight: summary.overchargeCount > 0 ? 700 : 500, marginTop: '3px' }}>
              {t('maritime_freight.freight_audit_tab.s7', "إجمالي الزيادات: +$")}{Number(summary.totalOverchargeAmount || 0).toLocaleString()}
            </div>
          </div>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#dc2626',
              flexShrink: 0,
            }}
          >
            <AppIcons.AlertTriangle size={18} />
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '12px 16px',
            minHeight: '88px',
            boxSizing: 'border-box',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#64748b' }}>
              {t('maritime_freight.freight_audit_tab.s8', "نزاعات مالية مفتوحة (Disputed)")}
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#0f172a', marginTop: '3px', lineHeight: 1.2 }}>
              {summary.disputedCount} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.freight_audit_tab.s9', "نزاع")}</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '3px' }}>
              {t('maritime_freight.freight_audit_tab.s10', "فواتير محجوزة عن الصرف لحين التسوية")}
            </div>
          </div>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#d97706',
              flexShrink: 0,
            }}
          >
            <AppIcons.Shield size={18} />
          </div>
        </div>
      </div>

      {/* 2. شريط البحث والتصفية بحسب حالة التدقيق */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { id: 'all', label: t('maritime_freight.freight_audit_tab.s11', "كافة الفواتير") },
            { id: 'overcharge', label: t('maritime_freight.freight_audit_tab.s12', "زيادة غير معتمدة") },
            { id: 'matched', label: t('maritime_freight.freight_audit_tab.s13', "مطابقة للتعرفة") },
            { id: 'disputed', label: t('maritime_freight.freight_audit_tab.s14', "نزاع مفتوح") },
            { id: 'approved_override', label: t('maritime_freight.freight_audit_tab.s15', "تجاوز معتمد") },
            { id: 'undercharge', label: t('maritime_freight.freight_audit_tab.s16', "وفر / خصم") },
            { id: 'no_contract', label: t('maritime_freight.freight_audit_tab.s17', "بدون تعرفة") },
          ].map((item) => {
            const isActive = statusFilter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setStatusFilter(item.id)}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: isActive ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  background: isActive ? '#170e5e' : '#f8fafc',
                  color: isActive ? '#ffffff' : '#334155',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'none',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder={t('maritime_freight.freight_audit_tab.s18', "بحث برقم الفاتورة، الناقل، أو الشحنة...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                height: '34px',
                width: '260px',
                padding: '0 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '0.8rem',
                outline: 'none',
              }}
            />
          </div>
          <button
            type="submit"
            style={{
              height: '34px',
              padding: '0 12px',
              borderRadius: '6px',
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <AppIcons.Search size={14} />
            <span>{t('maritime_freight.freight_audit_tab.s19', "بحث")}</span>
          </button>
          <button
            type="button"
            onClick={() => void loadInvoices()}
            disabled={loading}
            style={{
              height: '34px',
              padding: '0 10px',
              borderRadius: '6px',
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              cursor: loading ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
            title={t('maritime_freight.freight_audit_tab.s20', "تحديث البيانات")}
          >
            <AppIcons.RefreshCw size={14} />
          </button>
        </form>
      </div>

      {/* 3. جدول فواتير النواقل والتدقيق المالي الشامل */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: '#0f172a' }}>
              {t('maritime_freight.freight_audit_tab.s21', "سجل تدقيق ومطابقة فواتير النواقل المركزية (Carrier Freight Audit Center)")}
            </h3>
            <p style={{ margin: '3px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              {t('maritime_freight.freight_audit_tab.s22', "مطابقة فواتير الخطوط الملاحية وشركات الطيران والنقل البري تلقائياً مع بطاقات التعرفة المتعاقد عليها، وحوكمة التجاوزات والنزاعات")}
            </p>
          </div>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              background: '#ffffff',
              color: '#475569',
              border: '1px solid #e2e8f0',
              padding: '3px 10px',
              borderRadius: '12px',
            }}
          >
            {filteredInvoices.length} {t('maritime_freight.freight_audit_tab.s23', "فاتورة")}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem', textAlign: 'right' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700 }}>
                <th style={{ padding: '10px 14px' }}>{t('maritime_freight.freight_audit_tab.s24', "رقم الفاتورة والتاريخ")}</th>
                <th style={{ padding: '10px 14px' }}>{t('maritime_freight.freight_audit_tab.s25', "أمر التشغيل والعميل")}</th>
                <th style={{ padding: '10px 14px' }}>{t('maritime_freight.freight_audit_tab.s26', "الناقل ومسار الشحن")}</th>
                <th style={{ padding: '10px 14px' }}>{t('maritime_freight.freight_audit_tab.s27', "المبلغ المفوتر")}</th>
                <th style={{ padding: '10px 14px' }}>{t('maritime_freight.freight_audit_tab.s28', "التعرفة المتعاقد عليها")}</th>
                <th style={{ padding: '10px 14px' }}>{t('maritime_freight.freight_audit_tab.s29', "الفارق (Variance)")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>{t('maritime_freight.freight_audit_tab.s30', "حالة التدقيق")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>{t('maritime_freight.freight_audit_tab.s31', "الإجراءات")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                    {t('maritime_freight.freight_audit_tab.s32', "جاري تحميل سجل فواتير النواقل والتدقيق المالي...")}
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                    {t('maritime_freight.freight_audit_tab.s33', "لا توجد فواتير نواقل مطابقة للشروط المحددة.")}
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 800, fontFamily: 'monospace', color: '#0f172a', fontSize: '0.85rem' }}>
                        {inv.invoiceNumber}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                        {inv.invoiceDate ? String(inv.invoiceDate).split('T')[0] : '—'}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div
                        onClick={() => onOpenJobModal && onOpenJobModal(inv.jobId)}
                        style={{
                          fontWeight: 700,
                          color: '#170e5e',
                          cursor: onOpenJobModal ? 'pointer' : 'default',
                          textDecoration: onOpenJobModal ? 'underline' : 'none',
                        }}
                      >
                        {inv.jobNumber || `JOB-${inv.jobId}`}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '2px' }}>
                        {inv.customerName || '—'}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{inv.carrierName}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                        {inv.polName} ← {inv.podName}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 800, color: '#b91c1c' }}>
                      {inv.currency} {Number(inv.totalInvoicedAmount || 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: '#166534' }}>
                      {inv.contractedAmount > 0 ? `${inv.currency} ${Number(inv.contractedAmount).toLocaleString()}` : '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {inv.varianceAmount > 0 ? (
                        <span style={{ fontWeight: 800, color: '#dc2626' }}>
                          +{inv.currency} {Number(inv.varianceAmount).toLocaleString()} (+{inv.variancePct}%)
                        </span>
                      ) : inv.varianceAmount < 0 ? (
                        <span style={{ fontWeight: 800, color: '#2563eb' }}>
                          -{inv.currency} {Math.abs(Number(inv.varianceAmount)).toLocaleString()}
                        </span>
                      ) : (
                        <span style={{ color: '#16a34a', fontWeight: 700 }}>0.00</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          background:
                            inv.auditStatus === 'matched'
                              ? '#dcfce7'
                              : inv.auditStatus === 'overcharge'
                              ? '#fee2e2'
                              : inv.auditStatus === 'approved_override'
                              ? '#f3e8ff'
                              : inv.auditStatus === 'disputed'
                              ? '#fef3c7'
                              : '#f1f5f9',
                          color:
                            inv.auditStatus === 'matched'
                              ? '#15803d'
                              : inv.auditStatus === 'overcharge'
                              ? '#b91c1c'
                              : inv.auditStatus === 'approved_override'
                              ? '#7e22ce'
                              : inv.auditStatus === 'disputed'
                              ? '#b45309'
                              : '#64748b',
                        }}
                      >
                        {inv.auditStatus === 'matched'
                          ? t('maritime_freight.freight_audit_tab.s34', "مطابق للتعرفة")
                          : inv.auditStatus === 'overcharge'
                          ? t('maritime_freight.freight_audit_tab.s35', "زيادة غير معتمدة")
                          : inv.auditStatus === 'approved_override'
                          ? t('maritime_freight.freight_audit_tab.s36', "تجاوز معتمد")
                          : inv.auditStatus === 'disputed'
                          ? `نزاع مفتوح (${inv.dispute?.disputeNumber || ''})`
                          : inv.auditStatus === 'undercharge'
                          ? t('maritime_freight.freight_audit_tab.s37', "وفر / خصم")
                          : t('maritime_freight.freight_audit_tab.s38', "بدون تعرفة")}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        {inv.auditStatus === 'overcharge' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenOverride(inv)}
                              style={{
                                padding: '3px 8px',
                                background: '#7e22ce',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {t('maritime_freight.freight_audit_tab.s39', "اعتماد تجاوز")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenDispute(inv)}
                              style={{
                                padding: '3px 8px',
                                background: '#b45309',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {t('maritime_freight.freight_audit_tab.s40', "فتح نزاع")}
                            </button>
                          </>
                        )}
                        {inv.dispute && (
                          <button
                            type="button"
                            onClick={() => handlePrintDispute(inv)}
                            style={{
                              padding: '3px 8px',
                              background: '#0369a1',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {t('maritime_freight.freight_audit_tab.s41', "طباعة النزاع")}
                          </button>
                        )}
                        {onOpenJobModal && (
                          <button
                            type="button"
                            onClick={() => onOpenJobModal(inv.jobId)}
                            style={{
                              padding: '3px 8px',
                              background: '#f8fafc',
                              color: '#334155',
                              border: '1px solid #cbd5e1',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {t('maritime_freight.freight_audit_tab.s42', "عرض الشحنة")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal 1: اعتماد التجاوز المالي (Maker-Checker Override Dialog) */}
      {overrideTarget && (
        <StandardDialog
          open={Boolean(overrideTarget)}
          onClose={() => setOverrideTarget(null)}
          title={t('maritime_freight.freight_audit_tab.s43', "اعتماد تجاوز مالي لفاتورة الناقل (Maker-Checker Override)")}
          subtitle={`الفاتورة #${overrideTarget.invoiceNumber} | الناقل: ${overrideTarget.carrierName} | الزيادة: +${overrideTarget.currency} ${overrideTarget.varianceAmount}`}
          width="min(560px, 95vw)"
          minHeight="min(450px, 80vh)"
          footerActions={(
            <StandardDialogFooter
              onSubmit={handleConfirmOverride}
              submitText={isSubmittingOverride ? t('maritime_freight.freight_audit_tab.s44', "جاري الاعتماد...") : t('maritime_freight.freight_audit_tab.s45', "اعتماد التجاوز وترحيل القيد")}
              isSubmitting={isSubmittingOverride}
              onCancel={() => setOverrideTarget(null)}
            />
          )}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '10px 0' }}>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px', fontSize: '0.8rem', color: '#991b1b', lineHeight: 1.5 }}>
              <strong>{t('maritime_freight.freight_audit_tab.s46', "تحذير رقابي حاسم:")}</strong> {t('maritime_freight.freight_audit_tab.s47', "قيمة هذه الفاتورة تتجاوز التعرفة المعتمدة بمقدار")}{' '}
              <strong>+{overrideTarget.currency} {overrideTarget.varianceAmount} (+{overrideTarget.variancePct}%)</strong>{t('maritime_freight.freight_audit_tab.s48', ".\n              بناءً على معايير الحوكمة المالية، يتطلب هذا الإجراء مصادقة محاسب مسؤول آخر (Maker-Checker) مع تدوين مبرر صريح لترحيل قيد المصروف في دفاتر المنشأة.")}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                {t('maritime_freight.freight_audit_tab.s49', "مبرر اعتماد الزيادة التشغيلية (Rationale) *")}
              </label>
              <textarea
                rows={3}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder={t('maritime_freight.freight_audit_tab.s50', "مثال: زيادة طارئة في رسوم الوقود BAF وتأخير غير متوقع في رسوم التفريغ بميناء الوجهة تم التوافق عليها مع الإدارة...")}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.8rem',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '4px' }}>
                {t('maritime_freight.freight_audit_tab.s51', "الحد الأدنى 10 أحرف لضمان توثيق سجل التدقيق المحاسبي.")}
              </div>
            </div>
          </div>
        </StandardDialog>
      )}

      {/* Modal 2: فتح نزاع مالي مع الناقل (Carrier Dispute Dialog) */}
      {disputeTarget && (
        <StandardDialog
          open={Boolean(disputeTarget)}
          onClose={() => setDisputeTarget(null)}
          title={t('maritime_freight.freight_audit_tab.s52', "فتح مذكرة نزاع مالي رسمي مع الناقل (Carrier Freight Dispute)")}
          subtitle={`الفاتورة #${disputeTarget.invoiceNumber} | الناقل: ${disputeTarget.carrierName}`}
          width="min(560px, 95vw)"
          minHeight="min(450px, 80vh)"
          footerActions={(
            <StandardDialogFooter
              onSubmit={handleConfirmDispute}
              submitText={isSubmittingDispute ? t('maritime_freight.freight_audit_tab.s53', "جاري الفتح...") : t('maritime_freight.freight_audit_tab.s54', "تأكيد فتح النزاع وحجز الفاتورة")}
              isSubmitting={isSubmittingDispute}
              onCancel={() => setDisputeTarget(null)}
            />
          )}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '10px 0' }}>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 14px', fontSize: '0.8rem', color: '#92400e', lineHeight: 1.5 }}>
              {t('maritime_freight.freight_audit_tab.s55', "فتح النزاع يقوم تلقائياً بـ")} <strong>{t('maritime_freight.freight_audit_tab.s56', "تجميد الفاتورة عن الصرف")}</strong> {t('maritime_freight.freight_audit_tab.s57', "ومنع ترحيلها إلى أوامر السداد، وتوليد رقم نزاع مالي رسمي يمكنك طباعته ومشاركته مع الخط الملاحي لطلب إشعار دائن (Credit Note).")}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                {t('maritime_freight.freight_audit_tab.s58', "المبلغ المتنازع عليه (")}{disputeTarget.currency}) *
              </label>
              <input
                type="number"
                value={disputedAmount}
                onChange={(e) => setDisputedAmount(e.target.value)}
                style={{
                  width: '100%',
                  height: '36px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                {t('maritime_freight.freight_audit_tab.s59', "موضوع وتفاصيل النزاع المالي *")}
              </label>
              <textarea
                rows={3}
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder={t('maritime_freight.freight_audit_tab.s60', "أدخل تفاصيل الاعتراض المالي على بنود الفاتورة...")}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.8rem',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </StandardDialog>
      )}
    </div>
  );
}
