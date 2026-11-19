import type { Dispatch, SetStateAction } from 'react';
import { PosItemModifiersModal } from '@/features/pos/components/pos-cart-panel/PosItemModifiersModal';
import { PosDraftSwitcherOverlay } from '@/features/pos/components/pos-workspace/PosDraftSwitcherOverlay';
import { PosOpenShiftModal } from '@/features/pos/components/pos-workspace/PosOpenShiftModal';
import { SerialLookupModal } from '@/features/products/components/SerialLookupModal';
import { QuickProductModal } from '@/shared/components/QuickProductModal';
import { PosRecentSalesReprintModal } from '@/features/pos/components/pos-workspace/PosRecentSalesReprintModal';
import type { usePosWorkspace } from '@/features/pos/hooks/usePosWorkspace';

// First aux-dialog group of the POS workspace: reprint, draft-switcher,
// modifiers, open-shift, serial lookup and quick-service mounts.
// Pure move from PosWorkspace; the workspace keeps all state.

export interface PosWorkspaceAuxDialogs1Props {
  reprintModalOpen: boolean;
  setReprintModalOpen: Dispatch<SetStateAction<boolean>>;
  focusBarcodeEntry: () => void;
  pos: ReturnType<typeof usePosWorkspace>;
  requestRecallHeldDraftByIndex: (index: number) => Promise<void>;
  modifiersModalLineKey: string;
  setModifiersModalLineKey: Dispatch<SetStateAction<string>>;
  openShiftModalOpen: boolean;
  setOpenShiftModalOpen: Dispatch<SetStateAction<boolean>>;
  serialLookupOpen: boolean;
  setSerialLookupOpen: Dispatch<SetStateAction<boolean>>;
  quickServiceOpen: boolean;
  setQuickServiceOpen: Dispatch<SetStateAction<boolean>>;
}

export function PosWorkspaceAuxDialogs1({
  reprintModalOpen,
  setReprintModalOpen,
  focusBarcodeEntry,
  pos,
  requestRecallHeldDraftByIndex,
  modifiersModalLineKey,
  setModifiersModalLineKey,
  openShiftModalOpen,
  setOpenShiftModalOpen,
  serialLookupOpen,
  setSerialLookupOpen,
  quickServiceOpen,
  setQuickServiceOpen,
}: PosWorkspaceAuxDialogs1Props) {
  return (
    <>
      {reprintModalOpen && (
        <PosRecentSalesReprintModal
          isOpen={reprintModalOpen}
          onClose={() => {
            setReprintModalOpen(false);
            focusBarcodeEntry();
          }}
          lastSale={pos.lastSale}
          settings={pos.settingsQuery.data || null}
          cashierName={(pos.ownOpenShift as any)?.openedByName || '—'}
          onReprintLastSale={() => {
            pos.reprintLastSale();
          }}
        />
      )}

      <PosDraftSwitcherOverlay
        drafts={pos.heldDraftSummaries}
        onRecall={requestRecallHeldDraftByIndex}
      />

      <PosItemModifiersModal
        open={Boolean(modifiersModalLineKey)}
        onClose={() => {
          setModifiersModalLineKey('');
          focusBarcodeEntry();
        }}
        item={pos.cart.find((item) => item.lineKey === modifiersModalLineKey) || null}
        onSave={(modifiers) => {
          if (modifiersModalLineKey) {
            pos.setItemModifiers(modifiersModalLineKey, modifiers);
          }
        }}
      />

      {openShiftModalOpen && (
        <PosOpenShiftModal
          open={openShiftModalOpen}
          onClose={() => {
            setOpenShiftModalOpen(false);
            focusBarcodeEntry();
          }}
          branches={pos.branchesQuery.data || []}
          locations={pos.locationsQuery.data || []}
          defaultBranchId={pos.branchId}
          defaultLocationId={pos.locationId}
          requirePassword={Boolean(pos.settings?.requirePasswordOnShiftOpen)}
          onShiftOpened={() => {
            void pos.refetchCatalogs();
          }}
        />
      )}

      {serialLookupOpen && (
        <SerialLookupModal
          open={serialLookupOpen}
          onClose={() => {
            setSerialLookupOpen(false);
            focusBarcodeEntry();
          }}
        />
      )}

      {quickServiceOpen && (
        <QuickProductModal
          isOpen={quickServiceOpen}
          onClose={() => setQuickServiceOpen(false)}
          itemType="service"
          onSuccess={(newServiceProduct) => {
            pos.handleAddProduct(newServiceProduct);
            focusBarcodeEntry();
          }}
        />
      )}
    </>
  );
}
