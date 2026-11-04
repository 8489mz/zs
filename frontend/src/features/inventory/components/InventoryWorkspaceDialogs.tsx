import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { ActionConfirmDialog } from '@/shared/components/action-confirm-dialog';
import { toast } from '@/shared/components/system-alert';
import type { StockCountSession, StockTransfer } from '@/types/domain';
import { useAuthStore, isAdminUser } from '@/stores/auth-store';

type ReceiptLine = {
  itemId: number; receivedQty: number;
  receivedSerials?: string[];
  batchReceipts?: Array<{ transitBatchId: number; receivedQty: number }>;
};
type ReceiptRows = Record<string, ReceiptLine[]>;
type ReceiptDraft = { receivedQty: string; serials: string; batches: string };
/** Variance reason per transfer, keyed by String(transfer.id). The
 *  reason is optional: a shortfall receipt completes without one and
 *  the shortage is recorded pending a reason; a supplied reason is
 *  stored as-is on each shortfall item. A full receipt sends none. */
type TransferVarianceReasons = Record<string, string>;

function transferHasShortfall(transfer: StockTransfer, draft: Record<string, ReceiptDraft>): boolean {
  return transfer.items.some((item) => {
    const entry = draft[`${transfer.id}:${item.id}`];
    const receivedQty = entry ? Number(entry.receivedQty) : Number(item.qty);
    return Number(item.qty) - receivedQty > 0.0001;
  });
}

function varianceReasonsFromDraft(
  transfers: StockTransfer[],
  draft: Record<string, ReceiptDraft>,
  reasons: TransferVarianceReasons,
): TransferVarianceReasons {
  const collected: TransferVarianceReasons = {};
  for (const transfer of transfers) {
    if (!transferHasShortfall(transfer, draft)) continue;
    const reason = (reasons[String(transfer.id)] || '').trim();
    if (reason) collected[String(transfer.id)] = reason;
  }
  return collected;
}

function receiptRowsFromDraft(transfers: StockTransfer[], draft: Record<string, ReceiptDraft>): ReceiptRows {
  const rows: ReceiptRows = {};
  for (const transfer of transfers) {
    rows[String(transfer.id)] = transfer.items.map((item) => {
      const key = `${transfer.id}:${item.id}`;
      const entry = draft[key];
      const dispatched = Number(item.qty);
      const receivedQty = entry ? Number(entry.receivedQty) : dispatched;
      if (!Number.isFinite(receivedQty) || receivedQty < 0 || receivedQty > dispatched ||
        Math.abs(receivedQty * 1000 - Math.round(receivedQty * 1000)) > 1e-7) {
        throw new Error(`كمية الاستلام غير صحيحة للصنف ${item.productName}`);
      }
      const receivedSerials = (entry?.serials || '').split(/[\n,،]+/).map(v => v.trim()).filter(Boolean);
      if (item.serialTracking?.length && receivedQty > 0 && receivedQty < dispatched && receivedSerials.length !== receivedQty) {
        throw new Error(`حدد السيريالات المستلمة فعلاً للصنف ${item.productName}`);
      }
      const rawBatchRows = (entry?.batches || '').split(/[\n,،]+/).map(v => v.trim()).filter(Boolean);
      const batchReceipts = rawBatchRows.map(line => {
        const parts = /^(\d+)\s*:\s*(\d+(?:\.\d+)?)$/.exec(line);
        if (!parts) throw new Error(`اكتب كل تشغيلة بصيغة رقم:كمية للصنف ${item.productName}`);
        return { transitBatchId: Number(parts[1]), receivedQty: Number(parts[2]) };
      });
      if (item.batchTracking?.length && receivedQty < dispatched && item.batchTracking.length > 1 &&
        !batchReceipts.length) {
        throw new Error(`حدد المستلم والفاقد لكل تشغيلة للصنف ${item.productName}`);
      }
      return {
        itemId: Number(item.id), receivedQty,
        ...(receivedSerials.length ? { receivedSerials } : {}),
        ...(batchReceipts.length ? { batchReceipts } : {}),
      };
    });
  }
  return rows;
}

