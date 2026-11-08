import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { RestaurantOperationsDialog } from './RestaurantOperationsDialog';
import { Button } from '@/shared/ui/button';
import {
  ShieldCheckIcon,
  CheckCircleIcon,
  UserIcon,
  FileTextIcon,
  LockIcon,
} from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import { toast } from '@/shared/components/system-alert';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';
import { useAuthStore } from '@/stores/auth-store';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

interface PosManagerCompModalProps {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  currentCartTotal: number;
  currentTableNumber?: string;
  cartSummary?: string;
  onApplyComp: (compDetails: {
    compType: 'vip_guest' | 'customer_complaint' | 'staff_meal' | 'promotional_tasting';
    amount: number;
    managerName: string;
    notes?: string;
  }) => Promise<void> | void;
}

export function PosManagerCompModal({
  open,
  onClose,
  onBack,
  currentCartTotal,
  currentTableNumber,
  cartSummary,
  onApplyComp,
}: PosManagerCompModalProps) {
  const { t: __t } = useTranslation();
  const currentUser = useAuthStore((s: any) => s.user);
  const [compType, setCompType] = useState<'vip_guest' | 'customer_complaint' | 'staff_meal' | 'promotional_tasting'>('vip_guest');
  const [isFullComp, setIsFullComp] = useState(true);
  const [customAmount, setCustomAmount] = useState<string>(String(currentCartTotal));
  const [managerName, setManagerName] = useState<string>(currentUser?.name || 'مدير الصالة');
  const [managerPin, setManagerPin] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const finalCompAmount = isFullComp
    ? currentCartTotal
    : Math.min(currentCartTotal, Math.max(0, Number(customAmount) || 0));

  const netPayable = Math.max(0, currentCartTotal - finalCompAmount);

  const handleConfirm = async () => {
    if (finalCompAmount <= 0) {
      toast.warning('مبلغ الضيافة يجب أن يكون أكبر من الصفر');
      return;
    }

    if (!managerName.trim()) {
      toast.warning('يرجى تحديد اسم المدير المعتمد للضيافة');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Record official comp ledger in backend
      await restaurantAdvancedFnbApi.recordManagerComp({
        compType,
        amount: finalCompAmount,
        managerName: managerName.trim(),
        tableNumber: currentTableNumber || undefined,
        itemsSummary: cartSummary || undefined,
        notes: notes.trim() || undefined,
      });

      // 2. Apply discount to POS cart
      await onApplyComp({
        compType,
        amount: finalCompAmount,
        managerName: managerName.trim(),
        notes: notes.trim() || undefined,
      });

      toast.success(`تم اعتماد قيد ضيافة الإدارة بقيمة ${formatCurrency(finalCompAmount)} بنجاح`);
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تسجيل ضيافة الإدارة');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RestaurantOperationsDialog
      open={open}
      onClose={onClose}
      onBack={onBack}
      title={__t('pos.pos_workspace.pos_manager_comp_modal.s0', __t('pos.pos_workspace.pos_manager_comp_modal.s0', "ضيافة الإدارة (Manager Comps & House Account)"))}
      subtitle={__t('pos.pos_workspace.pos_manager_comp_modal.s1', __t('pos.pos_workspace.pos_manager_comp_modal.s1', "اعتماد ضيافة رسمية وقيدها على حسابات الضيافة والتسويق مع التوثيق المحاسبي"))}
      icon={<ShieldCheckIcon size={18} color="#170e5e" />}
      footerNote={__t('pos.pos_workspace.pos_manager_comp_modal.s2', __t('pos.pos_workspace.pos_manager_comp_modal.s2', "يتم توثيق القيد وإدراجه تلقائياً في كشف ضيافات الإدارة وحسابات الأرباح والخسائر"))}
      scrollableBody={false}
      bodyStyle={{
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: '100%',
        boxSizing: 'border-box',
      }}
      footerActions={
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
            style={{ minHeight: '34px', height: '34px', padding: '0 16px', fontSize: '12px' }}
          >
            {__t('pos.pos_workspace.pos_manager_comp_modal.s3', __t('pos.pos_workspace.pos_manager_comp_modal.s3', "إلغاء"))}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={isSubmitting || finalCompAmount <= 0}
            style={{
              minHeight: '34px',
              height: '34px',
              padding: '0 20px',
              fontSize: '12px',
              fontWeight: 800,
              backgroundColor: '#170e5e',
            }}
          >
            {isSubmitting ? __t('pos.pos_workspace.pos_manager_comp_modal.s4', __t('pos.pos_workspace.pos_manager_comp_modal.s4', "جارٍ الاعتماد...")) : `اعتماد الضيافة (${formatCurrency(finalCompAmount)})`}
          </Button>
        </div>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.05fr 0.95fr',
          gap: '16px',
          height: '100%',
          boxSizing: 'border-box',
          alignItems: 'stretch',
        }}
      >
        {/* Right Column: Comp Type Selection & Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0, justifyContent: 'space-between' }}>
          {/* Box 1: Comp Type Selection */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px' }}>
            <label style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <FileTextIcon size={14} color="#170e5e" />
              <span>{__t('pos.pos_workspace.pos_manager_comp_modal.s5', __t('pos.pos_workspace.pos_manager_comp_modal.s5', "نوع ومبرر الضيافة المعتمد:"))}</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { key: 'vip_guest', label: __t('pos.pos_workspace.pos_manager_comp_modal.s6', __t('pos.pos_workspace.pos_manager_comp_modal.s6', "ضيافة زائر VIP أو شريك")), desc: 'House Hospitality' },
                { key: 'customer_complaint', label: __t('pos.pos_workspace.pos_manager_comp_modal.s7', __t('pos.pos_workspace.pos_manager_comp_modal.s7', "تعويض شكوى عميل / خدمة")), desc: 'Service Recovery' },
                { key: 'staff_meal', label: __t('pos.pos_workspace.pos_manager_comp_modal.s8', __t('pos.pos_workspace.pos_manager_comp_modal.s8', "وجبة موظف / طاقم العمل")), desc: 'Staff Meal Allowance' },
                { key: 'promotional_tasting', label: __t('pos.pos_workspace.pos_manager_comp_modal.s9', __t('pos.pos_workspace.pos_manager_comp_modal.s9', "تذوق ترويجي / صنف جديد")), desc: 'Promotional Tasting' },
              ].map((t) => {
                const isSelected = compType === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setCompType(t.key as any)}
                    style={{
                      padding: '9px 10px',
                      borderRadius: '8px',
                      border: isSelected ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                      backgroundColor: isSelected ? '#eef2ff' : '#ffffff',
                      color: isSelected ? '#170e5e' : '#334155',
                      textAlign: 'right',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      transition: 'all 0.15s ease',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                      <span style={{ fontSize: '11.5px', fontWeight: 800 }}>{t.label}</span>
                      {isSelected && <CheckCircleIcon size={13} color="#170e5e" />}
                    </div>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>{t.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Box 2: Manager Authorization */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                  <UserIcon size={13} color="#170e5e" />
                  <span>{__t('pos.pos_workspace.pos_manager_comp_modal.s10', __t('pos.pos_workspace.pos_manager_comp_modal.s10', "اسم المدير المعتمد:"))}</span>
                </label>
                <input
                  type="text"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 10px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                    background: '#ffffff',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                  <LockIcon size={13} color="#170e5e" />
                  <span>{__t('pos.pos_workspace.pos_manager_comp_modal.s11', __t('pos.pos_workspace.pos_manager_comp_modal.s11', "رمز PIN الأمني (اختياري):"))}</span>
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={managerPin}
                  onChange={(e) => setManagerPin(e.target.value)}
                  placeholder="••••"
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 10px',
                    fontSize: '12px',
                    textAlign: 'center',
                    boxSizing: 'border-box',
                    background: '#ffffff',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Box 3: Notes & Audit Justification */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px' }}>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '4px' }}>
              {__t('pos.pos_workspace.pos_manager_comp_modal.s12', __t('pos.pos_workspace.pos_manager_comp_modal.s12', "ملاحظات وتفاصيل الضيافة للتقرير المحاسبي:"))}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={__t('pos.pos_workspace.pos_manager_comp_modal.s13', __t('pos.pos_workspace.pos_manager_comp_modal.s13', "مثال: زيارة مالك العقار، أو تعويض عن تأخر طبق الشوربة"))}
              style={{
                width: '100%',
                height: '34px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                padding: '0 10px',
                fontSize: '12px',
                boxSizing: 'border-box',
                background: '#ffffff',
              }}
            />
          </div>
        </div>

        {/* Left Column: Financials & Authorization */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0, justifyContent: 'space-between' }}>
          {/* Cart & Financials Card */}
          <div
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '14px 16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px', marginBottom: '10px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>{__t('pos.pos_workspace.pos_manager_comp_modal.s14', __t('pos.pos_workspace.pos_manager_comp_modal.s14', "إجمالي الفاتورة الحالية:"))}</div>
                <div style={{ fontSize: '17px', fontWeight: 900, color: '#0f172a', marginTop: '2px' }}>
                  {formatCurrency(currentCartTotal)} {currentTableNumber && <span style={{ fontSize: '12px', color: '#170e5e', fontWeight: 700 }}>{__t('pos.pos_workspace.pos_manager_comp_modal.s15', __t('pos.pos_workspace.pos_manager_comp_modal.s15', "(طاولة"))} {currentTableNumber})</span>}
                </div>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '11px', color: '#64748b' }}>{__t('pos.pos_workspace.pos_manager_comp_modal.s16', __t('pos.pos_workspace.pos_manager_comp_modal.s16', "مبلغ الضيافة المعتمد:"))}</div>
                <div style={{ fontSize: '18px', fontWeight: 900, color: '#16a34a', marginTop: '2px' }}>
                  {formatCurrency(finalCompAmount)}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11.5px', color: '#475569' }}>
              <span>{__t('pos.pos_workspace.pos_manager_comp_modal.s17', __t('pos.pos_workspace.pos_manager_comp_modal.s17', "المطلوب تحصيله بعد الضيافة:"))}</span>
              <span style={{ fontWeight: 800, color: netPayable > 0 ? '#ea580c' : '#16a34a' }}>
                {netPayable === 0 ? __t('pos.pos_workspace.pos_manager_comp_modal.s18', __t('pos.pos_workspace.pos_manager_comp_modal.s18', "0.00 ج.م (إعفاء تام)")) : formatCurrency(netPayable)}
              </span>
            </div>
          </div>

          {/* Amount Mode: Full 100% vs Partial */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px' }}>
            <label style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', display: 'block', marginBottom: '8px' }}>
              {__t('pos.pos_workspace.pos_manager_comp_modal.s19', __t('pos.pos_workspace.pos_manager_comp_modal.s19', "تحديد نسبة وقيمة الضيافة:"))}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  setIsFullComp(true);
                  setCustomAmount(String(currentCartTotal));
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: isFullComp ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                  backgroundColor: isFullComp ? '#170e5e' : '#ffffff',
                  color: isFullComp ? '#ffffff' : '#334155',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {__t('pos.pos_workspace.pos_manager_comp_modal.s20', __t('pos.pos_workspace.pos_manager_comp_modal.s20', "ضيافة كاملة (100% إعفاء)"))}
              </button>
              <button
                type="button"
                onClick={() => setIsFullComp(false)}
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: !isFullComp ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                  backgroundColor: !isFullComp ? '#170e5e' : '#ffffff',
                  color: !isFullComp ? '#ffffff' : '#334155',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {__t('pos.pos_workspace.pos_manager_comp_modal.s21', __t('pos.pos_workspace.pos_manager_comp_modal.s21', "ضيافة جزئية بمبلغ محدد"))}
              </button>
            </div>

            {!isFullComp && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="number"
                    min="0.01"
                    max={currentCartTotal}
                    step="0.5"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder={__t('pos.pos_workspace.pos_manager_comp_modal.s22', __t('pos.pos_workspace.pos_manager_comp_modal.s22', "أدخل مبلغ الضيافة"))}
                    style={{
                      flex: 1,
                      height: '34px',
                      borderRadius: '6px',
                      border: '1.5px solid #170e5e',
                      padding: '0 10px',
                      fontSize: '13px',
                      fontWeight: 800,
                      boxSizing: 'border-box',
                      background: '#ffffff',
                    }}
                  />
                  {[25, 50, 75].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setCustomAmount(String(roundMoneyValue(currentCartTotal * (pct / 100), currencyMoneyDigits(getGlobalSystemCurrency()))))}
                      style={{
                        padding: '0 10px',
                        height: '34px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#475569',
                        cursor: 'pointer',
                      }}
                    >
                      %{pct}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Security & Audit Box */}
          <div
            style={{
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '10px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <ShieldCheckIcon size={20} color="#16a34a" />
            <div style={{ fontSize: '11px', color: '#166534', lineHeight: 1.45 }}>
              <strong>{__t('pos.pos_workspace.pos_manager_comp_modal.s23', __t('pos.pos_workspace.pos_manager_comp_modal.s23', "الرقابة المحاسبية:"))}</strong> {__t('pos.pos_workspace.pos_manager_comp_modal.s24', __t('pos.pos_workspace.pos_manager_comp_modal.s24', "يُرحّل القيد تلقائياً إلى حساب مصروفات الضيافة والتسويق مع توثيق اسم المدير ورقم الطاولة لمنع أي تلاعب مالي."))}
            </div>
          </div>
        </div>
      </div>
    </RestaurantOperationsDialog>
  );
}
