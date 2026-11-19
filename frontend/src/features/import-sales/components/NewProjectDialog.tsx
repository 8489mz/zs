import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { DollarSignIcon, PlusCircleIcon, RefreshCwIcon, Trash2Icon, TruckIcon, UsersIcon } from '@/shared/components/icons/AppIcons';

export interface PartnerRow {
  id: string;
  partnerId: string;
  name: string;
  capitalShare: number;
  profitPercentage: number;
  isSelected: boolean;
}

export interface NewProjectDialogProps {
  isNewProjectOpen: boolean;
  setIsNewProjectOpen: Dispatch<SetStateAction<boolean>>;
  handleCreateProject: (e: FormEvent) => void;
  handleGenerateSuggestedTitle: () => void;
  projectTitle: string;
  setProjectTitle: Dispatch<SetStateAction<string>>;
  targetSector: string;
  setTargetSector: Dispatch<SetStateAction<string>>;
  setPickerSector: Dispatch<SetStateAction<string>>;
  availableSectors: any[];
  sectorPreset: string;
  setSectorPreset: Dispatch<SetStateAction<string>>;
  sectorPresets: any[];
  containerType: string;
  setContainerType: Dispatch<SetStateAction<string>>;
  containerCount: number;
  setContainerCount: Dispatch<SetStateAction<number>>;
  portOfDischarge: string;
  setPortOfDischarge: Dispatch<SetStateAction<string>>;
  incoterms: string;
  setIncoterms: Dispatch<SetStateAction<string>>;
  countryOrigin: string;
  setCountryOrigin: Dispatch<SetStateAction<string>>;
  targetMarket: string;
  setTargetMarket: Dispatch<SetStateAction<string>>;
  budgetCurrency: 'EGP' | 'USD';
  setBudgetCurrency: Dispatch<SetStateAction<'EGP' | 'USD'>>;
  allocatedCapital: number;
  setAllocatedCapital: Dispatch<SetStateAction<number>>;
  commRate: number;
  targetRoi: number;
  setTargetRoi: Dispatch<SetStateAction<number>>;
  selectedPartners: PartnerRow[];
  setSelectedPartners: Dispatch<SetStateAction<PartnerRow[]>>;
  handleAddPartner: () => void;
  handleDistributeEqualPercentages: () => void;
  handleDistributeByCapital: () => void;
  handleRemovePartner: (idx: number) => void;
  partnersData: any[];
  projectNotes: string;
  setProjectNotes: Dispatch<SetStateAction<string>>;
  createProjectMutation: { isPending: boolean };
}

