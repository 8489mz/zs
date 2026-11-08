import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getCurrencyDecimals, getGlobalCurrencySymbol } from '@/lib/currencies';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { toast } from '@/shared/components/system-alert';
import { AlertTriangleIcon, CheckIcon, XIcon } from '@/shared/components/icons/AppIcons';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value';
import { productsApi } from '@/features/products';
import { MaintenanceIcons as Icons, statusConfig } from './MaintenanceConstants';
import { maintenanceApi } from '../api/maintenance.api';
import type { MaintenanceTicket, MaintenanceStatus } from '@/types/domain-models/maintenance';
import type { getMaintenanceProfile } from '../constants/maintenance-profiles';

interface MaintenanceDetailModalProps {
  ticket: MaintenanceTicket | null;
  onClose: () => void;
  onOpenSettlement: (ticket: MaintenanceTicket) => void;
  onSendWhatsApp: (ticket: MaintenanceTicket) => void;
  onPrintReceipt: (ticket: MaintenanceTicket) => void;
  maintenanceProfile: ReturnType<typeof getMaintenanceProfile>;
  commissionRate: number;
}

/* One combobox row: a real catalog product found by the server-side search. */
type PartProductOption = {
  id: string;
  name: string;
  stock: number;
  retailPrice: number;
  costPrice: number;
  barcode: string;
};

/* Diagnosis / quote fields (package 9): getTicket exposes them, but
 * MaintenanceTicket in domain-models does not declare them yet, so
 * they are read through an explicit intersection — the same pattern
 * package 7 used for refundedAdvance — never `as any`. */
type TicketWithQuote = MaintenanceTicket & {
  diagnosis?: string | null;
  quotedCost?: number | null;
  quoteApprovedAt?: string | null;
  quoteApprovedBy?: number | null;
};

