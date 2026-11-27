import { useTranslation } from 'react-i18next';
import { ActionConfirmDialog } from '@/shared/components/action-confirm-dialog';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';

interface PosWorkspaceDiscountDialogProps {
  open: boolean;
  pos: PosWorkspaceState;
  onClose: () => void;
  onFocusBarcodeEntry: () => void;
}

export function PosWorkspaceDiscountDialog({
  open,
  pos,
  onClose,
  onFocusBarcodeEntry,
}: PosWorkspaceDiscountDialogProps) {
  const { t } = useTranslation();
  return (
    <ActionConfirmDialog
      open={open}
      title={t('pos.pos_workspace.pos_workspace_discount_dialog.s0', "اعتماد خصم الفاتورة")}
      description={t('pos.pos_workspace.pos_workspace_discount_dialog.s1', "أدخل رمز المدير أو كلمة مرور حساب المدير لفتح الخصم لهذه الفاتورة فقط. سيتم قفل الخصم تلقائيًا مع أي فاتورة جديدة.")}
      confirmLabel={t('pos.pos_workspace.pos_workspace_discount_dialog.s2', "اعتماد الخصم")}
      confirmVariant="primary"
      managerPinRequired
      managerPinLabel={t('pos.pos_workspace.pos_workspace_discount_dialog.s3', "رمز المدير أو كلمة المرور")}
      managerPinHint={t('pos.pos_workspace.pos_workspace_discount_dialog.s4', "سيتم إخفاء القيمة أثناء الكتابة، ولن يظل الاعتماد مفتوحًا إلا للفواتير الحالية فقط.")}
      isBusy={Boolean(pos.discountAuthorizationMutation.isPending)}
      onCancel={() => {
        pos.setDiscountApprovalSecret('');
        onClose();
      }}
      onConfirm={async ({ managerPin }) => {
        try {
          await pos.discountAuthorizationMutation.mutateAsync(managerPin);
          pos.setDiscountApprovalGranted(true);
          pos.setDiscountApprovalSecret(managerPin);
          pos.setSubmitMessage(t('pos.pos_workspace.pos_workspace_discount_dialog.s5', "تم اعتماد الخصم لهذه الفاتورة فقط."));
          onClose();
          onFocusBarcodeEntry();
        } catch (error) {
          pos.setDiscountApprovalSecret('');
          throw error;
        }
      }}
    />
  );
}
