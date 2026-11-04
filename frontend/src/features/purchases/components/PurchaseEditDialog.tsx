import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { ActionConfirmDialog } from '@/shared/components/action-confirm-dialog';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { formatCurrency } from '@/lib/format';
import { useAuthStore, isAdminUser } from '@/stores/auth-store';
import type { Purchase } from '@/types/domain';

const PAYMENT_TYPE_OPTIONS = [
  { value: 'cash', label: 'نقدي' },
  { value: 'credit', label: 'آجل' },
];

interface PurchaseEditDialogProps {
  open: boolean;
  purchase?: Purchase;
  isBusy?: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onSave: (payload: { paymentType: string; discount: number; note: string; editReason: string; managerPin: string; items: Array<{ productId: string; qty: number; cost: number; unitName: string; unitMultiplier: number }> }) => Promise<void> | void;
}

export function PurchaseEditDialog({ open, purchase, isBusy = false, errorMessage = '', onCancel, onSave }: PurchaseEditDialogProps) {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const isAdmin = isAdminUser(user);

  const [paymentType, setPaymentType] = useState('cash');
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState('');
  const [items, setItems] = useState<Array<{ productId: string; name: string; qty: number; cost: number; unitName: string; unitMultiplier: number }>>([]);
  const [editReason, setEditReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [localError, setLocalError] = useState('');
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  useEffect(() => {
    if (!open || !purchase) return;
    setPaymentType(purchase.paymentType || 'cash');
    setDiscount(Number(purchase.discount || 0));
    setNote(purchase.note || '');
    setItems((purchase.items || []).map((item) => ({
      productId: String(item.productId),
      name: item.name,
      qty: Number(item.qty || 0),
      cost: Number(item.cost || 0),
      unitName: item.unitName || 'قطعة',
      unitMultiplier: Number(item.unitMultiplier || 1)
    })));
    setEditReason('');
    setManagerPin('');
    setLocalError('');
  }, [open, purchase]);

  const baselineItems = useMemo(() => (purchase?.items || []).map((item) => ({
    productId: String(item.productId),
    qty: Number(item.qty || 0),
    cost: Number(item.cost || 0),
    unitName: item.unitName || 'قطعة',
    unitMultiplier: Number(item.unitMultiplier || 1)
  })), [purchase]);
  const normalizedItems = useMemo(() => items.map((item) => ({
    productId: item.productId,
    qty: Number(item.qty || 0),
    cost: Number(item.cost || 0),
    unitName: item.unitName,
    unitMultiplier: item.unitMultiplier
  })), [items]);
  const isDirty = useMemo(() => {
    if (!purchase) return false;
    return (
      paymentType !== (purchase.paymentType || 'cash')
      || Number(discount || 0) !== Number(purchase.discount || 0)
      || note !== (purchase.note || '')
      || JSON.stringify(normalizedItems) !== JSON.stringify(baselineItems)
    );
  }, [baselineItems, discount, normalizedItems, note, paymentType, purchase]);
  useUnsavedChangesGuard(open && isDirty && !isBusy);

  const computedSubTotal = useMemo(() => Number(items.reduce((sum, item) => sum + item.qty * item.cost, 0).toFixed(2)), [items]);
  const computedTax = useMemo(() => {
    if (!purchase) return 0;
    const taxable = Math.max(0, computedSubTotal - discount);
    const taxRate = Number(purchase.taxRate || 0);
    if (!taxRate) return 0;
    if (purchase.pricesIncludeTax) return Number((taxable - taxable / (1 + taxRate / 100)).toFixed(2));
    return Number((taxable * (taxRate / 100)).toFixed(2));
  }, [computedSubTotal, discount, purchase]);
  const computedTotal = useMemo(() => {
    if (!purchase) return 0;
    const taxable = Math.max(0, computedSubTotal - discount);
    return purchase.pricesIncludeTax ? Number(taxable.toFixed(2)) : Number((taxable + computedTax).toFixed(2));
  }, [computedSubTotal, computedTax, discount, purchase]);

  function handleCancel() {
    if (isBusy) return;
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onCancel();
  }

  function handleReset() {
    if (!purchase) return;
    setPaymentType(purchase.paymentType || 'cash');
    setDiscount(Number(purchase.discount || 0));
    setNote(purchase.note || '');
    setItems((purchase.items || []).map((item) => ({
      productId: String(item.productId),
      name: item.name,
      qty: Number(item.qty || 0),
      cost: Number(item.cost || 0),
      unitName: item.unitName || 'قطعة',
      unitMultiplier: Number(item.unitMultiplier || 1)
    })));
    setEditReason('');
    setManagerPin('');
    setLocalError('');
  }

  const handleSaveClick = async () => {
    if (!normalizedItems.length) {
      setLocalError('يجب أن تحتوي الفاتورة على صنف واحد على الأقل');
      return;
    }
    if (normalizedItems.some((item) => item.qty <= 0 || item.cost < 0)) {
      setLocalError('راجع الكميات والتكلفة داخل الفاتورة');
      return;
    }
    if (discount < 0) {
      setLocalError('الخصم لا يمكن أن يكون سالبًا');
      return;
    }
    if (!String(editReason || '').trim()) {
      setLocalError('سبب التعديل يجب أن يكون واضحًا');
      return;
    }
    if (!isAdmin && !String(managerPin || '').trim()) {
      setLocalError('أدخل رمز اعتماد المدير قبل حفظ التعديل');
      return;
    }
    setLocalError('');
    await onSave({
      paymentType,
      discount: Number(discount || 0),
      note,
      editReason: String(editReason || '').trim(),
      managerPin: String(managerPin || '').trim(),
      items: normalizedItems
    });
  };

  if (!open || !purchase) return null;

  return (
    <>
      <StandardDialog
        open={open}
        onClose={handleCancel}
        title={`تعديل فاتورة مشتريات ${purchase.docNo || purchase.id}`}
        subtitle={t('purchases.purchase_edit_dialog.s0', "تعديل بيانات وأصناف فاتورة الشراء مع توثيق سبب التعديل")}
        maxWidth="980px"
        footerActions={
          <StandardDialogFooter
            onCancel={handleCancel}
            cancelLabel={t('purchases.purchase_edit_dialog.s1', "إغلاق")}
            onSubmit={handleSaveClick}
            submitLabel={isBusy ? t('purchases.purchase_edit_dialog.s2', "جارٍ حفظ التعديل...") : t('purchases.purchase_edit_dialog.s3', "حفظ التعديل")}
            isSubmitting={isBusy}
            extraActions={
              <Button variant="secondary" onClick={handleReset} disabled={isBusy || !isDirty}>
                {t('purchases.purchase_edit_dialog.s4', "إعادة القيم")}
              </Button>
            }
          />
        }
      >
        <DraftStateNotice visible={isDirty && !isBusy} title={t('purchases.purchase_edit_dialog.s5', "تعديلات فاتورة الشراء الحالية غير محفوظة")} hint={t('purchases.purchase_edit_dialog.s6', "أعد القيم الأصلية أو احفظ التعديلات قبل إغلاق نافذة التعديل.")} />
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label={t('purchases.purchase_edit_dialog.s7', "نوع السداد")}>
            <CustomSelect
              value={paymentType}
              onChange={(val) => setPaymentType(String(val))}
              options={PAYMENT_TYPE_OPTIONS}
              searchable={false}
              disabled={isBusy}
            />
          </Field>
          <Field label={t('purchases.purchase_edit_dialog.s8', "خصم الفاتورة")}><input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value || 0))} disabled={isBusy} /></Field>
          <div style={{ gridColumn: '1 / -1' }}><Field label={t('purchases.purchase_edit_dialog.s9', "ملاحظات")}><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={isBusy} /></Field></div>
          <div style={{ gridColumn: '1 / -1' }}><Field label={t('purchases.purchase_edit_dialog.s10', "سبب التعديل")}><textarea rows={2} value={editReason} onChange={(e) => setEditReason(e.target.value)} disabled={isBusy} placeholder={t('purchases.purchase_edit_dialog.s11', "مثال: تعديل التكلفة بعد مراجعة فاتورة المورد")} /></Field></div>
          {!isAdmin && <Field label={t('purchases.purchase_edit_dialog.s12', "رمز اعتماد المدير")}><input type="text" className="secure-password-field" inputMode="numeric" value={managerPin} onChange={(e) => setManagerPin(e.target.value)} disabled={isBusy} placeholder={t('purchases.purchase_edit_dialog.s13', "أدخل رمز المدير")} autoComplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" autoCorrect="off" autoCapitalize="off" spellCheck={false} /></Field>}
        </div>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr><th>{t('purchases.purchase_edit_dialog.s14', "الصنف")}</th><th>{t('purchases.purchase_edit_dialog.s15', "الوحدة")}</th><th>{t('purchases.purchase_edit_dialog.s16', "الكمية")}</th><th>{t('purchases.purchase_edit_dialog.s17', "التكلفة")}</th><th>{t('purchases.purchase_edit_dialog.s18', "الإجمالي")}</th></tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.productId}-${item.unitName}-${index}`}>
                  <td>{item.name}</td>
                  <td>{item.unitName}</td>
                  <td><input type="number" min="0.001" step="0.001" value={item.qty} onChange={(e) => setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, qty: Number(e.target.value || 0) } : entry))} disabled={isBusy} /></td>
                  <td><input type="number" min="0" step="0.01" value={item.cost} onChange={(e) => setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, cost: Number(e.target.value || 0) } : entry))} disabled={isBusy} /></td>
                  <td>{formatCurrency(Number((item.qty * item.cost).toFixed(2)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="stats-grid compact-grid" style={{ marginTop: 12 }}>
          <div className="stat-card"><span>{t('purchases.purchase_edit_dialog.s19', "قبل الضريبة")}</span><strong>{formatCurrency(computedSubTotal)}</strong></div>
          <div className="stat-card"><span>{t('purchases.purchase_edit_dialog.s20', "الضريبة")}</span><strong>{formatCurrency(computedTax)}</strong></div>
          <div className="stat-card"><span>{t('purchases.purchase_edit_dialog.s21', "الإجمالي")}</span><strong>{formatCurrency(computedTotal)}</strong></div>
        </div>

        {(localError || errorMessage) ? <div className="error-box" style={{ marginTop: 12 }}>{localError || errorMessage}</div> : null}
      </StandardDialog>

      <ActionConfirmDialog
        open={showDiscardConfirm}
        title={t('purchases.purchase_edit_dialog.s22', "إلغاء التعديلات")}
        description={t('purchases.purchase_edit_dialog.s23', "هل أنت متأكد؟ لن يتم حفظ هذه التغييرات.")}
        confirmLabel={t('purchases.purchase_edit_dialog.s24', "نعم، إلغاء")}
        cancelLabel={t('purchases.purchase_edit_dialog.s25', "تراجع")}
        onConfirm={() => {
          setShowDiscardConfirm(false);
          onCancel();
        }}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </>
  );
}