export function InventoryTransferActionDialog({
  action,
  isBusy,
  onCancel,
  onConfirm
}: {
  action: { action: 'receive' | 'cancel'; transfers: StockTransfer[] } | null;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: (receipts?: ReceiptRows, varianceReasons?: TransferVarianceReasons) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [receiptDraft, setReceiptDraft] = useState<Record<string, ReceiptDraft>>({});
  const [varianceReasonDraft, setVarianceReasonDraft] = useState<TransferVarianceReasons>({});
  useEffect(() => { setReceiptDraft({}); setVarianceReasonDraft({}); }, [action]);
  const transferCount = action?.transfers.length || 0;
  const firstTransfer = action?.transfers[0] || null;
  const title = action?.action === 'receive' ? 'تأكيد استلام التحويل' : action?.action === 'cancel' ? 'تأكيد إلغاء التحويل' : '';
  const description = action
    ? action.action === 'receive'
      ? <>{t('inventory.inventory_workspace_dialogs.s0', "سيتم اعتماد استلام")} {transferCount > 1 ? <>{t('inventory.inventory_workspace_dialogs.s1', "عدد")} <strong>{transferCount}</strong> {t('inventory.inventory_workspace_dialogs.s2', "من التحويلات المحددة")}</> : <>{t('inventory.inventory_workspace_dialogs.s3', "التحويل")} <strong>{firstTransfer?.docNo || firstTransfer?.id}</strong></>} {t('inventory.inventory_workspace_dialogs.s4', "ونقل الكميات إلى المواقع الهدف. راجع البنود والجهات قبل المتابعة.")}</>
      : <>{t('inventory.inventory_workspace_dialogs.s5', "سيتم إلغاء")} {transferCount > 1 ? <>{t('inventory.inventory_workspace_dialogs.s6', "عدد")} <strong>{transferCount}</strong> {t('inventory.inventory_workspace_dialogs.s7', "من التحويلات المحددة")}</> : <>{t('inventory.inventory_workspace_dialogs.s8', "التحويل")} <strong>{firstTransfer?.docNo || firstTransfer?.id}</strong></>} {t('inventory.inventory_workspace_dialogs.s9', "ولن تصبح قابلة للاستلام لاحقًا. استخدم هذا الإجراء فقط إذا كانت التحويلات غير صالحة.")}</>
    : '';

  return (
    <ActionConfirmDialog
      open={Boolean(action)}
      title={title}
      description={<>
        {description}
        {action?.action === 'receive' ? (
          <div style={{ maxHeight: '240px', overflowY: 'auto', marginTop: 12 }}>
            {action.transfers.map(transfer => (
              <div key={`transfer-${transfer.id}`}>
                {transfer.items.map(item => {
              const key = `${transfer.id}:${item.id}`;
              const draft = receiptDraft[key];
              const patch = (change: Partial<ReceiptDraft>) =>
                setReceiptDraft(current => ({ ...current, [key]: {
                  receivedQty: current[key]?.receivedQty ?? String(item.qty),
                  serials: current[key]?.serials ?? '',
                  batches: current[key]?.batches ?? '',
                  ...change,
                } }));
              return (
                <div key={key} style={{ padding: '8px 0', borderBottom: '1px solid #e2e8f0' }}>
                  <strong>{item.productName} ({transfer.docNo || transfer.id})</strong>
                  <div className="form-grid" style={{ marginTop: 6 }}>
                    <label>الكمية المستلمة من {item.qty}
                      <input type="number" min={0} max={item.qty} step="0.001" value={draft?.receivedQty ?? String(item.qty)}
                        onChange={e => patch({ receivedQty: e.target.value })} disabled={isBusy} />
                    </label>
                    {item.serialTracking?.length ? <label>السيريالات المستلمة (رقم بكل سطر؛ المطلوب عند وجود فاقد)
                      <textarea rows={2} value={draft?.serials ?? ''} onChange={e => patch({ serials: e.target.value })}
                        placeholder="Serial / IMEI" disabled={isBusy}/>
                    </label> : null}
                    {item.batchTracking?.length ? <label>استلام التشغيلات (رقم تشغيلة الطريق:الكمية؛ مطلوب عند اختلاف كميات أكثر من تشغيلة)
                      <textarea rows={2} value={draft?.batches ?? ''} onChange={e => patch({ batches: e.target.value })}
                        placeholder={item.batchTracking.map(line => `${line.transitBatchId}:${line.qty}`).join('\n')} disabled={isBusy}/>
                    </label> : null}
                  </div>
                </div>
              );
            })}
                {transferHasShortfall(transfer, receiptDraft) ? (
                  <div style={{ padding: '8px 0', borderBottom: '1px solid #e2e8f0' }}>
                    <label>سبب فرق الكمية للتحويل {transfer.docNo || transfer.id} (اختياري — الفاقد يُسجَّل بانتظار السبب)
                      <textarea rows={2} value={varianceReasonDraft[String(transfer.id)] ?? ''}
                        onChange={e => setVarianceReasonDraft(current => ({ ...current, [String(transfer.id)]: e.target.value }))}
                        placeholder="مثال: نقصت وحدتان أثناء النقل" disabled={isBusy}/>
                    </label>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </>}
      confirmLabel={action?.action === 'receive' ? t('inventory.inventory_workspace_dialogs.s10', "تأكيد الاستلام") : t('inventory.inventory_workspace_dialogs.s11', "تأكيد الإلغاء")}
      confirmVariant={action?.action === 'receive' ? 'success' : 'danger'}
      isBusy={isBusy}
      onCancel={onCancel}
      onConfirm={() => {
        if (!action) return;
        if (action.action !== 'receive') return onConfirm();
        try {
          const rows = receiptRowsFromDraft(action.transfers, receiptDraft);
          const reasons = varianceReasonsFromDraft(action.transfers, receiptDraft, varianceReasonDraft);
          return onConfirm(rows, reasons);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'تعذر قراءة كميات استلام التحويل');
        }
      }}
    />
  );
}

export function InventoryPostSessionDialog({
  sessions,
  isBusy,
  onCancel,
  onConfirm
}: {
  sessions: StockCountSession[];
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: (context: { managerPin?: string }) => void;
}) {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const isAdmin = isAdminUser(user);
  // Manager approval is required only when a selected session posts a
  // variance or a serial/batch trace; a zero-variance session posts
  // without any approval credential (backend enforces the same rule).
  const hasVariance = sessions.some((session) => session.items.some((item) =>
    Math.abs(Number(item.varianceQty || 0)) >= 0.001 ||
    (Array.isArray(item.countedSerials) && item.countedSerials.length > 0) ||
    Boolean(String(item.batchCountsText || '').trim()),
  ));

  return (
    <ActionConfirmDialog
      open={Boolean(sessions.length)}
      title={t('inventory.inventory_workspace_dialogs.s12', "تأكيد اعتماد وترحيل جلسة الجرد")}
      description={sessions.length ? (sessions.length === 1 ? <>{t('inventory.inventory_workspace_dialogs.s13', "سيتم اعتماد الجلسة")} <strong>{sessions[0].docNo || sessions[0].id}</strong> {t('inventory.inventory_workspace_dialogs.s14', "وتسجيل فروقاتها على المخزون بشكل نهائي.")}</> : <>{t('inventory.inventory_workspace_dialogs.s15', "سيتم اعتماد")} <strong>{sessions.length}</strong> {t('inventory.inventory_workspace_dialogs.s16', "جلسات جرد محددة وتسجيل فروقاتها على المخزون بشكل نهائي.")}</>) : ''}
      confirmLabel={t('inventory.inventory_workspace_dialogs.s17', "اعتماد الجلسة")}
      confirmVariant="primary"
      managerPinRequired={!isAdmin && hasVariance}
      managerPinLabel="رمز اعتماد المدير أو كلمة مرور المدير"
      managerPinHint="أدخل رمز اعتماد المدير أو كلمة مرور حساب مدير لاعتماد فروقات الجلسة وتسوية الفروقات المخزنية."
      managerPinPlaceholder="أدخل رمز اعتماد المدير أو كلمة مرور المدير"
      managerPinInputType="password"
      isBusy={isBusy}
      onCancel={onCancel}
      onConfirm={({ managerPin }) => onConfirm({ managerPin })}
    />
  );
}
