import { useTranslation } from 'react-i18next';
import { DownloadIcon } from '@/shared/components/icons/AppIcons';
import type { FreightPortalCustomer } from '../../hooks/use-maritime-customer-portal';

export function MaritimePortalStatementTab({ customer, loadingStatement, statementData }: { customer: FreightPortalCustomer; loadingStatement: boolean; statementData: any | null }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 2px' }}>
            {t('maritime_freight.maritime_customer_portal_page.s139', "كشف الحساب والمديونيات (Statement of Account)")}
          </h2>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            {t('maritime_freight.maritime_customer_portal_page.s140', "سجل تفصيلي بالعمليات المالية، الفواتير، والأرصدة المستحقة على الشحنات")}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => window.print()}
            style={{ padding: '6px 14px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <DownloadIcon size={14} color="#fff" />
            <span>{t('maritime_freight.maritime_customer_portal_page.s141', "طباعة كشف الحساب")}</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px' }}>
          <div style={{ fontSize: '11.5px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s142', "الرصيد المستحق الحالي")}</div>
          <div style={{ fontSize: '22px', fontWeight: 900, color: (customer.balance || 0) > 0 ? '#b91c1c' : '#0f172a', marginTop: '4px' }}>
            {Number(customer.balance || 0).toLocaleString()} <span style={{ fontSize: '13px' }}>{t('maritime_freight.maritime_customer_portal_page.s143', "ج.م")}</span>
          </div>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px' }}>
          <div style={{ fontSize: '11.5px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s144', "الحد الائتماني المعتمد")}</div>
          <div style={{ fontSize: '22px', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
            {Number(customer.creditLimit || 0).toLocaleString()} <span style={{ fontSize: '13px' }}>{t('maritime_freight.maritime_customer_portal_page.s145', "ج.م")}</span>
          </div>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px' }}>
          <div style={{ fontSize: '11.5px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s146', "الرصيد الائتماني المتبقي")}</div>
          <div style={{ fontSize: '22px', fontWeight: 900, color: '#166534', marginTop: '4px' }}>
            {Math.max(0, Number(customer.creditLimit || 0) - Number(customer.balance || 0)).toLocaleString()} <span style={{ fontSize: '13px' }}>{t('maritime_freight.maritime_customer_portal_page.s147', "ج.م")}</span>
          </div>
        </div>
      </div>

      {/* Jobs Ledger Summary Table */}
      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', fontWeight: 700, fontSize: '13.5px', color: '#0f172a' }}>
          {t('maritime_freight.maritime_customer_portal_page.s148', "سجل شحنات ومطالبات العميل")}
        </div>

        {loadingStatement ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s149', "جاري تحميل البيانات...")}</div>
        ) : !statementData?.jobsSummary || statementData.jobsSummary.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s150', "لا توجد قيود أو فواتير مسجلة")}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('maritime_freight.maritime_customer_portal_page.s151', "رقم الشحنة")}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('maritime_freight.maritime_customer_portal_page.s152', "الناقل")}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('maritime_freight.maritime_customer_portal_page.s153', "المسار (POL → POD)")}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('maritime_freight.maritime_customer_portal_page.s154', "التاريخ")}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'left' }}>{t('maritime_freight.maritime_customer_portal_page.s155', "إجمالي الرسوم المسجلة")}</th>
                </tr>
              </thead>
              <tbody>
                {statementData.jobsSummary.map((job: any) => (
                  <tr key={job.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 800, color: '#0f172a' }}>{job.job_number}</td>
                    <td style={{ padding: '10px 14px', color: '#475569' }}>{job.shipping_line_name || '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#334155' }}>{job.pol_name} → {job.pod_name}</td>
                    <td style={{ padding: '10px 14px', color: '#64748b' }}>{new Date(job.created_at).toLocaleDateString('ar-EG')}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'left', color: '#170e5e' }}>
                      {Number(job.totalAmount || 0).toLocaleString()} {t('maritime_freight.maritime_customer_portal_page.s156', "ج.م")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
