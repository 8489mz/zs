import { useTranslation } from 'react-i18next';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { getGlobalCurrencySymbol, getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { DataTable } from '@/shared/ui/data-table';
import { getErrorMessage } from '@/lib/errors';
import type { HrEmployee, HrEmployeeAsset } from '@/types/domain';
import { useHrEmployeeAssets, useHrMutations, useHrWorkspace } from '@/features/hr/hooks/useHr';
import {
  assetTypeOptions,
  cashAmount,
  cashCustodyType,
  cashDifference,
  custodyKind,
  employeeDisplay,
  fallbackText,
  initialForm,
  isCashCustody,
  money,
  needsReview,
  normalize,
  parseAmount,
  settlementParts,
  statusLabel,
  statusMatches,
  statusOptions,
  text,
  todayDate,
  type AssetFormState,
  type CustodyTab,
  type ReviewStatusFilter,
  type SettlementDraft,
} from '@/features/hr/pages/assets/hr-assets.helpers';

export function HrAssetsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useHrMutations();

  const [activeTab, setActiveTab] = useState<CustodyTab>('physical');
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>('needs_review');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<AssetFormState>(() => initialForm('physical'));
  const [settlementId, setSettlementId] = useState('');
  const [settlementDraft, setSettlementDraft] = useState<SettlementDraft>({ spentAmount: '', returnedAmount: '', notes: '' });
  const [settlementError, setSettlementError] = useState('');

  const workspace = useHrWorkspace({ page: 1, pageSize: 200, search: '' });
  const assetsQuery = useHrEmployeeAssets({ search, status: statusFilter === 'needs_review' || statusFilter === 'all' ? '' : statusFilter, page, pageSize });

  const employees = useMemo(() => (workspace.employees.data?.employees || []) as HrEmployee[], [workspace.employees.data?.employees]);
  const employeesMap = useMemo(() => new Map(employees.map((row) => [String(row.id), row])), [employees]);
  const rawAssets = useMemo(() => (assetsQuery.data?.assets || []) as HrEmployeeAsset[], [assetsQuery.data?.assets]);
  const tabAssets = useMemo(() => rawAssets.filter((row) => custodyKind(row) === activeTab), [activeTab, rawAssets]);
  const selectedSettlementRow = useMemo(() => tabAssets.find((row) => String(row.id) === settlementId), [settlementId, tabAssets]);

  const departmentOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const employee of employees) {
      const key = normalize(employee.departmentName);
      if (key) set.set(key, String(employee.departmentName || '').trim());
    }
    return Array.from(set.entries()).map(([value, label]) => ({ value, label }));
  }, [employees]);

  const assets = useMemo(() => tabAssets.filter((row) => {
    const employee = employeesMap.get(String(row.employeeId));
    const departmentName = normalize(employee?.departmentName || row.departmentName);
    if (departmentFilter !== 'all' && departmentName !== departmentFilter) return false;
    return statusMatches(row, statusFilter);
  }), [tabAssets, employeesMap, departmentFilter, statusFilter]);

  const summary = useMemo(() => {
    const result = { total: tabAssets.length, assigned: 0, returned: 0, damaged: 0, lost: 0, needsReview: 0, visible: assets.length, cashOpenAmount: 0, cashTotalAmount: 0 };
    for (const row of tabAssets) {
      const status = normalize(row.status);
      if (status === 'assigned') result.assigned += 1;
      if (status === 'returned') result.returned += 1;
      if (status === 'damaged') result.damaged += 1;
      if (status === 'lost') result.lost += 1;
      if (needsReview(row)) result.needsReview += 1;
      if (isCashCustody(row)) {
        const amount = cashAmount(row);
        // INV-FE3-FRONTEND-BOOK-DIGITS: cash totals are money; the
        // running sum rounds at the tenant's book digits, not 2dp.
        result.cashTotalAmount = roundMoneyValue(result.cashTotalAmount + amount, currencyMoneyDigits(getGlobalSystemCurrency()));
        if (status === 'assigned') result.cashOpenAmount = roundMoneyValue(result.cashOpenAmount + amount, currencyMoneyDigits(getGlobalSystemCurrency()));
      }
    }
    return result;
  }, [assets.length, tabAssets]);

  const totalItems = statusFilter === 'all' && departmentFilter === 'all' ? tabAssets.length : assets.length;

  const switchTab = (tab: CustodyTab) => {
    setActiveTab(tab);
    setShowCreate(false);
    setStatusFilter('needs_review');
    setDepartmentFilter('all');
    setPage(1);
    setErrors({});
    setSettlementId('');
    setSettlementError('');
    setForm(initialForm(tab));
  };

  const submitAsset = async () => {
    const nextErrors: Record<string, string> = {};
    const isCash = activeTab === 'cash';
    const amount = parseAmount(form.cashAmount);
    if (!form.employeeId) nextErrors.employeeId = 'اختيار الموظف مطلوب.';
    if (isCash && !(amount > 0)) nextErrors.cashAmount = 'مبلغ العهدة النقدية مطلوب.';
    if (!isCash && !text(form.assetType)) nextErrors.assetType = 'نوع العهدة مطلوب.';
    if (!text(form.assetName)) nextErrors.assetName = isCash ? 'الغرض / بيان العهدة مطلوب.' : 'اسم العهدة مطلوب.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    await mutations.saveEmployeeAsset.mutateAsync({
      payload: {
        employeeId: Number(form.employeeId),
        assetType: isCash ? cashCustodyType : form.assetType,
        assetName: form.assetName,
        assetCode: isCash ? String(amount) : (form.assetCode || undefined),
        serialNo: isCash ? undefined : (form.serialNo || undefined),
        assignedAt: form.assignedAt || undefined,
        notes: form.notes || undefined,
      },
    });
    setForm(initialForm(activeTab));
    setErrors({});
    setShowCreate(false);
    setStatusFilter('assigned');
  };

  const submitSettlement = async () => {
    setSettlementError('');
    if (!selectedSettlementRow) return;
    const amount = cashAmount(selectedSettlementRow);
    const spent = parseAmount(settlementDraft.spentAmount);
    const returned = parseAmount(settlementDraft.returnedAmount);
    if (!(spent > 0) && !(returned > 0)) { setSettlementError('اكتب المصروف أو المرتجع على الأقل.'); return; }
    // INV-FE3-FRONTEND-BOOK-DIGITS: the settlement difference is money
    // at book digits; the note strings record the same rounded values,
    // and any nonzero difference is a real fils-level difference.
    const bookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
    const difference = roundMoneyValue(amount - spent - returned, bookDigits);
    const notes = [`مصروف: ${spent.toFixed(bookDigits)}`, `مرتجع: ${returned.toFixed(bookDigits)}`, `فرق: ${difference.toFixed(bookDigits)}`, text(settlementDraft.notes)].filter(Boolean).join(' | ');
    await mutations.returnEmployeeAsset.mutateAsync({ id: String(selectedSettlementRow.id), payload: { returnedAt: todayDate(), notes: selectedSettlementRow.notes || undefined, returnNotes: notes } });
    setSettlementId('');
    setSettlementDraft({ spentAmount: '', returnedAmount: '', notes: '' });
    setStatusFilter(Math.abs(difference) > 0 ? 'needs_review' : 'returned');
  };

  const setFilter = (filter: ReviewStatusFilter) => { setStatusFilter(filter); setPage(1); };

  const renderActions = (row: HrEmployeeAsset) => {
    const status = normalize(row.status);
    if (isCashCustody(row)) {
      return (
        <div className="compact-actions">
          <Button type="button" variant="secondary" onClick={() => navigate(`/hr/employees/${row.employeeId}`)}>{t('hr.hr_assets_page.s0', "ملف الموظف")}</Button>
          {status === 'assigned' ? <Button type="button" variant="secondary" onClick={() => { setSettlementId(String(row.id)); setSettlementDraft({ spentAmount: '', returnedAmount: '', notes: '' }); setSettlementError(''); }}>{t('hr.hr_assets_page.s1', "تسوية")}</Button> : null}
        </div>
      );
    }
    return (
      <div className="compact-actions">
        <Button type="button" variant="secondary" onClick={() => navigate(`/hr/employees/${row.employeeId}`)}>{t('hr.hr_assets_page.s2', "ملف الموظف")}</Button>
        {status === 'assigned' ? <Button type="button" variant="secondary" onClick={() => mutations.returnEmployeeAsset.mutate({ id: String(row.id), payload: { notes: row.notes || undefined } })}>{t('hr.hr_assets_page.s3', "استرجاع")}</Button> : null}
        {status === 'assigned' ? <Button type="button" variant="secondary" onClick={() => mutations.markEmployeeAssetDamaged.mutate({ id: String(row.id), payload: { notes: row.notes || undefined } })}>{t('hr.hr_assets_page.s4', "تالفة")}</Button> : null}
        {status === 'assigned' ? <Button type="button" variant="secondary" onClick={() => mutations.markEmployeeAssetLost.mutate({ id: String(row.id), payload: { notes: row.notes || undefined } })}>{t('hr.hr_assets_page.s5', "مفقودة")}</Button> : null}
      </div>
    );
  };

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '20px' }}>
        <PageHeader
          title={t('hr.hr_assets_page.s6', "العُهد والأصول")}
          description={t('hr.hr_assets_page.s7', "إدارة ومتابعة العُهد العينية والنقدية المسلّمة للموظفين وتتبع الاسترجاع والتسوية.")}
          actions={
            <div className="actions compact-actions">
              <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
                <Button type="button" variant={activeTab === 'physical' ? 'primary' : 'secondary'} onClick={() => switchTab('physical')} style={{ padding: '4px 12px', fontSize: '0.825rem' }}>{t('hr.hr_assets_page.s8', "عُهد عينية")}</Button>
                <Button type="button" variant={activeTab === 'cash' ? 'primary' : 'secondary'} onClick={() => switchTab('cash')} style={{ padding: '4px 12px', fontSize: '0.825rem' }}>{t('hr.hr_assets_page.s9', "عُهد نقدية")}</Button>
              </div>
              <Button type="button" onClick={() => setShowCreate((current) => !current)}>
                {showCreate ? t('hr.hr_assets_page.s10', "إغلاق النموذج") : activeTab === 'cash' ? t('hr.hr_assets_page.s11', "تسليم عهدة نقدية") : t('hr.hr_assets_page.s12', "تسليم عهدة عينية")}
              </Button>
              <Button variant="secondary" onClick={() => navigate('/hr/employees')}>{t('hr.hr_assets_page.s13', "رجوع للموظفين")}</Button>
            </div>
          }
        />
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

          {showCreate ? (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                <div>
                  <strong style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>{activeTab === 'cash' ? t('hr.hr_assets_page.s14', "تسليم عهدة نقدية") : t('hr.hr_assets_page.s15', "تسليم عهدة عينية")}</strong>
                  <small style={{ fontSize: '0.8rem', color: '#64748b', display: 'block' }}>{activeTab === 'cash' ? t('hr.hr_assets_page.s16', "سجّل المبلغ والغرض. التسوية تتم لاحقًا من قائمة العهد النقدية.") : t('hr.hr_assets_page.s17', "سجّل العهدة على الموظف الصحيح لمتابعتها في ملفه.")}</small>
                </div>
                <Button type="button" variant="secondary" onClick={() => setShowCreate(false)} style={{ padding: '2px 8px', fontSize: '0.8rem' }}><XIcon size={15} /></Button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('hr.hr_assets_page.s18', "الموظف")} <span style={{ color: '#dc2626' }}>*</span></label>
                  <CustomSelect
                    value={form.employeeId}
                    onChange={(val) => setForm((prev) => ({ ...prev, employeeId: val }))}
                    options={[
                      { value: '', label: t('hr.hr_assets_page.s19', "اختر الموظف...") },
                      ...employees.map((employee) => ({ value: employee.id, label: employeeDisplay(employee) })),
                    ]}
                  />
                  {errors.employeeId ? <small style={{ color: '#dc2626', fontSize: '0.75rem', marginTop: '2px', display: 'block' }}>{errors.employeeId}</small> : null}
                </div>

                {activeTab === 'cash' ? (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('hr.hr_assets_page.s20', "مبلغ العهدة (")}{getGlobalCurrencySymbol()}) <span style={{ color: '#dc2626' }}>*</span></label>
                    <input inputMode="decimal" value={form.cashAmount} onChange={(event) => setForm((prev) => ({ ...prev, cashAmount: event.target.value }))} placeholder={t('hr.hr_assets_page.s21', "مثال: 5000")} style={{ width: '100%', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                    {errors.cashAmount ? <small style={{ color: '#dc2626', fontSize: '0.75rem', marginTop: '2px', display: 'block' }}>{errors.cashAmount}</small> : null}
                  </div>
                ) : (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('hr.hr_assets_page.s22', "نوع العهدة")} <span style={{ color: '#dc2626' }}>*</span></label>
                    <CustomSelect
                      value={form.assetType}
                      onChange={(val) => setForm((prev) => ({ ...prev, assetType: val }))}
                      options={[
                        { value: '', label: t('hr.hr_assets_page.s23', "اختر النوع...") },
                        ...assetTypeOptions.map((opt) => ({ value: opt, label: opt })),
                      ]}
                    />
                    {errors.assetType ? <small style={{ color: '#dc2626', fontSize: '0.75rem', marginTop: '2px', display: 'block' }}>{errors.assetType}</small> : null}
                  </div>
                )}


                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{activeTab === 'cash' ? t('hr.hr_assets_page.s24', "الغرض / البيان *") : t('hr.hr_assets_page.s25', "اسم العهدة / الأصل *")}</label>
                  <input value={form.assetName} onChange={(event) => setForm((prev) => ({ ...prev, assetName: event.target.value }))} placeholder={activeTab === 'cash' ? t('hr.hr_assets_page.s26', "مثال: شراء مستلزمات للنشاط") : t('hr.hr_assets_page.s27', "اسم العهدة")} style={{ width: '100%', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                  {errors.assetName ? <small style={{ color: '#dc2626', fontSize: '0.75rem', marginTop: '2px', display: 'block' }}>{errors.assetName}</small> : null}
                </div>

                {activeTab === 'physical' ? (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('hr.hr_assets_page.s28', "الكود / السيريال")}</label>
                    <input value={form.assetCode} onChange={(event) => setForm((prev) => ({ ...prev, assetCode: event.target.value, serialNo: event.target.value }))} placeholder={t('hr.hr_assets_page.s29', "اختياري")} style={{ width: '100%', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                  </div>
                ) : null}

                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('hr.hr_assets_page.s30', "تاريخ التسليم")}</label>
                  <input type="date" value={form.assignedAt} onChange={(event) => setForm((prev) => ({ ...prev, assignedAt: event.target.value }))} style={{ width: '100%', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('hr.hr_assets_page.s31', "ملاحظات")}</label>
                  <input value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder={t('hr.hr_assets_page.s32', "أي ملاحظات إضافية...")} style={{ width: '100%', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                </div>
              </div>

              <div className="actions compact-actions" style={{ justifyContent: 'flex-start', gap: '8px' }}>
                <Button type="button" onClick={submitAsset} disabled={mutations.saveEmployeeAsset.isPending} style={{ padding: '6px 14px', fontSize: '0.85rem' }}>
                  {mutations.saveEmployeeAsset.isPending ? t('hr.hr_assets_page.s33', "جاري التسجيل...") : activeTab === 'cash' ? t('hr.hr_assets_page.s34', "تسليم عهدة نقدية") : t('hr.hr_assets_page.s35', "تسليم عهدة عينية")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setShowCreate(false)} style={{ padding: '6px 14px', fontSize: '0.85rem' }}>{t('hr.hr_assets_page.s36', "إلغاء")}</Button>
              </div>
              {mutations.saveEmployeeAsset.isError ? <p className="muted" style={{ margin: '8px 0 0', color: '#dc2626' }}>{getErrorMessage(mutations.saveEmployeeAsset.error)}</p> : null}
            </div>
          ) : null}

          {/* Compact Single-Row KPI Summary Bar */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.825rem', fontWeight: 800, color: '#0f172a' }}>{activeTab === 'cash' ? t('hr.hr_assets_page.s37', "ملخص العُهد النقدية") : t('hr.hr_assets_page.s38', "ملخص العُهد العينية")}</span>
              <span style={{ fontSize: '0.725rem', color: '#64748b' }}>{t('hr.hr_assets_page.s39', "اضغط على أي مؤشر لتصفية القائمة فوراً")}</span>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '8px' }}>
              {(activeTab === 'cash' ? [
                { label: t('hr.hr_assets_page.s40', "الإجمالي"), value: summary.total, onClick: () => setFilter('all'), isAlert: false, active: statusFilter === 'all' },
                { label: t('hr.hr_assets_page.s41', "مفتوحة"), value: summary.assigned, onClick: () => setFilter('assigned'), isAlert: false, active: statusFilter === 'assigned' },
                { label: t('hr.hr_assets_page.s42', "مقفولة / مسواة"), value: summary.returned, onClick: () => setFilter('returned'), isAlert: false, active: statusFilter === 'returned' },
                { label: t('hr.hr_assets_page.s43', "تحتاج مراجعة"), value: summary.needsReview, onClick: () => setFilter('needs_review'), isAlert: summary.needsReview > 0, active: statusFilter === 'needs_review' },
                { label: t('hr.hr_assets_page.s44', "إجمالي المبالغ"), value: money(summary.cashTotalAmount), onClick: () => {}, isAlert: false, active: false },
                { label: t('hr.hr_assets_page.s45', "مبالغ مفتوحة"), value: money(summary.cashOpenAmount), onClick: () => {}, isAlert: false, active: false },
                { label: t('hr.hr_assets_page.s46', "ظاهر حالياً"), value: summary.visible, onClick: () => {}, isAlert: false, active: false },
              ] : [
                { label: t('hr.hr_assets_page.s47', "الإجمالي"), value: summary.total, onClick: () => setFilter('all'), isAlert: false, active: statusFilter === 'all' },
                { label: t('hr.hr_assets_page.s48', "مسلّمة"), value: summary.assigned, onClick: () => setFilter('assigned'), isAlert: false, active: statusFilter === 'assigned' },
                { label: t('hr.hr_assets_page.s49', "مرتجعة"), value: summary.returned, onClick: () => setFilter('returned'), isAlert: false, active: statusFilter === 'returned' },
                { label: t('hr.hr_assets_page.s50', "تالفة"), value: summary.damaged, onClick: () => setFilter('damaged'), isAlert: summary.damaged > 0, active: statusFilter === 'damaged' },
                { label: t('hr.hr_assets_page.s51', "مفقودة"), value: summary.lost, onClick: () => setFilter('lost'), isAlert: summary.lost > 0, active: statusFilter === 'lost' },
                { label: t('hr.hr_assets_page.s52', "تحتاج مراجعة"), value: summary.needsReview, onClick: () => setFilter('needs_review'), isAlert: summary.needsReview > 0, active: statusFilter === 'needs_review' },
                { label: t('hr.hr_assets_page.s53', "ظاهر حالياً"), value: summary.visible, onClick: () => {}, isAlert: false, active: false },
              ]).map((stat, idx) => (
                <div
                  key={idx}
                  onClick={stat.onClick}
                  style={{
                    background: stat.active ? '#eff6ff' : '#ffffff',
                    border: `1px solid ${stat.active ? '#3b82f6' : stat.isAlert ? '#fca5a5' : '#e2e8f0'}`,
                    borderRadius: '6px',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    transition: 'all 0.15s ease',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                    minWidth: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#94a3b8'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = stat.active ? '#3b82f6' : stat.isAlert ? '#fca5a5' : '#e2e8f0'; }}
                >
                  <span style={{ fontSize: '0.725rem', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={stat.label}>
                    {stat.label}
                  </span>
                  <strong style={{ fontSize: '1.05rem', fontWeight: 800, color: stat.isAlert ? '#dc2626' : stat.active ? '#1d4ed8' : '#0f172a', lineHeight: 1.2 }}>
                    {stat.value}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          {/* Integrated Toolbar - Single Row */}
          <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '14px', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <input
              type="text"
              value={search}
              onChange={(value) => { setSearch(value.target.value); setPage(1); }}
              placeholder={activeTab === 'cash' ? t('hr.hr_assets_page.s54', "بحث بالموظف أو الغرض...") : t('hr.hr_assets_page.s55', "بحث بالموظف أو الكود...")}
              style={{ width: '190px', minWidth: '150px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.825rem', background: '#fff', boxSizing: 'border-box' }}
            />

            <div style={{ width: '150px' }}>
              <CustomSelect
                value={departmentFilter}
                onChange={(val) => { setDepartmentFilter(val); setPage(1); }}
                options={[
                  { value: 'all', label: t('hr.hr_assets_page.s56', "كل الأقسام") },
                  ...departmentOptions.map((option) => ({ value: option.value, label: option.label })),
                ]}
              />
            </div>


            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap', marginRight: 'auto' }}>
              {statusOptions.filter((option) => activeTab === 'physical' || !['damaged', 'lost'].includes(option.value)).map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={statusFilter === option.value ? 'primary' : 'secondary'}
                  onClick={() => setFilter(option.value)}
                  style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <QueryFeedback isLoading={assetsQuery.isLoading} isError={assetsQuery.isError} error={assetsQuery.error} isEmpty={!assets.length} loadingText={t('hr.hr_assets_page.s57', "جاري تحميل العُهد...")} errorTitle={t('hr.hr_assets_page.s58', "تعذر تحميل بيانات العُهد")} emptyTitle={statusFilter === 'needs_review' ? t('hr.hr_assets_page.s59', "لا توجد عُهد تحتاج مراجعة حاليًا.") : t('hr.hr_assets_page.s60', "لا توجد نتائج مطابقة للفلاتر الحالية.")} emptyHint={statusFilter === 'needs_review' ? t('hr.hr_assets_page.s61', "يمكنك عرض كل العُهد أو تسليم عهدة جديدة من أعلى الصفحة.") : t('hr.hr_assets_page.s62', "جرّب تغيير الفلتر أو البحث.")}>
            <DataTable
              rows={assets}
              rowKey={(row) => String(row.id)}
              density="compact"
              pagination={{ page, pageSize, totalItems, onPageChange: setPage, onPageSizeChange: (next) => { setPageSize(next); setPage(1); }, itemLabel: t('hr.hr_assets_page.s63', "عهدة") }}
              columns={activeTab === 'cash' ? [
                { key: 'employeeNo', header: t('hr.hr_assets_page.s64', "كود الموظف"), cell: (row) => fallbackText(row.employeeNo) },
                { key: 'employeeName', header: t('hr.hr_assets_page.s65', "اسم الموظف"), cell: (row) => fallbackText(row.employeeName) },
                { key: 'assetName', header: t('hr.hr_assets_page.s66', "الغرض / البيان"), cell: (row) => fallbackText(row.assetName) },
                { key: 'cashAmount', header: t('hr.hr_assets_page.s67', "المبلغ المسلم"), cell: (row) => money(cashAmount(row)) },
                { key: 'spentAmount', header: t('hr.hr_assets_page.s68', "المصروف"), cell: (row) => money(settlementParts(row).spentAmount) },
                { key: 'returnedAmount', header: t('hr.hr_assets_page.s69', "المرتجع"), cell: (row) => money(settlementParts(row).returnedAmount) },
                { key: 'difference', header: t('hr.hr_assets_page.s70', "فرق التسوية"), cell: (row) => money(Math.abs(cashDifference(row))) },
                { key: 'assignedAt', header: t('hr.hr_assets_page.s71', "تاريخ التسليم"), cell: (row) => fallbackText(row.assignedAt) },
                { key: 'returnedAt', header: t('hr.hr_assets_page.s72', "تاريخ التسوية"), cell: (row) => fallbackText(row.returnedAt) },
                { key: 'status', header: t('hr.hr_assets_page.s73', "الحالة"), cell: (row) => statusLabel(row.status, 'cash') },
                { key: 'notes', header: t('hr.hr_assets_page.s74', "ملاحظات"), cell: (row) => fallbackText(row.returnNotes || row.notes) },
                { key: 'actions', header: t('hr.hr_assets_page.s75', "إجراء"), cell: (row) => renderActions(row) },
              ] : [
                { key: 'employeeNo', header: t('hr.hr_assets_page.s76', "كود الموظف"), cell: (row) => fallbackText(row.employeeNo) },
                { key: 'employeeName', header: t('hr.hr_assets_page.s77', "اسم الموظف"), cell: (row) => fallbackText(row.employeeName) },
                { key: 'departmentName', header: t('hr.hr_assets_page.s78', "القسم"), cell: (row) => fallbackText(row.departmentName || employeesMap.get(String(row.employeeId))?.departmentName) },
                { key: 'assetType', header: t('hr.hr_assets_page.s79', "نوع العهدة"), cell: (row) => fallbackText(row.assetType) },
                { key: 'assetName', header: t('hr.hr_assets_page.s80', "اسم العهدة / الأصل"), cell: (row) => fallbackText(row.assetName) },
                { key: 'assetCode', header: t('hr.hr_assets_page.s81', "الكود / السيريال"), cell: (row) => fallbackText(row.assetCode || row.serialNo) },
                { key: 'assignedAt', header: t('hr.hr_assets_page.s82', "تاريخ التسليم"), cell: (row) => fallbackText(row.assignedAt) },
                { key: 'returnedAt', header: t('hr.hr_assets_page.s83', "تاريخ الاسترجاع"), cell: (row) => fallbackText(row.returnedAt) },
                { key: 'status', header: t('hr.hr_assets_page.s84', "الحالة"), cell: (row) => statusLabel(row.status, 'physical') },
                { key: 'notes', header: t('hr.hr_assets_page.s85', "ملاحظات"), cell: (row) => fallbackText(row.notes || row.returnNotes) },
                { key: 'actions', header: t('hr.hr_assets_page.s86', "إجراء"), cell: (row) => renderActions(row) },
              ]}
            />

            {selectedSettlementRow ? (
              <div style={{ marginTop: '16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <strong style={{ display: 'block', marginBottom: '10px', fontSize: '0.95rem' }}>{t('hr.hr_assets_page.s87', "تسوية عهدة نقدية:")} {fallbackText(selectedSettlementRow.assetName)}</strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <label className="field"><span>{t('hr.hr_assets_page.s88', "المبلغ المسلم")}</span><input value={money(cashAmount(selectedSettlementRow))} disabled style={{ padding: '6px 10px', background: '#e2e8f0' }} /></label>
                  <label className="field"><span>{t('hr.hr_assets_page.s89', "المبلغ المصروف")}</span><input inputMode="decimal" value={settlementDraft.spentAmount} onChange={(event) => setSettlementDraft((prev) => ({ ...prev, spentAmount: event.target.value }))} style={{ padding: '6px 10px' }} /></label>
                  <label className="field"><span>{t('hr.hr_assets_page.s90', "المبلغ المرتجع")}</span><input inputMode="decimal" value={settlementDraft.returnedAmount} onChange={(event) => setSettlementDraft((prev) => ({ ...prev, returnedAmount: event.target.value }))} style={{ padding: '6px 10px' }} /></label>
                  <label className="field" style={{ gridColumn: 'span 2' }}><span>{t('hr.hr_assets_page.s91', "ملاحظات التسوية / الفواتير")}</span><input value={settlementDraft.notes} onChange={(event) => setSettlementDraft((prev) => ({ ...prev, notes: event.target.value }))} placeholder={t('hr.hr_assets_page.s92', "مثال: فواتير شراء مستلزمات + رد الباقي")} style={{ padding: '6px 10px' }} /></label>
                </div>
                {settlementError ? <div style={{ color: '#dc2626', marginTop: '8px', fontSize: '0.85rem' }}>{settlementError}</div> : null}
                <div className="actions compact-actions" style={{ marginTop: '12px' }}>
                  <Button type="button" onClick={submitSettlement} disabled={mutations.returnEmployeeAsset.isPending} style={{ padding: '6px 14px', fontSize: '0.85rem' }}>{mutations.returnEmployeeAsset.isPending ? t('hr.hr_assets_page.s93', "جاري التسوية...") : t('hr.hr_assets_page.s94', "تسجيل التسوية")}</Button>
                  <Button type="button" variant="secondary" onClick={() => { setSettlementId(''); setSettlementError(''); }} style={{ padding: '6px 14px', fontSize: '0.85rem' }}>{t('hr.hr_assets_page.s95', "إلغاء")}</Button>
                </div>
              </div>
            ) : null}
          </QueryFeedback>
        </div>
      </main>
    </div>
  );
}
