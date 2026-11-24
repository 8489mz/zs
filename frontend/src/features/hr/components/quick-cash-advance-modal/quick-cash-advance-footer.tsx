import { Button } from '@/shared/ui/button';
import { LockIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { UseMutationResult } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';

export interface QuickCashAdvanceFooterProps {
  setIsOpen: Dispatch<SetStateAction<boolean>>;
  t: ReturnType<typeof useTranslation>['t'];
  mutation: UseMutationResult<unknown, Error, any, unknown>;
  activeShift: Record<string, unknown> | null;
  employeeId: string;
  parsedAmount: number;
  requiresManagerAuth: boolean;
  activeTab: 'advance' | 'payout';
  isEarlyWagePayout: boolean;
}

export function QuickCashAdvanceFooter({ setIsOpen, t, mutation, activeShift, employeeId, parsedAmount, requiresManagerAuth, activeTab, isEarlyWagePayout }: QuickCashAdvanceFooterProps) {
  return (
    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
        {t('hr.quick_cash_advance_modal.cancel', 'إلغاء')}
      </Button>
      <Button
        type="submit"
        disabled={mutation.isPending || !activeShift || !employeeId || !parsedAmount}
        style={{
          backgroundColor: '#170e5e',
          color: '#ffffff',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {requiresManagerAuth && <LockIcon size={14} color="#ffffff" />}
        {mutation.isPending
          ? 'جاري الصرف والتسجيل...'
          : requiresManagerAuth
            ? (activeTab === 'payout' ? (isEarlyWagePayout ? 'اعتماد وصرف تسوية مبكرة' : 'اعتماد وصرف الراتب') : 'اعتماد وصرف السلفة')
            : (activeTab === 'payout' ? 'تأكيد صرف الراتب وتصفية الرصيد' : 'صرف المسحوب من المستحقات')}
      </Button>
    </div>
  );
}
