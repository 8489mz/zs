import { useTranslation } from 'react-i18next';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatCurrencyWithSymbol, formatTenantDateKey } from '@/lib/format';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { PrinterIcon, CalendarIcon } from '@/shared/components/icons/AppIcons';

interface CostCenterReportModalProps {
  centerId: number | null;
  onClose: () => void;
  reportData: any;
  isLoading: boolean;
  fromDate: string;
  toDate: string;
  onFromDateChange: (val: string) => void;
  onToDateChange: (val: string) => void;
}

export function CostCenterReportModal({
  centerId,
  onClose,
  reportData,
  isLoading,
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
}: CostCenterReportModalProps) {
  const { t } = useTranslation();
  const { data: settings } = useSettingsQuery();
  const tenantTimezone = settings?.timezone || 'Africa/Cairo';
  if (!centerId) return null;

  const centerTitle = `كشف حركات وتقرير مركز التكلفة: ${reportData?.center?.name || '...'} (${reportData?.center?.code || ''})`;

  return (
    <StandardDialog
      open={true}
      onClose={onClose}
      title={centerTitle}
      subtitle={t('accounting.cost_centers.cost_center_report_modal.s0', "بيان كافة القيود والمصروفات والإيرادات المحملة على هذا المركز")}
      size="lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Filter dates card */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          backgroundColor: '#f8fafc',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
            <CalendarIcon size={16} style={{ color: '#170e5e' }} />
            <span>{t('accounting.cost_centers.cost_center_report_modal.s1', "نطاق الفترة المحاسبية:")}</span>
          </div>

          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>{t('accounting.cost_centers.cost_center_report_modal.s2', "من تاريخ:")}</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => onFromDateChange(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px', backgroundColor: '#ffffff' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>{t('accounting.cost_centers.cost_center_report_modal.s3', "إلى تاريخ:")}</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => onToDateChange(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px', backgroundColor: '#ffffff' }}
              />
            </div>
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
            {t('accounting.cost_centers.cost_center_report_modal.s4', "جاري استخراج بيانات التقرير...")}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Totals Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px' }}>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginBottom: '4px' }}>{t('accounting.cost_centers.cost_center_report_modal.s5', "إجمالي المدين (المصروفات)")}</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#dc2626' }}>
                  {formatCurrencyWithSymbol(reportData?.summary?.totalDebit || 0)}
                </div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px' }}>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginBottom: '4px' }}>{t('accounting.cost_centers.cost_center_report_modal.s6', "إجمالي الدائن (الإيرادات)")}</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#059669' }}>
                  {formatCurrencyWithSymbol(reportData?.summary?.totalCredit || 0)}
                </div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px' }}>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginBottom: '4px' }}>{t('accounting.cost_centers.cost_center_report_modal.s7', "صافي الرصيد")}</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#170e5e' }}>
                  {formatCurrencyWithSymbol(reportData?.summary?.netBalance || 0)}
                </div>
              </div>
            </div>

            {/* Entries Table */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '10px 14px' }}>{t('accounting.cost_centers.cost_center_report_modal.s8', "التاريخ")}</th>
                    <th style={{ padding: '10px 14px' }}>{t('accounting.cost_centers.cost_center_report_modal.s9', "رقم القيد")}</th>
                    <th style={{ padding: '10px 14px' }}>{t('accounting.cost_centers.cost_center_report_modal.s10', "الحساب")}</th>
                    <th style={{ padding: '10px 14px' }}>{t('accounting.cost_centers.cost_center_report_modal.s11', "البيان")}</th>
                    <th style={{ padding: '10px 14px' }}>{t('accounting.cost_centers.cost_center_report_modal.s12', "مدين")}</th>
                    <th style={{ padding: '10px 14px' }}>{t('accounting.cost_centers.cost_center_report_modal.s13', "دائن")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(!reportData?.entries || reportData.entries.length === 0) ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                        {t('accounting.cost_centers.cost_center_report_modal.s14', "لا توجد قيود مسجلة على هذا المركز في الفترة المحددة.")}
                      </td>
                    </tr>
                  ) : (
                    reportData.entries.map((ent: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 14px' }}>{formatTenantDateKey(ent.entryDate, tenantTimezone)}</td>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 700 }}>#{ent.entryNumber}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{ent.accountName}</td>
                        <td style={{ padding: '10px 14px', color: '#64748b' }}>{ent.description || '—'}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: '#dc2626' }}>{ent.debit ? formatCurrency(ent.debit) : '—'}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: '#059669' }}>{ent.credit ? formatCurrency(ent.credit) : '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <StandardDialogFooter>
        <Button variant="secondary" onClick={onClose} style={{ padding: '8px 18px', fontSize: '13px', borderRadius: '8px' }}>
          {t('accounting.cost_centers.cost_center_report_modal.s15', "إغلاق")}
        </Button>
        <Button
          type="button"
          onClick={() => window.print()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: '#170e5e',
            color: '#ffffff',
            padding: '8px 20px',
            fontSize: '13px',
            fontWeight: 700,
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <PrinterIcon size={14} />
          <span>{t('accounting.cost_centers.cost_center_report_modal.s16', "طباعة A4")}</span>
        </Button>
      </StandardDialogFooter>
    </StandardDialog>
  );
}
