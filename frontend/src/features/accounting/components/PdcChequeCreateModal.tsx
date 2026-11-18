import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { FileTextIcon, DollarSignIcon } from '@/shared/components/icons/AppIcons';
import { pdcChequesApi, type ChequeType, type CreatePdcChequePayload } from '../api/accounting.api';
import { todayLocalDateKey } from '@/lib/format';

export interface PdcChequeCreateModalProps {
  open: boolean;
  onClose: () => void;
  chequeType: ChequeType;
  onCreated?: () => void;
}

const getInitialState = (type: ChequeType, currency: string): CreatePdcChequePayload => ({
  type,
  chequeNumber: '',
  bankName: '',
  branchName: '',
  drawerName: '',
  partnerName: '',
  amount: 0,
  currency,
  issueDate: todayLocalDateKey(),
  dueDate: '',
  notes: '',
});

const CURRENCY_OPTIONS = [
  { value: 'EGP', label: 'جنيه مصري (EGP)' },
  { value: 'SAR', label: 'ريال سعودي (SAR)' },
  { value: 'USD', label: 'دولار أمريكي (USD)' },
  { value: 'EUR', label: 'يورو (EUR)' },
  { value: 'AED', label: 'درهم إماراتي (AED)' },
  { value: 'KWD', label: 'دينار كويتي (KWD)' },
];

