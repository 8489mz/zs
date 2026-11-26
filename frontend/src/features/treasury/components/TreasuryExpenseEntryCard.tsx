import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { CameraCaptureUpload } from '@/shared/components/CameraCaptureUpload';
import { ReceiptIcon, BuildingIcon, FileTextIcon } from '@/shared/components/icons/AppIcons';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import type { Location } from '@/types/domain';
import type { ExpenseFormState } from '@/features/treasury/lib/treasury-page.helpers';
import { useCostCentersQuery } from '@/shared/hooks/use-catalog-queries';

const EXPENSE_PRESETS = [
  'إيجار',
  'كهرباء',
  'مياه',
  'إنترنت',
  'صيانة نشاط',
  'صيانة أجهزة',
  'أدوات نظافة',
  'ضيافة',
  'نقل وشحن',
  'مرتبات',
  'سلفة عامل',
  'عمولة فني',
  'مستلزمات تشغيل',
  'رسوم حكومية',
  'مصروف بنكي',
];

export function TreasuryExpenseEntryCard({ expenseForm, setExpenseForm, branches, warehouses, locations, availableLocations, expenseValidationErrors, expenseMutation, onReset }: {
  expenseForm: ExpenseFormState;
  setExpenseForm: React.Dispatch<React.SetStateAction<ExpenseFormState>>;
  branches: Array<{ id: string; name: string }>;
  warehouses?: Location[];
  locations?: Location[];
  availableLocations: Location[];
  expenseValidationErrors: string[];
  expenseMutation: { isError: boolean; isSuccess: boolean; error: unknown; isPending: boolean; mutate: (values: ExpenseFormState) => void };
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const warehouseList = warehouses || locations || [];
  const [customPresets, setCustomPresets] = useState<string[]>([]);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);

  const { data: costCenters = [] } = useCostCentersQuery();

  useEffect(() => {
    try {
      const stored = localStorage.getItem('zsystems_custom_expense_presets');
      if (stored) {
        setCustomPresets(JSON.parse(stored));
      }
    } catch (e) {
      // Ignore parse errors
    }
  }, []);

  const handleSave = () => {
    const currentTitle = expenseForm.title.trim();
    if (currentTitle && !EXPENSE_PRESETS.includes(currentTitle) && !customPresets.includes(currentTitle)) {
      const nextPresets = [...customPresets, currentTitle];
      setCustomPresets(nextPresets);
      localStorage.setItem('zsystems_custom_expense_presets', JSON.stringify(nextPresets));
    }
    expenseMutation.mutate(expenseForm);
  };

  const allPresets = [...EXPENSE_PRESETS, ...customPresets];
  const presetOptions = allPresets.map(preset => ({ id: preset, label: preset }));

  const branchOptions = [
    { value: '', label: 'بدون فرع' },
    ...branches.map((b) => ({ value: String(b.id), label: b.name })),
  ];

  const locationOptions = [
    { value: '', label: 'بدون مخزن' },
    ...availableLocations.map((l) => ({ value: String(l.id), label: l.name })),
  ];

  const costCenterOptions = [
    { value: '', label: 'بدون مركز تكلفة' },
    ...costCenters
      .filter((c) => c.isActive)
      .map((center) => ({
        value: String(center.id),
        label: `${center.code} - ${center.name}`,
      })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px' }}>
      {/* البطاقة الرمادية 1: بيانات المصروف الأساسية */}
      <div
        style={{
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
          <ReceiptIcon size={16} color="#170e5e" />
          <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#170e5e' }}>{t('treasury.treasury_expense_entry_card.s0', "بيانات المصروف الأساسية")}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px' }}>
          <SearchableCombobox
            label={t('treasury.treasury_expense_entry_card.s1', "نوع / اسم المصروف")}
            placeholder={t('treasury.treasury_expense_entry_card.s2', "اختر من القائمة أو اكتب مصروف جديد...")}
            value={expenseForm.title}
            onChange={(val) => setExpenseForm(current => ({ ...current, title: val }))}
            options={presetOptions}
            search={(option, query) => normalizeArabicSearchKey(option.label).includes(normalizeArabicSearchKey(query))}
            getLabel={(option) => option.label}
            onSelect={(option) => setExpenseForm(current => ({ ...current, title: option.label }))}
            onCreate={(query) => setExpenseForm(current => ({ ...current, title: query }))}
            createLabel={(query) => `إضافة وتسجيل "${query}"`}
            emptyLabel={t('treasury.treasury_expense_entry_card.s3', "لا يوجد مصروف بهذا الاسم")}
            showDropdownOnEmpty={true}
          />

          <Field label={t('treasury.treasury_expense_entry_card.s4', "المبلغ")}>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={expenseForm.amount}
              onChange={(e) => setExpenseForm((current) => ({ ...current, amount: e.target.value }))}
            />
          </Field>
        </div>

        <Field label={t('treasury.treasury_expense_entry_card.s5', "التاريخ والوقت")}>
          <input
            type="datetime-local"
            value={expenseForm.date}
            onChange={(e) => setExpenseForm((current) => ({ ...current, date: e.target.value }))}
          />
        </Field>
      </div>

      {/* البطاقة الرمادية 2: التوجيه الإداري والمالي */}
      <div
        style={{
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
          <BuildingIcon size={16} color="#170e5e" />
          <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#170e5e' }}>{t('treasury.treasury_expense_entry_card.s6', "التوجيه الإداري والمالي والمخزني")}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {!SINGLE_STORE_MODE && (
            <Field label={t('treasury.treasury_expense_entry_card.s7', "الفرع")}>
              <CustomSelect
                options={branchOptions}
                value={expenseForm.branchId}
                onChange={(val) => {
                  const nextBranchId = val;
                  setExpenseForm((current) => {
                    const currentLocation = warehouseList.find((location) => String(location.id) === String(current.locationId));
                    const shouldClearLocation = Boolean(currentLocation && nextBranchId && currentLocation.branchId && String(currentLocation.branchId) !== String(nextBranchId));
                    return {
                      ...current,
                      branchId: nextBranchId,
                      locationId: shouldClearLocation ? '' : current.locationId,
                    };
                  });
                }}
                placeholder={t('treasury.treasury_expense_entry_card.s8', "اختر الفرع...")}
                searchable
              />
            </Field>
          )}

          {SINGLE_STORE_MODE ? (
            <Field label={t('treasury.treasury_expense_entry_card.s9', "المخزن الأساسي")}>
              <input value={warehouseList[0]?.name || t('treasury.treasury_expense_entry_card.s10', "المخزن الرئيسي")} disabled readOnly />
            </Field>
          ) : (
            <Field label={t('treasury.treasury_expense_entry_card.s11', "المخزن / الخزينة")}>
              <CustomSelect
                options={locationOptions}
                value={expenseForm.locationId}
                onChange={(val) => setExpenseForm((current) => ({ ...current, locationId: val }))}
                placeholder={t('treasury.treasury_expense_entry_card.s12', "اختر المخزن...")}
                searchable
              />
            </Field>
          )}

          <div style={{ gridColumn: '1 / -1' }}>
            <Field label={t('treasury.treasury_expense_entry_card.s13', "مركز التكلفة (اختياري)")}>
              <CustomSelect
                options={costCenterOptions}
                value={expenseForm.costCenterId || ''}
                onChange={(val) => setExpenseForm((current) => ({ ...current, costCenterId: val }))}
                placeholder={t('treasury.treasury_expense_entry_card.s14', "بدون مركز تكلفة...")}
                searchable
              />
            </Field>
          </div>
        </div>
      </div>

      {/* البطاقة الرمادية 3: الملاحظات ومرفق الفاتورة */}
      <div
        style={{
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
          <FileTextIcon size={16} color="#170e5e" />
          <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#170e5e' }}>{t('treasury.treasury_expense_entry_card.s15', "البيان والمستندات المرفقة")}</span>
        </div>

        <Field label={t('treasury.treasury_expense_entry_card.s16', "ملاحظات وبيان المصروف")}>
          <textarea
            rows={2}
            value={expenseForm.note}
            placeholder={t('treasury.treasury_expense_entry_card.s17', "تفاصيل إضافية عن سبب المصروف...")}
            onChange={(e) => setExpenseForm((current) => ({ ...current, note: e.target.value }))}
          />
        </Field>

        <CameraCaptureUpload
          label={t('treasury.treasury_expense_entry_card.s18', "إرفاق صورة إيصال / فاتورة المصروف")}
          previewUrl={receiptImage}
          onFileSelect={(_file, preview) => {
            setReceiptImage(preview || null);
          }}
          onRemove={() => setReceiptImage(null)}
        />
      </div>

      <MutationFeedback
        isError={expenseMutation.isError}
        isSuccess={expenseMutation.isSuccess}
        error={expenseMutation.error}
        errorFallback={t('treasury.treasury_expense_entry_card.s19', "تعذر تسجيل المصروف")}
        successText={t('treasury.treasury_expense_entry_card.s20', "تم تسجيل المصروف وتحديث الخزينة بنجاح.")}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
        <Button type="button" variant="secondary" onClick={onReset}>{t('treasury.treasury_expense_entry_card.s21', "تفريغ")}</Button>
        <SubmitButton
          type="button"
          onClick={handleSave}
          isPending={expenseMutation.isPending}
          disabled={expenseValidationErrors.length > 0}
          idleText={t('treasury.treasury_expense_entry_card.s22', "حفظ وتسجيل المصروف")}
          pendingText={t('treasury.treasury_expense_entry_card.s23', "جارٍ الحفظ...")}
        />
      </div>
    </div>
  );
}
