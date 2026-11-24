import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import type { useTranslation } from 'react-i18next';

export interface ProductsTableCardNoteModalProps {
  activeNoteModal: { productName: string; note: string } | null;
  setActiveNoteModal: (val: { productName: string; note: string } | null) => void;
  __t: ReturnType<typeof useTranslation>['t'];
}

export function ProductsTableCardNoteModal({ activeNoteModal, setActiveNoteModal, __t }: ProductsTableCardNoteModalProps) {
  return (
    <>
    {/* Product Note Modal */}
    {activeNoteModal && (
      <StandardDialog
        open={Boolean(activeNoteModal)}
        onClose={() => setActiveNoteModal(null)}
        title={__t('products.products_table_card.s72', "ملاحظات الصنف")}
        subtitle={activeNoteModal.productName}
        maxWidth="480px"
        footerActions={
          <StandardDialogFooter
            cancelText={__t('products.products_table_card.s73', "إغلاق")}
            onCancel={() => setActiveNoteModal(null)}
          />
        }
      >
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 16px', fontSize: '0.9rem', lineHeight: 1.7, color: '#1e293b', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {activeNoteModal.note}
        </div>
      </StandardDialog>
    )}
    </>
  );
}
