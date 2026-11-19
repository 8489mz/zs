import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Field } from '@/shared/ui/field';
import { AppIcons, XIcon } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';

const COUNTRY_OPTIONS = [
  { code: 'all', name: 'كافة الدول والمناطق' },
  { code: 'CN', name: 'الصين وشرق آسيا' },
  { code: 'DE', name: 'ألمانيا وأوروبا' },
  { code: 'FR', name: 'فرنسا وأوروبا' },
  { code: 'TR', name: 'تركيا والمتوسط' },
  { code: 'AE', name: 'الإمارات والخليج العربي' },
  { code: 'US', name: 'الولايات المتحدة الأمريكية' },
  { code: 'IN', name: 'الهند وشبه القارة الهندية' },
  { code: 'JP', name: 'اليابان وآسيا' },
  { code: 'SG', name: 'سنغافورة والآسيان' },
];

interface MasterDataFilterBarsProps {
  subTab: 'lines' | 'airlines' | 'agents' | 'ports' | 'airports' | 'standards';
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  selectedLane: string;
  setSelectedLane: Dispatch<SetStateAction<string>>;
  selectedCountry: string;
  setSelectedCountry: Dispatch<SetStateAction<string>>;
  showAddPortForm: boolean;
  newPortCode: string;
  setNewPortCode: Dispatch<SetStateAction<string>>;
  newPortNameAr: string;
  setNewPortNameAr: Dispatch<SetStateAction<string>>;
  newPortNameEn: string;
  setNewPortNameEn: Dispatch<SetStateAction<string>>;
  newPortCountryName: string;
  setNewPortCountryName: Dispatch<SetStateAction<string>>;
  isAddingPort: boolean;
  handleAddPort: () => Promise<void>;
}

