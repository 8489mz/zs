import { useTranslation } from 'react-i18next';
import { ActionConfirmDialog } from '@/shared/components/action-confirm-dialog';
import type { HeldPosDraftSummary } from '@/features/pos/components/pos-cart-panel/posCartPanel.types';
import type { PosItem } from '@/features/pos/types/pos.types';

interface PosWorkspaceConfirmDialogsProps {
  clearCartConfirmOpen: boolean;
  lineDeleteConfirmItem: PosItem | null;
  heldDeleteConfirmDraft: HeldPosDraftSummary | null;
  clearHeldConfirmOpen: boolean;
  heldDraftsCount: number;
  onCancelClearCart: () => void;
  onConfirmClearCart: () => void;
  onCancelLineDelete: () => void;
  onConfirmLineDelete: () => void;
  onCancelHeldDelete: () => void;
  onConfirmHeldDelete: () => void | Promise<void>;
  onCancelClearHeld: () => void;
  onConfirmClearHeld: () => void | Promise<void>;
}

export function PosWorkspaceConfirmDialogs({
  clearCartConfirmOpen,
  lineDeleteConfirmItem,
  heldDeleteConfirmDraft,
  clearHeldConfirmOpen,
  heldDraftsCount,
  onCancelClearCart,
  onConfirmClearCart,
  onCancelLineDelete,
  onConfirmLineDelete,
  onCancelHeldDelete,
  onConfirmHeldDelete,
  onCancelClearHeld,
  onConfirmClearHeld,
}: PosWorkspaceConfirmDialogsProps) {
  const { t } = useTranslation();
  return (
    <>
      <ActionConfirmDialog
        open={clearCartConfirmOpen}
        overlayClassName="pos-destructive-confirm-overlay"
        shellClassName="pos-destructive-confirm-shell"
        title={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s0', "هل تريد تفريغ الفاتورة الحالية؟")}
        description={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s1', "سيتم حذف كل بنود الفاتورة الحالية فقط، ولن يتم حذف أي فاتورة معلقة.")}
        confirmLabel={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s3', "تفريغ")}
        cancelLabel={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s2', "إلغاء")}
        confirmVariant="danger"
        onCancel={onCancelClearCart}
        onConfirm={onConfirmClearCart}
      />

      <ActionConfirmDialog
        open={Boolean(lineDeleteConfirmItem)}
        overlayClassName="pos-destructive-confirm-overlay"
        shellClassName="pos-destructive-confirm-shell"
        title={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s4', "تأكيد حذف البند")}
        description={lineDeleteConfirmItem ? `سيتم حذف ${lineDeleteConfirmItem.name} من الفاتورة الحالية.` : ''}
        confirmLabel={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s5', "حذف")}
        cancelLabel={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s6', "إلغاء")}
        confirmVariant="danger"
        onCancel={onCancelLineDelete}
        onConfirm={onConfirmLineDelete}
      />

      <ActionConfirmDialog
        open={Boolean(heldDeleteConfirmDraft)}
        overlayClassName="pos-destructive-confirm-overlay"
        shellClassName="pos-destructive-confirm-shell"
        title={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s7', "تأكيد حذف الفاتورة المعلقة")}
        description={heldDeleteConfirmDraft ? `سيتم حذف ${heldDeleteConfirmDraft.label} من الفواتير المعلقة.` : ''}
        confirmLabel={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s8', "حذف")}
        cancelLabel={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s9', "إلغاء")}
        confirmVariant="danger"
        onCancel={onCancelHeldDelete}
        onConfirm={onConfirmHeldDelete}
      />

      <ActionConfirmDialog
        open={clearHeldConfirmOpen}
        overlayClassName="pos-destructive-confirm-overlay"
        shellClassName="pos-destructive-confirm-shell"
        title={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s10', "تأكيد حذف كل الفواتير المعلقة")}
        description={`سيتم حذف ${heldDraftsCount} فاتورة معلقة من هذه الشاشة. اكتب حذف الكل للتأكيد.`}
        confirmationKeyword={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s11', "حذف الكل")}
        confirmLabel={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s12', "حذف")}
        cancelLabel={t('pos.pos_workspace.pos_workspace_confirm_dialogs.s13', "إلغاء")}
        confirmVariant="danger"
        onCancel={onCancelClearHeld}
        onConfirm={onConfirmClearHeld}
      />
    </>
  );
}
