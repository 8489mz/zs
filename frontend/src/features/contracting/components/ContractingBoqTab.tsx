import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContractingBoqItem } from '../contracting.types';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { downloadExcelFile } from '@/lib/browser';
import { contractingApi } from '../api/contracting.api';
import { ImportBoqModal } from './LazyImportBoqModal';
import { ImportMasterBoqModal } from './ImportMasterBoqModal';
import { AutoPricingModal } from './AutoPricingModal';
import { ClientQuotationModal } from './ClientQuotationModal';
import { ProjectMaterialsMrpModal } from './ProjectMaterialsMrpModal';
import { BoqProfitabilityModal } from './BoqProfitabilityModal';
import { CostSnapshotModal } from './CostSnapshotModal';
import { CreateBoqItemModal } from './CreateBoqItemModal';
import { BoqTakeoffSheetModal } from './BoqTakeoffSheetModal';
import { SiteMobilizationModal } from './SiteMobilizationModal';
import { ClientMilestonesModal } from './ClientMilestonesModal';
import { EquipmentTrackingModal } from './EquipmentTrackingModal';
import { SuppliersDirectoryModal } from './SuppliersDirectoryModal';
import { TenderEstimatorModal } from './TenderEstimatorModal';
import { FieldIndirectCostModal } from './FieldIndirectCostModal';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { systemConfirm } from '@/shared/components/system-alert';
import { TRADE_LABELS, getNum } from './contracting-boq-tab/contracting-boq-tab-shared';
import { ContractingBoqTabHeader } from './contracting-boq-tab/contracting-boq-tab-header';
import { ContractingBoqTabPlanning } from './contracting-boq-tab/contracting-boq-tab-planning';
import { ContractingBoqTabStats } from './contracting-boq-tab/contracting-boq-tab-stats';
import { ContractingBoqTabToolbar } from './contracting-boq-tab/contracting-boq-tab-toolbar';
import { ContractingBoqTabTable } from './contracting-boq-tab/contracting-boq-tab-table';

interface ContractingBoqTabProps {
  items: ContractingBoqItem[];
  loading: boolean;
  projectId?: string;
  projectName?: string;
  clientName?: string;
  projectStatus?: string;
  onNewItem: () => void;
  onRefresh?: () => void;
  onAwardProject?: () => void;
}