export function MasterDataFilterBars({
  subTab,
  searchQuery,
  setSearchQuery,
  selectedLane,
  setSelectedLane,
  selectedCountry,
  setSelectedCountry,
  showAddPortForm,
  newPortCode,
  setNewPortCode,
  newPortNameAr,
  setNewPortNameAr,
  newPortNameEn,
  setNewPortNameEn,
  newPortCountryName,
  setNewPortCountryName,
  isAddingPort,
  handleAddPort,
}: MasterDataFilterBarsProps) {
  const { t: __t } = useTranslation();
  return (
    <>
        {/* 3. شريط البحث والتصفية المتجاوب بدون تمدد خارجي */}
        {subTab === 'lines' && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e2e8f0',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              minHeight: '58px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
              <input
                type="text"
                role="searchbox"
                name="search_maritime_lines"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={__t('maritime_freight.maritime_master_data_tab.s22', "بحث في الخطوط الملاحية والتوكيلات...")}
                style={{
                  width: '100%',
                  height: '34px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: searchQuery ? '0 32px 0 28px' : '0 32px 0 10px',
                  fontSize: '0.8125rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ position: 'absolute', right: '10px', top: '9px', color: '#94a3b8', pointerEvents: 'none' }}>
                <AppIcons.Search size={15} />
              </div>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title={__t('maritime_freight.maritime_master_data_tab.s23', "مسح البحث")}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px',
                    borderRadius: '50%',
                  }}
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s24', "المسار:")}</span>
              {[
                { id: 'all', label: __t('maritime_freight.maritime_master_data_tab.s25', "الكل") },
                { id: 'far_east', label: __t('maritime_freight.maritime_master_data_tab.s26', "الصين والشرق الأقصى") },
                { id: 'europe_med', label: __t('maritime_freight.maritime_master_data_tab.s27', "أوروبا والمتوسط") },
                { id: 'arabian_gulf', label: __t('maritime_freight.maritime_master_data_tab.s28', "الخليج والبحر الأحمر") },
                { id: 'americas', label: __t('maritime_freight.maritime_master_data_tab.s29', "الأمريكتين") },
              ].map((lane) => (
                <button
                  key={lane.id}
                  type="button"
                  onClick={() => setSelectedLane(lane.id)}
                  style={{
                    height: '28px',
                    padding: '0 10px',
                    borderRadius: '6px',
                    border: selectedLane === lane.id ? '1px solid #170e5e' : '1px solid #e2e8f0',
                    background: selectedLane === lane.id ? '#170e5e' : '#f8fafc',
                    color: selectedLane === lane.id ? '#ffffff' : '#475569',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {lane.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {subTab === 'airlines' && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e2e8f0',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              minHeight: '58px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
              <input
                type="text"
                role="searchbox"
                name="search_maritime_airlines"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={__t('maritime_freight.maritime_master_data_tab.s30', "بحث في شركات الشحن الجوي والبادئات...")}
                style={{
                  width: '100%',
                  height: '34px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: searchQuery ? '0 32px 0 28px' : '0 32px 0 10px',
                  fontSize: '0.8125rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ position: 'absolute', right: '10px', top: '9px', color: '#94a3b8', pointerEvents: 'none' }}>
                <AppIcons.Search size={15} />
              </div>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title={__t('maritime_freight.maritime_master_data_tab.s31', "مسح البحث")}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px',
                    borderRadius: '50%',
                  }}
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {subTab === 'agents' && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e2e8f0',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              minHeight: '58px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
              <input
                type="text"
                role="searchbox"
                name="search_maritime_agents"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={__t('maritime_freight.maritime_master_data_tab.s32', "بحث باسم الوكيل، الدولة، أو الكود...")}
                style={{
                  width: '100%',
                  height: '34px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: searchQuery ? '0 32px 0 28px' : '0 32px 0 10px',
                  fontSize: '0.8125rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ position: 'absolute', right: '10px', top: '9px', color: '#94a3b8', pointerEvents: 'none' }}>
                <AppIcons.Search size={15} />
              </div>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title={__t('maritime_freight.maritime_master_data_tab.s33', "مسح البحث")}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px',
                    borderRadius: '50%',
                  }}
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s34', "دولة ومقر الوكيل:")}</span>
              <div style={{ minWidth: '200px' }}>
                <CustomSelect
                  value={selectedCountry}
                  onChange={(val) => setSelectedCountry(val || 'all')}
                  options={COUNTRY_OPTIONS.map((c) => ({ value: c.code, label: c.name }))}
                />
              </div>
            </div>
          </div>
        )}

        {(subTab === 'ports' || subTab === 'airports') && (
          <>
            {showAddPortForm && (
              <div
                style={{
                  padding: '16px 20px',
                  background: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                <h4 style={{ margin: '0 0 12px', fontSize: '0.88rem', fontWeight: 700, color: '#170e5e' }}>
                  {subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s35', "بيانات مطار الشحن الدولي الجديد (Cargo Airport)") : __t('maritime_freight.maritime_master_data_tab.s36', "بيانات الميناء الجديد (UN/LOCODE Seaport)")}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', alignItems: 'flex-end' }}>
                  <Field label={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s37', "كود IATA (3 حروف) *") : __t('maritime_freight.maritime_master_data_tab.s38', "كود الميناء (UN/LOCODE) *")}>
                    <input
                      type="text"
                      value={newPortCode}
                      onChange={(e) => setNewPortCode(e.target.value.toUpperCase())}
                      placeholder={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s39', "مثال: CAI, DXB") : __t('maritime_freight.maritime_master_data_tab.s40', "مثال: EGALY, CNSHA")}
                      style={{ width: '100%', height: '34px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '0.8125rem' }}
                    />
                  </Field>
                  <Field label={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s41', "اسم المطار بالعربية *") : __t('maritime_freight.maritime_master_data_tab.s42', "اسم الميناء بالعربية *")}>
                    <input
                      type="text"
                      value={newPortNameAr}
                      onChange={(e) => setNewPortNameAr(e.target.value)}
                      placeholder={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s43', "مطار القاهرة للشحن") : __t('maritime_freight.maritime_master_data_tab.s44', "ميناء الإسكندرية")}
                      style={{ width: '100%', height: '34px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '0.8125rem' }}
                    />
                  </Field>
                  <Field label={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s45', "اسم المطار بالإنجليزية") : __t('maritime_freight.maritime_master_data_tab.s46', "اسم الميناء بالإنجليزية")}>
                    <input
                      type="text"
                      value={newPortNameEn}
                      onChange={(e) => setNewPortNameEn(e.target.value)}
                      placeholder={subTab === 'airports' ? 'Cairo Cargo Airport' : 'Alexandria Port'}
                      style={{ width: '100%', height: '34px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '0.8125rem' }}
                    />
                  </Field>
                  <Field label={__t('maritime_freight.maritime_master_data_tab.s47', "الدولة")}>
                    <input
                      type="text"
                      value={newPortCountryName}
                      onChange={(e) => setNewPortCountryName(e.target.value)}
                      placeholder={__t('maritime_freight.maritime_master_data_tab.s48', "مصر، الإمارات...")}
                      style={{ width: '100%', height: '34px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '0.8125rem' }}
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={handleAddPort}
                    disabled={isAddingPort}
                    style={{
                      height: '34px',
                      padding: '0 16px',
                      background: '#170e5e',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 700,
                      fontSize: '0.8125rem',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s49', "حفظ المطار") : __t('maritime_freight.maritime_master_data_tab.s50', "حفظ الميناء")}
                  </button>
                </div>
              </div>
            )}

            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#ffffff', minHeight: '58px', boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
                <input
                  type="text"
                  role="searchbox"
                  name="search_maritime_ports"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-form-type="other"
                  data-lpignore="true"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s51', "بحث في مطارات الشحن بالكود أو الاسم...") : __t('maritime_freight.maritime_master_data_tab.s52', "بحث في الموانئ بالكود أو الاسم...")}
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: searchQuery ? '0 32px 0 28px' : '0 32px 0 10px',
                    fontSize: '0.8125rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ position: 'absolute', right: '10px', top: '9px', color: '#94a3b8', pointerEvents: 'none' }}>
                  <AppIcons.Search size={15} />
                </div>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title={__t('maritime_freight.maritime_master_data_tab.s53', "مسح البحث")}
                    style={{
                      position: 'absolute',
                      left: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '2px',
                      borderRadius: '50%',
                    }}
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
    </>
  );
}
