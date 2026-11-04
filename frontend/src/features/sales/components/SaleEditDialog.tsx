import { useEffect, useMemo, useState } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { formatCurrency } from '@/lib/format';
import type { Sale } from '@/types/domain';
import { useTranslation } from "react-i18next";

interface SaleEditDialogProps {
  open: boolean;
  sale?: Sale;
  isBusy?: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onSave: (payload: {
    paymentType: string;
    paymentChannel: string;
    discount: number;
    note: string;
    editReason: string;
    managerPin: string;
    paidAmount: number;
    items: Array<{ productId: string; qty: number; price: number; unitName: string; unitMultiplier: number; priceType: string }>;
  }) => Promise<void> | void;
}

export function SaleEditDialog({ open, sale, isBusy = false, errorMessage = '', onCancel, onSave }: SaleEditDialogProps) {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  const [paymentType, setPaymentType] = useState('cash');
  const [paymentChannel, setPaymentChannel] = useState('cash');
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState('');
  const [items, setItems] = useState<Array<{ productId: string; name: string; qty: number; price: number; unitName: string; unitMultiplier: number; priceType: string }>>([]);
  const [editReason, setEditReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open || !sale) return;
    setPaymentType(sale.paymentType || 'cash');
    setPaymentChannel(sale.paymentChannel || (sale.paymentType === 'credit' ? 'credit' : 'cash'));
    setDiscount(Number(sale.discount || 0));
    setNote(sale.note || '');
    setItems((sale.items || []).map((item) => ({
      productId: String(item.productId),
      name: item.name,
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      unitName: item.unitName || t('sales.5d16c3'),
      unitMultiplier: Number(item.unitMultiplier || 1),
      priceType: item.priceType || 'retail'
    })));
    setEditReason('');
    setManagerPin('');
    setLocalError('');
  }, [open, sale, t]);

  const baselineItems = useMemo(() => (sale?.items || []).map((item) => ({
    productId: String(item.productId),
    qty: Number(item.qty || 0),
    price: Number(item.price || 0),
    unitName: item.unitName || t('sales.5d16c3'),
    unitMultiplier: Number(item.unitMultiplier || 1),
    priceType: item.priceType || 'retail'
  })), [sale, t]);

  const normalizedItems = useMemo(() => items.map((item) => ({
    productId: item.productId,
    qty: Number(item.qty || 0),
    price: Number(item.price || 0),
    unitName: item.unitName,
    unitMultiplier: item.unitMultiplier,
    priceType: item.priceType
  })), [items]);

  const isDirty = useMemo(() => {
    if (!sale) return false;
    return (
      paymentType !== (sale.paymentType || 'cash')
      || paymentChannel !== (sale.paymentChannel || (sale.paymentType === 'credit' ? 'credit' : 'cash'))
      || Number(discount || 0) !== Number(sale.discount || 0)
      || note !== (sale.note || '')
      || JSON.stringify(normalizedItems) !== JSON.stringify(baselineItems)
    );
  }, [baselineItems, discount, normalizedItems, note, paymentChannel, paymentType, sale]);

  const canNavigateAway = useUnsavedChangesGuard(open && isDirty && !isBusy);

  const computedSubTotal = useMemo(() => Number(items.reduce((sum, item) => sum + item.qty * item.price, 0).toFixed(2)), [items]);
  const computedTax = useMemo(() => {
    if (!sale) return 0;
    const taxable = Math.max(0, computedSubTotal - discount);
    const taxRate = Number(sale.taxRate || 0);
    if (!taxRate) return 0;
    if (sale.pricesIncludeTax) return Number((taxable - taxable / (1 + taxRate / 100)).toFixed(2));
    return Number((taxable * (taxRate / 100)).toFixed(2));
  }, [computedSubTotal, discount, sale]);

  const computedTotal = useMemo(() => {
    if (!sale) return 0;
    const taxable = Math.max(0, computedSubTotal - discount);
    return sale.pricesIncludeTax ? Number(taxable.toFixed(2)) : Number((taxable + computedTax).toFixed(2));
  }, [computedSubTotal, computedTax, discount, sale]);

  const paymentTypeOptions = useMemo(() => [
    { value: 'cash', label: t('sales.47062f') },
    { value: 'credit', label: t('sales.80106f') },
  ], [t]);

  const paymentChannelOptions = useMemo(() => [
    { value: 'cash', label: t('sales.47062f') },
    { value: 'card', label: t('sales.2a62eb') },
    { value: 'credit', label: t('sales.80106f') },
  ], [t]);

  function handleCancel() {
    if (isBusy) return;
    if (!canNavigateAway()) return;
    onCancel();
  }

  function handleReset() {
    if (!sale) return;
    setPaymentType(sale.paymentType || 'cash');
    setPaymentChannel(sale.paymentChannel || (sale.paymentType === 'credit' ? 'credit' : 'cash'));
    setDiscount(Number(sale.discount || 0));
    setNote(sale.note || '');
    setItems((sale.items || []).map((item) => ({
      productId: String(item.productId),
      name: item.name,
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      unitName: item.unitName || t('sales.5d16c3'),
      unitMultiplier: Number(item.unitMultiplier || 1),
      priceType: item.priceType || 'retail'
    })));
    setEditReason('');
    setManagerPin('');
    setLocalError('');
  }

  const handleSaveSubmit = async () => {
    if (!normalizedItems.length) {
      setLocalError(t('sales.f7181a'));
      return;
    }
    if (normalizedItems.some((item) => item.qty <= 0 || item.price < 0)) {
      setLocalError(t('sales.7c2636'));
      return;
    }
    if (discount < 0) {
      setLocalError(t('sales.53dd25'));
      return;
    }
    if (paymentType === 'credit' && !sale?.customerId) {
      setLocalError(t('sales.ca9c8e'));
      return;
    }
    if (!String(editReason || '').trim()) {
      setLocalError(t('sales.bee06e'));
      return;
    }
    if (!String(managerPin || '').trim()) {
      setLocalError(t('sales.d0c62a'));
      return;
    }
    setLocalError('');
    await onSave({
      paymentType,
      paymentChannel: paymentType === 'credit' ? 'credit' : paymentChannel,
      discount: Number(discount || 0),
      note,
      editReason: String(editReason || '').trim(),
      managerPin: String(managerPin || '').trim(),
      paidAmount: 0,
      items: normalizedItems,
    });
  };

  if (!open || !sale) return null;

  const modalFooter = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '8px' }}>
      <div>
        <Button variant="secondary" onClick={handleReset} disabled={isBusy || !isDirty}>
          {t('sales.722b47')}
        </Button>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button variant="secondary" onClick={handleCancel} disabled={isBusy}>
          {t('sales.9932cc')}
        </Button>
        <Button
          variant="primary"
          disabled={isBusy}
          style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
          onClick={handleSaveSubmit}
        >
          {isBusy ? t('sales.c793e5') : t('sales.ea76b8')}
        </Button>
      </div>
    </div>
  );

  return (
    <StandardDialog
      isOpen={open}
      onClose={handleCancel}
      title={`تعديل الفاتورة: ${sale.docNo || sale.id}`}
      subtitle={__t('sales.sale_edit_dialog.s0', "تعديل بنود الفاتورة وطريقة السداد مع التدقيق الإداري والرقابي")}
      maxWidth="980px"
      zIndex={70}
      footer={modalFooter}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <DraftStateNotice visible={isDirty && !isBusy} title={t('sales.75f3bb')} hint={t('sales.e5aaba')} />

        {/* Card 1: إعدادات السداد والاعتماد */}
        <div
          style={{
            padding: 16,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#170e5e', borderBottom: '1px solid #e2e8f0', paddingBottom: 6 }}>
            {__t('sales.sale_edit_dialog.s1', "بيانات السداد والتدقيق الرقابي")}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <Field label={t('sales.394ebd')}>
              <CustomSelect
                value={paymentType}
                onChange={(val) => {
                  setPaymentType(val);
                  if (val === 'credit') setPaymentChannel('credit');
                }}
                disabled={isBusy}
                options={paymentTypeOptions}
              />
            </Field>

            <Field label={t('sales.91f4d8')}>
              <CustomSelect
                value={paymentChannel}
                onChange={(val) => setPaymentChannel(val)}
                disabled={isBusy || paymentType === 'credit'}
                options={paymentChannelOptions}
              />
            </Field>

            <Field label={t('sales.20000a')}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value || 0))}
                disabled={isBusy}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
              />
            </Field>

            <Field label={t('sales.2249f4')}>
              <input
                type="text"
                className="secure-password-field"
                inputMode="numeric"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value)}
                disabled={isBusy}
                placeholder={t('sales.f7fa23')}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label={t('sales.3c4208')}>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isBusy}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '12px' }}
              />
            </Field>

            <Field label={t('sales.9625a0')}>
              <textarea
                rows={2}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                disabled={isBusy}
                placeholder={t('sales.13ae61')}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '12px' }}
              />
            </Field>
          </div>
        </div>

        {/* Card 2: جدول الأصناف والبنود */}
        <div style={{ border: '1px solid #cbd5e1', borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #cbd5e1', color: '#475569', fontWeight: 700 }}>
                <th style={{ padding: '10px 12px' }}>{t('sales.77c42d')}</th>
                <th style={{ padding: '10px 12px' }}>{t('sales.694ca7')}</th>
                <th style={{ padding: '10px 12px', width: '120px' }}>{t('sales.510165')}</th>
                <th style={{ padding: '10px 12px', width: '130px' }}>{t('sales.fa59c3')}</th>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>{t('sales.88fc73')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.productId}-${item.unitName}-${index}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{item.name}</td>
                  <td style={{ padding: '10px 12px', color: '#64748b' }}>{item.unitName}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={item.qty}
                      onChange={(e) => setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, qty: Number(e.target.value || 0) } : entry))}
                      disabled={isBusy}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.price}
                      onChange={(e) => setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, price: Number(e.target.value || 0) } : entry))}
                      disabled={isBusy}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#170e5e' }}>
                    {formatCurrency(Number((item.qty * item.price).toFixed(2)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ملخص الإجماليات */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div style={{ padding: '12px 14px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('sales.e89b20')}</span>
            <strong style={{ fontSize: '14px', color: '#0f172a' }}>{formatCurrency(computedSubTotal)}</strong>
          </div>
          <div style={{ padding: '12px 14px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('sales.ad68a9')}</span>
            <strong style={{ fontSize: '14px', color: '#0f172a' }}>{formatCurrency(computedTax)}</strong>
          </div>
          <div style={{ padding: '12px 14px', backgroundColor: '#eef2ff', borderRadius: '10px', border: '1px solid #c7d2fe', textAlign: 'center' }}>
            <span style={{ fontSize: '11px', color: '#3730a3', display: 'block', marginBottom: '2px' }}>{t('sales.88fc73')}</span>
            <strong style={{ fontSize: '15px', color: '#170e5e' }}>{formatCurrency(computedTotal)}</strong>
          </div>
        </div>

        {(localError || errorMessage) ? (
          <div style={{ padding: '10px 14px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '12.5px' }}>
            {localError || errorMessage}
          </div>
        ) : null}
      </div>
    </StandardDialog>
  );
}

