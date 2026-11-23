import { ImportMasterBoqExcelModal } from '../../components/ImportMasterBoqExcelModal';
import type { useTranslation } from 'react-i18next';
import type { MasterBoqTrade } from '../../contracting.types';

export interface ContractingMasterBoqExcelImportModalProps {
  isExcelImportModalOpen: boolean;
  trades: MasterBoqTrade[];
  setIsExcelImportModalOpen: (val: boolean) => void;
  loadItems: () => Promise<void>;
  loadTrades: () => Promise<void>;
  setNotification: (val: { type: 'success' | 'error'; text: string } | null) => void;
  __t: ReturnType<typeof useTranslation>['t'];
}

export function ContractingMasterBoqExcelImportModal({ isExcelImportModalOpen, trades, setIsExcelImportModalOpen, loadItems, loadTrades, setNotification, __t }: ContractingMasterBoqExcelImportModalProps) {
  return (
    <>
    {/* مودال استيراد Excel */}
    {isExcelImportModalOpen && (
      <ImportMasterBoqExcelModal
        open={isExcelImportModalOpen}
        trades={trades}
        onClose={() => setIsExcelImportModalOpen(false)}
        onImported={() => {
          loadItems();
          loadTrades();
          setNotification({
            type: 'success',
            text: __t('contracting.contracting_master_boq_page.s44', "تم استيراد بنود المقاولات من ملف Excel بنجاح إلى بنك البنود المرجعي"),
          });
        }}
      />
    )}
    </>
  );
}
