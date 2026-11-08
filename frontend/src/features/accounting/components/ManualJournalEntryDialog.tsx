import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { formatCurrency } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { accountingApi, type AccountingAccount } from '../api/accounting.api';
import { costCentersApi, type CostCenterRecord } from '../api/cost-centers.api';
import { PlusIcon, Trash2Icon, FileTextIcon, CalculatorIcon, ScaleIcon } from '@/shared/components/icons/AppIcons';

interface JournalLineRow {
  id: string;
  accountId: string;
  costCenterId: string;
  description: string;
  debit: string;
  credit: string;
}

interface ManualJournalEntryDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (entry: { id: number; entryNo: string }) => void;
}

function normalizeNumerals(value: string): string {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const easternArabicIndic = '۰۱۲۳۴۵۶۷۸۹';
  return String(value || '')
    .replace(/[٠-٩]/g, (char) => String(arabicIndic.indexOf(char)))
    .replace(/[۰-۹]/g, (char) => String(easternArabicIndic.indexOf(char)));
}

function parseMoney(value: string): number {
  const normalized = normalizeNumerals(value).replace(/,/g, '.').trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  // INV-FE3-FRONTEND-BOOK-DIGITS: journal lines post to the ledger, so
  // they round at the tenant's book digits, not hardcoded 2dp.
  return roundMoneyValue(parsed, currencyMoneyDigits(getGlobalSystemCurrency()));
}

function createEmptyRow(): JournalLineRow {
  return {
    id: 'row_' + Math.random().toString(36).substring(2, 9),
    accountId: '',
    costCenterId: '',
    description: '',
    debit: '',
    credit: '',
  };
}

