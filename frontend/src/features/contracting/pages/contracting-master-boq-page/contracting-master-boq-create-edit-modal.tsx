import { CreateMasterBoqItemModal } from '../../components/CreateMasterBoqItemModal';
import type { useTranslation } from 'react-i18next';
import type { MasterBoqItem, MasterBoqTrade } from '../../contracting.types';

export interface ContractingMasterBoqCreateEditModalProps {
  isCreateModalOpen: boolean;
  editingItem: MasterBoqItem | null;
  trades: MasterBoqTrade[];
  allItems: MasterBoqItem[];
  selectedTrade: string;
  setIsCreateModalOpen: (val: boolean) => void;
  setEditingItem: (val: MasterBoqItem | null) => void;
  loadItems: () => Promise<void>;
  loadTrades: () => Promise<void>;
  setNotification: (val: { type: 'success' | 'error'; text: string } | null) => void;
  __t: ReturnType<typeof useTranslation>['t'];
}

export function ContractingMasterBoqCreateEditModal({ isCreateModalOpen, editingItem, trades, allItems, selectedTrade, setIsCreateModalOpen, setEditingItem, loadItems, loadTrades, setNotification, __t }: ContractingMasterBoqCreateEditModalProps) {
  return (
    <>
    {/* مودال الإضافة والتعديل */}
    {isCreateModalOpen && (
      <CreateMasterBoqItemModal
        open={isCreateModalOpen}
        initialItem={editingItem}
        trades={trades}
        existingItems={allItems}
        initialTradeCategory={selectedTrade !== 'all' ? selectedTrade : undefined}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingItem(null);
        }}
        onSaved={() => {
          loadItems();
          loadTrades();
          setNotification({
            type: 'success',
            text: editingItem ? __t('contracting.contracting_master_boq_page.s42', "تم تحديث بيانات البند بنجاح") : __t('contracting.contracting_master_boq_page.s43', "تمت إضافة البند إلى بنك البنود المرجعي بنجاح"),
          });
        }}
      />
    )}
    </>
  );
}
