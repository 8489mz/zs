import { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/shared/ui/button';

interface PosWorkspaceDockProps {
  qtySummaries: string[];
  itemsCount: number;
  total: number;
  canOpenCheckout: boolean;
  checkoutDisabledReason: string;
  isPending: boolean;
  heldDraftsCount: number;
  onFocusSearch: () => void;
  onPrintPreview: () => void;
  onResetDraft: () => void;
  onHoldDraft: () => void;
  onOpenHeldDrafts: () => void;
  onSubmit: () => void;
  settings?: any;
}

export function PosWorkspaceDock({
  qtySummaries,
  itemsCount,
  total,
  canOpenCheckout,
  checkoutDisabledReason,
  isPending,
  heldDraftsCount,
  onHoldDraft,
  onOpenHeldDrafts,
  onSubmit,
  settings,
}: PosWorkspaceDockProps) {
  const { t } = useTranslation();
  const dockRef = useRef<HTMLElement>(null);
  const [dockWidth, setDockWidth] = useState(0);

  useEffect(() => {
    if (!dockRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry?.contentRect) {
        setDockWidth(entry.contentRect.width);
      }
    });
    observer.observe(dockRef.current);
    return () => observer.disconnect();
  }, []);

  // When dock width is less than 640px, switch to 2 stacked rows to prevent button clipping
  const isCompact = dockWidth > 0 && dockWidth < 640;

  return (
    <section
      ref={dockRef}
      className={`pos-workspace-dock ${isCompact ? 'pos-dock-compact' : 'pos-dock-wide'}`}
      aria-label={t('pos.pos_workspace.pos_workspace_dock.s0', "شريط الكاشير السريع")}
      style={{
        padding: isCompact ? '6px 8px' : '4px 10px',
        margin: '0',
        boxSizing: 'border-box',
        background: 'transparent',
        border: 'none',
        boxShadow: 'none',
      }}
    >
      <div
        className="pos-workspace-dock-ribbon-track"
        style={{
          display: 'flex',
          flexDirection: isCompact ? 'column' : 'row',
          alignItems: isCompact ? 'stretch' : 'center',
          justifyContent: isCompact ? 'flex-start' : 'space-between',
          flexWrap: 'nowrap',
          width: '100%',
          gap: isCompact ? '6px' : '14px',
          padding: '0',
          minHeight: 'unset',
          boxSizing: 'border-box',
        }}
      >
        {/* Summary metrics (إجمالي الكميات, عدد العناصر, المطلوب دفعه) */}
        <div
          className="pos-workspace-dock-summary pos-workspace-dock-summary-extended"
          style={{
            display: isCompact ? 'grid' : 'flex',
            gridTemplateColumns: isCompact ? 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.35fr)' : undefined,
            alignItems: 'stretch',
            gap: '0',
            width: isCompact ? '100%' : 'auto',
            flexShrink: 0,
            padding: '0',
            background: 'rgba(255, 255, 255, 0.92)',
            border: '1px solid rgba(226, 232, 240, 0.95)',
            borderRadius: '8px',
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        >
          <div
            className="pos-workspace-dock-chip pos-workspace-dock-chip--surface"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: isCompact ? '4px 8px' : '6px 16px',
              minWidth: 0,
              minHeight: isCompact ? '40px' : '44px',
              borderInlineEnd: '1px solid rgba(226, 232, 240, 0.92)',
              boxSizing: 'border-box',
            }}
          >
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>
              {t('pos.pos_workspace.pos_workspace_dock.s1', "إجمالي الكميات")}
            </span>
            {qtySummaries.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', marginTop: '1px', minWidth: 0, maxWidth: '100%' }}>
                {qtySummaries.map((s, i) => (
                  <strong
                    key={i}
                    style={{
                      fontSize: qtySummaries.length > 1 ? '13px' : '15px',
                      lineHeight: '1.1',
                      color: '#0f172a',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                    }}
                  >
                    {s}
                  </strong>
                ))}
              </div>
            ) : (
              <strong style={{ fontSize: '15px', lineHeight: '1.1', color: '#0f172a', marginTop: '1px' }}>0</strong>
            )}
          </div>

          <div
            className="pos-workspace-dock-chip pos-workspace-dock-chip--surface"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: isCompact ? '4px 8px' : '6px 16px',
              minWidth: 0,
              minHeight: isCompact ? '40px' : '44px',
              borderInlineEnd: '1px solid rgba(226, 232, 240, 0.92)',
              boxSizing: 'border-box',
            }}
          >
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>
              {t('pos.pos_workspace.pos_workspace_dock.s2', "عدد العناصر")}
            </span>
            <strong style={{ fontSize: '16px', lineHeight: '1.1', color: '#0f172a', marginTop: '1px' }}>
              {itemsCount}
            </strong>
          </div>

          <div
            className="pos-workspace-dock-chip"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: isCompact ? '4px 10px' : '6px 20px',
              minWidth: 0,
              minHeight: isCompact ? '40px' : '44px',
              background: '#f8fafc',
              boxSizing: 'border-box',
            }}
          >
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>
              {t('pos.pos_workspace.pos_workspace_dock.s3', "المطلوب دفعه")}
            </span>
            <strong
              style={{
                fontSize: isCompact ? '18px' : '22px',
                fontWeight: 800,
                lineHeight: '1.1',
                color: '#0f172a',
                marginTop: '1px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
              }}
            >
              {formatCurrency(total)}
            </strong>
          </div>
        </div>

        {/* Action buttons (تعليق F4, معلقة F3, إتمام البيع F2) */}
        <div
          className="pos-workspace-dock-actions pos-workspace-dock-actions-inline"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: isCompact ? '100%' : 'auto',
            flexShrink: 0,
            padding: '0',
            boxSizing: 'border-box',
          }}
        >
          <Button
            type="button"
            variant="secondary"
            className="pos-dock-btn-hold"
            onClick={onHoldDraft}
            disabled={itemsCount === 0 || isPending}
            style={{
              flex: isCompact ? '1 1 75px' : '0 0 auto',
              maxWidth: isCompact ? '110px' : undefined,
              height: '42px',
              padding: isCompact ? '4px 8px' : '6px 16px',
              fontSize: '12.5px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box',
            }}
          >
            <span className="pos-dock-btn-desktop-text">
              {t('pos.pos_workspace.pos_workspace_dock.s5', "تعليق F4")}
            </span>
            <span className="pos-dock-btn-mobile-text">
              {t('pos.pos_workspace.pos_workspace_dock.s7', "تعليق")}
            </span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            className="pos-dock-btn-drafts"
            onClick={onOpenHeldDrafts}
            style={{
              flex: isCompact ? '1.1 1 85px' : '0 0 auto',
              maxWidth: isCompact ? '125px' : undefined,
              height: '42px',
              padding: isCompact ? '4px 8px' : '6px 16px',
              fontSize: '12.5px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box',
            }}
          >
            <span className="pos-dock-btn-desktop-text">
              {settings?.restaurantModuleEnabled
                ? `طاولات مفتوحة (${heldDraftsCount}) F3`
                : `معلقة (${heldDraftsCount}) F3`}
            </span>
            <span className="pos-dock-btn-mobile-text">
              {settings?.restaurantModuleEnabled
                ? `طاولات (${heldDraftsCount})`
                : `معلقة (${heldDraftsCount})`}
            </span>
          </Button>

          <Button
            type="button"
            variant="success"
            className="pos-dock-btn-submit"
            onClick={onSubmit}
            disabled={isPending || !canOpenCheckout}
            aria-disabled={isPending || !canOpenCheckout}
            title={isPending ? t('pos.pos_workspace.pos_workspace_dock.s8', "جاري تنفيذ البيع") : (checkoutDisabledReason || undefined)}
            style={{
              flex: isCompact ? '2 1 120px' : '0 0 auto',
              minWidth: isCompact ? '120px' : '160px',
              height: '42px',
              padding: isCompact ? '4px 14px' : '6px 24px',
              fontSize: '15.5px',
              fontWeight: 800,
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box',
              boxShadow: '0 2px 6px rgba(22, 101, 52, 0.2)',
            }}
          >
            {isPending ? t('pos.pos_workspace.pos_workspace_dock.s9', "جارٍ الحفظ...") : (
              <>
                <span className="pos-dock-btn-desktop-text">{t('pos.pos_workspace.pos_workspace_dock.s10', "إتمام البيع F2")}</span>
                <span className="pos-dock-btn-mobile-text">{t('pos.pos_workspace.pos_workspace_dock.s11', "إتمام البيع")}</span>
              </>
            )}
          </Button>
        </div>

      </div>
    </section>
  );
}
