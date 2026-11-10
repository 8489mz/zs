import { useTranslation } from 'react-i18next';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { useCallback, useEffect, useState } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { formatCurrency } from '@/lib/format';
import type { HeldPosDraftSummary } from '@/features/pos/components/pos-cart-panel/posCartPanel.types';

interface PosHeldDraftsDialogProps {
  open: boolean;
  heldDrafts: HeldPosDraftSummary[];
  requestedRecallDraftId?: string;
  onRequestedRecallHandled?: () => void;
  onClose: () => void;
  onRecall: (draftId: string) => Promise<void>;
  onDelete: (draftId: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  /* INV-REST-FLOOR-TRANSFER-TRUTH (T10-E, F6): the dialog offered only
   * Recall / Delete — a held draft's table could only be changed as a
   * side effect of a whole-table transfer. Optional so existing callers
   * without a rename path keep working. */
  onRename?: (draftId: string, toTable: string) => Promise<void>;
  settings?: any;
}

export function PosHeldDraftsDialog({
  open,
  heldDrafts,
  requestedRecallDraftId = '',
  onRequestedRecallHandled,
  onClose,
  onRecall,
  onDelete,
  onClearAll,
  onRename,
  settings,
}: PosHeldDraftsDialogProps) {
  const { t } = useTranslation();
  const [pendingRecallId, setPendingRecallId] = useState('');
  const [recallError, setRecallError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [renamingDraftId, setRenamingDraftId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renamePending, setRenamePending] = useState(false);

  /* INV-REST-FLOOR-TRANSFER-TRUTH (T10-E, F6): renaming a held draft's
   * table reuses renameHeldDraftTable via onRename (same post-rename
   * invalidation as a transfer). A failed rename stays open with the
   * error, like a failed recall; renaming to the same table is a no-op. */
  const requestRename = useCallback(async (draftId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError(t('pos.pos_workspace.pos_held_drafts_dialog.s24', 'أدخل رقم الطاولة.'));
      return;
    }
    const current = heldDrafts.find((d) => d.id === draftId)?.tableNumber;
    if (current && trimmed === String(current).trim()) {
      setRenamingDraftId('');
      setRenameError('');
      return;
    }
    if (!onRename) return;
    setRenamePending(true);
    setRenameError('');
    try {
      await onRename(draftId, trimmed);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'تعذّر تغيير الطاولة');
      return;
    } finally {
      setRenamePending(false);
    }
    setRenamingDraftId('');
  }, [heldDrafts, onRename, renameValue, t]);

