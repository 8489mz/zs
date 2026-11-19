// Retail held-drafts dialog mount — standard (non-restaurant) mode.
// Pure move; the workspace keeps all state and mounts this component
// with the held-drafts values and callbacks.

import { PosHeldDraftsDialog } from '@/features/pos/components/pos-workspace/PosHeldDraftsDialog';
import { renameHeldDraftTableAndRefresh } from '@/features/pos/lib/pos-table-transfer';
import type { usePosWorkspace } from '@/features/pos/hooks/usePosWorkspace';

interface PosWorkspaceHeldDraftsDialogProps {
  heldDraftsDialogOpen: boolean;
  isRestaurantActive: boolean;
  pos: ReturnType<typeof usePosWorkspace>;
  shortcutRecallDraftId: string;
  setShortcutRecallDraftId: React.Dispatch<React.SetStateAction<string>>;
  setHeldDraftsDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  focusBarcodeEntry: () => void;
}

export function PosWorkspaceHeldDraftsDialog({
  heldDraftsDialogOpen,
  isRestaurantActive,
  pos,
  shortcutRecallDraftId,
  setShortcutRecallDraftId,
  setHeldDraftsDialogOpen,
  focusBarcodeEntry,
}: PosWorkspaceHeldDraftsDialogProps) {
  return (
    <>
      {/* 2. Standard Retail Held Drafts Dialog (Non-Restaurant Mode) */}
      {heldDraftsDialogOpen && !isRestaurantActive && (
        <PosHeldDraftsDialog
          open={heldDraftsDialogOpen && !isRestaurantActive}
          heldDrafts={pos.heldDraftSummaries}
          requestedRecallDraftId={shortcutRecallDraftId}
          onRequestedRecallHandled={() => setShortcutRecallDraftId('')}
          onClose={() => {
            setHeldDraftsDialogOpen(false);
            setShortcutRecallDraftId('');
            focusBarcodeEntry();
          }}
          onRecall={async (draftId) => {
            /* INV-REST-HOLD-RECALL-TRUTH (R5-B): a failed auto-hold
             * aborts the recall — the live cart is unrecoverable once
             * overwritten. The throw reaches PosHeldDraftsDialog, which
             * keeps the dialog open and shows the error. */
            if (pos.cart.length > 0) {
              await pos.holdDraft();
            }
            await pos.recallDraft(draftId);
          }}
          onDelete={async (draftId) => { await pos.deleteDraft(draftId); }}
          onClearAll={async () => { await pos.clearHeldDrafts(); }}
          onRename={async (draftId, toTable) => {
            /* INV-REST-FLOOR-TRANSFER-TRUTH (T10-E, F6): the dialog's
             * rename control reuses renameHeldDraftTable with the same
             * post-rename invalidation as a transfer. The throw reaches
             * PosHeldDraftsDialog, which keeps the dialog open and shows
             * the error. */
            const outcome = await renameHeldDraftTableAndRefresh({ draftId, toTable });
            if (outcome.status === 'error') throw new Error(outcome.message);
          }}
          settings={pos.settingsQuery.data}
        />
      )}
    </>
  );
}
