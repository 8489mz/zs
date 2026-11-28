import { memo } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';
import { SalesInventorySalesTax } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-sales-tax';
import { ContractingVerticalSection, MaritimeVerticalSection, ImportVerticalSection, ServicesVerticalSection, ManufacturingVerticalSection } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-verticals';
import { SalesInventoryRules, useSalesInventoryRulesState } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-rules';
import { SalesInventoryBarcode } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-barcode';
import { SalesInventoryPosCustom } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-pos-custom';
import { SalesInventoryZpay } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-zpay';
import { useSalesInventoryTerminals } from '@/features/settings/components/forms/tabs/sales-inventory/use-sales-inventory-terminals';
import { SalesInventoryTerminals } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-terminals';
import { SalesInventoryLoyalty, useSalesInventoryLoyalty } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-loyalty';
import { SalesInventoryExpiry } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-expiry';
import { SalesInventoryAntiTheft } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-anti-theft';

interface SalesInventoryTabProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  activeTab: string;
  settings?: AppSettings;
}
export const SalesInventorySettingsTab = memo(function SalesInventorySettingsTab({
  form,
  disabled,
  activeTab,
  settings,
}: SalesInventoryTabProps) {
  const loyalty = useSalesInventoryLoyalty({ form });
  const rawActivity = String(form.watch('businessIndustry') || settings?.businessIndustry || (settings as any)?.activityType || 'retail_general').trim().toLowerCase();
  const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات' || Boolean(form.watch('contractingModuleEnabled'));
  const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن' || Boolean(form.watch('maritimeFreightModuleEnabled'));
  const isManufacturingVertical = rawActivity === 'manufacturing' || rawActivity === 'production' || rawActivity === 'تصنيع' || rawActivity === 'مصنع' || Boolean(form.watch('manufacturingModuleEnabled'));
  const isServicesVertical = rawActivity === 'services' || rawActivity === 'consulting' || rawActivity === 'استشارات';
  const isImportVertical = rawActivity === 'import_export' || rawActivity === 'import';
  const isRestaurantVertical = ['restaurant', 'cafe', 'مطعم', 'كافيه'].includes(rawActivity) || Boolean(form.watch('restaurantModuleEnabled'));
  const isRetailCommerce = !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isServicesVertical;
  const weightedBarcodeEnabled = Boolean(form.watch('weightedBarcodeEnabled'));
  const isPosModuleEnabled = Boolean(form.watch('posModuleEnabled') ?? settings?.posModuleEnabled ?? true);
  const showPosSettings = isPosModuleEnabled && isRetailCommerce;
  const showPhysicalInventory = !isServicesVertical;

  const isStoreFleet = form.watch('deliveryFeeMode') === 'store_fleet';
  const rules = useSalesInventoryRulesState();
  const terminals = useSalesInventoryTerminals({ form, settings });

  return (
    <div style={{ display: activeTab === 'sales_inventory' ? 'block' : 'none' }}>
      <SalesInventorySalesTax form={form} disabled={disabled} settings={settings} />
      {isContractingVertical && (
        <ContractingVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isMaritimeVertical && (
        <MaritimeVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isImportVertical && (
        <ImportVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isServicesVertical && (
        <ServicesVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isManufacturingVertical && (
        <ManufacturingVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isRetailCommerce && (
        <SalesInventoryRules form={form} disabled={disabled} settings={settings} isRestaurantVertical={isRestaurantVertical} showPosSettings={showPosSettings} showPhysicalInventory={showPhysicalInventory} isStoreFleet={isStoreFleet} isChangingPin={rules.isChangingPin} setIsChangingPin={rules.setIsChangingPin} />
      )}
      {weightedBarcodeEnabled ? (
        <SalesInventoryBarcode form={form} disabled={disabled} settings={settings} weightedBarcodeEnabled={weightedBarcodeEnabled} />
      ) : null}

      {showPosSettings && (
        <SalesInventoryPosCustom form={form} disabled={disabled} settings={settings} showPosSettings={showPosSettings} />
      )}

      {showPosSettings && (
        <SalesInventoryZpay form={form} disabled={disabled} settings={settings} showPosSettings={showPosSettings} />
      )}

      {showPosSettings && (
        <SalesInventoryTerminals form={form} disabled={disabled} settings={settings} showPosSettings={showPosSettings} testingTerminalId={terminals.testingTerminalId} terminalTestResults={terminals.terminalTestResults} isMasterPosTerminalEnabled={terminals.isMasterPosTerminalEnabled} setIsMasterPosTerminalEnabled={terminals.setIsMasterPosTerminalEnabled} terminalsList={terminals.terminalsList} handleUpdateTerminal={terminals.handleUpdateTerminal} handleAddTerminal={terminals.handleAddTerminal} handleRemoveTerminal={terminals.handleRemoveTerminal} handleSetDefaultTerminal={terminals.handleSetDefaultTerminal} handleTestTerminalDevice={terminals.handleTestTerminalDevice} />
      )}
      {showPosSettings && (
        <SalesInventoryLoyalty form={form} disabled={disabled} settings={settings} showPosSettings={showPosSettings} loyaltyBookDigits={loyalty.loyaltyBookDigits} loyaltyPreviewPoints={loyalty.loyaltyPreviewPoints} loyaltyPreviewValue={loyalty.loyaltyPreviewValue} />
      )}
      {isRetailCommerce && (
        <SalesInventoryExpiry form={form} disabled={disabled} settings={settings} />
      )}
      <SalesInventoryAntiTheft form={form} disabled={disabled} />
    </div>
  );
}, (prev, next) => {
  // Freeze inactive tab to preserve 0ms switching performance
  if (prev.activeTab !== 'sales_inventory' && next.activeTab !== 'sales_inventory') {
    return true;
  }
  return false;
});
