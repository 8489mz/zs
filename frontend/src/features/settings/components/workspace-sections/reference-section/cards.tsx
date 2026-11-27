import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { Button } from '@/shared/ui/button';
import { downloadEntityListCsv, printEntityList } from '@/features/settings/components/SettingsWorkspacePrimitives';
import type { Branch, Location } from '@/types/domain';
import { BranchRowActions, LocationRowActions } from './row-actions';
import type { BranchActionState, LocationActionState, ReferenceDeleteConfirmState } from './types';
import { useAuthStore } from '@/stores/auth-store';
import { useHasFeature } from '@/shared/hooks/use-permission';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';

export function BranchReferenceCard(props: {
  locations?: Location[];
  branches: Branch[];
  branchList: Branch[];
  filteredCount: number;
  branchSearch: string;
  branchFilter: 'all' | 'with-code' | 'without-code';
  setBranchSearch: (value: string) => void;
  setBranchFilter: (value: 'all' | 'with-code' | 'without-code') => void;
  resetBranchFilters: () => void;
  copyVisibleBranches: () => Promise<void>;
  branchesQuery: { isLoading: boolean; isError: boolean; error?: unknown };
  canManageSettings: boolean;
  editingBranch: BranchActionState | null;
  setEditingBranch: Dispatch<SetStateAction<BranchActionState | null>>;
  setDeleteConfirm: Dispatch<SetStateAction<ReferenceDeleteConfirmState | null>>;
  branchActionBusy: boolean;
  branchActionError?: unknown;
  onUpdateBranch: (branchId: string, values: { name: string; code: string }) => Promise<void>;
  onShowAddBranch?: () => void;
  setupMode?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const { branches, branchList, filteredCount, branchSearch, branchFilter, setBranchSearch, setBranchFilter, resetBranchFilters, copyVisibleBranches: _copyVisibleBranches, branchesQuery, canManageSettings, setEditingBranch, setDeleteConfirm, branchActionBusy, setupMode, onShowAddBranch } = props;

  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const vertical = resolveCurrentVertical(tenant);
  const isSuperAdmin = user?.role === 'super_admin';
  const hasMultiBranchFeature = useHasFeature('multi_branch');
  const hasBranchesFeature = useHasFeature('branches');
  const hasMultiBranch = hasMultiBranchFeature || hasBranchesFeature || isSuperAdmin;
  const isBranchLimitReached = !hasMultiBranch && branches.length >= 1;

  const branchTitle = vertical === 'maritime'
    ? (isEn ? `Shipping Offices & HQs (${branches.length})` : `المقرات والمكاتب الملاحية (${branches.length})`)
    : vertical === 'contracting'
    ? (isEn ? `Project Sites & Administrative HQs (${branches.length})` : `المقرات الإدارية ومواقع العمل (${branches.length})`)
    : (isEn ? `Branches (${branches.length})` : `الفروع (${branches.length})`);

  const addBranchBtnLabel = vertical === 'maritime'
    ? (isEn ? '+ Shipping Office' : '+ مقر / مكتب')
    : vertical === 'contracting'
    ? (isEn ? '+ Project Site' : '+ موقع عمل')
    : (isEn ? '+ Branch' : '+ فرع');

  return (
    <section className="document-prototype-section settings-reference-card">
      <div className="section-header-compact-row">
        <h3 className="document-prototype-section-title">{branchTitle}</h3>
        <div className="section-header-actions-group">
          {canManageSettings && onShowAddBranch && (
            isBranchLimitReached ? (
              <span
                style={{
                  fontSize: '0.70rem',
                  padding: '3px 6px',
                  background: '#fef3c7',
                  color: '#92400e',
                  border: '1px solid #fde68a',
                  borderRadius: '6px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  whiteSpace: 'nowrap',
                }}
                title={t('settings.workspace_sections.reference_section.cards.s0', "وصلت للحد الأقصى في باقتك (فرع واحد).")}
              >
                {t('settings.workspace_sections.reference_section.cards.s1', "حد الباقة (1)")}
              </span>
            ) : (
              <Button variant="primary" onClick={onShowAddBranch} className="section-header-action-btn">
                {addBranchBtnLabel}
              </Button>
            )
          )}
          <Button variant="secondary" className="section-header-action-btn" onClick={() => downloadEntityListCsv('branches.csv', ['name', 'code'], branchList.map((branch) => [branch.name || '', branch.code || '']))}>
            {t('settings.workspace_sections.reference_section.cards.s2', "تصدير")}
          </Button>
          <Button variant="secondary" className="section-header-action-btn" onClick={() => printEntityList(branchTitle, [t('settings.workspace_sections.reference_section.cards.s3', "الاسم"), t('settings.workspace_sections.reference_section.cards.s4', "الكود")], branchList.map((branch) => [branch.name || '', branch.code || '']))}>
            {t('settings.workspace_sections.reference_section.cards.s5', "طباعة")}
          </Button>
        </div>
      </div>
      <QueryFeedback
        isLoading={branchesQuery.isLoading}
        isError={branchesQuery.isError}
        error={branchesQuery.error}
        isEmpty={!branches.length}
        loadingText={vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s6', "جاري تحميل المقرات والمكاتب الملاحية...") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s7', "جاري تحميل مواقع العمل...") : t('settings.workspace_sections.reference_section.cards.s8', "جاري تحميل الفروع الحالية...")}
        emptyTitle={vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s9', "لم تتم إضافة مقرات ملاحية بعد") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s10', "لم تتم إضافة مواقع عمل بعد") : t('settings.workspace_sections.reference_section.cards.s11', "لم تتم إضافة فروع بعد")}
        emptyHint={vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s12', "أضف مقراً ملاحياً جديداً للبدء.") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s13', "أضف موقع عمل جديداً للبدء.") : t('settings.workspace_sections.reference_section.cards.s14', "أضف فرعًا جديدًا للبدء.")}
      >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Compact Search & Filter Strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <input
            value={branchSearch}
            placeholder={vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s15', "بحث باسم المقر الملاحي أو الكود...") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s16', "بحث باسم موقع العمل أو الكود...") : t('settings.workspace_sections.reference_section.cards.s17', "بحث باسم الفرع أو الكود...")}
            onChange={(e) => setBranchSearch(e.target.value)}
            style={{ flex: 1, minWidth: '140px', padding: '5px 10px', fontSize: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', outline: 'none' }}
          />

          <div style={{ display: 'flex', gap: '4px', background: '#e2e8f0', padding: '2px', borderRadius: '6px' }}>
            {(['all', 'with-code', 'without-code'] as const).map((mode) => {
              const label = mode === 'all' ? t('settings.workspace_sections.reference_section.cards.s18', "الكل") : mode === 'with-code' ? t('settings.workspace_sections.reference_section.cards.s19', "بكود") : t('settings.workspace_sections.reference_section.cards.s20', "بدون كود");
              const active = branchFilter === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBranchFilter(mode)}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    borderRadius: '4px',
                    border: 'none',
                    background: active ? '#ffffff' : 'transparent',
                    color: active ? '#0f172a' : '#64748b',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    transition: 'background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {(branchSearch || branchFilter !== 'all') && (
            <button
              type="button"
              onClick={resetBranchFilters}
              style={{ fontSize: '0.72rem', color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {t('settings.workspace_sections.reference_section.cards.s21', "إعادة ضبط")}
            </button>
          )}
        </div>

        {/* Branch List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '420px', overflowY: 'auto' }}>
          {filteredCount === 0 ? (
            <div style={{ padding: '20px 14px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s22', "لا توجد مقرات ملاحية مطابقة للبحث أو الفلتر") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s23', "لا توجد مواقع عمل مطابقة للبحث أو الفلتر") : t('settings.workspace_sections.reference_section.cards.s24', "لا توجد فروع مطابقة للبحث أو الفلتر")}
              </div>
              <button
                type="button"
                onClick={resetBranchFilters}
                style={{ fontSize: '0.76rem', color: '#0369a1', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}
              >
                {vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s25', "إظهار كافة المقرات") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s26', "إظهار كافة المواقع") : t('settings.workspace_sections.reference_section.cards.s27', "إظهار كل الفروع")}
              </button>
            </div>
          ) : (
            branchList.map((branch) => (
              <BranchRowActions
                key={branch.id}
                branch={branch}
                onStartEdit={(currentBranch) => setEditingBranch({
                  branchId: currentBranch.id,
                  values: {
                    name: currentBranch.name || '',
                    code: currentBranch.code || '',
                    defaultStockLocationId: currentBranch.defaultStockLocationId || undefined,
                    salesStockMode: currentBranch.salesStockMode || 'single_location',
                    allowExternalSalesStock: currentBranch.allowExternalSalesStock || false,
                  }
                })}
                onDelete={(currentBranch) => setDeleteConfirm({ kind: 'branch', id: currentBranch.id, name: currentBranch.name || t('settings.workspace_sections.reference_section.cards.s28', "هذا الفرع") })}
                canManageSettings={canManageSettings}
                isBusy={branchActionBusy}
                setupMode={setupMode}
              />
            ))
          )}
        </div>
      </div>
      </QueryFeedback>
    </section>
  );
}

export function LocationReferenceCard(props: {
  branches: Branch[];
  locations: Location[];
  locationList: Location[];
  filteredCount: number;
  locationSearch: string;
  locationFilter: 'all' | 'with-branch' | 'without-branch';
  setLocationSearch: (value: string) => void;
  setLocationFilter: (value: 'all' | 'with-branch' | 'without-branch') => void;
  resetLocationFilters: () => void;
  copyVisibleLocations: () => Promise<void>;
  locationsQuery: { isLoading: boolean; isError: boolean; error?: unknown };
  canManageSettings: boolean;
  editingLocation: LocationActionState | null;
  setEditingLocation: Dispatch<SetStateAction<LocationActionState | null>>;
  setDeleteConfirm: Dispatch<SetStateAction<ReferenceDeleteConfirmState | null>>;
  locationActionBusy: boolean;
  locationActionError?: unknown;
  onUpdateLocation: (locationId: string, values: { name: string; code: string; branchId: string }) => Promise<void>;
  onShowAddLocation?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const { locations, locationList, filteredCount, locationSearch, locationFilter, setLocationSearch, setLocationFilter, resetLocationFilters, locationsQuery, canManageSettings, setEditingLocation, setDeleteConfirm, locationActionBusy, onShowAddLocation } = props;

  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const vertical = resolveCurrentVertical(tenant);
  const isSuperAdmin = user?.role === 'super_admin';
  const hasMultiWarehouse = useHasFeature('inventory') || isSuperAdmin;
  const isLocationLimitReached = !hasMultiWarehouse && locations.length >= 1;

  const locationTitle = vertical === 'maritime'
    ? (isEn ? `Ports, Terminals & Container Yards (${locations.length})` : `الموانئ ومحطات ومستودعات الحاويات (${locations.length})`)
    : vertical === 'contracting'
    ? (isEn ? `Field Storage Warehouses (${locations.length})` : `مخازن التشوين الميدانية (${locations.length})`)
    : (isEn ? `Warehouses & Locations (${locations.length})` : `المخازن والمواقع (${locations.length})`);

  const addLocationBtnLabel = vertical === 'maritime'
    ? (isEn ? '+ Port / Yard' : '+ ميناء / موقع')
    : vertical === 'contracting'
    ? (isEn ? '+ Storage Yard' : '+ مخزن تشوين')
    : (isEn ? '+ Warehouse' : '+ مخزن');

  return (
    <section className="document-prototype-section settings-reference-card">
      <div className="section-header-compact-row">
        <h3 className="document-prototype-section-title">{locationTitle}</h3>
        <div className="section-header-actions-group">
          {canManageSettings && onShowAddLocation && (
            isLocationLimitReached ? (
              <span
                style={{
                  fontSize: '0.70rem',
                  padding: '3px 6px',
                  background: '#fef3c7',
                  color: '#92400e',
                  border: '1px solid #fde68a',
                  borderRadius: '6px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  whiteSpace: 'nowrap',
                }}
                title={t('settings.workspace_sections.reference_section.cards.s29', "وصلت للحد الأقصى في باقتك (مخزن واحد).")}
              >
                {t('settings.workspace_sections.reference_section.cards.s30', "حد الباقة (1)")}
              </span>
            ) : (
              <Button variant="primary" onClick={onShowAddLocation} className="section-header-action-btn">
                {addLocationBtnLabel}
              </Button>
            )
          )}
          <Button variant="secondary" className="section-header-action-btn" onClick={() => downloadEntityListCsv('locations.csv', ['name', 'code', 'branch'], locationList.map((location) => [location.name || '', location.code || '', location.branchName || '']))}>
            {t('settings.workspace_sections.reference_section.cards.s31', "تصدير")}
          </Button>
          <Button variant="secondary" className="section-header-action-btn" onClick={() => printEntityList(locationTitle, [t('settings.workspace_sections.reference_section.cards.s32', "الاسم"), t('settings.workspace_sections.reference_section.cards.s33', "الكود"), vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s34', "المكتب المشرف") : t('settings.workspace_sections.reference_section.cards.s35', "الفرع")], locationList.map((location) => [location.name || '', location.code || '', location.branchName || '']))}>
            {t('settings.workspace_sections.reference_section.cards.s36', "طباعة")}
          </Button>
        </div>
      </div>
      <QueryFeedback
        isLoading={locationsQuery.isLoading}
        isError={locationsQuery.isError}
        error={locationsQuery.error}
        isEmpty={!locations.length}
        loadingText={vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s37', "جاري تحميل الموانئ والمحطات...") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s38', "جاري تحميل مواقع التشوين...") : t('settings.workspace_sections.reference_section.cards.s39', "جاري تحميل المخازن...")}
        emptyTitle={vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s40', "لم تتم إضافة موانئ أو محطات بعد") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s41', "لم تتم إضافة مواقع تشوين بعد") : t('settings.workspace_sections.reference_section.cards.s42', "لم تتم إضافة مخازن بعد")}
        emptyHint={vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s43', "أضف ميناء أو محطة حاويات جديدة للبدء.") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s44', "أضف مخزن تشوين جديداً للبدء.") : t('settings.workspace_sections.reference_section.cards.s45', "أضف مخزنًا جديدًا للبدء.")}
      >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Compact Search & Filter Strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <input
            value={locationSearch}
            placeholder={vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s46', "بحث باسم الميناء أو المحطة أو الكود...") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s47', "بحث باسم مخزن التشوين أو الكود...") : t('settings.workspace_sections.reference_section.cards.s48', "بحث باسم المخزن أو الكود أو الفرع...")}
            onChange={(e) => setLocationSearch(e.target.value)}
            style={{ flex: 1, minWidth: '140px', padding: '5px 10px', fontSize: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', outline: 'none' }}
          />

          <div style={{ display: 'flex', gap: '4px', background: '#e2e8f0', padding: '2px', borderRadius: '6px' }}>
            {(['all', 'with-branch', 'without-branch'] as const).map((mode) => {
              const label = mode === 'all'
                ? t('settings.workspace_sections.reference_section.cards.s49', "الكل")
                : mode === 'with-branch'
                ? (vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s50', "بمكتب") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s51', "بمقر") : t('settings.workspace_sections.reference_section.cards.s52', "بفرع"))
                : (vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s53', "بدون مكتب") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s54', "بدون مقر") : t('settings.workspace_sections.reference_section.cards.s55', "بدون فرع"));
              const active = locationFilter === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setLocationFilter(mode)}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    borderRadius: '4px',
                    border: 'none',
                    background: active ? '#ffffff' : 'transparent',
                    color: active ? '#0f172a' : '#64748b',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    transition: 'background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {(locationSearch || locationFilter !== 'all') && (
            <button
              type="button"
              onClick={resetLocationFilters}
              style={{ fontSize: '0.72rem', color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {t('settings.workspace_sections.reference_section.cards.s56', "إعادة ضبط")}
            </button>
          )}
        </div>

        {/* Location List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '420px', overflowY: 'auto' }}>
          {filteredCount === 0 ? (
            <div style={{ padding: '20px 14px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s57', "لا توجد موانئ أو محطات مطابقة للبحث أو الفلتر") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s58', "لا توجد مواقع تشوين مطابقة للبحث أو الفلتر") : t('settings.workspace_sections.reference_section.cards.s59', "لا توجد مخازن مطابقة للبحث أو الفلتر")}
              </div>
              <button
                type="button"
                onClick={resetLocationFilters}
                style={{ fontSize: '0.76rem', color: '#0369a1', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}
              >
                {vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s60', "إظهار كافة الموانئ والمحطات") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s61', "إظهار كافة مواقع التشوين") : t('settings.workspace_sections.reference_section.cards.s62', "إظهار كل المخازن")}
              </button>
            </div>
          ) : (
            locationList.map((location) => (
              <LocationRowActions
                key={location.id}
                location={location}
                onStartEdit={(currentLocation) => setEditingLocation({
                  locationId: currentLocation.id,
                  values: {
                    name: currentLocation.name || '',
                    code: currentLocation.code || '',
                    branchId: currentLocation.branchId || '',
                    locationType: currentLocation.locationType || 'internal_warehouse',
                  }
                })}
                onDelete={(currentLocation) => setDeleteConfirm({ kind: 'location', id: currentLocation.id, name: currentLocation.name || (vertical === 'maritime' ? t('settings.workspace_sections.reference_section.cards.s63', "هذا الموقع / الميناء") : vertical === 'contracting' ? t('settings.workspace_sections.reference_section.cards.s64', "هذا المخزن التشويني") : t('settings.workspace_sections.reference_section.cards.s65', "هذا المخزن")) })}
                canManageSettings={canManageSettings}
                isBusy={locationActionBusy}
              />
            ))
          )}
        </div>
      </div>
      </QueryFeedback>
    </section>
  );
}
