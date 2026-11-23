import { GeneralSettingsTab } from '../tabs/GeneralSettingsTab';
import { SalesInventorySettingsTab } from '../tabs/SalesInventorySettingsTab';
import { ModulesSettingsTab } from '../tabs/ModulesSettingsTab';
import { PrintingSettingsTab } from '../tabs/PrintingSettingsTab';
import type { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings, Branch, Location } from '@/types/domain';

export interface SettingsMainFormTabsProps {
  __t: ReturnType<typeof useTranslation>['t'];
  salesInventoryTabLabel: string;
  printingTabLabel: string;
  setActiveTab: React.Dispatch<React.SetStateAction<'general' | 'sales_inventory' | 'modules' | 'printing'>>;
  activeTab: 'general' | 'sales_inventory' | 'modules' | 'printing';
  tabErrors: Record<'general' | 'sales_inventory' | 'modules' | 'printing', { fieldKey: string; label: string; message?: string }[]>;
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  branches?: Branch[];
  locations?: Location[];
  canManageSettings: boolean;
  disabled: boolean;
  branchQuery: string;
  setBranchQuery: (val: string) => void;
  filteredBranches: Branch[];
  selectedBranch?: Branch;
  stockMode: 'single_location' | 'all_operational_locations';
  setStockMode: (val: 'single_location' | 'all_operational_locations') => void;
  defaultStockLocationId: string;
  setDefaultStockLocationId: (val: string) => void;
  allowExternalSalesStock: boolean;
  setAllowExternalSalesStock: (val: boolean) => void;
  branchStockSaving: boolean;
  setBranchStockSaving: (val: boolean) => void;
  branchStockSaved: boolean;
  setBranchStockSaved: (val: boolean) => void;
  branchStockError: string | null;
  setBranchStockError: (val: string | null) => void;
  branchStockDirty: boolean;
  setBranchStockDirty: (val: boolean) => void;
  branchMenuOpen: boolean;
  setBranchMenuOpen: (val: boolean) => void;
  branchMenuHasContent: boolean;
  branchCreateOptionVisible: boolean;
  commitSelectedBranch: (branchId: string, branchName?: string) => void;
  setBranchPrefillName: (val: string) => void;
  setShowBranchQuickAdd: (val: boolean) => void;
  visibleLocations: Location[];
  onUpdateBranch?: (id: any, data: any) => Promise<any>;
  settings?: AppSettings;
  systemPrinters?: { name: string; displayName: string }[];
}

export function SettingsMainFormTabs(props: SettingsMainFormTabsProps) {
  const { __t, salesInventoryTabLabel, printingTabLabel, setActiveTab, activeTab, tabErrors, form, branches, locations, canManageSettings, disabled, branchQuery, setBranchQuery, filteredBranches, selectedBranch, stockMode, setStockMode, defaultStockLocationId, setDefaultStockLocationId, allowExternalSalesStock, setAllowExternalSalesStock, branchStockSaving, setBranchStockSaving, branchStockSaved, setBranchStockSaved, branchStockError, setBranchStockError, branchStockDirty, setBranchStockDirty, branchMenuOpen, setBranchMenuOpen, branchMenuHasContent, branchCreateOptionVisible, commitSelectedBranch, setBranchPrefillName, setShowBranchQuickAdd, visibleLocations, onUpdateBranch, settings, systemPrinters } = props;
  return (
    <>
    <div className="settings-tabs" style={{ display: 'inline-flex', background: '#f1f5f9', padding: '4px', borderRadius: '10px', gap: '4px', marginBottom: '16px', overflowX: 'auto' }}>
      {[
        { id: 'general', label: __t('settings.forms.settings_main_form.s19', "عام") },
        { id: 'sales_inventory', label: salesInventoryTabLabel },
        { id: 'modules', label: __t('settings.forms.settings_main_form.s20', "تخصيص المنظومة والنشاط") },
        { id: 'printing', label: printingTabLabel },
      ].map(tab => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setActiveTab(tab.id as any)}
          style={{
            background: activeTab === tab.id ? 'var(--primary, #0f172a)' : 'transparent',
            color: activeTab === tab.id ? '#ffffff' : ((tabErrors as any)[tab.id]?.length ? '#ef4444' : '#64748b'),
            border: 'none',
            padding: '6px 16px',
            borderRadius: '7px',
            fontSize: '0.84rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'background-color 0.15s ease, color 0.15s ease',
            whiteSpace: 'nowrap',
            boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>{tab.label}</span>
          {(tabErrors as any)[tab.id]?.length > 0 ? (
            <span style={{ background: '#ef4444', color: '#fff', fontSize: '10px', borderRadius: '10px', padding: '1px 6px', fontWeight: 800 }}>
              {(tabErrors as any)[tab.id].length}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  <div className="settings-tab-content-wrapper">
    <GeneralSettingsTab
      form={form}
      branches={branches}
      locations={locations}
      canManageSettings={canManageSettings}
      disabled={disabled}
      activeTab={activeTab}
      branchQuery={branchQuery}
      setBranchQuery={setBranchQuery}
      filteredBranches={filteredBranches}
      selectedBranch={selectedBranch || undefined}
      stockMode={stockMode}
      setStockMode={setStockMode}
      defaultStockLocationId={defaultStockLocationId}
      setDefaultStockLocationId={setDefaultStockLocationId}
      allowExternalSalesStock={allowExternalSalesStock}
      setAllowExternalSalesStock={setAllowExternalSalesStock}
      branchStockSaving={branchStockSaving}
      setBranchStockSaving={setBranchStockSaving}
      branchStockSaved={branchStockSaved}
      setBranchStockSaved={setBranchStockSaved}
      branchStockError={branchStockError}
      setBranchStockError={setBranchStockError}
      branchStockDirty={branchStockDirty}
      setBranchStockDirty={setBranchStockDirty}
      branchMenuOpen={branchMenuOpen}
      setBranchMenuOpen={setBranchMenuOpen}
      branchMenuHasContent={branchMenuHasContent}
      branchCreateOptionVisible={branchCreateOptionVisible}
      commitSelectedBranch={commitSelectedBranch}
      setBranchPrefillName={setBranchPrefillName}
      setShowBranchQuickAdd={setShowBranchQuickAdd}
      visibleLocations={visibleLocations}
      onUpdateBranch={onUpdateBranch}
    />

    <SalesInventorySettingsTab
      form={form}
      disabled={disabled}
      activeTab={activeTab}
      settings={settings}
    />

    <ModulesSettingsTab form={form} disabled={disabled} activeTab={activeTab} />

    <PrintingSettingsTab
      form={form}
      disabled={disabled}
      activeTab={activeTab}
      settings={settings}
      systemPrinters={systemPrinters}
      savedCashierPrinter={form.watch('posElectronCashierPrinter')}
      savedKitchenPrinter={form.watch('posElectronKitchenPrinter')}
      savedBarcodePrinter={form.watch('posElectronBarcodePrinter')}
      savedDocumentPrinter={form.watch('posElectronDocumentPrinter')}
      posKitchenPrinterEnabled={form.watch('posKitchenPrinterEnabled')}
      branchName={selectedBranch?.name}
      locationName={visibleLocations.find((loc) => String(loc.id) === String(form.watch('currentLocationId')))?.name}
    />
  </div>
    </>
  );
}
