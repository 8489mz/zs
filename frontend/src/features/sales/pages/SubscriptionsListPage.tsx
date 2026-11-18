import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo, type FC } from 'react';
import { commercialSubscriptionsApi, type CommercialSubscription } from '../api/commercial-subscriptions.api';
import { CreateSubscriptionModal } from '../components/CreateSubscriptionModal';
import { formatCurrency, todayLocalDateKey } from '@/lib/format';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import {
  PlusIcon,
  PlayIcon,
  FileTextIcon,
  SearchIcon,
} from '@/shared/components/icons/AppIcons';

export const SubscriptionsListPage: FC = () => {
  const { t } = useTranslation();
    const [subscriptions, setSubscriptions] = useState<CommercialSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'expired'>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const fetchSubscriptions = async () => {
    try {
      setLoading(true);
      const data = await commercialSubscriptionsApi.list({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search: search.trim() || undefined,
      });
      setSubscriptions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast.error(err?.message || 'فشل تحميل الاشتراكات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscriptions();
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchSubscriptions();
  };

  const handleRunBillingEngine = async () => {
    const confirmed = await systemConfirm({
      title: 'تشغيل محرك الفوترة الدورية (Recurring Billing Engine)',
      message: 'هل تريد فحص كافة عقود الاشتراكات المستحقة اليوم وتوليد فواتير مبيعات آجلة لها تلقائياً مع ترحيل تاريخ الفوترة التالي؟',
      confirmText: 'بدء التوليد الفوري',
      cancelText: 'إلغاء',
    });
    if (!confirmed) return;

    setIsGenerating(true);
    try {
      const res = await commercialSubscriptionsApi.generateDueInvoices();
      if (res.generatedInvoices.length > 0) {
        toast.success(`تم بنجاح توليد ${res.generatedInvoices.length} فاتورة مبيعات دورية: ${res.generatedInvoices.join(', ')}`);
      } else {
        toast.info('تم فحص الاشتراكات: لا توجد عقود مستحقة للفوترة اليوم.');
      }
      fetchSubscriptions();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تشغيل محرك الفوترة');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: 'active' | 'paused' | 'cancelled') => {
    try {
      await commercialSubscriptionsApi.updateStatus(id, newStatus);
      toast.success('تم تحديث حالة العقد بنجاح');
      fetchSubscriptions();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تحديث الحالة');
    }
  };

  // KPIs
  const kpis = useMemo(() => {
    const active = subscriptions.filter((s) => s.status === 'active');
    const totalMRR = active.reduce((acc, s) => {
      const amt = Number(s.recurring_amount || 0);
      switch (s.billing_period) {
        case 'annual': return acc + amt / 12;
        case 'semi_annual': return acc + amt / 6;
        case 'quarterly': return acc + amt / 3;
        default: return acc + amt;
      }
    }, 0);
    const totalInvoices = subscriptions.reduce((acc, s) => acc + Number(s.invoices_count || 0), 0);
    const todayStr = todayLocalDateKey();
    const dueCount = active.filter((s) => s.next_billing_date <= todayStr).length;

    return {
      activeCount: active.length,
      mrr: Math.round(totalMRR),
      totalInvoices,
      dueCount,
    };
  }, [subscriptions]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: '#dcfce7', color: '#15803d' }}>{t('sales.subscriptions_list_page.s0', "نشط ومفعل")}</span>;
      case 'paused':
        return <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: '#fef3c7', color: '#b45309' }}>{t('sales.subscriptions_list_page.s1', "موقوف مؤقتاً")}</span>;
      case 'cancelled':
        return <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: '#fee2e2', color: '#b91c1c' }}>{t('sales.subscriptions_list_page.s2', "ملغي")}</span>;
      case 'expired':
        return <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: '#f1f5f9', color: '#64748b' }}>{t('sales.subscriptions_list_page.s3', "منتهي")}</span>;
      default:
        return <span>{status}</span>;
    }
  };

  const getPeriodLabel = (p: string) => {
    switch (p) {
      case 'monthly': return 'شهري';
      case 'quarterly': return 'ربع سنوي';
      case 'semi_annual': return 'نصف سنوي';
      case 'annual': return 'سنوي';
      default: return p;
    }
  };

  return (
    <div style={{ maxWidth: '1280px', width: 'min(100%, 1280px)', margin: '0 auto', padding: '24px 16px' }} dir="rtl">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
            {t('sales.subscriptions_list_page.s4', "عقود الاشتراكات والفوترة الدورية (B2B Recurring Invoicing)")}
          </h1>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: '#64748b' }}>
            {t('sales.subscriptions_list_page.s5', "إدارة العقود التجارية المتكررة، الاشتراكات الشهرية والسنوية، والأتمتة الكاملة لإصدار الفواتير")}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleRunBillingEngine}
            disabled={isGenerating}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#1e293b',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <PlayIcon size={15} />
            {isGenerating ? t('sales.subscriptions_list_page.s6', "جاري الفحص والتوليد...") : t('sales.subscriptions_list_page.s7', "تشغيل محرك الفوترة الدورية")}
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: '#170e5e',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <PlusIcon size={16} />
            {t('sales.subscriptions_list_page.s8', "عقد اشتراك جديد")}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '4px' }}>{t('sales.subscriptions_list_page.s9', "العقود النشطة")}</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>{kpis.activeCount}</div>
        </div>
        <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '4px' }}>{t('sales.subscriptions_list_page.s10', "الإيراد الشهري المتكرر التقريبي (MRR)")}</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#16a34a' }}>{formatCurrency(kpis.mrr)}</div>
        </div>
        <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '4px' }}>{t('sales.subscriptions_list_page.s11', "إجمالي الفواتير المولدة آلياً")}</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#2563eb' }}>{kpis.totalInvoices}</div>
        </div>
        <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '4px' }}>{t('sales.subscriptions_list_page.s12', "عقود مستحقة للفوترة اليوم")}</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: kpis.dueCount > 0 ? '#ea580c' : '#0f172a' }}>
            {kpis.dueCount}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ background: '#ffffff', padding: '14px 18px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { id: 'all', label: t('sales.subscriptions_list_page.s13', "الكل") },
            { id: 'active', label: t('sales.subscriptions_list_page.s14', "النشطة") },
            { id: 'paused', label: t('sales.subscriptions_list_page.s15', "الموقوفة") },
            { id: 'expired', label: t('sales.subscriptions_list_page.s16', "المنتهية") },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id as any)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '12.5px',
                fontWeight: 600,
                border: '1px solid',
                borderColor: statusFilter === tab.id ? '#170e5e' : '#e2e8f0',
                background: statusFilter === tab.id ? '#170e5e' : '#ffffff',
                color: statusFilter === tab.id ? '#ffffff' : '#475569',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder={t('sales.subscriptions_list_page.s17', "بحث برقم العقد، اسم العميل...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '240px', height: '34px', padding: '4px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
          />
          <button
            type="submit"
            style={{ padding: '0 12px', height: '34px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer' }}
          >
            <SearchIcon size={15} />
          </button>
        </form>
      </div>

      {/* Subscriptions Table */}
      <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>{t('sales.subscriptions_list_page.s18', "جاري تحميل العقود والاشتراكات...")}</div>
        ) : subscriptions.length === 0 ? (
          <div style={{ padding: '50px 20px', textAlign: 'center', color: '#64748b' }}>
            <FileTextIcon size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
            <div style={{ fontWeight: 600, fontSize: '14px' }}>{t('sales.subscriptions_list_page.s19', "لا توجد عقود اشتراكات مسجلة حالياً")}</div>
            <div style={{ fontSize: '12.5px', marginTop: '4px' }}>{t('sales.subscriptions_list_page.s20', "اضغط على \"عقد اشتراك جديد\" لإضافة أول اشتراك تعاقدي")}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'right' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('sales.subscriptions_list_page.s21', "رقم العقد")}</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('sales.subscriptions_list_page.s22', "العميل التعاقدي")}</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('sales.subscriptions_list_page.s23', "الدورية")}</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('sales.subscriptions_list_page.s24', "المبلغ الدوري")}</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('sales.subscriptions_list_page.s25', "الفاتورة القادمة")}</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('sales.subscriptions_list_page.s26', "الفواتير المصدرة")}</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>{t('sales.subscriptions_list_page.s27', "الحالة")}</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'center' }}>{t('sales.subscriptions_list_page.s28', "الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: '#1e293b' }}>
                      {sub.contract_number}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{sub.customer_name}</div>
                      {sub.customer_phone && <div style={{ fontSize: '11.5px', color: '#64748b' }}>{sub.customer_phone}</div>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {getPeriodLabel(sub.billing_period)}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a' }}>
                      {formatCurrency(sub.recurring_amount)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontWeight: 600, color: sub.next_billing_date <= todayLocalDateKey() ? '#ea580c' : '#334155' }}>
                        {sub.next_billing_date}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: '6px', fontWeight: 600 }}>
                        {sub.invoices_count}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {getStatusBadge(sub.status)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                        {sub.status === 'active' && (
                          <button
                            onClick={() => handleStatusChange(sub.id, 'paused')}
                            style={{ padding: '4px 8px', fontSize: '11.5px', borderRadius: '6px', border: '1px solid #fde047', background: '#fef9c3', color: '#854d0e', cursor: 'pointer' }}
                          >
                            {t('sales.subscriptions_list_page.s29', "إيقاف مؤقت")}
                          </button>
                        )}
                        {sub.status === 'paused' && (
                          <button
                            onClick={() => handleStatusChange(sub.id, 'active')}
                            style={{ padding: '4px 8px', fontSize: '11.5px', borderRadius: '6px', border: '1px solid #bbf7d0', background: '#dcfce7', color: '#166534', cursor: 'pointer' }}
                          >
                            {t('sales.subscriptions_list_page.s30', "استئناف")}
                          </button>
                        )}
                        {sub.status !== 'cancelled' && (
                          <button
                            onClick={() => handleStatusChange(sub.id, 'cancelled')}
                            style={{ padding: '4px 8px', fontSize: '11.5px', borderRadius: '6px', border: '1px solid #fecaca', background: '#fee2e2', color: '#991b1b', cursor: 'pointer' }}
                          >
                            {t('sales.subscriptions_list_page.s31', "إلغاء")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateSubscriptionModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={fetchSubscriptions}
      />
    </div>
  );
};