export function MaintenanceDetailModal({
  ticket,
  onClose,
  onOpenSettlement,
  onSendWhatsApp,
  onPrintReceipt,
  maintenanceProfile,
  commissionRate,
}: MaintenanceDetailModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [currentTicket, setCurrentTicket] = useState<MaintenanceTicket | null>(ticket);

  const [selectedProductId, setSelectedProductId] = useState('');
  const [partSearchText, setPartSearchText] = useState('');
  const [partQty, setPartQty] = useState(1);
  const [partPrice, setPartPrice] = useState(0);
  const [editingCost, setEditingCost] = useState<number | null>(null);
  const [pendingCashRefundStatus, setPendingCashRefundStatus] = useState<MaintenanceStatus | null>(null);

  /* Diagnosis / quote drafts (package 9, review P2-5): the technician
   * records the finding + quoted cost during 'inspecting', and the
   * customer approval is recorded by staff with an explicit flag. */
  const [diagnosisDraft, setDiagnosisDraft] = useState('');
  const [quotedCostDraft, setQuotedCostDraft] = useState('');

  /* Device passcode is masked by default (P1-3): the real value is shown
   * only after an explicit show action, and it is never printed from here. */
  const [showPasscode, setShowPasscode] = useState(false);

  /* Synchronous record of the picked part: the combobox calls onSelect and
   * then onChange(label) in the same tick, so state set by onSelect is not
   * yet visible to the onChange guard. The ref is the guard's source of
   * truth; the state above is what renders the dispatch button. It also
   * retains the full picked option: 250 ms after the pick the debounced
   * search text becomes the option label, a query key that never runs, so
   * the option list empties while the button stays enabled. Dispatch must
   * resolve from this retained pick, never from the (possibly empty) list. */
  const selectedPartRef = useRef<(PartProductOption & { label: string }) | null>(null);

  const clearPartSelection = () => {
    selectedPartRef.current = null;
    setSelectedProductId('');
  };

  /* Search-as-you-type against the real catalog (server-side `q` matches
   * name / barcode / SKU, Arabic-normalized). The whole catalog is never
   * fetched: it can hold 10k+ products and the combobox shows at most 8.
   * No request fires until the technician types, and none fires for the
   * label text left in the box after a pick (it is not a search query). */
  const debouncedPartSearch = useDebouncedValue(partSearchText, 250);
  const trimmedPartSearch = debouncedPartSearch.trim();
  const { data: partSearchData } = useQuery({
    queryKey: ['maintenance-part-products', trimmedPartSearch],
    queryFn: () => productsApi.listPage({ q: trimmedPartSearch, page: 1, pageSize: 20 }),
    enabled:
      Boolean(currentTicket) &&
      trimmedPartSearch.length > 0 &&
      trimmedPartSearch !== selectedPartRef.current?.label,
  });
  const partOptions = useMemo<PartProductOption[]>(
    () =>
      (partSearchData?.products || []).map((p: any) => ({
        id: String(p.id),
        name: p.name,
        stock: Number(p.stock ?? p.stock_qty ?? 0),
        retailPrice: Number(p.retailPrice ?? p.retail_price ?? 0),
        costPrice: Number(p.costPrice ?? p.cost_price ?? 0),
        barcode: p.barcode || '',
      })),
    [partSearchData],
  );
  const getPartOptionLabel = (p: PartProductOption) =>
    `${p.name} (متاح: ${p.stock}) - ${p.retailPrice} ${getGlobalCurrencySymbol()}`;

  /* Which ticket the modal's drafts belong to. The ticket prop arrives
   * as a FRESH object whenever the parent list refetch re-derives the
   * selected ticket (same id, new identity): resetting the in-progress
   * pick on every identity change wiped a part the technician had
   * already picked and left the dispatch button disabled under live
   * clicks (LF-P1). The reset below runs only when a DIFFERENT ticket
   * is opened (or the modal closes); a same-ticket refresh keeps the
   * pick, the drafts and the prices, and only refreshes the shown
   * ticket content. */
  const openedTicketIdRef = useRef<string | null>(ticket?.id ?? null);

  useEffect(() => {
    const nextId = ticket?.id ?? null;
    if (nextId === openedTicketIdRef.current) {
      setCurrentTicket(ticket);
      return;
    }
    openedTicketIdRef.current = nextId;
    setCurrentTicket(ticket);
    setEditingCost(null);
    setPendingCashRefundStatus(null);
    setShowPasscode(false);
    clearPartSelection();
    setPartSearchText('');
    setPartQty(1);
    setPartPrice(0);
    const quote = ticket as TicketWithQuote | null;
    setDiagnosisDraft(quote?.diagnosis ?? '');
    setQuotedCostDraft(quote?.quotedCost === null || quote?.quotedCost === undefined ? '' : String(quote.quotedCost));
  }, [ticket]);

  const refreshCurrentTicket = async (ticketId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['maintenance-tickets'] });
    const res = await maintenanceApi.get(ticketId);
    setCurrentTicket(res.ticket);
  };

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, finalCost, collectedAmount, technicianNotes, refundAdvance, diagnosis, quotedCost, approveQuote }: { id: string; status: MaintenanceStatus; finalCost?: number; collectedAmount?: number; technicianNotes?: string; refundAdvance?: boolean; diagnosis?: string; quotedCost?: number; approveQuote?: boolean }) => {
      /* diagnosis / quotedCost / approveQuote ride the same PATCH body
       * the backend DTO accepts; maintenance.api.ts updateStatus has
       * not gained the typed fields yet (package scope), so the
       * payload is built as a variable — extra properties on a
       * non-literal object are structurally fine — instead of a fresh
       * literal the narrower api type would reject. The values are
       * sent verbatim by JSON.stringify. */
      const payload: { status: MaintenanceStatus; finalCost?: number; collectedAmount?: number; technicianNotes?: string; refundAdvance?: boolean; diagnosis?: string; quotedCost?: number; approveQuote?: boolean } =
        { status, finalCost, collectedAmount, technicianNotes, refundAdvance, diagnosis, quotedCost, approveQuote };
      return maintenanceApi.updateStatus(id, payload);
    },
    onSuccess: () => {
      setPendingCashRefundStatus(null);
      if (currentTicket) void refreshCurrentTicket(currentTicket.id);
    },
  });

  /* A failed dispatch must name the actual problem — never a generic
   * message, and never silence (LF-P1: four live clicks produced no
   * error at all). The backend already returns a specific message +
   * code (ApiError.code): the English closed-ticket message is rendered
   * in Arabic with the ticket number, the Arabic stock message is shown
   * verbatim because it already names the part, and anything else falls
   * back to the backend message — never a bare "تعذر تنفيذ العملية". */
  const getAddPartErrorMessage = (error: unknown): string => {
    const code = (error as { code?: unknown } | null)?.code;
    const backendMessage = error instanceof Error && error.message ? error.message : '';
    const ticketNo = currentTicket?.ticketNo ?? '';
    if (code === 'MAINTENANCE_CLOSED') {
      return `لا يمكن صرف قطع غيار لتذكرة مغلقة — التذكرة ${ticketNo} مسلّمة/ملغاة ولا تقبل صرفًا جديدًا.`;
    }
    if (backendMessage) return backendMessage;
    return `تعذّر صرف قطعة الغيار على التذكرة ${ticketNo} — راجع المخزون وحالة التذكرة ثم حاول مجددًا.`;
  };

  const addPartMutation = useMutation({
    mutationFn: ({ ticketId, payload }: { ticketId: string; payload: any }) =>
      maintenanceApi.addPart(ticketId, payload),
    onSuccess: () => {
      clearPartSelection();
      setPartSearchText('');
      setPartQty(1);
      setPartPrice(0);
      if (currentTicket) void refreshCurrentTicket(currentTicket.id);
    },
    onError: (error) => {
      toast.error(getAddPartErrorMessage(error));
    },
  });

  const removePartMutation = useMutation({
    mutationFn: ({ ticketId, partId }: { ticketId: string; partId: string }) =>
      maintenanceApi.removePart(ticketId, partId),
    onSuccess: () => {
      if (currentTicket) void refreshCurrentTicket(currentTicket.id);
    },
  });

  const handleAddPartSubmit = () => {
    if (!currentTicket || !selectedProductId) return;
    /* Prefer the retained pick: after the 250 ms debounce the option list
     * is empty (the label query key never runs), so resolving from the list
     * alone silently drops a dispatch the button still offers. The list is
     * only a fallback for a selection whose retained snapshot is gone. */
    const retained = selectedPartRef.current;
    const prod =
      retained && retained.id === selectedProductId
        ? retained
        : partOptions.find((p) => p.id === selectedProductId);
    if (!prod) return;

    addPartMutation.mutate({
      ticketId: currentTicket.id,
      payload: {
        productId: Number(prod.id),
        productName: prod.name,
        qty: Number(partQty || 1),
        unitCost: Number(prod.costPrice || 0),
        unitPrice: Number(partPrice || 0),
      },
    });
  };

  if (!currentTicket) return null;

  const quoteTicket = currentTicket as TicketWithQuote;
  const isTicketOpen = !['delivered', 'cancelled', 'unrepairable'].includes(currentTicket.status);
  const storedDiagnosis = quoteTicket.diagnosis ?? '';
  const storedQuotedCostText =
    quoteTicket.quotedCost === null || quoteTicket.quotedCost === undefined ? '' : String(quoteTicket.quotedCost);
  const storedQuotedCost = quoteTicket.quotedCost === null || quoteTicket.quotedCost === undefined ? null : Number(quoteTicket.quotedCost);
  const quoteUnchanged = diagnosisDraft === storedDiagnosis && quotedCostDraft === storedQuotedCostText;

  const totalCost = currentTicket.finalCost || currentTicket.expectedCost || 0;
  const partsCost = (currentTicket.parts || []).reduce((acc, p) => acc + (p.qty * (p.unitCost || 0)), 0);
  const partsPrice = (currentTicket.parts || []).reduce((acc, p) => acc + (p.qty * (p.unitPrice || 0)), 0);
  const partsProfit = Math.max(0, partsPrice - partsCost);
  const laborPrice = Math.max(0, totalCost - partsPrice);
  const technicianCommission = laborPrice * (commissionRate / 100);
  const storeProfit = Math.max(0, (laborPrice - technicianCommission) + partsProfit);

  return (
    <DialogShell
      open={Boolean(currentTicket)}
      onClose={onClose}
      width="min(880px, 96vw)"
      ariaLabel={`تذكرة رقم ${currentTicket.ticketNo}`}
    >
      <div className="page-stack" dir="rtl" style={{ gap: '14px', padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                {t('maintenance.maintenance_detail_modal.s0', "بطاقة صيانة الجهاز:")}{' '}
                <span style={{ fontFamily: 'monospace', color: '#0f172a', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: '5px' }}>
                  {currentTicket.ticketNo}
                </span>
              </h3>
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: '5px',
                  fontSize: '0.775rem',
                  fontWeight: 700,
                  background: '#ffffff',
                  color: '#475569',
                  border: '1px solid #e2e8f0',
                }}
              >
                {statusConfig[currentTicket.status]?.label || currentTicket.status}
              </span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '3px' }}>
              {t('maintenance.maintenance_detail_modal.s1', "تاريخ الاستلام:")} {new Date(currentTicket.receivedAt).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <Button
              variant="secondary"
              onClick={() => onSendWhatsApp(currentTicket)}
              style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              <Icons.WhatsApp />
              <span>{t('maintenance.maintenance_detail_modal.s2', "إرسال واتساب")}</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => onPrintReceipt(currentTicket)}
              style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              <Icons.Printer />
              <span>{t('maintenance.maintenance_detail_modal.s3', "طباعة")}</span>
            </Button>
            <button
              type="button"
              onClick={onClose}
              style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', width: '30px', height: '30px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}
            >
              <XIcon size={14} />
            </button>
          </div>
        </div>

        {/* Status Stepper / Switcher */}
        <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
            {t('maintenance.maintenance_detail_modal.s4', "مرحلة عمل وصيانة الجهاز:")}
          </div>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            {(['received', 'inspecting', 'in_progress', 'waiting_parts', 'repaired', 'delivered', 'unrepairable', 'cancelled'] as MaintenanceStatus[]).map((st) => {
              const isCurrent = currentTicket.status === st;
              const cfg = statusConfig[st];
              return (
                <button
                  key={st}
                  type="button"
                  disabled={updateStatusMutation.isPending ||
                    ['delivered', 'cancelled', 'unrepairable'].includes(currentTicket.status) ||
                    pendingCashRefundStatus !== null}
                  onClick={() => {
                    if (st === 'delivered') {
                      onOpenSettlement(currentTicket);
                    } else if (['cancelled', 'unrepairable'].includes(st) &&
                      Number(currentTicket.advancePayment || 0) > 0) {
                      // Financial cancellation is opt-in. Never silently refund
                      // cash when the operator merely changes a status.
                      setPendingCashRefundStatus(st);
                    } else {
                      updateStatusMutation.mutate({ id: currentTicket.id, status: st });
                    }
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    border: isCurrent ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                    background: isCurrent ? '#ffffff' : '#f8fafc',
                    color: isCurrent ? '#0f172a' : '#64748b',
                    boxShadow: isCurrent ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isCurrent ? cfg?.dot || '#cbd5e1' : '#cbd5e1' }} />
                  <span>{cfg?.label || st}</span>
                </button>
              );
            })}
          </div>
          {/* A failed status change must name the reason (e.g. the
           * quote-approval gate blocking in_progress) instead of
           * failing silently — the stepper has no other error surface. */}
          {updateStatusMutation.isError && (
            <div role="alert" style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '6px', border: '1px solid #fecdd3', background: '#fff1f2', color: '#9f1239', fontSize: '0.8rem', fontWeight: 600 }}>
              {t('maintenance.maintenance_detail_modal.status_change_failed', 'تعذّر تغيير الحالة:')} {(updateStatusMutation.error as Error)?.message || t('maintenance.maintenance_detail_modal.status_change_failed_fallback', 'راجع حالة التذكرة ثم حاول مجددًا.')}
            </div>
          )}
          {pendingCashRefundStatus && (
            <div role="alert" style={{ marginTop: '10px', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff' }}>
              <strong style={{ fontSize: '0.85rem', color: '#9f1239' }}>
                {t('maintenance.confirm_advance_refund', 'تأكيد إلغاء التذكرة ورد العربون النقدي')}
              </strong>
              <p style={{ margin: '8px 0', fontSize: '0.82rem', color: '#334155' }}>
                {t('maintenance.advance_refund_notice', 'سيتم تسجيل رد نقدي للعميل وعكس التزام العربون في الدفتر العام:')}{' '}
                {Number(currentTicket.advancePayment || 0).toFixed(getCurrencyDecimals())} {getGlobalCurrencySymbol()}.
              </p>
              {(currentTicket.parts || []).length > 0 && (
                <p style={{ fontSize: '0.82rem', color: '#9f1239' }}>
                  {t('maintenance.return_parts_before_refund', 'يجب رد جميع قطع الغيار أولاً من قائمة القطع قبل رد العربون.')}
                </p>
              )}
              {updateStatusMutation.isError && (
                <p style={{ fontSize: '0.8rem', color: '#9f1239' }}>
                  {t('maintenance.refund_failed', 'لم يتم رد العربون. راجع حالة التذكرة أو القيد ثم حاول مجددًا.')}
                </p>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <Button type="button" variant="secondary" onClick={() => setPendingCashRefundStatus(null)}
                  disabled={updateStatusMutation.isPending}>
                  {t('common.cancel', 'تراجع')}
                </Button>
                <Button type="button" variant="secondary"
                  disabled={updateStatusMutation.isPending || (currentTicket.parts || []).length > 0}
                  onClick={() => updateStatusMutation.mutate({
                    id: currentTicket.id, status: pendingCashRefundStatus, refundAdvance: true,
                  })}>
                  {t('maintenance.refund_and_cancel', 'تأكيد رد العربون نقدًا وإلغاء الصيانة')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Customer, Device & Passcode Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px', fontSize: '0.825rem' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ color: '#64748b', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
              <Icons.User />
              <span>{t('maintenance.maintenance_detail_modal.s5', "العميل:")}</span>
            </div>
            <strong style={{ color: '#0f172a' }}>{currentTicket.customerName}</strong>
            <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '1px' }} dir="ltr">{currentTicket.customerPhone}</div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ color: '#64748b', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
              <Icons.Device />
              <span>{t('maintenance.maintenance_detail_modal.s6', "الجهاز:")}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginBottom: '1px' }}>
              {currentTicket.deviceBrand && (
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    padding: '1px 5px',
                    borderRadius: '4px',
                    background: '#f1f5f9',
                    color: '#475569',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  {currentTicket.deviceBrand}
                </span>
              )}
              <strong style={{ color: '#0f172a' }}>{currentTicket.deviceModel}</strong>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#64748b' }}>
              <span dir="ltr">{maintenanceProfile.serialLabel}: {currentTicket.serialNumber || '—'}</span>
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ color: '#64748b', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
              <Icons.Lock />
              <span>{maintenanceProfile.passcodeLabel}:</span>
            </div>
            {currentTicket.passcode ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong dir="ltr" style={{ color: '#0f172a', fontFamily: 'monospace' }}>{showPasscode ? currentTicket.passcode : '••••••'}</strong>
                <button
                  type="button"
                  onClick={() => setShowPasscode((v) => !v)}
                  aria-label={showPasscode ? t('maintenance.maintenance_detail_modal.hide_passcode', "إخفاء") : t('maintenance.maintenance_detail_modal.show_passcode', "إظهار")}
                  style={{ background: 'transparent', border: '1px solid #e2e8f0', borderRadius: '5px', padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700, color: '#475569', cursor: 'pointer' }}
                >
                  {showPasscode ? t('maintenance.maintenance_detail_modal.hide_passcode', "إخفاء") : t('maintenance.maintenance_detail_modal.show_passcode', "إظهار")}
                </button>
              </span>
            ) : (
              <strong style={{ color: '#0f172a' }}>{t('maintenance.maintenance_detail_modal.s7', "بدون قفل")}</strong>
            )}
          </div>

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ color: '#64748b', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
              <Icons.Shield />
              <span>{t('maintenance.maintenance_detail_modal.s8', "فترة الضمان:")}</span>
            </div>
            <strong style={{ color: '#0f172a' }}>{currentTicket.warrantyDays || 30} {t('maintenance.maintenance_detail_modal.s9', "يوماً")}</strong>
          </div>
        </div>

        <div>
          <div style={{ color: '#475569', fontSize: '0.8rem', fontWeight: 700, marginBottom: '4px' }}>{t('maintenance.maintenance_detail_modal.s10', "عطل الجهاز المشتكى منه:")}</div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem', color: '#1e293b', lineHeight: 1.5 }}>
            {currentTicket.problemDescription}
          </div>
        </div>

        {/* Diagnosis & quote approval (package 9, review P2-5): the
         * diagnosis lives in its own column, separate from the
         * free-text technician notes, and the customer approves the
         * quoted price before repair starts. There is no customer
         * portal — staff record the approval with an explicit flag;
         * the backend stamps who approved and when. Moving to
         * in_progress with an unapproved quote is rejected by the
         * backend gate (MAINTENANCE_QUOTE_APPROVAL_REQUIRED). */}
        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
            {t('maintenance.maintenance_detail_modal.diagnosis_title', "التشخيص والتسعير قبل الإصلاح:")}
          </div>
          {storedQuotedCost !== null && storedQuotedCost > 0 && !quoteTicket.quoteApprovedAt && (
            <div role="alert" style={{ marginBottom: '8px', padding: '8px 10px', borderRadius: '6px', border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangleIcon size={14} color="#d97706" />
              <span>{t('maintenance.maintenance_detail_modal.quote_awaiting_approval', "بانتظار اعتماد العميل على السعر قبل بدء الصيانة — لا يمكن نقل التذكرة إلى «قيد الصيانة» قبل الاعتماد.")}</span>
            </div>
          )}
          {quoteTicket.quoteApprovedAt && (
            <div style={{ marginBottom: '8px', padding: '8px 10px', borderRadius: '6px', border: '1px solid #a7f3d0', background: '#ecfdf5', color: '#065f46', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckIcon size={14} color="#065f46" />
              <span>
                {t('maintenance.maintenance_detail_modal.quote_approved', "تم اعتماد العميل على السعر:")} {storedQuotedCost !== null ? `${storedQuotedCost.toFixed(2)} ` : ''}<CurrencySymbol />
                {' — '}{new Date(quoteTicket.quoteApprovedAt).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </div>
          )}
          {storedDiagnosis && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem', color: '#1e293b', lineHeight: 1.5, marginBottom: '8px' }}>
              <span style={{ color: '#475569', fontWeight: 700 }}>{t('maintenance.maintenance_detail_modal.diagnosis_label', "التشخيص:")} </span>
              {storedDiagnosis}
            </div>
          )}
          {isTicketOpen && (
            <div style={{ display: 'grid', gap: '8px', background: '#f8fafc', padding: '8px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <textarea
                aria-label={t('maintenance.maintenance_detail_modal.diagnosis_placeholder', "تشخيص الفني للعطل")}
                placeholder={t('maintenance.maintenance_detail_modal.diagnosis_placeholder', "تشخيص الفني للعطل — مثال: شاشة مكسورة وتحتاج استبدال، البطارية سليمة")}
                value={diagnosisDraft}
                onChange={(e) => setDiagnosisDraft(e.target.value)}
                style={{ minHeight: '60px', lineHeight: 1.5, padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '0.825rem', width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label={t('maintenance.maintenance_detail_modal.quoted_cost_placeholder', "السعر المعروض على العميل")}
                  placeholder={t('maintenance.maintenance_detail_modal.quoted_cost_placeholder', "السعر المعروض على العميل")}
                  value={quotedCostDraft}
                  onChange={(e) => setQuotedCostDraft(e.target.value)}
                  style={{ height: '35px', padding: '0 12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '0.825rem', width: '160px', boxSizing: 'border-box' }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={quoteUnchanged || updateStatusMutation.isPending}
                  onClick={() => {
                    const parsed = quotedCostDraft.trim() === '' ? undefined : Number(quotedCostDraft);
                    updateStatusMutation.mutate({
                      id: currentTicket.id,
                      status: currentTicket.status,
                      diagnosis: diagnosisDraft,
                      quotedCost: parsed,
                    });
                  }}
                  style={{ padding: '3px 12px', fontSize: '0.8rem', fontWeight: 700 }}
                >
                  {t('maintenance.maintenance_detail_modal.save_diagnosis_quote', "حفظ التشخيص والسعر")}
                </Button>
                {storedQuotedCost !== null && storedQuotedCost > 0 && !quoteTicket.quoteApprovedAt && (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={updateStatusMutation.isPending}
                    onClick={() => updateStatusMutation.mutate({
                      id: currentTicket.id,
                      status: currentTicket.status,
                      approveQuote: true,
                    })}
                    style={{ padding: '3px 12px', fontSize: '0.8rem', fontWeight: 700 }}
                  >
                    {t('maintenance.maintenance_detail_modal.approve_quote', "تأكيد اعتماد العميل على السعر")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Parts Dispatch Area */}
        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icons.Wrench />
              <span>{t('maintenance.maintenance_detail_modal.s11', "صرف قطع الغيار من المخزن على الكود (")}{currentTicket.ticketNo})</span>
            </h4>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{(currentTicket.parts || []).length} {t('maintenance.maintenance_detail_modal.s12', "قطعة مسجلة")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 85px 105px auto', gap: '8px', marginBottom: '8px', background: '#f8fafc', padding: '8px', borderRadius: '8px', border: '1px solid #e2e8f0', alignItems: 'center' }}>
            <SearchableCombobox
              inline
              inputClassName="purchase-prototype-field-input"
              placeholder={t('maintenance.maintenance_detail_modal.s13', "ابحث عن قطعة غيار في المخزن بالاسم أو الباركود...")}
              value={partSearchText}
              onChange={(value) => {
                setPartSearchText(value);
                /* Typing over a picked part unpicks it: dispatch must always
                 * send the part shown in the box, never a stale selection. */
                if (selectedPartRef.current && value !== selectedPartRef.current.label) {
                  clearPartSelection();
                }
              }}
              options={partOptions}
              getLabel={getPartOptionLabel}
              getMeta={(p) => `${p.barcode} ${p.name}`}
              onSelect={(p) => {
                selectedPartRef.current = { ...p, label: getPartOptionLabel(p) };
                setSelectedProductId(p.id);
                setPartSearchText(p.name);
                setPartPrice(Number(p.retailPrice || 0));
              }}
            />
            <input
              type="number"
              min="1"
              placeholder={t('maintenance.maintenance_detail_modal.s14', "الكمية")}
              className="purchase-prototype-field-input"
              value={partQty}
              onChange={(e) => setPartQty(Number(e.target.value))}
              style={{ height: '36px', padding: '0 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '0.825rem', width: '100%', boxSizing: 'border-box', margin: 0 }}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder={t('maintenance.maintenance_detail_modal.s15', "السعر")}
              className="purchase-prototype-field-input"
              value={partPrice}
              onChange={(e) => setPartPrice(Number(e.target.value))}
              style={{ height: '36px', padding: '0 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '0.825rem', width: '100%', boxSizing: 'border-box', margin: 0 }}
            />
            <Button
              type="button"
              variant="primary"
              onClick={handleAddPartSubmit}
              /* A closed ticket can never accept a dispatch — the backend
               * rejects it with MAINTENANCE_CLOSED — so the button is not
               * offered at all instead of taking clicks that fail (LF-P1). */
              disabled={!selectedProductId || !isTicketOpen || addPartMutation.isPending}
              style={{ height: '36px', padding: '0 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', margin: 0, fontWeight: 700, fontSize: '0.825rem' }}
            >
              {addPartMutation.isPending ? t('maintenance.maintenance_detail_modal.s16', "جاري...") : t('maintenance.maintenance_detail_modal.s17', "+ صرف")}
            </Button>
          </div>

          {/* A failed dispatch must name the reason in place (same pattern
           * as the status-change error above) — the toast alone is not
           * enough if the technician missed it. The message itself is in
           * its own span so it stays addressable verbatim. */}
          {addPartMutation.isError && (
            <div role="alert" style={{ marginBottom: '8px', padding: '8px 10px', borderRadius: '6px', border: '1px solid #fecdd3', background: '#fff1f2', color: '#9f1239', fontSize: '0.8rem', fontWeight: 600 }}>
              {t('maintenance.maintenance_detail_modal.add_part_failed', 'تعذّر صرف قطعة الغيار:')}{' '}
              <span>{getAddPartErrorMessage(addPartMutation.error)}</span>
            </div>
          )}

          {(currentTicket.parts || []).length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'right', color: '#475569', fontSize: '0.78rem' }}>
                  <th style={{ padding: '7px 10px' }}>{t('maintenance.maintenance_detail_modal.s18', "القطعة")}</th>
                  <th style={{ padding: '7px 10px' }}>{t('maintenance.maintenance_detail_modal.s19', "الكمية")}</th>
                  <th style={{ padding: '7px 10px' }}>{t('maintenance.maintenance_detail_modal.s20', "سعر الوحدة")}</th>
                  <th style={{ padding: '7px 10px' }}>{t('maintenance.maintenance_detail_modal.s21', "الإجمالي")}</th>
                  <th style={{ padding: '7px 10px', textAlign: 'center' }}>{t('maintenance.maintenance_detail_modal.s22', "إلغاء الصرف")}</th>
                </tr>
              </thead>
              <tbody>
                {currentTicket.parts?.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '7px 10px', fontWeight: 600, color: '#0f172a' }}>{p.productName}</td>
                    <td style={{ padding: '7px 10px' }}>{p.qty}</td>
                    <td style={{ padding: '7px 10px' }}>{p.unitPrice.toFixed(2)} <CurrencySymbol /></td>
                    <td style={{ padding: '7px 10px', fontWeight: 700, color: '#0f172a' }}>{p.totalPrice.toFixed(2)} <CurrencySymbol /></td>
                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                      <button
                        type="button"
                        style={{ color: '#9f1239', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                        onClick={() => removePartMutation.mutate({ ticketId: currentTicket.id, partId: p.id })}
                        title={t('maintenance.maintenance_detail_modal.s23', "إلغاء وإرجاع للمخزن")}
                      >
                        <XIcon size={12} color="#9f1239" />
                        <span>{t('maintenance.maintenance_detail_modal.s24', "إرجاع")}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: '0.8rem', textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '6px', border: '1px dashed #e2e8f0' }}>
              {t('maintenance.maintenance_detail_modal.s25', "لم يتم صرف أي قطع غيار على هذا الجهاز بعد.")}
            </div>
          )}
        </div>

        {/* Profit & Labor Commission Breakdown */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
          <div style={{ fontSize: '0.825rem', fontWeight: 700, color: '#1e293b', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icons.Coins />
              <span>{t('maintenance.maintenance_detail_modal.s26', "حساب أرباح الصيانة وعمولة الفني:")}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem' }}>
              <span style={{ color: '#64748b' }}>{t('maintenance.maintenance_detail_modal.s27', "تعديل إجمالي الحساب:")}</span>
              <input
                type="number"
                min="0"
                step="10"
                className="purchase-prototype-field-input"
                value={editingCost ?? totalCost}
                onChange={(e) => setEditingCost(Number(e.target.value))}
                style={{ width: '90px', padding: '3px 6px', borderRadius: '5px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 700, textAlign: 'center', fontSize: '0.85rem' }}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={editingCost === null || editingCost === totalCost || updateStatusMutation.isPending}
                onClick={() => {
                  if (editingCost !== null) {
                    updateStatusMutation.mutate({ id: currentTicket.id, status: currentTicket.status, finalCost: editingCost });
                    setEditingCost(null);
                  }
                }}
                style={{ padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700 }}
              >
                {t('maintenance.maintenance_detail_modal.s28', "تحديث الحساب")}
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '0.78rem', textAlign: 'center' }}>
            <div style={{ background: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ color: '#64748b', marginBottom: '1px' }}>{t('maintenance.maintenance_detail_modal.s29', "قطع الغيار (قطاعي)")}</div>
              <strong style={{ color: '#0f172a', fontSize: '0.875rem' }}>{partsPrice.toFixed(2)} <CurrencySymbol /></strong>
              {partsProfit > 0 && <div style={{ fontSize: '0.68rem', color: '#16a34a', marginTop: '1px', fontWeight: 600 }}>{t('maintenance.maintenance_detail_modal.s30', "ربح بضاعة: +")}{partsProfit.toFixed(0)}</div>}
            </div>
            <div style={{ background: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ color: '#64748b', marginBottom: '1px' }}>{t('maintenance.maintenance_detail_modal.s31', "صافي المصنعية")}</div>
              <strong style={{ color: '#0f172a', fontSize: '0.875rem' }}>{laborPrice.toFixed(2)} <CurrencySymbol /></strong>
            </div>
            <div style={{ background: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ color: '#64748b', marginBottom: '1px' }}>{t('maintenance.maintenance_detail_modal.s32', "عمولة الفني (")}{commissionRate}%)</div>
              <strong style={{ color: '#0f172a', fontSize: '0.875rem' }}>{technicianCommission.toFixed(2)} <CurrencySymbol /></strong>
            </div>
            <div style={{ background: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ color: '#64748b', marginBottom: '1px' }}>{t('maintenance.maintenance_detail_modal.s33', "صافي ربح المحل")}</div>
              <strong style={{ color: '#16a34a', fontSize: '0.875rem' }}>{storeProfit.toFixed(2)} <CurrencySymbol /></strong>
            </div>
          </div>
          {/* Warning only (P1-1): the ticket may be priced below its parts
           * cost. No blocking, no change to any mutation. */}
          {partsPrice > totalCost && (
            <div role="alert" style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '6px', border: '1px solid #fed7aa', background: '#fff7ed', color: '#9a3412', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangleIcon size={14} color="#c2410c" />
              <span>{t('maintenance.maintenance_detail_modal.parts_price_above_total', "تحذير: سعر قطع الغيار أعلى من إجمالي الحساب — التذكرة مسعّرة بأقل من تكلفة القطع.")} ({partsPrice.toFixed(2)} <CurrencySymbol /> / {totalCost.toFixed(2)} <CurrencySymbol />)</span>
            </div>
          )}
        </div>

        {/* Settlement / Financial Card */}
        {currentTicket.status === 'delivered' ? (() => {
          /* No discount concept at delivery (D-M1-1): the final agreed
           * amount IS the revenue; the estimate is reference only. */
          const advancePaid = currentTicket.advancePayment || 0;
          const collectedAtDelivery = Math.max(0, totalCost - advancePaid);

          return (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>{t('maintenance.maintenance_detail_modal.s34', "إجمالي حساب الصيانة والتسليم:")}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '1.2rem', color: '#0f172a' }}>
                    {totalCost.toFixed(2)} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
                  </strong>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#16a34a', marginTop: '3px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckIcon size={12} color="#16a34a" />
                  <span>{t('maintenance.maintenance_detail_modal.s37', "تم السداد والتحصيل في الخزينة بالكامل")}</span>
                  {advancePaid > 0 ? ` (مقدم: ${advancePaid.toFixed(2)} ${getGlobalCurrencySymbol()} + عند الاستلام: ${collectedAtDelivery.toFixed(2)} ${getGlobalCurrencySymbol()})` : ` (المحصل عند الاستلام: ${collectedAtDelivery.toFixed(2)} ${getGlobalCurrencySymbol()})`}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{t('maintenance.maintenance_detail_modal.s39', "الرصيد المتبقي:")}</div>
                  <strong style={{ fontSize: '1.2rem', color: '#16a34a', fontWeight: 800 }}>
                    0.00 <span style={{ fontSize: '0.75rem' }}><CurrencySymbol /> {t('maintenance.maintenance_detail_modal.s40', "(خالص)")}</span>
                  </strong>
                </div>
                <span style={{ padding: '6px 12px', borderRadius: '6px', background: '#f0fdf4', color: '#166534', fontWeight: 700, fontSize: '0.85rem', border: '1px solid #dcfce7', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <CheckIcon size={13} color="#166534" />
                  <span>{t('maintenance.maintenance_detail_modal.s41', "تم تسليم الجهاز")}</span>
                </span>
              </div>
            </div>
          );
        })() : (currentTicket.status === 'unrepairable' || currentTicket.status === 'cancelled') ? (() => {
          const advancePaid = currentTicket.advancePayment || 0;
          const isUnrep = currentTicket.status === 'unrepairable';
          /* `refundedAdvance` arrives with package 5 (merges before this
           * one); on this base the field does not exist yet, so read it
           * defensively and treat absent as not-refunded. */
          const refundedAdvance =
            (currentTicket as { refundedAdvance?: boolean }).refundedAdvance === true;
          return (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '0.825rem', color: isUnrep ? '#9f1239' : '#475569', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <XIcon size={13} color={isUnrep ? '#9f1239' : '#475569'} />
                  <span>{isUnrep ? t('maintenance.maintenance_detail_modal.s42', "تعذر إصلاح الجهاز (تم إلغاء رسوم الصيانة)") : t('maintenance.maintenance_detail_modal.s43', "تم إلغاء تذكرة الصيانة")}</span>
                </div>
                {advancePaid > 0 && !refundedAdvance ? (
                  <div style={{ fontSize: '0.78rem', color: '#c2410c', marginTop: '3px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertTriangleIcon size={14} color="#c2410c" />
                    <span>{t('maintenance.maintenance_detail_modal.s44', "مستحق رد العربون للعميل بالكامل:")} {advancePaid.toFixed(2)} <CurrencySymbol /> {t('maintenance.maintenance_detail_modal.s45', "عند تسليم الجهاز")}</span>
                  </div>
                ) : advancePaid > 0 ? (
                  <div style={{ fontSize: '0.78rem', color: '#16a34a', marginTop: '3px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckIcon size={14} color="#16a34a" />
                    <span>{t('maintenance.maintenance_detail_modal.s44b', "تم تسجيل رد العربون للعميل بالكامل:")} {advancePaid.toFixed(2)} <CurrencySymbol /></span>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                    {t('maintenance.maintenance_detail_modal.s46', "لا توجد أي مستحقات مالية مطلوبة من العميل.")}
                  </div>
                )}
              </div>

              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{t('maintenance.maintenance_detail_modal.s47', "المطلوب تحصيله:")}</div>
                <strong style={{ fontSize: '1.2rem', color: '#64748b', fontWeight: 700 }}>
                  0.00 <span style={{ fontSize: '0.75rem' }}><CurrencySymbol /></span>
                </strong>
              </div>
            </div>
          );
        })() : (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{t('maintenance.maintenance_detail_modal.s48', "إجمالي حساب الصيانة والقطع:")}</div>
              <strong style={{ fontSize: '1.2rem', color: '#0f172a' }}>
                {(currentTicket.finalCost || currentTicket.expectedCost || 0).toFixed(2)} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
              </strong>
              {currentTicket.advancePayment > 0 && (
                <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '2px', fontWeight: 600 }}>
                  {t('maintenance.maintenance_detail_modal.s49', "(المدفوع مقدماً:")} {currentTicket.advancePayment.toFixed(2)} <CurrencySymbol />)
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>{t('maintenance.maintenance_detail_modal.s50', "المتبقي للتحصيل:")}</div>
                <strong style={{ fontSize: '1.25rem', color: '#0f172a', fontWeight: 800 }}>
                  {Math.max(0, (currentTicket.finalCost || currentTicket.expectedCost || 0) - (currentTicket.advancePayment || 0)).toFixed(2)} <span style={{ fontSize: '0.75rem', color: '#64748b' }}><CurrencySymbol /></span>
                </strong>
              </div>

              <Button
                variant="primary"
                onClick={() => onOpenSettlement(currentTicket)}
                disabled={updateStatusMutation.isPending}
                style={{ padding: '7px 18px', fontWeight: 700, fontSize: '0.85rem' }}
              >
                {t('maintenance.maintenance_detail_modal.s51', "تسليم الجهاز والتحصيل")}
              </Button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button variant="secondary" onClick={onClose} style={{ fontSize: '0.85rem' }}>
            {t('maintenance.maintenance_detail_modal.s52', "إغلاق")}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
