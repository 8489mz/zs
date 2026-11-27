import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { contractingApi } from '../../api/contracting.api';
import {roundMoneyValue, type MoneyDigits} from '@/shared/utils/money';
import { toast } from '@/shared/components/system-alert';
import { ImportBoqModal } from '../../components/LazyImportBoqModal';
import { ImportMasterBoqModal } from '../../components/ImportMasterBoqModal';
import { AutoPricingModal } from '../../components/AutoPricingModal';
import { ClientQuotationModal } from '../../components/ClientQuotationModal';
import { MarkTenderLostModal } from '../../components/MarkTenderLostModal';
import { AwardTenderModal } from '../../components/AwardTenderModal';
import { TenderSwitcherModal } from '../../components/TenderSwitcherModal';
import { ContractingWorkflowMapModal } from '../../components/ContractingWorkflowMapModal';
import { matchEngineeringConstant } from '../../utils/engineeringMasterPricingCore';
import type { TenderItem, TenderItemComponent } from './tender-page-types';

export interface TenderModalsProps {
  isImportBoqOpen: boolean;
  setIsImportBoqOpen: Dispatch<SetStateAction<boolean>>;
  projectName: string;
  items: TenderItem[];
  setItems: Dispatch<SetStateAction<TenderItem[]>>;
  engineeringConstants: any[];
  globalProfitMargin: number;
  globalOverhead: number;
  globalWaste: number;
  bookDigits: MoneyDigits;
  isImportMasterOpen: boolean;
  setIsImportMasterOpen: Dispatch<SetStateAction<boolean>>;
  isAutoPricingOpen: boolean;
  setIsAutoPricingOpen: Dispatch<SetStateAction<boolean>>;
  isQuotationOpen: boolean;
  setIsQuotationOpen: Dispatch<SetStateAction<boolean>>;
  clientName: string;
  calculateItemRates: (item: TenderItem) => {
    directCost: number;
    sellingUnitPrice: number;
    totalItemValue: number;
    totalItemDirectCost: number;
    totalItemProfit: number;
  };
  isLostModalOpen: boolean;
  setIsLostModalOpen: Dispatch<SetStateAction<boolean>>;
  projectIdParam: string | null;
  currentProject: any | null;
  setCurrentProject: Dispatch<SetStateAction<any | null>>;
  reloadProjects: () => Promise<void>;
  isAwardModalOpen: boolean;
  setIsAwardModalOpen: Dispatch<SetStateAction<boolean>>;
  grandTotals: {
    totalSellingPrice: number;
    totalDirectCost: number;
    totalProfit: number;
    profitMargin: number;
  };
  navigate: NavigateFunction;
  isTenderSwitcherOpen: boolean;
  setIsTenderSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  handleSelectProjectFromSwitcher: (targetId: string) => void;
  handleStartNewTender: () => Promise<void>;
  isWorkflowMapOpen: boolean;
  setIsWorkflowMapOpen: Dispatch<SetStateAction<boolean>>;
}

