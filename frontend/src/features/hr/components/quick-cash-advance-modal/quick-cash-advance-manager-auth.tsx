import { money } from './quick-cash-advance-shared';
import { LockIcon } from '@/shared/components/icons/AppIcons';
import type { AuthUser } from '@/types/auth';
import type { Dispatch, SetStateAction } from 'react';

export interface QuickCashAdvanceManagerAuthProps {
  requiresManagerAuth: boolean;
  parsedAmount: number;
  isEarlyWagePayout: boolean;
  isAdvanceOverDirectCap: boolean;
  isOverdraft: boolean;
  maxDirectAdvance: number;
  isAdminOrOwner: boolean;
  currentUser: AuthUser | null;
  managerPassword: string;
  setManagerPassword: Dispatch<SetStateAction<string>>;
}

export function QuickCashAdvanceManagerAuth({ requiresManagerAuth, parsedAmount, isEarlyWagePayout, isAdvanceOverDirectCap, isOverdraft, maxDirectAdvance, isAdminOrOwner, currentUser, managerPassword, setManagerPassword }: QuickCashAdvanceManagerAuthProps) {
  return (
    <>
    {/* 6. Manager Password (Shows when amount exceeds available balance OR early wage payout) */}
    {requiresManagerAuth && parsedAmount > 0 && (
      <div
        style={{
          padding: 10,
          backgroundColor: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: 8,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <LockIcon size={15} color="#d97706" />
          <strong style={{ fontSize: '0.8rem', color: '#92400e' }}>
            {isEarlyWagePayout
              ? 'اعتماد المدير مطلوب: الصرف قبل موعد الاستحقاق الرسمي (تسوية مبكرة)'
              : isAdvanceOverDirectCap && !isOverdraft
                ? `اعتماد المدير مطلوب: السلفة تتجاوز الحد المباشر للكاشير (${money(maxDirectAdvance)} ج.م)`
                : 'اعتماد المدير أو مالك المنشأة مطلوب (سلفة استثنائية)'}
          </strong>
        </div>

        {isAdminOrOwner ? (
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#78350f' }}>
            {isEarlyWagePayout
              ? `أنت مسجل حالياً برتبة مدير/مسؤول نظام (${currentUser?.username})؛ سيتم توثيق العملية كـ "تسوية وصرف أجر مبكر معتمد من الإدارة".`
              : isAdvanceOverDirectCap && !isOverdraft
                ? `أنت مسجل برتبة مدير/مسؤول نظام (${currentUser?.username})؛ سيتم اعتماد السلفة الاستثنائية باسمك.`
                : `أنت مسجل حالياً برتبة مدير/مسؤول نظام (${currentUser?.username})؛ سيتم توثيق الاعتماد باسمك في السجل الرقابي.`}
          </p>
        ) : (
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
              {isEarlyWagePayout
                ? 'كلمة مرور المدير / رمز PIN للموافقة على التسوية المبكرة *'
                : isAdvanceOverDirectCap && !isOverdraft
                  ? 'كلمة مرور المدير / رمز PIN للموافقة على سلفة تتجاوز سقف الكاشير *'
                  : 'كلمة مرور المدير / رمز PIN للموافقة على سلفة على المكشوف *'}
            </label>
            <input
              type="password"
              required
              value={managerPassword}
              onChange={(e) => setManagerPassword(e.target.value)}
              placeholder="أدخل كلمة مرور الإدارة للاعتماد"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
              }}
            />
          </div>
        )}
      </div>
    )}
    </>
  );
}