export function NewProjectDialog(props: NewProjectDialogProps) {
  const {
    isNewProjectOpen,
    setIsNewProjectOpen,
    handleCreateProject,
    handleGenerateSuggestedTitle,
    projectTitle,
    setProjectTitle,
    targetSector,
    setTargetSector,
    setPickerSector,
    availableSectors,
    sectorPreset,
    setSectorPreset,
    sectorPresets,
    containerType,
    setContainerType,
    containerCount,
    setContainerCount,
    portOfDischarge,
    setPortOfDischarge,
    incoterms,
    setIncoterms,
    countryOrigin,
    setCountryOrigin,
    targetMarket,
    setTargetMarket,
    budgetCurrency,
    setBudgetCurrency,
    allocatedCapital,
    setAllocatedCapital,
    commRate,
    targetRoi,
    setTargetRoi,
    selectedPartners,
    setSelectedPartners,
    handleAddPartner,
    handleDistributeEqualPercentages,
    handleDistributeByCapital,
    handleRemovePartner,
    partnersData,
    projectNotes,
    setProjectNotes,
    createProjectMutation,
  } = props;

  return (
    <StandardDialog
      open={isNewProjectOpen}
      onClose={() => setIsNewProjectOpen(false)}
      title="إنشاء مشروع استيراد جديد (New Import Project)"
      subtitle="تسجيل تفاصيل المشروع، الميزانية، مواصفات الحاوية والميناء، وتوزيع نسب الشركاء"
      width="min(880px, 96vw)"
      compact
    >
      <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Section 1: Basic Project Info & Sector */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1.2fr)', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                اسم المشروع والصفقة المستهدفة *
              </label>
              <button
                type="button"
                onClick={handleGenerateSuggestedTitle}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#170e5e',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}
                title="توليد اسم مقترح للصفقة تلقائياً بناءً على مواصفات الحاوية والقطاع"
              >
                <RefreshCwIcon size={11} />
                <span>توليد اسم مقترح</span>
              </button>
            </div>
            <input
              type="text"
              required
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder="أدخل اسم المشروع أو الصفقة (مثال: استيراد حاوية قطع غيار نقل ثقيل - كوانزو 2026)"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              القطاع التجاري المستهدف
            </label>
            <select
              value={targetSector}
              onChange={(e) => {
                setTargetSector(e.target.value);
                setPickerSector(e.target.value);
              }}
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px', backgroundColor: '#ffffff' }}
            >
              {availableSectors.map((sec: any) => (
                <option key={sec.id} value={sec.id}>
                  {sec.name_ar}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              قالب القطاع لأصناف الاستيراد
            </label>
            <select
              value={sectorPreset}
              onChange={(e) => setSectorPreset(e.target.value)}
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px', backgroundColor: '#ffffff' }}
            >
              <option value="">عام — بدون قالب (بدون فئة أو باركود أو هامش تلقائي)</option>
              {sectorPresets.map((preset: any) => (
                <option key={preset.key} value={preset.key}>
                  {preset.nameAr}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Section 2: Logistics & Container Specifications */}
        <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#170e5e', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <TruckIcon size={14} />
            <span>مواصفات الشحن البحري وميناء الوصول والتعاقد</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
                نوع وحجم الحاوية
              </label>
              <select
                value={containerType}
                onChange={(e) => setContainerType(e.target.value)}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px', backgroundColor: '#ffffff' }}
              >
                <option value="40FT">40 قدم عادية (24 طن / 60 CBM - الأنسب للنقل)</option>
                <option value="40HC">40 قدم مرتفعة (High Cube - 70 CBM)</option>
                <option value="20FT">20 قدم قياسية (21 طن / 28 CBM)</option>
                <option value="LCL">شحنة جزئية مجزأة (LCL)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
                عدد الحاويات التقديري
              </label>
              <input
                type="number"
                min={1}
                value={containerCount}
                onChange={(e) => setContainerCount(Math.max(1, Number(e.target.value)))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
                ميناء الوصول المصري
              </label>
              <select
                value={portOfDischarge}
                onChange={(e) => setPortOfDischarge(e.target.value)}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px', backgroundColor: '#ffffff' }}
              >
                <option value="العين السخنة">العين السخنة (Sokhna Port)</option>
                <option value="الإسكندرية والدخيلة">الإسكندرية والدخيلة (Alexandria)</option>
                <option value="شرق بورسعيد">شرق بورسعيد (Port Said)</option>
                <option value="دمياط">دمياط (Damietta)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
                شرط التعاقد (Incoterms)
              </label>
              <select
                value={incoterms}
                onChange={(e) => setIncoterms(e.target.value)}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px', backgroundColor: '#ffffff' }}
              >
                <option value="FOB">FOB (استلام ظهر السفينة بالصين)</option>
                <option value="CIF">CIF (شامل النولون والتأمين)</option>
                <option value="EXW">EXW (أرض المصنع بالصين)</option>
                <option value="CFR">CFR (شامل النولون فقط)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 2 }}>
                بلد ومنشأ الشراء
              </label>
              <input
                type="text"
                value={countryOrigin}
                onChange={(e) => setCountryOrigin(e.target.value)}
                style={{ width: '100%', height: 32, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '11.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 2 }}>
                سوق الوصول والتوزيع
              </label>
              <input
                type="text"
                value={targetMarket}
                onChange={(e) => setTargetMarket(e.target.value)}
                style={{ width: '100%', height: 32, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '11.5px' }}
              />
            </div>
          </div>
        </div>

        {/* Section 3: Capital, Currency Converter & Target ROI */}
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
              <DollarSignIcon size={14} color="#15803d" />
              <span>رأس المال المرصود ومحول العملة اللحظي</span>
            </div>
            {/* Currency Capsule Selector */}
            <div style={{ display: 'flex', backgroundColor: '#f1f5f9', padding: '2px', borderRadius: 6 }}>
              <button
                type="button"
                onClick={() => {
                  if (budgetCurrency !== 'EGP') {
                    setBudgetCurrency('EGP');
                    setAllocatedCapital(Math.round(allocatedCapital * (commRate || 50)));
                  }
                }}
                style={{
                  padding: '3px 12px',
                  border: 'none',
                  borderRadius: 5,
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  backgroundColor: budgetCurrency === 'EGP' ? '#170e5e' : 'transparent',
                  color: budgetCurrency === 'EGP' ? '#ffffff' : '#64748b',
                }}
              >
                جنيه مصري (EGP)
              </button>
              <button
                type="button"
                onClick={() => {
                  if (budgetCurrency !== 'USD') {
                    setBudgetCurrency('USD');
                    setAllocatedCapital(Math.round(allocatedCapital / (commRate || 50)));
                  }
                }}
                style={{
                  padding: '3px 12px',
                  border: 'none',
                  borderRadius: 5,
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  backgroundColor: budgetCurrency === 'USD' ? '#170e5e' : 'transparent',
                  color: budgetCurrency === 'USD' ? '#ffffff' : '#64748b',
                }}
              >
                دولار أمريكي (USD)
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 3 }}>
                مبلغ رأس المال المرصود ({budgetCurrency === 'EGP' ? 'جنيه مصري' : 'دولار أمريكي'})
              </label>
              <input
                type="number"
                value={allocatedCapital}
                onChange={(e) => setAllocatedCapital(Number(e.target.value))}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '13px', fontWeight: 700 }}
              />
              <div style={{ marginTop: 4, fontSize: '11px', color: '#0369a1', fontWeight: 600 }}>
                {budgetCurrency === 'EGP' ? (
                  <span>
                    ما يعادل: <strong>${Math.round(allocatedCapital / (commRate || 50)).toLocaleString()} دولار أمريكي</strong> تقريباً (بسعر صرف تجاري {commRate || 50} ج.م/$)
                  </span>
                ) : (
                  <span>
                    ما يعادل: <strong>{(allocatedCapital * (commRate || 50)).toLocaleString()} جنيه مصري</strong> تقريباً (بسعر صرف تجاري {commRate || 50} ج.م/$)
                  </span>
                )}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 3 }}>
                العائد المستهدف على الاستثمار ROI (%)
              </label>
              <input
                type="number"
                value={targetRoi}
                onChange={(e) => setTargetRoi(Number(e.target.value))}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '13px', fontWeight: 700 }}
              />
              <div style={{ marginTop: 4, fontSize: '11px', color: '#15803d', fontWeight: 600 }}>
                صافي الربح المستهدف: {budgetCurrency === 'EGP'
                  ? `${Math.round(allocatedCapital * (targetRoi / 100)).toLocaleString()} ج.م`
                  : `$${Math.round(allocatedCapital * (targetRoi / 100)).toLocaleString()}`}
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Partners & Equity Allocation (Dynamic & Non-hardcoded) */}
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
              <UsersIcon size={14} color="#170e5e" />
              <span>هيكل الشركاء وتوزيع نسب الأرباح وحصص رأس المال</span>
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                ({selectedPartners.filter((p) => p.isSelected).length} شركاء نشطين)
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={handleAddPartner}
                style={{
                  padding: '3px 8px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 5,
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#15803d',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                title="إضافة شريك جديد لهيكل الصفقة"
              >
                <PlusCircleIcon size={12} />
                <span>إضافة شريك</span>
              </button>
              <button
                type="button"
                onClick={handleDistributeEqualPercentages}
                title="توزيع نسب الأرباح وحصص رأس المال بالتساوي على الشركاء النشطين"
                style={{
                  padding: '3px 8px',
                  backgroundColor: '#eef2ff',
                  border: '1px solid #c7d2fe',
                  borderRadius: 5,
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#3730a3',
                  cursor: 'pointer',
                }}
              >
                توزيع بالتساوي
              </button>
              <button
                type="button"
                onClick={handleDistributeByCapital}
                title="احتساب نسب الأرباح تلقائياً وفقاً لنسبة رأس مال كل شريك"
                style={{
                  padding: '3px 8px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: 5,
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                توزيع حسب رأس المال
              </button>
            </div>
          </div>

          {/* Datalist for registered partners autocompletion */}
          <datalist id="registered-partners-list">
            {partnersData.map((p: any) => (
              <option key={p.id} value={p.name}>
                {p.name} (مسجل - نسبة معتمدة: {p.profit_share_percentage}%)
              </option>
            ))}
          </datalist>

          {/* Column Headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '24px minmax(0, 1.8fr) minmax(0, 1.2fr) minmax(0, 0.7fr) 30px',
              gap: 8,
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 700,
              color: '#64748b',
              borderBottom: '1px solid #f1f5f9',
              marginBottom: 4,
            }}
          >
            <span title="تفعيل / استبعاد">نشط</span>
            <span>اسم الشريك / صفته ودوره في الصفقة</span>
            <span>حصة رأس المال ({budgetCurrency})</span>
            <span style={{ textAlign: 'center' }}>نسبة الربح %</span>
            <span style={{ textAlign: 'center' }}>حذف</span>
          </div>

          {/* Partner Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '220px', overflowY: 'auto' }}>
            {selectedPartners.map((partner, idx) => (
              <div
                key={partner.id || idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px minmax(0, 1.8fr) minmax(0, 1.2fr) minmax(0, 0.7fr) 30px',
                  gap: 8,
                  alignItems: 'center',
                  backgroundColor: partner.isSelected ? '#f8fafc' : '#ffffff',
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: '1px solid #e2e8f0',
                  opacity: partner.isSelected ? 1 : 0.6,
                }}
              >
                <input
                  type="checkbox"
                  checked={partner.isSelected}
                  title={partner.isSelected ? 'شريك نشط' : 'شريك مستبعد من هذه الصفقة'}
                  onChange={(e) => {
                    const updated = [...selectedPartners];
                    updated[idx].isSelected = e.target.checked;
                    setSelectedPartners(updated);
                  }}
                  style={{ cursor: 'pointer', width: 15, height: 15 }}
                />

                {/* Editable Partner Name Input with Datalist Autocomplete */}
                <div>
                  <input
                    type="text"
                    list="registered-partners-list"
                    placeholder={`اسم الشريك أو دوره (مثال: شريك ${idx + 1})`}
                    value={partner.name}
                    onChange={(e) => {
                      const val = e.target.value;
                      const matching = partnersData.find((p: any) => p.name === val);
                      const updated = [...selectedPartners];
                      updated[idx].name = val;
                      if (matching) {
                        updated[idx].partnerId = matching.id;
                        if (matching.capital_amount) updated[idx].capitalShare = Number(matching.capital_amount);
                        if (matching.profit_share_percentage) updated[idx].profitPercentage = Number(matching.profit_share_percentage);
                      } else {
                        updated[idx].partnerId = '';
                      }
                      setSelectedPartners(updated);
                    }}
                    style={{
                      width: '100%',
                      height: 30,
                      padding: '2px 8px',
                      border: '1px solid #cbd5e1',
                      borderRadius: 4,
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: '#0f172a',
                    }}
                  />
                </div>

                {/* Capital Share Input */}
                <div>
                  <input
                    type="number"
                    placeholder={`حصة رأس المال (${budgetCurrency})`}
                    value={partner.capitalShare || ''}
                    onChange={(e) => {
                      const updated = [...selectedPartners];
                      updated[idx].capitalShare = Number(e.target.value);
                      setSelectedPartners(updated);
                    }}
                    style={{
                      width: '100%',
                      height: 30,
                      padding: '2px 8px',
                      border: '1px solid #cbd5e1',
                      borderRadius: 4,
                      fontSize: '11.5px',
                    }}
                  />
                </div>

                {/* Profit Percentage Input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="%"
                    value={partner.profitPercentage || ''}
                    onChange={(e) => {
                      const updated = [...selectedPartners];
                      updated[idx].profitPercentage = Number(e.target.value);
                      setSelectedPartners(updated);
                    }}
                    style={{
                      width: '100%',
                      height: 30,
                      padding: '2px 4px',
                      border: '1px solid #cbd5e1',
                      borderRadius: 4,
                      fontSize: '11.5px',
                      fontWeight: 700,
                      textAlign: 'center',
                    }}
                  />
                  <span style={{ fontSize: '11px', color: '#64748b' }}>%</span>
                </div>

                {/* Delete Partner Button */}
                <button
                  type="button"
                  onClick={() => handleRemovePartner(idx)}
                  title="حذف هذا الشريك من الصفقة"
                  disabled={selectedPartners.length <= 1}
                  style={{
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #fecdd3',
                    borderRadius: 4,
                    backgroundColor: '#fff1f2',
                    color: '#e11d48',
                    cursor: selectedPartners.length <= 1 ? 'not-allowed' : 'pointer',
                    opacity: selectedPartners.length <= 1 ? 0.35 : 1,
                    padding: 0,
                  }}
                >
                  <Trash2Icon size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* Total Balance Status Bar */}
          {(() => {
            const active = selectedPartners.filter((p) => p.isSelected);
            const totalCap = active.reduce((sum, p) => sum + Number(p.capitalShare || 0), 0);
            const totalPct = active.reduce((sum, p) => sum + Number(p.profitPercentage || 0), 0);
            const isPctBalanced = Math.abs(totalPct - 100) < 0.5;
            const isCapBalanced = totalCap === allocatedCapital;

            return (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 8,
                  padding: '6px 10px',
                  borderRadius: 6,
                  backgroundColor: '#f1f5f9',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: '11px', color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>مجموع حصص رأس المال:</span>
                  <strong style={{ color: isCapBalanced ? '#15803d' : '#b45309' }}>
                    {totalCap.toLocaleString()} {budgetCurrency}
                  </strong>
                  <span style={{ fontSize: '10px', color: '#64748b' }}>
                    (من المرصود: {allocatedCapital.toLocaleString()} {budgetCurrency})
                  </span>
                </div>
                <div style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: '#475569' }}>إجمالي نسب الأرباح:</span>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 800,
                      color: isPctBalanced ? '#15803d' : '#b45309',
                    }}
                  >
                    {totalPct.toFixed(1)}% {isPctBalanced ? '(متزن تماماً)' : '(غير متزن)'}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Section 5: Project Notes */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
            ملاحظات وشروط المشروع الإضافية
          </label>
          <textarea
            rows={2}
            value={projectNotes}
            onChange={(e) => setProjectNotes(e.target.value)}
            placeholder="مثال: شروط فحص GOEIC، مهلة سماح أرضيات الحاويات (Free Demurrage 14 يوم)، مواعيد الدفع للمصنع..."
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
          />
        </div>

        {/* Actions Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
          <button
            type="button"
            onClick={() => setIsNewProjectOpen(false)}
            style={{ padding: '8px 18px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={createProjectMutation.isPending}
            style={{ padding: '8px 24px', backgroundColor: '#170e5e', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#ffffff', cursor: 'pointer' }}
          >
            {createProjectMutation.isPending ? 'جاري الحفظ...' : 'إنشاء المشروع واعتماد الشركاء'}
          </button>
        </div>
      </form>
    </StandardDialog>
  );
}