export function ManualJournalEntryDialog({ open, onClose, onSuccess }: ManualJournalEntryDialogProps) {
  const { t } = useTranslation();
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [cashFlowCategory, setCashFlowCategory] = useState<'' | 'operating' | 'investing' | 'financing'>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const [lines, setLines] = useState<JournalLineRow[]>([
    createEmptyRow(),
    createEmptyRow(),
  ]);

  const accountsQuery = useQuery({
    queryKey: ['accounting', 'accounts'],
    queryFn: () => accountingApi.accounts(),
    enabled: open,
  });

  const costCentersQuery = useQuery({
    queryKey: ['accounting', 'cost-centers'],
    queryFn: () => costCentersApi.list(),
    enabled: open,
  });

  const activeAccounts = useMemo(() => {
    const list = accountsQuery.data?.accounts || [];
    return list.filter((a: AccountingAccount) => a.isActive && a.allowManualEntries && !a.isControlAccount && !a.flags.isReceivable && !a.flags.isPayable && !a.flags.isInventory);
  }, [accountsQuery.data]);

  const accountOptions = useMemo(() => {
    return activeAccounts.map((acc: AccountingAccount) => ({
      value: String(acc.id),
      label: `${acc.code} - ${acc.nameAr}`,
    }));
  }, [activeAccounts]);

  const costCenters = useMemo(() => {
    return (costCentersQuery.data || []).filter((cc: CostCenterRecord) => cc.isActive);
  }, [costCentersQuery.data]);

  const costCenterOptions = useMemo(() => {
    return [
      { value: '', label: 'بدون مركز تكلفة' },
      ...costCenters.map((cc: CostCenterRecord) => ({
        value: String(cc.id),
        label: `${cc.code} - ${cc.name}`,
      })),
    ];
  }, [costCenters]);

  const totals = useMemo(() => {
    // INV-FE3-FRONTEND-BOOK-DIGITS: the balance check must use the same
    // book digits as the posted lines, or a 3-decimal tenant's balanced
    // entry reads as a difference.
    const bookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
    let debit = 0;
    let credit = 0;
    for (const line of lines) {
      debit += parseMoney(line.debit);
      credit += parseMoney(line.credit);
    }
    debit = roundMoneyValue(debit, bookDigits);
    credit = roundMoneyValue(credit, bookDigits);
    const difference = roundMoneyValue(Math.abs(debit - credit), bookDigits);
    const balanced = debit > 0 && credit > 0 && difference <= 0.0001;
    return { debit, credit, difference, balanced };
  }, [lines]);

  const postMutation = useMutation({
    mutationFn: () => {
      setErrorMessage(null);
      const payloadLines = lines.map((l) => ({
        accountId: Number(l.accountId),
        costCenterId: l.costCenterId ? Number(l.costCenterId) : null,
        description: l.description.trim() || description.trim(),
        debit: parseMoney(l.debit),
        credit: parseMoney(l.credit),
      }));

      return accountingApi.createJournalEntry({
        entryDate,
        cashFlowCategory: cashFlowCategory || undefined,
        description: description.trim(),
        reference: reference.trim() || undefined,
        lines: payloadLines,
      });
    },
    onSuccess: (res) => {
      // The accounts page reads ['accounting', 'accounts']; without this
      // invalidation its balances column would stay stale until a reload.
      queryClient.invalidateQueries({ queryKey: ['accounting', 'accounts'] });
      onSuccess(res.entry);
      handleReset();
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'حدث خطأ أثناء ترحيل القيد اليومي.';
      setErrorMessage(typeof msg === 'string' ? msg : JSON.stringify(msg));
    },
  });

  function handleReset() {
    setEntryDate(new Date().toISOString().slice(0, 10));
    setDescription('');
    setReference('');
    setCashFlowCategory('');
    setErrorMessage(null);
    setLines([createEmptyRow(), createEmptyRow()]);
  }

  function handleAddLine() {
    setLines((prev) => [...prev, createEmptyRow()]);
  }

  function handleRemoveLine(index: number) {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function handleLineChange(index: number, field: keyof JournalLineRow, value: string) {
    setLines((prev) => {
      const copy = [...prev];
      const row = { ...copy[index], [field]: value };

      // Mutual exclusivity: if entering debit, clear credit and vice versa
      if (field === 'debit' && parseMoney(value) > 0) {
        row.credit = '';
      } else if (field === 'credit' && parseMoney(value) > 0) {
        row.debit = '';
      }

      copy[index] = row;
      return copy;
    });
  }

  const canSubmit = totals.balanced && description.trim().length > 0 && lines.every((l) => l.accountId && (parseMoney(l.debit) > 0 || parseMoney(l.credit) > 0));

  return (
    <StandardDialog
      open={open}
      onClose={() => {
        if (!postMutation.isPending) {
          handleReset();
          onClose();
        }
      }}
      title={t('accounting.manual_journal_entry_dialog.s0', "إنشاء قيد يومية يدوي")}
      subtitle={t('accounting.manual_journal_entry_dialog.s1', "تسجيل قيود التسوية والإقفال المحاسبي مع فحص فوري لتوازن القيد وتواريخ إقفال الفترات.")}
      width="min(1060px, 96vw)"
      minHeight="min(600px, 90vh)"
      footerActions={
        <StandardDialogFooter
          onClose={() => {
            handleReset();
            onClose();
          }}
          onSubmit={() => postMutation.mutate()}
          submitText={postMutation.isPending ? t('accounting.manual_journal_entry_dialog.s2', "جاري ترحيل القيد...") : t('accounting.manual_journal_entry_dialog.s3', "ترحيل القيد اليومي")}
          isSubmitting={postMutation.isPending}
          disabled={!canSubmit}
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        {/* Error Alert */}
        {errorMessage && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#fef2f2',
              borderRight: '4px solid #ef4444',
              borderRadius: '8px',
              color: '#991b1b',
              fontSize: '13px',
              lineHeight: 1.6,
            }}
          >
            <strong>{t('accounting.manual_journal_entry_dialog.s4', "تنبيه:")} </strong> {errorMessage}
          </div>
        )}

        {/* Sectional Card 1: Header Fields */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <span style={{ color: '#170e5e', display: 'flex' }}>
              <FileTextIcon size={18} />
            </span>
            <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#170e5e' }}>
              {t('accounting.manual_journal_entry_dialog.s5', "بيانات ومعلومات القيد")}
            </h4>
          </div>

          <Field label={t('accounting.arch02.cashFlowCategory', 'تصنيف التدفق النقدي')} hint={t('accounting.arch02.cashFlowHint', 'حدد التصنيف عند بيع أصل أو وجود تمويل غير نقدي ضمن القيد')}>
            <CustomSelect value={cashFlowCategory} onChange={value => setCashFlowCategory(value as typeof cashFlowCategory)} options={[
              { value: '', label: t('accounting.arch02.automaticCategory', 'تلقائي للقيود البسيطة') }, { value: 'operating', label: t('accounting.arch02.operating', 'تشغيلي') },
              { value: 'investing', label: t('accounting.arch02.investing', 'استثماري') }, { value: 'financing', label: t('accounting.arch02.financing', 'تمويلي') },
            ]} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '14px' }}>
            <Field label={t('accounting.manual_journal_entry_dialog.s6', "تاريخ القيد *")} hint={t('accounting.manual_journal_entry_dialog.s7', "تاريخ إثبات الحركة")}>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  backgroundColor: '#ffffff',
                }}
              />
            </Field>

            <Field label={t('accounting.manual_journal_entry_dialog.s8', "البيان العام للقيد *")} hint={t('accounting.manual_journal_entry_dialog.s9', "وصف سبب وتفاصيل القيد")}>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('accounting.manual_journal_entry_dialog.s10', "مثال: إثبات مصاريف تسوية الإيجار لشهر أغسطس")}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  backgroundColor: '#ffffff',
                }}
              />
            </Field>

            <Field label={t('accounting.manual_journal_entry_dialog.s11', "رقم المرجع (اختياري)")} hint={t('accounting.manual_journal_entry_dialog.s12', "رقم الفاتورة أو المستند")}>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t('accounting.manual_journal_entry_dialog.s13', "مثال: REF-9082")}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  backgroundColor: '#ffffff',
                }}
              />
            </Field>
          </div>
        </div>

        {/* Sectional Card 2: Lines Table */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <span style={{ color: '#170e5e', display: 'flex' }}>
              <ScaleIcon size={18} />
            </span>
            <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#170e5e' }}>
              {t('accounting.manual_journal_entry_dialog.s14', "أطراف وحسابات القيد اليومي")}
            </h4>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'visible', backgroundColor: '#ffffff' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2.5fr 1.8fr 2fr 1fr 1fr 40px',
                gap: '8px',
                backgroundColor: '#f1f5f9',
                padding: '10px 12px',
                fontWeight: 700,
                fontSize: '12px',
                color: '#475569',
                borderBottom: '1px solid #e2e8f0',
                borderRadius: '9px 9px 0 0',
              }}
            >
              <div>{t('accounting.manual_journal_entry_dialog.s15', "الحساب المحاسبي *")}</div>
              <div>{t('accounting.manual_journal_entry_dialog.s16', "مركز التكلفة")}</div>
              <div>{t('accounting.manual_journal_entry_dialog.s17', "البيان / الوصف")}</div>
              <div style={{ textAlign: 'left' }}>{t('accounting.manual_journal_entry_dialog.s18', "مدين")}</div>
              <div style={{ textAlign: 'left' }}>{t('accounting.manual_journal_entry_dialog.s19', "دائن")}</div>
              <div></div>
            </div>

            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {lines.map((line, idx) => (
                <div
                  key={line.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2.5fr 1.8fr 2fr 1fr 1fr 40px',
                    gap: '8px',
                    padding: '8px 12px',
                    alignItems: 'center',
                    borderBottom: idx < lines.length - 1 ? '1px solid #f1f5f9' : 'none',
                    backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                  }}
                >
                  {/* Account via CustomSelect */}
                  <div>
                    <CustomSelect
                      value={line.accountId}
                      onChange={(val) => handleLineChange(idx, 'accountId', val)}
                      options={accountOptions}
                      placeholder={t('accounting.manual_journal_entry_dialog.s20', "-- اختر الحساب --")}
                      searchable
                    />
                  </div>

                  {/* Cost Center via CustomSelect */}
                  <div>
                    <CustomSelect
                      value={line.costCenterId}
                      onChange={(val) => handleLineChange(idx, 'costCenterId', val)}
                      options={costCenterOptions}
                      placeholder={t('accounting.manual_journal_entry_dialog.s21', "-- بدون مركز --")}
                      searchable
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => handleLineChange(idx, 'description', e.target.value)}
                      placeholder={description.trim() || t('accounting.manual_journal_entry_dialog.s22', "وصف السطر...")}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '12px',
                        backgroundColor: '#ffffff',
                      }}
                    />
                  </div>

                  {/* Debit */}
                  <div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.debit}
                      onChange={(e) => handleLineChange(idx, 'debit', e.target.value)}
                      placeholder="0.00"
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '12px',
                        textAlign: 'left',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        backgroundColor: line.debit && parseMoney(line.debit) > 0 ? '#eff6ff' : '#ffffff',
                      }}
                    />
                  </div>

                  {/* Credit */}
                  <div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.credit}
                      onChange={(e) => handleLineChange(idx, 'credit', e.target.value)}
                      placeholder="0.00"
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '12px',
                        textAlign: 'left',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        backgroundColor: line.credit && parseMoney(line.credit) > 0 ? '#f0fdf4' : '#ffffff',
                      }}
                    />
                  </div>

                  {/* Remove button */}
                  <div style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(idx)}
                      disabled={lines.length <= 2}
                      title={lines.length <= 2 ? t('accounting.manual_journal_entry_dialog.s23', "القيد يتطلب سطرين على الأقل") : t('accounting.manual_journal_entry_dialog.s24', "حذف السطر")}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: lines.length <= 2 ? 'not-allowed' : 'pointer',
                        color: lines.length <= 2 ? '#cbd5e1' : '#ef4444',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Trash2Icon size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Line Action */}
            <div style={{ padding: '8px 12px', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0', borderRadius: '0 0 9px 9px' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={handleAddLine}
                style={{
                  fontSize: '12px',
                  padding: '5px 12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <PlusIcon size={14} />
                {t('accounting.manual_journal_entry_dialog.s25', "إضافة سطر جديد للقيد")}
              </Button>
            </div>
          </div>
        </div>

        {/* Sectional Card 3: Balance & Totals Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 18px',
            backgroundColor: totals.balanced ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
            borderRadius: '12px',
            border: totals.balanced ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
          }}
        >
          <div style={{ display: 'flex', gap: '28px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CalculatorIcon size={16} />
              <span style={{ fontSize: '12px', color: '#64748b' }}>{t('accounting.manual_journal_entry_dialog.s26', "إجمالي المدين:")} </span>
              <strong style={{ fontSize: '14px', color: '#0f172a', fontFamily: 'monospace' }}>
                {formatCurrency(totals.debit)}
              </strong>
            </div>
            <div>
              <span style={{ fontSize: '12px', color: '#64748b' }}>{t('accounting.manual_journal_entry_dialog.s27', "إجمالي الدائن:")} </span>
              <strong style={{ fontSize: '14px', color: '#0f172a', fontFamily: 'monospace' }}>
                {formatCurrency(totals.credit)}
              </strong>
            </div>
            <div>
              <span style={{ fontSize: '12px', color: '#64748b' }}>{t('accounting.manual_journal_entry_dialog.s28', "الفارق:")} </span>
              <strong
                style={{
                  fontSize: '14px',
                  fontFamily: 'monospace',
                  color: totals.balanced ? '#059669' : '#dc2626',
                }}
              >
                {formatCurrency(totals.difference)}
              </strong>
            </div>
          </div>

          <div>
            {totals.balanced ? (
              <span
                style={{
                  display: 'inline-block',
                  padding: '4px 14px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: 700,
                  backgroundColor: '#d1fae5',
                  color: '#065f46',
                }}
              >
                {t('accounting.manual_journal_entry_dialog.s29', "القيد متزن وجاهز للترحيل")}
              </span>
            ) : (
              <span
                style={{
                  display: 'inline-block',
                  padding: '4px 14px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: 700,
                  backgroundColor: '#fee2e2',
                  color: '#991b1b',
                }}
              >
                {t('accounting.manual_journal_entry_dialog.s30', "القيد غير متزن")}
              </span>
            )}
          </div>
        </div>
      </div>
    </StandardDialog>
  );
}
