// List view tab — keyboard hints, held drafts with recall/delete, note,
// clear-all/close actions. Pure move; the dialog keeps all state and
// mounts this component with the list values and callbacks.

import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/shared/ui/button';
import type { HeldPosDraftSummary } from '@/features/pos/components/pos-cart-panel/posCartPanel.types';

export interface PosTablesListViewProps {
  heldDrafts: HeldPosDraftSummary[];
  selectedIndex: number;
  pendingRecallId: string;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  handleRecall: (draftId: string) => Promise<void>;
  onDeleteDraft?: (draftId: string) => Promise<void>;
  onClearAllDrafts?: () => Promise<void>;
  onClose: () => void;
}

export function PosTablesListView({
  heldDrafts,
  selectedIndex,
  pendingRecallId,
  setSelectedIndex,
  handleRecall,
  onDeleteDraft,
  onClearAllDrafts,
  onClose,
}: PosTablesListViewProps) {
  const { t: __t } = useTranslation();
  return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Keyboard Hints Bar */}
            <div style={{
              display: 'flex',
              gap: '16px',
              alignItems: 'center',
              background: '#f8fafc',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '0.78rem',
              color: '#64748b',
              border: '1px solid #e2e8f0',
              flexWrap: 'wrap',
            }}>
              <span><kbd style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '1px 5px', borderRadius: 4, fontWeight: 700, color: '#334155' }}>↑ ↓</kbd> {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s80', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s80', "للتنقل"))}</span>
              <span>•</span>
              <span><kbd style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '1px 5px', borderRadius: 4, fontWeight: 700, color: '#334155' }}>Enter</kbd> {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s81', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s81', "للاسترجاع"))}</span>
              <span>•</span>
              <span><kbd style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '1px 5px', borderRadius: 4, fontWeight: 700, color: '#334155' }}>Del</kbd> {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s82', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s82', "للحذف"))}</span>
              <span style={{ marginInlineStart: 'auto', color: '#94a3b8' }}>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s83', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s83', "أو انقر نقراً مزدوجاً بالماوس"))}</span>
            </div>

            {/* Drafts List */}
            {heldDrafts.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '380px', overflowY: 'auto', padding: '2px' }}>
                {heldDrafts.map((draft, idx) => {
                  const isSelected = selectedIndex === idx;
                  const isPending = pendingRecallId === draft.id;

                  return (
                    <div
                      key={draft.id}
                      onClick={() => setSelectedIndex(idx)}
                      onDoubleClick={() => void handleRecall(draft.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '14px',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        border: isSelected ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                        background: isSelected ? '#f8fafc' : '#ffffff',
                        boxShadow: isSelected ? '0 2px 8px rgba(15,23,42,0.06)' : 'none',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* Left: Draft Info & Badges */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: isSelected ? '#170e5e' : '#94a3b8' }}>
                            #{idx + 1}
                          </span>
                          <strong style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 700 }}>
                            {draft.label || __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s84', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s84', "عميل نقدي"))}
                          </strong>
                          <span style={{
                            background: draft.tableNumber ? '#f0fdf4' : '#eff6ff',
                            color: draft.tableNumber ? '#166534' : '#1e40af',
                            border: draft.tableNumber ? '1px solid #bbf7d0' : '1px solid #bfdbfe',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '4px',
                          }}>
                            {draft.tableNumber ? `طاولة: ${draft.tableNumber}` : draft.orderType === 'delivery' ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s85', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s85', "دليفري")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s86', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s86', "تيك أواي"))}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#64748b' }}>
                          <span>{draft.itemsCount} {draft.itemsCount === 1 ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s87', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s87', "صنف")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s88', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s88', "أصناف"))}</span>
                          <span>•</span>
                          <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s89', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s89', "الإجمالي:"))} <strong style={{ color: '#0f172a', fontWeight: 800 }}>{formatCurrency(draft.total)}</strong></span>
                        </div>
                      </div>

                      {/* Right: Action Buttons */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Button
                          type="button"
                          variant="primary"
                          disabled={isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRecall(draft.id);
                          }}
                          style={{
                            background: '#170e5e',
                            borderColor: '#170e5e',
                            color: '#ffffff',
                            fontWeight: 700,
                            minHeight: '30px',
                            padding: '0 14px',
                            fontSize: '12px',
                          }}
                        >
                          {isPending ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s90', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s90', "جاري الاسترجاع...")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s91', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s91', "استرجاع"))}
                        </Button>
                        {onDeleteDraft && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDeleteDraft(draft.id);
                            }}
                            style={{
                              minHeight: '30px',
                              padding: '0 10px',
                              fontSize: '12px',
                              color: '#dc2626',
                              borderColor: '#fca5a5',
                            }}
                          >
                            {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s92', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s92', "حذف"))}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '36px 20px', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #e2e8f0' }}>
                <p style={{ margin: 0, fontSize: '0.92rem', color: '#64748b', fontWeight: 600 }}>
                  {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s93', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s93', "لا توجد طلبات معلقة حالياً."))}
                </p>
              </div>
            )}

            {/* List Tab Footer Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
              {onClearAllDrafts && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { void onClearAllDrafts(); }}
                  disabled={!heldDrafts.length}
                  style={{
                    color: heldDrafts.length ? '#dc2626' : '#94a3b8',
                    borderColor: heldDrafts.length ? '#fca5a5' : '#e2e8f0',
                    fontSize: '12px',
                  }}
                >
                  {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s94', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s94', "حذف الكل"))}
                </Button>
              )}
              <Button variant="secondary" onClick={onClose} style={{ padding: '6px 16px', fontSize: '12.5px' }}>
                {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s95', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s95', "إغلاق"))}
              </Button>
            </div>
          </div>
  );
}