  const requestRecall = useCallback(async (draftId: string) => {
    setPendingRecallId(draftId);
    setRecallError('');
    try {
      await onRecall(draftId);
    } catch (error) {
      /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the old finally closed the
       * dialog even when recall failed, hiding the error — and the cart
       * was already replaced, so the order could live twice. Stay open
       * and show the error; the live cart is untouched (recall deletes
       * the server draft before restoring, and aborts on delete
       * failure). */
      setRecallError(error instanceof Error ? error.message : 'تعذّر استرجاع الفاتورة المعلقة');
      return;
    } finally {
      setPendingRecallId('');
    }
    onClose();
  }, [onRecall, onClose]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex((current) => {
      if (!heldDrafts.length) return 0;
      return Math.min(current, heldDrafts.length - 1);
    });
  }, [heldDrafts, open]);

  useEffect(() => {
    if (!open || !requestedRecallDraftId) return;
    const exists = heldDrafts.some((entry) => entry.id === requestedRecallDraftId);
    if (!exists) {
      onRequestedRecallHandled?.();
      return;
    }
    void requestRecall(requestedRecallDraftId);
    onRequestedRecallHandled?.();
  }, [heldDrafts, onRequestedRecallHandled, open, requestRecall, requestedRecallDraftId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable));
      if (isTypingTarget) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (!heldDrafts.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((current) => Math.min(current + 1, heldDrafts.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const draft = heldDrafts[selectedIndex];
        if (draft) void requestRecall(draft.id);
        return;
      }
      if (event.key === 'Delete') {
        event.preventDefault();
        const draft = heldDrafts[selectedIndex];
        if (draft) void onDelete(draft.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [heldDrafts, onClose, onDelete, open, requestRecall, selectedIndex]);

  if (!open) return null;

  const isRestaurant = Boolean(settings?.restaurantModuleEnabled);
  const title = isRestaurant ? `الطاولات المفتوحة (${heldDrafts.length})` : `الفواتير المعلقة (${heldDrafts.length})`;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      width="min(680px, 95vw)"
      zIndex={87}
      ariaLabel={title}
    >
      <div style={{ padding: '24px 28px', direction: 'rtl', background: '#ffffff', borderRadius: '16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
              {isRestaurant ? t('pos.pos_workspace.pos_held_drafts_dialog.s0', "الطاولات المفتوحة") : t('pos.pos_workspace.pos_held_drafts_dialog.s1', "الفواتير المعلقة")}
            </h2>
            <span style={{
              background: '#f1f5f9',
              color: '#475569',
              fontSize: '0.78rem',
              fontWeight: 700,
              padding: '2px 9px',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
            }}>
              {heldDrafts.length}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#94a3b8',
              width: '30px',
              height: '30px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#0f172a'; e.currentTarget.style.background = '#f1f5f9'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'transparent'; }}
          ><XIcon size={15} /></button>
        </div>

        {/* Keyboard Hints Bar */}
        <div style={{
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          background: '#f8fafc',
          padding: '8px 14px',
          borderRadius: '8px',
          marginBottom: '16px',
          fontSize: '0.78rem',
          color: '#64748b',
          border: '1px solid #e2e8f0',
        }}>
          <span><kbd style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '1px 5px', borderRadius: 4, fontWeight: 700, color: '#334155' }}>↑ ↓</kbd> {t('pos.pos_workspace.pos_held_drafts_dialog.s2', "للتنقل")}</span>
          <span>•</span>
          <span><kbd style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '1px 5px', borderRadius: 4, fontWeight: 700, color: '#334155' }}>Enter</kbd> {t('pos.pos_workspace.pos_held_drafts_dialog.s3', "للاسترجاع")}</span>
          <span>•</span>
          <span><kbd style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '1px 5px', borderRadius: 4, fontWeight: 700, color: '#334155' }}>Del</kbd> {t('pos.pos_workspace.pos_held_drafts_dialog.s4', "للحذف")}</span>
          <span style={{ marginInlineStart: 'auto', color: '#94a3b8' }}>{t('pos.pos_workspace.pos_held_drafts_dialog.s5', "أو انقر نقراً مزدوجاً بالماوس")}</span>
        </div>

        {/* Drafts List */}
        {recallError || renameError ? (
          <div style={{ marginBottom: '12px', padding: '10px 14px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '0.85rem', fontWeight: 600 }}>
            {recallError || renameError}
          </div>
        ) : null}
        {heldDrafts.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '52vh', overflowY: 'auto', paddingRight: '2px', paddingLeft: '2px' }}>
            {heldDrafts.map((draft, idx) => {
              const isSelected = selectedIndex === idx;
              const isPending = pendingRecallId === draft.id;

              return (
                <div
                  key={draft.id}
                  onClick={() => setSelectedIndex(idx)}
                  onDoubleClick={() => { void requestRecall(draft.id); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px',
                    padding: '14px 18px',
                    borderRadius: '10px',
                    border: isSelected ? '1.5px solid #0f172a' : '1px solid #e2e8f0',
                    background: isSelected ? '#ffffff' : '#fafafa',
                    boxShadow: isSelected ? '0 4px 12px rgba(15,23,42,0.06)' : 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {/* Left: Draft Info & Badges */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: isSelected ? '#0f172a' : '#94a3b8',
                      }}>
                        #{idx + 1}
                      </span>
                      <strong style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 700 }}>
                        {draft.label || t('pos.pos_workspace.pos_held_drafts_dialog.s6', "عميل نقدي")}
                      </strong>
                      {isRestaurant && draft.orderType ? (
                        <span style={{
                          background: '#f1f5f9',
                          color: '#475569',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: '4px',
                          border: '1px solid #e2e8f0',
                        }}>
                          {draft.orderType === 'dine_in' ? `طاولة: ${draft.tableNumber || t('pos.pos_workspace.pos_held_drafts_dialog.s7', "غير محدد")}` : draft.orderType === 'delivery' ? t('pos.pos_workspace.pos_held_drafts_dialog.s8', "دليفري") : t('pos.pos_workspace.pos_held_drafts_dialog.s9', "تيك أواي")}
                        </span>
                      ) : null}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#64748b' }}>
                      <span>{draft.itemsCount} {draft.itemsCount === 1 ? t('pos.pos_workspace.pos_held_drafts_dialog.s10', "صنف") : t('pos.pos_workspace.pos_held_drafts_dialog.s11', "أصناف")}</span>
                      <span>•</span>
                      <span>{t('pos.pos_workspace.pos_held_drafts_dialog.s12', "الإجمالي:")} <strong style={{ color: '#0f172a', fontWeight: 800 }}>{formatCurrency(draft.total)}</strong></span>
                    </div>
                  </div>

                  {/* Right: Action Buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {renamingDraftId === draft.id ? (
                      <>
                        <input
                          type="text"
                          value={renameValue}
                          autoFocus
                          disabled={renamePending}
                          aria-label={t('pos.pos_workspace.pos_held_drafts_dialog.s23', 'رقم الطاولة الجديدة')}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void requestRename(draft.id);
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setRenamingDraftId('');
                              setRenameError('');
                            }
                          }}
                          style={{
                            width: '84px',
                            height: '32px',
                            padding: '0 10px',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            borderRadius: '7px',
                            border: '1px solid #0f172a',
                            background: '#ffffff',
                            color: '#0f172a',
                            textAlign: 'center',
                          }}
                        />
                        <button
                          type="button"
                          disabled={renamePending}
                          onClick={(e) => {
                            e.stopPropagation();
                            void requestRename(draft.id);
                          }}
                          style={{
                            padding: '7px 14px',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            borderRadius: '7px',
                            border: '1px solid #0f172a',
                            background: '#0f172a',
                            color: '#ffffff',
                            cursor: 'pointer',
                          }}
                        >
                          {renamePending ? t('pos.pos_workspace.pos_held_drafts_dialog.s25', 'جارٍ الحفظ...') : t('pos.pos_workspace.pos_held_drafts_dialog.s21', 'حفظ')}
                        </button>
                        <button
                          type="button"
                          disabled={renamePending}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingDraftId('');
                            setRenameError('');
                          }}
                          style={{
                            padding: '7px 12px',
                            fontSize: '0.82rem',
                            borderRadius: '7px',
                            border: '1px solid #e2e8f0',
                            background: 'transparent',
                            color: '#64748b',
                            cursor: 'pointer',
                          }}
                        >
                          {t('pos.pos_workspace.pos_held_drafts_dialog.s22', 'إلغاء')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            void requestRecall(draft.id);
                          }}
                          style={{
                            padding: '7px 16px',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            borderRadius: '7px',
                            border: '1px solid #0f172a',
                            background: '#0f172a',
                            color: '#ffffff',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {isPending ? t('pos.pos_workspace.pos_held_drafts_dialog.s13', "جاري الاسترجاع...") : t('pos.pos_workspace.pos_held_drafts_dialog.s14', "استرجاع")}
                        </button>
                        {onRename ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingDraftId(draft.id);
                              setRenameValue(String(draft.tableNumber || ''));
                              setRenameError('');
                            }}
                            style={{
                              padding: '7px 12px',
                              fontSize: '0.82rem',
                              borderRadius: '7px',
                              border: '1px solid #e2e8f0',
                              background: 'transparent',
                              color: '#334155',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {t('pos.pos_workspace.pos_held_drafts_dialog.s20', 'تغيير الطاولة')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onDelete(draft.id);
                          }}
                          style={{
                            padding: '7px 12px',
                            fontSize: '0.82rem',
                            borderRadius: '7px',
                            border: '1px solid #e2e8f0',
                            background: 'transparent',
                            color: '#64748b',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = '#dc2626';
                            e.currentTarget.style.borderColor = '#fca5a5';
                            e.currentTarget.style.background = '#fef2f2';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = '#64748b';
                            e.currentTarget.style.borderColor = '#e2e8f0';
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          {t('pos.pos_workspace.pos_held_drafts_dialog.s15', "حذف")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 20px', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #e2e8f0' }}>
            <p style={{ margin: 0, fontSize: '0.92rem', color: '#64748b', fontWeight: 600 }}>
              {isRestaurant ? t('pos.pos_workspace.pos_held_drafts_dialog.s16', "لا توجد طاولات مفتوحة حالياً.") : t('pos.pos_workspace.pos_held_drafts_dialog.s17', "لا توجد فواتير معلقة حالياً.")}
            </p>
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
          <button
            type="button"
            onClick={() => { void onClearAll(); }}
            disabled={!heldDrafts.length}
            style={{
              padding: '7px 14px',
              fontSize: '0.82rem',
              fontWeight: 600,
              borderRadius: '7px',
              border: '1px solid #fee2e2',
              background: 'transparent',
              color: heldDrafts.length ? '#dc2626' : '#cbd5e1',
              cursor: heldDrafts.length ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (heldDrafts.length) {
                e.currentTarget.style.background = '#fef2f2';
                e.currentTarget.style.borderColor = '#fca5a5';
              }
            }}
            onMouseLeave={(e) => {
              if (heldDrafts.length) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = '#fee2e2';
              }
            }}
          >
            {t('pos.pos_workspace.pos_held_drafts_dialog.s18', "حذف الكل")}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 20px',
              fontSize: '0.82rem',
              fontWeight: 600,
              borderRadius: '7px',
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              color: '#334155',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f1f5f9';
              e.currentTarget.style.color = '#0f172a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.color = '#334155';
            }}
          >
            {t('pos.pos_workspace.pos_held_drafts_dialog.s19', "إغلاق")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