export function TenderModals(props: TenderModalsProps) {
  const { t } = useTranslation();
  const {
    isImportBoqOpen,
    setIsImportBoqOpen,
    projectName,
    items,
    setItems,
    engineeringConstants,
    globalProfitMargin,
    globalOverhead,
    globalWaste,
    bookDigits,
    isImportMasterOpen,
    setIsImportMasterOpen,
    isAutoPricingOpen,
    setIsAutoPricingOpen,
    isQuotationOpen,
    setIsQuotationOpen,
    clientName,
    calculateItemRates,
    isLostModalOpen,
    setIsLostModalOpen,
    projectIdParam,
    currentProject,
    setCurrentProject,
    reloadProjects,
    isAwardModalOpen,
    setIsAwardModalOpen,
    grandTotals,
    navigate,
    isTenderSwitcherOpen,
    setIsTenderSwitcherOpen,
    handleSelectProjectFromSwitcher,
    handleStartNewTender,
    isWorkflowMapOpen,
    setIsWorkflowMapOpen,
  } = props;

  return (
    <>
      {/* Sub-modals */}
      {isImportBoqOpen && (
        <ImportBoqModal
          open={isImportBoqOpen}
          projectName={projectName}
          existingItemCount={items.length}
          onClose={() => setIsImportBoqOpen(false)}
          onImportItems={(parsedRows, mode = 'append') => {
            const newTenderItems: TenderItem[] = parsedRows.map((r, idx) => {
              const matchedConstant = matchEngineeringConstant(r.description, r.itemCode, engineeringConstants);

              const fallbackCode = `BOQ-${String(items.length + idx + 1).padStart(3, '0')}`;
              const itemCode = r.itemCode && r.itemCode.trim() ? r.itemCode.trim() : (matchedConstant ? matchedConstant.itemCode : fallbackCode);
              const unit = r.unit || (matchedConstant ? matchedConstant.unit : 'item');
              const estimatedQty = r.contractQty > 0 ? r.contractQty : 1;

              // Derive components (BOM)
              let components: TenderItemComponent[] = [];
              if (matchedConstant?.components && matchedConstant.components.length > 0) {
                components = matchedConstant.components.map((c: any) => ({
                  componentCode: c.componentCode || `MAT-${itemCode}`,
                  componentName: c.componentName || c.name || r.description,
                  unit: c.unit || unit,
                  qtyPerUnit: Number(c.qtyPerUnit || 1),
                  unitRate: Number(c.unitRate || 0),
                  componentType: c.componentType || 'material',
                }));
              } else {
                const calculatedCost = r.estimatedUnitCost > 0
                  ? r.estimatedUnitCost
                  : (r.unitPrice > 0 ? roundMoneyValue(r.unitPrice / (1 + (globalProfitMargin + globalOverhead + globalWaste) / 100), bookDigits) : 0);

                components = [
                  {
                    componentCode: `MAT-${itemCode}`,
                    componentName: `خامات وتوريدات: ${r.description.slice(0, 45)}`,
                    unit,
                    qtyPerUnit: 1,
                    unitRate: roundMoneyValue(calculatedCost * 0.7, bookDigits),
                    componentType: 'material',
                  },
                  {
                    componentCode: `LAB-${itemCode}`,
                    componentName: `مصنعيات وتركيب: ${r.description.slice(0, 45)}`,
                    unit,
                    qtyPerUnit: 1,
                    unitRate: roundMoneyValue(calculatedCost * 0.3, bookDigits),
                    componentType: 'labor',
                  },
                ];
              }

              const trade = r.category && r.category !== 'general'
                ? r.category
                : (matchedConstant?.trade || 'general');

              return {
                id: `TND-${Math.random().toString(36).slice(2, 9)}`,
                itemCode,
                description: r.description,
                unit,
                estimatedQty,
                trade,
                sourceFileName: r.sourceFileName,
                sourceSheetName: r.sourceSheetName,
                rawRowIdx: r.rawRowIdx,
                components,
                wastePercent: matchedConstant?.wastePercent ?? globalWaste,
                overheadPercent: matchedConstant?.overheadPercent ?? globalOverhead,
                profitMarkupPercent: matchedConstant?.profitMarkupPercent ?? globalProfitMargin,
                notes: r.notes || matchedConstant?.notes,
              };
            });

            if (mode === 'append' && items.length > 0) {
              setItems((prev) => [...prev, ...newTenderItems]);
              toast.success(`تم إلحاق وتفكيك وتسعير ${newTenderItems.length} بند جديد بالمشروع بنجاح`);
            } else {
              setItems(newTenderItems);
              toast.success(`تم استيراد وتفكيك وتسعير ${newTenderItems.length} بند من المقايسة بنجاح`);
            }
            setIsImportBoqOpen(false);
          }}
        />
      )}

      {isImportMasterOpen && (
        <ImportMasterBoqModal
          open={isImportMasterOpen}
          onClose={() => setIsImportMasterOpen(false)}
          onImportSelected={async (selectedIds) => {
            try {
              const allMaster = await contractingApi.getMasterBoqLibrary({});
              const selectedMaster = allMaster.filter((it: any) => selectedIds.includes(it.id));
              const newTenderItems: TenderItem[] = selectedMaster.map((masterItem: any) => ({
                id: `TND-${Math.random().toString(36).slice(2, 9)}`,
                itemCode: masterItem.itemCode,
                description: masterItem.description || masterItem.name,
                unit: masterItem.unit,
                estimatedQty: 100,
                trade: masterItem.tradeCategory || 'general',
                components: [
                  {
                    componentCode: `MAT-${masterItem.itemCode}`,
                    componentName: masterItem.name,
                    unit: masterItem.unit,
                    qtyPerUnit: 1,
                    unitRate: masterItem.standardCost || 50,
                    componentType: 'material',
                  },
                ],
                wastePercent: globalWaste,
                overheadPercent: globalOverhead,
                profitMarkupPercent: globalProfitMargin,
              }));
              setItems((prev) => [...prev, ...newTenderItems]);
              setIsImportMasterOpen(false);
              toast.success(`تم استيراد ${newTenderItems.length} بند من بنك المقايسات المرجعي`);
            } catch (err) {
              console.error(err);
            }
          }}
        />
      )}

      {isAutoPricingOpen && (
        <AutoPricingModal
          isOpen={isAutoPricingOpen}
          onClose={() => setIsAutoPricingOpen(false)}
          onApplyPrice={(_unitPrice, estimatedCost) => {
            setItems((prev) =>
              prev.map((item) => ({
                ...item,
                components: item.components.map((c) => ({ ...c, unitRate: estimatedCost })),
              }))
            );
            setIsAutoPricingOpen(false);
            toast.success(t('contracting.contracting_tender_page.s93', "تم تطبيق أسعار ونسب التسعير الآلي بنجاح"));
          }}
        />
      )}

      {isQuotationOpen && (
        <ClientQuotationModal
          isOpen={isQuotationOpen}
          onClose={() => setIsQuotationOpen(false)}
          projectName={projectName}
          clientName={clientName}
          items={items.map((item) => {
            const rates = calculateItemRates(item);
            return {
              id: item.id,
              projectId: '',
              itemCode: item.itemCode,
              description: item.description,
              category: item.trade,
              sourceFileName: item.sourceFileName,
              sourceSheetName: item.sourceSheetName,
              rawRowIdx: item.rawRowIdx,
              unit: item.unit,
              contractQty: item.estimatedQty,
              revisedQty: item.estimatedQty,
              unitPrice: rates.sellingUnitPrice,
              estimatedUnitCost: rates.directCost,
              totalPrice: rates.totalItemValue,
              executedQty: 0,
              createdAt: new Date().toISOString(),
            };
          })}
        />
      )}

      {/* Mark Tender Lost Modal */}
      {isLostModalOpen && projectIdParam && (
        <MarkTenderLostModal
          open={isLostModalOpen}
          projectId={projectIdParam}
          projectCode={currentProject?.code}
          projectName={projectName}
          onClose={() => setIsLostModalOpen(false)}
          onSuccess={async () => {
            await reloadProjects();
            setCurrentProject((prev: any) => (prev ? { ...prev, status: 'lost' } : null));
          }}
        />
      )}

      {/* Award Tender Modal */}
      {isAwardModalOpen && projectIdParam && (
        <AwardTenderModal
          open={isAwardModalOpen}
          projectId={projectIdParam}
          projectCode={currentProject?.code}
          projectName={projectName}
          clientName={clientName}
          contractValue={grandTotals.totalSellingPrice}
          initialDownPayment={Math.round(grandTotals.totalSellingPrice * 0.1)}
          initialRetentionPercent={5}
          onClose={() => setIsAwardModalOpen(false)}
          onSuccess={async () => {
            await reloadProjects();
            navigate(`/contracting/boq?projectId=${projectIdParam}`);
          }}
        />
      )}

      {/* Tender Switcher Modal */}
      {isTenderSwitcherOpen && (
        <TenderSwitcherModal
          open={isTenderSwitcherOpen}
          currentProjectId={projectIdParam}
          onClose={() => setIsTenderSwitcherOpen(false)}
          onSelectProject={(selectedId) => {
            handleSelectProjectFromSwitcher(selectedId);
          }}
          onNewTender={() => {
            handleStartNewTender();
          }}
        />
      )}

      {/* Contracting Lifecycle Workflow Map Modal */}
      {isWorkflowMapOpen && (
        <ContractingWorkflowMapModal
          open={isWorkflowMapOpen}
          onClose={() => setIsWorkflowMapOpen(false)}
        />
      )}
    </>
  );
}
