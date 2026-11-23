import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { RequiredField, comboListStyle, comboRowStyle, comboCreateStyle } from '@/features/settings/components/forms/settings-forms.shared';
import { CustomSelect } from '@/shared/ui/custom-select';
import type { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { Branch, Location } from '@/types/domain';

export interface GeneralSettingsBranchStockProps {
  isContractingVertical: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  isMaritimeVertical: boolean;
  branchFieldLabel: string;
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  selectedBranch?: Branch;
  branchQuery: string;
  branchMenuOpen: boolean;
  disabled: boolean;
  setBranchMenuOpen: (val: boolean) => void;
  setBranchQuery: (val: string) => void;
  branchMenuHasContent: boolean;
  filteredBranches: Branch[];
  commitSelectedBranch: (branchId: string, branchName?: string) => void;
  branchCreateOptionVisible: boolean;
  setBranchPrefillName: (val: string) => void;
  setShowBranchQuickAdd: (val: boolean) => void;
  isNonPosVertical: boolean;
  locationFieldLabel: string;
  visibleLocations: Location[];
  onUpdateBranch?: (id: any, data: any) => Promise<any>;
  stockMode: 'single_location' | 'all_operational_locations';
  canManageSettings: boolean;
  branchStockSaving: boolean;
  setStockMode: (val: 'single_location' | 'all_operational_locations') => void;
  setBranchStockDirty: (val: boolean) => void;
  setBranchStockSaved: (val: boolean) => void;
  defaultStockLocationId: string;
  setDefaultStockLocationId: (val: string) => void;
  locations: Location[];
  allowExternalSalesStock: boolean;
  setAllowExternalSalesStock: (val: boolean) => void;
  branchStockDirty: boolean;
  setBranchStockSaving: (val: boolean) => void;
  setBranchStockError: (val: string | null) => void;
  branchStockSaved: boolean;
  branchStockError: string | null;
}

export function GeneralSettingsBranchStock({ isContractingVertical, t, isMaritimeVertical, branchFieldLabel, form, selectedBranch, branchQuery, branchMenuOpen, disabled, setBranchMenuOpen, setBranchQuery, branchMenuHasContent, filteredBranches, commitSelectedBranch, branchCreateOptionVisible, setBranchPrefillName, setShowBranchQuickAdd, isNonPosVertical, locationFieldLabel, visibleLocations, onUpdateBranch, stockMode, canManageSettings, branchStockSaving, setStockMode, setBranchStockDirty, setBranchStockSaved, defaultStockLocationId, setDefaultStockLocationId, locations, allowExternalSalesStock, setAllowExternalSalesStock, branchStockDirty, setBranchStockSaving, setBranchStockError, branchStockSaved, branchStockError }: GeneralSettingsBranchStockProps) {
  return (
    <>
    {/* Card 2: إعدادات التشغيل والفرع والمخزون (Store Operations & Stock) */}
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
        <div>
          <strong style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 800, display: 'block' }}>
            {isContractingVertical ? t('settings.forms.tabs.general_settings_tab.s15', "المقر الإداري ومواقع العمل") : isMaritimeVertical ? t('settings.forms.tabs.general_settings_tab.s16', "المكتب والمقر الملاحي الرئيسي") : t('settings.forms.tabs.general_settings_tab.s17', "إعدادات التشغيل والمخزون")}
          </strong>
          <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
            {isContractingVertical ? t('settings.forms.tabs.general_settings_tab.s18', "مقر الإدارة ومخزن التشوين الميداني الافتراضي") : isMaritimeVertical ? t('settings.forms.tabs.general_settings_tab.s19', "المكتب المعتمد كمركز إدارة وتنسيق العمليات والتوكيلات الملاحية") : t('settings.forms.tabs.general_settings_tab.s20', "الفرع الرئيسي ومخازن ونمط الكاشير")}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Branch Selector */}
        {SINGLE_STORE_MODE ? (
          <RequiredField label={branchFieldLabel} error={form.formState.errors.currentBranchId?.message}>
            <input
              className="purchase-prototype-field-input"
              value={selectedBranch?.name || t('settings.forms.tabs.general_settings_tab.s21', "سيتم الربط تلقائيًا بعد حفظ بيانات النشاط الرئيسي")}
              disabled
              readOnly
              style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc' }}
            />
          </RequiredField>
        ) : (
          <RequiredField label={branchFieldLabel} error={form.formState.errors.currentBranchId?.message}>
            <div style={{ position: 'relative' }}>
              <input
                className="purchase-prototype-field-input"
                value={branchQuery}
                placeholder={t('settings.forms.tabs.general_settings_tab.s22', "ابحث أو اكتب اسم فرع جديد لإضافته")}
                name="settings_branch_search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-lpignore="true"
                data-form-type="other"
                role="combobox"
                aria-expanded={branchMenuOpen}
                disabled={disabled}
                onFocus={() => setBranchMenuOpen(true)}
                onChange={(event) => {
                  setBranchQuery(event.target.value);
                  setBranchMenuOpen(true);
                  form.clearErrors('currentBranchId');
                  form.clearErrors('currentLocationId');
                  form.clearErrors('root.serverError');
                }}
                onBlur={() => {
                  window.setTimeout(() => setBranchMenuOpen(false), 120);
                }}
                style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1', width: '100%', boxSizing: 'border-box' }}
              />
              {branchMenuOpen && branchMenuHasContent ? (
                <div style={{ ...comboListStyle, position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20 }}>
                  {filteredBranches.map((branch) => (
                    <button
                      key={branch.id}
                      type="button"
                      style={comboRowStyle}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        commitSelectedBranch(String(branch.id), String(branch.name || ''));
                      }}
                    >
                      {branch.name}
                    </button>
                  ))}
                  {branchCreateOptionVisible ? (
                    <button
                      type="button"
                      style={comboCreateStyle}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setBranchPrefillName(branchQuery.trim());
                        setShowBranchQuickAdd(true);
                        setBranchMenuOpen(false);
                      }}
                    >
                      {t('settings.forms.tabs.general_settings_tab.s23', "+ إضافة فرع جديد: \"")}{branchQuery.trim()}&quot;
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </RequiredField>
        )}

        {/* Maritime Operations Settings OR Receiving Location & Cashier Mode Grid */}
        {isMaritimeVertical ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="field">
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>
                {t('settings.forms.tabs.general_settings_tab.s24', "عملة تسعير النولون الافتراضية")}
              </label>
              <CustomSelect
                value={form.watch('maritimeDefaultCurrency') || 'USD'}
                onChange={(val) => form.setValue('maritimeDefaultCurrency', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'USD', label: t('settings.forms.tabs.general_settings_tab.s25', "دولار أمريكي (USD)") },
                  { value: 'EUR', label: t('settings.forms.tabs.general_settings_tab.s26', "يورو (EUR)") },
                  { value: 'EGP', label: t('settings.forms.tabs.general_settings_tab.s27', "جنيه مصري (EGP)") },
                ]}
                disabled={disabled}
              />
            </div>
            <div className="field">
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>
                {t('settings.forms.tabs.general_settings_tab.s28', "أيام السماح المجانية للحاويات (Demurrage)")}
              </label>
              <input
                type="number"
                min="1"
                max="90"
                className="purchase-prototype-field-input"
                value={Number(form.watch('maritimeDemurrageFreeDays') || 14)}
                onChange={(e) => form.setValue('maritimeDemurrageFreeDays', Math.max(1, parseInt(e.target.value) || 14), { shouldDirty: true, shouldValidate: true })}
                disabled={disabled}
                style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1', width: '100%', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isNonPosVertical ? '1fr' : '1fr 1fr', gap: '10px' }}>
            <RequiredField label={locationFieldLabel} error={form.formState.errors.currentLocationId?.message}>
              {visibleLocations.length === 0 ? (
                <div style={{ padding: '6px 8px', background: '#fee2e2', color: '#991b1b', borderRadius: '6px', fontSize: '0.78rem' }}>
                  {t('settings.forms.tabs.general_settings_tab.s29', "لا توجد أماكن مخزون.")}
                </div>
              ) : (
                <CustomSelect
                  value={form.watch('currentLocationId') || ''}
                  onChange={(val) => form.setValue('currentLocationId', val, { shouldDirty: true, shouldValidate: true })}
                  options={[
                    { value: '', label: t('settings.forms.tabs.general_settings_tab.s30', "-- اختر المخزن --") },
                    ...visibleLocations.map((loc) => ({ value: String(loc.id), label: loc.name })),
                  ]}
                  disabled={disabled}
                />
              )}
            </RequiredField>

            {!isNonPosVertical && (
              <div className="field">
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s31', "نمط الكاشير الافتراضي")}</label>
                <CustomSelect
                  value={form.watch('defaultPosMode') || 'scanner'}
                  onChange={(val) => form.setValue('defaultPosMode', val as any, { shouldDirty: true, shouldValidate: true })}
                  options={[
                    { value: 'scanner', label: t('settings.forms.tabs.general_settings_tab.s32', "سكانر باركود") },
                    { value: 'touch', label: t('settings.forms.tabs.general_settings_tab.s33', "لمس (تاتش)") },
                  ]}
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        )}

        {/* Sales Stock Source (Branch-level stock settings) */}
        {!isNonPosVertical && selectedBranch && onUpdateBranch && (
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '10px 12px',
            marginTop: '4px',
          }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
              {t('settings.forms.tabs.general_settings_tab.s34', "مصدر مخزون البيع للفرع (")}{selectedBranch.name})
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('settings.forms.tabs.general_settings_tab.s35', "نطاق المخزون")}</label>
                <CustomSelect
                  value={stockMode}
                  disabled={!canManageSettings || branchStockSaving}
                  onChange={(val) => { setStockMode(val as any); setBranchStockDirty(true); setBranchStockSaved(false); }}
                  options={[
                    { value: 'single_location', label: t('settings.forms.tabs.general_settings_tab.s36', "مخزن محدد") },
                    { value: 'all_operational_locations', label: t('settings.forms.tabs.general_settings_tab.s37', "كل المخازن التشغيلية") },
                  ]}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('settings.forms.tabs.general_settings_tab.s38', "مخزن البيع الأساسي")}</label>
                <CustomSelect
                  value={defaultStockLocationId}
                  disabled={!canManageSettings || branchStockSaving}
                  onChange={(val) => { setDefaultStockLocationId(val); setBranchStockDirty(true); setBranchStockSaved(false); }}
                  options={[
                    { value: '', label: t('settings.forms.tabs.general_settings_tab.s39', "-- غير محدد --") },
                    ...locations.filter((loc) => !loc.branchId || loc.branchId === selectedBranch.id).map((loc) => ({
                      value: String(loc.id),
                      label: loc.name,
                    })),
                  ]}
                />
              </div>
            </div>

            {stockMode === 'all_operational_locations' && (
              <div style={{ marginTop: '6px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.76rem', color: '#334155', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={allowExternalSalesStock}
                    disabled={!canManageSettings || branchStockSaving}
                    onChange={(e) => { setAllowExternalSalesStock(e.target.checked); setBranchStockDirty(true); setBranchStockSaved(false); }}
                  />
                  {t('settings.forms.tabs.general_settings_tab.s40', "السماح بالبيع من المخازن الخارجية")}
                </label>
              </div>
            )}

            {branchStockDirty && canManageSettings && (
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  disabled={branchStockSaving}
                  onClick={async () => {
                    if (!selectedBranch) return;
                    setBranchStockSaving(true);
                    setBranchStockError(null);
                    try {
                      await onUpdateBranch(selectedBranch.id, {
                        name: selectedBranch.name || '',
                        code: selectedBranch.code || '',
                        defaultStockLocationId: defaultStockLocationId || undefined,
                        salesStockMode: stockMode,
                        allowExternalSalesStock,
                      });
                      setBranchStockSaved(true);
                      setBranchStockDirty(false);
                    } catch {
                      setBranchStockError(t('settings.forms.tabs.general_settings_tab.s41', "تعذر حفظ إعدادات المخزون."));
                    } finally {
                      setBranchStockSaving(false);
                    }
                  }}
                  style={{
                    padding: '5px 12px',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    borderRadius: '6px',
                    background: '#0f172a',
                    color: '#ffffff',
                    border: 'none',
                    cursor: branchStockSaving ? 'wait' : 'pointer',
                  }}
                >
                  {branchStockSaving ? t('settings.forms.tabs.general_settings_tab.s42', "جارٍ الحفظ...") : t('settings.forms.tabs.general_settings_tab.s43', "حفظ إعدادات مخزون الفرع")}
                </button>
              </div>
            )}

            {branchStockSaved && <div style={{ color: '#16a34a', marginTop: '4px', fontSize: '0.75rem', fontWeight: 600 }}>{t('settings.forms.tabs.general_settings_tab.s44', "تم حفظ إعدادات مخزون البيع بنجاح.")}</div>}
            {branchStockError && <div style={{ color: '#dc2626', marginTop: '4px', fontSize: '0.75rem', fontWeight: 600 }}>{branchStockError}</div>}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
