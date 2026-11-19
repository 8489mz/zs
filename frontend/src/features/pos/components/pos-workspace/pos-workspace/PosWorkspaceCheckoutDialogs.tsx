import type { Dispatch, SetStateAction } from 'react';
import { PosWorkspaceDiscountDialog } from '@/features/pos/components/pos-workspace/PosWorkspaceDiscountDialog';
import { PosWorkspaceWholesaleDialog } from '@/features/pos/components/pos-workspace/PosWorkspaceWholesaleDialog';
import { PosCheckoutDialog } from '@/features/pos/components/pos-workspace/PosCheckoutDialog';
import { PosSplitBillModal } from '@/features/pos/components/pos-workspace/PosSplitBillModal';
import type { usePosWorkspace } from '@/features/pos/hooks/usePosWorkspace';

// Checkout, split-bill, discount-approval and wholesale-approval
// dialog mounts of the POS workspace. Pure move from PosWorkspace;
// the workspace keeps all state and handlers.

export interface PosWorkspaceCheckoutDialogsProps {
  checkoutDialogOpen: boolean;
  pos: ReturnType<typeof usePosWorkspace>;
  selectedCustomerName: string;
  setCheckoutDialogOpen: Dispatch<SetStateAction<boolean>>;
  focusBarcodeEntry: () => void;
  isRestaurantActive: boolean;
  setSplitBillManagerPin: Dispatch<SetStateAction<string>>;
  setSplitBillOpen: Dispatch<SetStateAction<boolean>>;
  splitBillOpen: boolean;
  splitBillManagerPin: string;
  discountApprovalDialogOpen: boolean;
  setDiscountApprovalDialogOpen: Dispatch<SetStateAction<boolean>>;
  wholesaleApprovalDialogOpen: boolean;
  setWholesaleApprovalDialogOpen: Dispatch<SetStateAction<boolean>>;
}

export function PosWorkspaceCheckoutDialogs({
  checkoutDialogOpen,
  pos,
  selectedCustomerName,
  setCheckoutDialogOpen,
  focusBarcodeEntry,
  isRestaurantActive,
  setSplitBillManagerPin,
  setSplitBillOpen,
  splitBillOpen,
  splitBillManagerPin,
  discountApprovalDialogOpen,
  setDiscountApprovalDialogOpen,
  wholesaleApprovalDialogOpen,
  setWholesaleApprovalDialogOpen,
}: PosWorkspaceCheckoutDialogsProps) {
  return (
    <>
      <PosCheckoutDialog
        open={checkoutDialogOpen}
        pos={pos}
        selectedCustomerName={selectedCustomerName}
        onClose={() => {
          setCheckoutDialogOpen(false);
          focusBarcodeEntry();
        }}
        onOpenSplitBill={isRestaurantActive ? (pin) => { setSplitBillManagerPin(pin || ''); setSplitBillOpen(true); } : undefined}
        onConfirmSale={(managerPin, tenderedAmount) => {
          // T10-A (INV-REST-COMBO-TOTALS-TRUTH): close ONLY on a real
          // post. handleSubmit resolves false on every gate refusal
          // and on any server refusal (e.g. the 422 totals mismatch),
          // so the dialog stays open and the cashier keeps the cart
          // and the reason instead of a silent close (F1 + F8).
          void pos.handleSubmit({ managerPin, tenderedAmount }).then((posted) => {
            if (!posted) return;
            setCheckoutDialogOpen(false);
            focusBarcodeEntry();
          });
        }}
      />

      {splitBillOpen && (
        <PosSplitBillModal
          open={splitBillOpen}
          pos={pos}
          initialManagerPin={splitBillManagerPin}
          onClose={() => {
            setSplitBillOpen(false);
            setSplitBillManagerPin('');
            focusBarcodeEntry();
          }}
          onSplitCompleted={() => {
            setSplitBillOpen(false);
            setSplitBillManagerPin('');
            focusBarcodeEntry();
          }}
        />
      )}

      {discountApprovalDialogOpen && (
        <PosWorkspaceDiscountDialog
          open={discountApprovalDialogOpen}
          pos={pos}
          onClose={() => setDiscountApprovalDialogOpen(false)}
          onFocusBarcodeEntry={focusBarcodeEntry}
        />
      )}

      {wholesaleApprovalDialogOpen && (
        <PosWorkspaceWholesaleDialog
          open={wholesaleApprovalDialogOpen}
          pos={pos}
          onClose={() => setWholesaleApprovalDialogOpen(false)}
          onFocusBarcodeEntry={focusBarcodeEntry}
        />
      )}
    </>
  );
}
