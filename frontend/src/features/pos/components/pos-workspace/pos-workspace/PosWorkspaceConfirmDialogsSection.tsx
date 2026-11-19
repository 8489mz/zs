import type { Dispatch, SetStateAction } from 'react';
import { PosWorkspaceConfirmDialogs } from '@/features/pos/components/pos-workspace/PosWorkspaceConfirmDialogs';
import { PosSaleSuccessDialog } from '@/features/pos/components/pos-workspace/PosSaleSuccessDialog';
import type { usePosWorkspace } from '@/features/pos/hooks/usePosWorkspace';
import type { PosItem } from '@/features/pos/types/pos.types';
import type { Customer } from '@/types/domain';
import type { HeldPosDraftSummary } from '@/features/pos/components/pos-cart-panel/posCartPanel.types';

// Confirmation and sale-success dialog mounts of the POS workspace.
// Pure move from PosWorkspace; the workspace keeps all state, handlers
// and the post-sale cycle.

export interface PosWorkspaceConfirmDialogsSectionProps {
  clearCartConfirmOpen: boolean;
  lineDeleteConfirmItem: PosItem | null;
  heldDeleteConfirmDraft: HeldPosDraftSummary | null;
  clearHeldConfirmOpen: boolean;
  pos: ReturnType<typeof usePosWorkspace>;
  setClearCartConfirmOpen: Dispatch<SetStateAction<boolean>>;
  focusBarcodeEntry: () => void;
  setLineDeleteConfirmKey: Dispatch<SetStateAction<string>>;
  lineDeleteConfirmKey: string;
  setHeldDeleteConfirmId: Dispatch<SetStateAction<string>>;
  heldDeleteConfirmId: string;
  setClearHeldConfirmOpen: Dispatch<SetStateAction<boolean>>;
  saleSuccessDialogOpen: boolean;
  lastSaleCustomer: Customer | null;
  setSaleSuccessDialogOpen: Dispatch<SetStateAction<boolean>>;
}

export function PosWorkspaceConfirmDialogsSection({
  clearCartConfirmOpen,
  lineDeleteConfirmItem,
  heldDeleteConfirmDraft,
  clearHeldConfirmOpen,
  pos,
  setClearCartConfirmOpen,
  focusBarcodeEntry,
  setLineDeleteConfirmKey,
  lineDeleteConfirmKey,
  setHeldDeleteConfirmId,
  heldDeleteConfirmId,
  setClearHeldConfirmOpen,
  saleSuccessDialogOpen,
  lastSaleCustomer,
  setSaleSuccessDialogOpen,
}: PosWorkspaceConfirmDialogsSectionProps) {
  return (
    <>
      <PosWorkspaceConfirmDialogs
        clearCartConfirmOpen={clearCartConfirmOpen}
        lineDeleteConfirmItem={lineDeleteConfirmItem}
        heldDeleteConfirmDraft={heldDeleteConfirmDraft}
        clearHeldConfirmOpen={clearHeldConfirmOpen}
        heldDraftsCount={pos.heldDraftSummaries.length}
        onCancelClearCart={() => {
          setClearCartConfirmOpen(false);
          focusBarcodeEntry();
        }}
        onConfirmClearCart={() => {
          pos.resetPosDraft();
          setClearCartConfirmOpen(false);
        }}
        onCancelLineDelete={() => {
          setLineDeleteConfirmKey('');
          focusBarcodeEntry();
        }}
        onConfirmLineDelete={() => {
          if (lineDeleteConfirmKey) pos.removeItem(lineDeleteConfirmKey);
          setLineDeleteConfirmKey('');
          focusBarcodeEntry();
        }}
        onCancelHeldDelete={() => {
          setHeldDeleteConfirmId('');
          focusBarcodeEntry();
        }}
        onConfirmHeldDelete={async () => {
          if (heldDeleteConfirmId) await pos.deleteDraft(heldDeleteConfirmId);
          setHeldDeleteConfirmId('');
          focusBarcodeEntry();
        }}
        onCancelClearHeld={() => {
          setClearHeldConfirmOpen(false);
          focusBarcodeEntry();
        }}
        onConfirmClearHeld={async () => {
          await pos.clearHeldDrafts();
          setClearHeldConfirmOpen(false);
          focusBarcodeEntry();
        }}
      />

      <PosSaleSuccessDialog
        open={saleSuccessDialogOpen && Boolean(pos.lastSale)}
        sale={pos.lastSale}
        customer={lastSaleCustomer}
        settings={pos.settingsQuery.data || null}
        onClose={() => {
          pos.completePostSaleCycle();
          setSaleSuccessDialogOpen(false);
          focusBarcodeEntry();
        }}
        onNewSale={() => {
          pos.completePostSaleCycle();
          setSaleSuccessDialogOpen(false);
          focusBarcodeEntry();
        }}
        onPrintReceipt={() => {
          pos.printReceiptNow();
          pos.completePostSaleCycle('تمت طباعة الريسيت. جاهز لعميل جديد.');
          setSaleSuccessDialogOpen(false);
          focusBarcodeEntry();
        }}
        onPrintDualReceipt={() => {
          pos.printDualReceiptNow();
          pos.completePostSaleCycle('تمت طباعة نسختي الريسيت (العميل + المحل). جاهز لعميل جديد.');
          setSaleSuccessDialogOpen(false);
          focusBarcodeEntry();
        }}
        onPrintA4={() => {
          pos.printA4Now();
          pos.completePostSaleCycle('تم فتح طباعة A4. جاهز لعميل جديد.');
          setSaleSuccessDialogOpen(false);
          focusBarcodeEntry();
        }}
        onPrintKitchen={() => {
          pos.printKitchenNow();
          pos.completePostSaleCycle('تم طباعة شيت المطبخ. جاهز لعميل جديد.');
          setSaleSuccessDialogOpen(false);
          focusBarcodeEntry();
        }}
        onPrintBoth={() => {
          pos.printBothNow();
          pos.completePostSaleCycle('تمت طباعة الريسيت وشيت المطبخ. جاهز لعميل جديد.');
          setSaleSuccessDialogOpen(false);
          focusBarcodeEntry();
        }}
      />
    </>
  );
}