export function PdcChequeCreateModal({
  open,
  onClose,
  chequeType,
  onCreated,
}: PdcChequeCreateModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { currencyCode } = useSystemCurrency();
  const [newCheque, setNewCheque] = useState<CreatePdcChequePayload>(() => getInitialState(chequeType, currencyCode));

  useEffect(() => {
    if (open) {
      setNewCheque(getInitialState(chequeType, currencyCode));
    }
  }, [open, chequeType, currencyCode]);

  const createMutation = useMutation({
    mutationFn: (payload: CreatePdcChequePayload) => pdcChequesApi.create(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pdc-cheques-list'] });
      void queryClient.invalidateQueries({ queryKey: ['pdc-cheques-stats'] });
      if (onCreated) onCreated();
      onClose();
    },
  });

  if (!open) return null;

  const isReceivable = chequeType === 'receivable';

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={isReceivable ? t('accounting.pdc_cheque_create_modal.s0', "تسجيل ورقة قبض جديدة (شيك عميل)") : t('accounting.pdc_cheque_create_modal.s1', "تحرير ورقة دفع جديدة (شيك مورد)")}
      subtitle={t('accounting.pdc_cheque_create_modal.s2', "إدخال بيانات الشيك البنكي وتفاصيل الساحب والمبلغ وتاريخ الاستحقاق بالحافظة")}
      size="lg"
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <label className="field">
          <span>{t('accounting.arch02.chequeRate', 'سعر صرف الشيك بعملة الأساس (اختياري؛ الافتراضي سعر العملة المسجل)')}</span>
          <input type="number" min="0.000001" step="0.000001" value={newCheque.exchangeRate ?? ''} onChange={event => setNewCheque({ ...newCheque, exchangeRate: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
        {/* Card 1: Bank & Partner Info */}
        <div style={{
          backgroundColor: '#f8fafc',
          borderRadius: '12px',
          padding: '16px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
            <FileTextIcon size={16} style={{ color: '#170e5e' }} />
            <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', margin: 0 }}>
              {t('accounting.pdc_cheque_create_modal.s3', "بيانات الشيك والطرف المستفيد")}
            </h4>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('accounting.pdc_cheque_create_modal.s4', "رقم الشيك")} <span style={{ color: '#e11d48' }}>*</span>
            </label>
            <input
              type="text"
              value={newCheque.chequeNumber}
              onChange={(e) => setNewCheque({ ...newCheque, chequeNumber: e.target.value })}
              placeholder={t('accounting.pdc_cheque_create_modal.s5', "مثال: 00482910")}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '12px',
                color: '#1e293b',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {isReceivable ? t('accounting.pdc_cheque_create_modal.s6', "اسم العميل / الطرف") : t('accounting.pdc_cheque_create_modal.s7', "اسم المورد المستفيد")}{' '}
              <span style={{ color: '#e11d48' }}>*</span>
            </label>
            <input
              type="text"
              value={newCheque.partnerName}
              onChange={(e) => setNewCheque({ ...newCheque, partnerName: e.target.value })}
              placeholder={t('accounting.pdc_cheque_create_modal.s8', "الاسم الثلاثي أو اسم المنشأة")}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '12px',
                color: '#1e293b',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('accounting.pdc_cheque_create_modal.s9', "البنك المسحوب عليه")} <span style={{ color: '#e11d48' }}>*</span>
            </label>
            <input
              type="text"
              value={newCheque.bankName}
              onChange={(e) => setNewCheque({ ...newCheque, bankName: e.target.value })}
              placeholder={t('accounting.pdc_cheque_create_modal.s10', "مثال: البنك الأهلي المصري / بنك الراجحي")}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '12px',
                color: '#1e293b',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('accounting.pdc_cheque_create_modal.s11', "فرع البنك")}
            </label>
            <input
              type="text"
              value={newCheque.branchName || ''}
              onChange={(e) => setNewCheque({ ...newCheque, branchName: e.target.value })}
              placeholder={t('accounting.pdc_cheque_create_modal.s12', "مثال: فرع التجمع الخامس")}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '12px',
                color: '#1e293b',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('accounting.pdc_cheque_create_modal.s13', "اسم الساحب الفعلي (إن وجد)")}
            </label>
            <input
              type="text"
              value={newCheque.drawerName || ''}
              onChange={(e) => setNewCheque({ ...newCheque, drawerName: e.target.value })}
              placeholder={t('accounting.pdc_cheque_create_modal.s14', "اسم صاحب الحساب البنكي الموقع")}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '12px',
                color: '#1e293b',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Card 2: Financial & Dates Info */}
        <div style={{
          backgroundColor: '#f8fafc',
          borderRadius: '12px',
          padding: '16px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
            <DollarSignIcon size={16} style={{ color: '#170e5e' }} />
            <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', margin: 0 }}>
              {t('accounting.pdc_cheque_create_modal.s15', "البيانات المالية وتواريخ الاستحقاق")}
            </h4>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('accounting.pdc_cheque_create_modal.s16', "المبلغ")} <span style={{ color: '#e11d48' }}>*</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={newCheque.amount || ''}
                onChange={(e) => setNewCheque({ ...newCheque, amount: Number(e.target.value) })}
                placeholder="0.00"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#0f172a',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('accounting.pdc_cheque_create_modal.s17', "العملة")}
              </label>
              <CustomSelect
                value={newCheque.currency}
                onChange={(val) => setNewCheque({ ...newCheque, currency: val })}
                options={CURRENCY_OPTIONS}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('accounting.pdc_cheque_create_modal.s18', "تاريخ التحرير / الاستلام")} <span style={{ color: '#e11d48' }}>*</span>
            </label>
            <input
              type="date"
              value={newCheque.issueDate}
              onChange={(e) => setNewCheque({ ...newCheque, issueDate: e.target.value })}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '12px',
                color: '#1e293b',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('accounting.pdc_cheque_create_modal.s19', "تاريخ الاستحقاق (الصرف)")} <span style={{ color: '#e11d48' }}>*</span>
            </label>
            <input
              type="date"
              value={newCheque.dueDate}
              onChange={(e) => setNewCheque({ ...newCheque, dueDate: e.target.value })}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '12px',
                color: '#1e293b',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('accounting.pdc_cheque_create_modal.s20', "ملاحظات إضافية")}
            </label>
            <textarea
              rows={3}
              value={newCheque.notes || ''}
              onChange={(e) => setNewCheque({ ...newCheque, notes: e.target.value })}
              placeholder={t('accounting.pdc_cheque_create_modal.s21', "رقم الفاتورة أو العقد المرتبط بالشيك...")}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '12px',
                color: '#1e293b',
                boxSizing: 'border-box',
                resize: 'none',
              }}
            />
          </div>
        </div>
      </div>

      <StandardDialogFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          style={{ padding: '8px 18px', fontSize: '13px', borderRadius: '8px' }}
        >
          {t('accounting.pdc_cheque_create_modal.s22', "إلغاء")}
        </Button>
        <Button
          type="button"
          onClick={() => createMutation.mutate(newCheque)}
          disabled={
            createMutation.isPending ||
            !newCheque.chequeNumber ||
            !newCheque.partnerName ||
            !newCheque.bankName ||
            !newCheque.amount ||
            !newCheque.dueDate
          }
          style={{
            backgroundColor: '#170e5e',
            color: '#ffffff',
            padding: '8px 22px',
            fontSize: '13px',
            fontWeight: 700,
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            opacity: createMutation.isPending || !newCheque.chequeNumber ? 0.6 : 1,
          }}
        >
          {createMutation.isPending ? t('accounting.pdc_cheque_create_modal.s23', "جاري الحفظ...") : t('accounting.pdc_cheque_create_modal.s24', "حفظ الشيك بالحافظة")}
        </Button>
      </StandardDialogFooter>
    </StandardDialog>
  );
}