export function ContractingBoqTab({
  items,
  loading,
  projectId,
  projectName,
  clientName,
  projectStatus,
  onNewItem,
  onRefresh,
  onAwardProject,
}: ContractingBoqTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currencySymbol } = useSystemCurrency();
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isImportMasterOpen, setIsImportMasterOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isAutoPricingOpen, setIsAutoPricingOpen] = useState(false);
  const [isQuotationOpen, setIsQuotationOpen] = useState(false);
  const [isMrpOpen, setIsMrpOpen] = useState(false);
  const [isProfitabilityOpen, setIsProfitabilityOpen] = useState(false);
  const [isIndirectCostOpen, setIsIndirectCostOpen] = useState(false);
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false);
  const [takeoffItem, setTakeoffItem] = useState<ContractingBoqItem | null>(null);
  const [isMobilizationOpen, setIsMobilizationOpen] = useState(false);
  const [isMilestonesOpen, setIsMilestonesOpen] = useState(false);
  const [isEquipmentOpen, setIsEquipmentOpen] = useState(false);
  const [isSuppliersOpen, setIsSuppliersOpen] = useState(false);
  const [isTenderEstimatorOpen, setIsTenderEstimatorOpen] = useState(false);

  // Edit & Delete states
  const [editingItem, setEditingItem] = useState<ContractingBoqItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Summary KPIs (Guarded against any NaN)
  const totalContractValue = items.reduce((sum, item) => {
    const qty = getNum(item.revisedQty ?? (item as any).revised_qty ?? item.contractQty ?? (item as any).contract_qty);
    const price = getNum(item.unitPrice ?? (item as any).unit_price);
    return sum + (qty * price);
  }, 0);

  const totalEstimatedCost = items.reduce((sum, item) => {
    const qty = getNum(item.revisedQty ?? (item as any).revised_qty ?? item.contractQty ?? (item as any).contract_qty);
    const cost = getNum(item.estimatedUnitCost ?? (item as any).estimated_unit_cost);
    return sum + (qty * cost);
  }, 0);

  const plannedMargin = totalContractValue > 0 ? ((totalContractValue - totalEstimatedCost) / totalContractValue) * 100 : 0;
  
  const executedValue = items.reduce((sum, item) => {
    const execQty = getNum(item.executedQty ?? (item as any).executed_qty);
    const price = getNum(item.unitPrice ?? (item as any).unit_price);
    return sum + (execQty * price);
  }, 0);

  const overallProgress = totalContractValue > 0 ? (executedValue / totalContractValue) * 100 : 0;

  const handleDeleteItem = async (id: string, code: string, desc: string) => {
    const confirmed = await systemConfirm({
      title: 'حذف بند المقايسة',
      message: `هل أنت متأكد من حذف البند [${code}] "${desc.slice(0, 35)}..." نهائياً من المقايسة؟`,
      confirmText: 'نعم، احذف البند',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setDeletingId(id);
    try {
      await contractingApi.deleteBoqItem(id);
      setNotification({ type: 'success', text: `تم حذف البند [${code}] بنجاح من المقايسة` });
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setNotification({ type: 'error', text: err?.message || 'تعذر حذف البند من المقايسة' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleExportExcel = async () => {
    if (items.length === 0) return;
    setIsExporting(true);
    try {
      const headers = [
        'كود البند',
        'بيان الأعمال والمواصفات',
        'التصنيف',
        'الوحدة',
        'الكمية التعاقدية',
        'الكمية المعدلة',
        'سعر الفئة التعاقدي',
        'إجمالي القيمة التعاقدية',
        'التكلفة التقديرية للوحدة',
        'الكمية المنفذة',
        'نسبة الإنجاز %',
        'ملاحظات',
      ];

      const rows = items.map((item) => {
        const contractQty = getNum(item.contractQty ?? (item as any).contract_qty);
        const revisedQty = getNum(item.revisedQty ?? (item as any).revised_qty ?? contractQty);
        const unitPrice = getNum(item.unitPrice ?? (item as any).unit_price);
        const total = revisedQty * unitPrice;
        const executedQty = getNum(item.executedQty ?? (item as any).executed_qty);
        const completion = revisedQty > 0 ? Math.min(100, Math.round((executedQty / revisedQty) * 100)) : 0;

        return [
          item.itemCode || (item as any).item_code || '',
          item.description,
          TRADE_LABELS[item.category] || item.category,
          item.unit,
          contractQty,
          revisedQty,
          unitPrice,
          total,
          getNum(item.estimatedUnitCost ?? (item as any).estimated_unit_cost),
          executedQty,
          `${completion}%`,
          item.notes || '',
        ];
      });

      const safeProjectName = projectName ? projectName.replace(/[/\\?%*:|"<>]/g, '_') : 'project';
      await downloadExcelFile(`BOQ_${safeProjectName}.xlsx`, headers, rows);
    } catch (err: any) {
      console.error('Failed to export BOQ Excel:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }} dir="rtl">
      {/* إشعار النجاح أو الخطأ */}
      {notification && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: '8px',
            fontSize: 'var(--font-body)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: notification.type === 'success' ? '#f0fdf4' : '#fef2f2',
            color: notification.type === 'success' ? '#15803d' : '#b91c1c',
            border: `1px solid ${notification.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
          }}
        >
          <span>{notification.text}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            <AppIcons.X size={16} />
          </button>
        </div>
      )}
      {/* هيدر التبويب */}
      <ContractingBoqTabHeader t={t} projectName={projectName} isExporting={isExporting} items={items} handleExportExcel={handleExportExcel} projectId={projectId} setIsImportModalOpen={setIsImportModalOpen} setIsImportMasterOpen={setIsImportMasterOpen} onNewItem={onNewItem} />
      {/* تنبيه واضح إذا كان المشروع عطاء قيد الدراسة والتسعير */}
      <ContractingBoqTabPlanning projectStatus={projectStatus} t={t} navigate={navigate} projectId={projectId} onAwardProject={onAwardProject} />
      {/* شريط الإحصائيات المصغر للجدول - في مقدمة المقايسة */}
      <ContractingBoqTabStats t={t} totalContractValue={totalContractValue} currencySymbol={currencySymbol} totalEstimatedCost={totalEstimatedCost} plannedMargin={plannedMargin} overallProgress={overallProgress} />
      {/* شريط الأدوات والتحليل الهندسي للمقايسة */}
      <ContractingBoqTabToolbar t={t} setIsAutoPricingOpen={setIsAutoPricingOpen} projectId={projectId} setIsProfitabilityOpen={setIsProfitabilityOpen} setIsIndirectCostOpen={setIsIndirectCostOpen} setIsSnapshotOpen={setIsSnapshotOpen} />
      {/* تنبيه توجيهي أنيق عند استيراد بنود جديدة بدون كميات */}
      {items.length > 0 && totalContractValue === 0 && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fef3c7',
            borderRadius: '10px',
            padding: '12px 16px',
            fontSize: 'var(--font-body)',
            color: '#b45309',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 1px 2px rgba(245, 158, 11, 0.05)',
          }}
        >
          <div style={{ color: '#d97706', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <AppIcons.AlertCircle size={18} />
          </div>
          <div style={{ lineHeight: 1.5 }}>
            <strong>{t('contracting.contracting_boq_tab.s21', "تنويه:")}</strong> {t('contracting.contracting_boq_tab.s22', "تم سحب البنود بنجاح من بنك البنود المرجعي. يرجى الضغط على زر")} <strong style={{ textDecoration: 'underline' }}>{t('contracting.contracting_boq_tab.s23', "\"0 (حدد الكمية)\"")}</strong> {t('contracting.contracting_boq_tab.s24', "أو زر التعديل أمام كل بند لتحديد كميات هذا المشروع وحساب إجمالي القيمة تلقائياً.")}
          </div>
        </div>
      )}
      {/* جدول البنود */}
      <ContractingBoqTabTable loading={loading} t={t} items={items} projectId={projectId} setIsImportModalOpen={setIsImportModalOpen} setIsImportMasterOpen={setIsImportMasterOpen} onNewItem={onNewItem} setEditingItem={setEditingItem} currencySymbol={currencySymbol} setIsAutoPricingOpen={setIsAutoPricingOpen} setTakeoffItem={setTakeoffItem} handleDeleteItem={handleDeleteItem} deletingId={deletingId} />
      {/* مودال إضافة/تعديل بند */}
      {editingItem && (
        <CreateBoqItemModal
          open={!!editingItem}
          projectId={projectId || ''}
          itemToEdit={editingItem}
          onClose={() => setEditingItem(null)}
          onSuccess={() => {
            setEditingItem(null);
            setNotification({ type: 'success', text: t('contracting.contracting_boq_tab.s48', "تم تحديث البند بنجاح") });
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {/* مودال استيراد المقايسة من Excel */}
      {isImportModalOpen && projectId && (
        <ImportBoqModal
          open={isImportModalOpen}
          projectId={projectId}
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {/* مودال استيراد بنود من بنك المقاولات المرجعي الشامل */}
      {isImportMasterOpen && projectId && (
        <ImportMasterBoqModal
          open={isImportMasterOpen}
          projectId={projectId}
          projectName={projectName || ''}
          onClose={() => setIsImportMasterOpen(false)}
          onSuccess={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {/* مودال محرك التسعير الهندسي */}
      {isAutoPricingOpen && (
        <AutoPricingModal
          isOpen={isAutoPricingOpen}
          onClose={() => {
            setIsAutoPricingOpen(false);
            setEditingItem(null);
          }}
          currencySymbol={currencySymbol}
          boqItems={items.filter((i) => !i.isSectionHeader)}
          selectedBoqItemId={editingItem ? String(editingItem.id) : undefined}
          initialCode={editingItem?.itemCode || ''}
          initialQuantity={editingItem?.contractQty || 100}
          onApplyPrice={async (suggestedUnitPrice, estimatedCost, targetItemId) => {
            const itemIdToUpdate = targetItemId || (editingItem ? String(editingItem.id) : undefined);
            if (!itemIdToUpdate) {
              setNotification({ type: 'error', text: t('contracting.contracting_boq_tab.s49', "يرجى تحديد البند المستهدف بالتحديث") });
              return;
            }

            try {
              await contractingApi.updateBoqItem(itemIdToUpdate, {
                unitPrice: suggestedUnitPrice,
                estimatedCost: estimatedCost,
              });
              setNotification({
                type: 'success',
                text: `تم اعتماد وتحديث سعر الفئة (${suggestedUnitPrice.toLocaleString()} ${currencySymbol}) للبند بنجاح!`,
              });
              if (onRefresh) onRefresh();
            } catch (err: any) {
              console.error('Failed to update BOQ item price:', err);
              setNotification({
                type: 'error',
                text: err?.message || t('contracting.contracting_boq_tab.s50', "تعذر تحديث سعر البند في المقايسة"),
              });
              throw err;
            }
          }}
        />
      )}

      {/* مودال عرض السعر الرسمي للعميل */}
      {isQuotationOpen && (
        <ClientQuotationModal
          isOpen={isQuotationOpen}
          onClose={() => setIsQuotationOpen(false)}
          projectName={projectName}
          clientName={clientName}
          items={items}
        />
      )}

      {/* مودال حصر خامات المشروع MRP */}
      {isMrpOpen && projectId && (
        <ProjectMaterialsMrpModal
          isOpen={isMrpOpen}
          onClose={() => setIsMrpOpen(false)}
          projectId={projectId}
          projectName={projectName}
        />
      )}

      {/* مودال تحليل ربحية وخسائر البنود */}
      {isProfitabilityOpen && projectId && (
        <BoqProfitabilityModal
          isOpen={isProfitabilityOpen}
          onClose={() => setIsProfitabilityOpen(false)}
          projectId={projectId}
          projectName={projectName}
        />
      )}

      {/* مودال تجميد الميزانية */}
      {isSnapshotOpen && projectId && (
        <CostSnapshotModal
          isOpen={isSnapshotOpen}
          onClose={() => setIsSnapshotOpen(false)}
          projectId={projectId}
          projectName={projectName}
        />
      )}

      {/* مودال حصر كميات الكاد */}
      {takeoffItem && (
        <BoqTakeoffSheetModal
          open={Boolean(takeoffItem)}
          boqItem={takeoffItem}
          projectName={projectName}
          onClose={() => setTakeoffItem(null)}
          onSuccess={() => {
            setTakeoffItem(null);
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {/* مودال تجهيز الموقع وسكن العمال */}
      {isMobilizationOpen && projectId && (
        <SiteMobilizationModal
          open={isMobilizationOpen}
          projectId={projectId}
          projectName={projectName}
          onClose={() => setIsMobilizationOpen(false)}
          onSuccess={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {/* مودال دفعات العميل والمقايضة العينية */}
      {isMilestonesOpen && projectId && (
        <ClientMilestonesModal
          open={isMilestonesOpen}
          projectId={projectId}
          projectName={projectName}
          contractValue={totalContractValue}
          onClose={() => setIsMilestonesOpen(false)}
          onSuccess={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {/* مودال تتبع العِدة والمعدات */}
      {isEquipmentOpen && (
        <EquipmentTrackingModal
          open={isEquipmentOpen}
          projectId={projectId}
          projectName={projectName}
          onClose={() => setIsEquipmentOpen(false)}
          onSuccess={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {/* مودال دليل الموردين والذاكرة السعرية */}
      {isSuppliersOpen && (
        <SuppliersDirectoryModal
          open={isSuppliersOpen}
          onClose={() => setIsSuppliersOpen(false)}
        />
      )}

      {/* مودال دراسة وتسعير العطاء وتفكيك الكود الهندسي */}
      {isTenderEstimatorOpen && (
        <TenderEstimatorModal
          isOpen={isTenderEstimatorOpen}
          onClose={() => setIsTenderEstimatorOpen(false)}
          initialProjectId={projectId}
          onProjectCreated={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {/* مودال محرك توزيع المصاريف غير المباشرة للموقع */}
      {isIndirectCostOpen && projectId && (
        <FieldIndirectCostModal
          open={isIndirectCostOpen}
          projectId={projectId}
          projectName={projectName}
          onClose={() => setIsIndirectCostOpen(false)}
          onChanged={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}
    </div>
  );
}
