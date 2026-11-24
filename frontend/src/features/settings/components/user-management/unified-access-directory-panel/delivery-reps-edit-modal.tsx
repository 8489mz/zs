import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { EyeIcon, EyeOffIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';
import type { UseMutationResult } from '@tanstack/react-query';

export interface DeliveryRepsEditModalProps {
  editingRep: DeliveryRep | null;
  setEditingRep: Dispatch<SetStateAction<DeliveryRep | null>>;
  __t: ReturnType<typeof useTranslation>['t'];
  phoneInput: string;
  setPhoneInput: Dispatch<SetStateAction<string>>;
  setShowRepPassword: Dispatch<SetStateAction<boolean>>;
  showRepPassword: boolean;
  pinInput: string;
  setPinInput: Dispatch<SetStateAction<string>>;
  handleSaveCredentials: () => void;
  updateMutation: UseMutationResult<DeliveryRep, any, { id: number; payload: Partial<DeliveryRep> & { pinCode?: string | undefined; }; }, unknown>;
}

export function DeliveryRepsEditModal({ editingRep, setEditingRep, __t, phoneInput, setPhoneInput, setShowRepPassword, showRepPassword, pinInput, setPinInput, handleSaveCredentials, updateMutation }: DeliveryRepsEditModalProps) {
  return (
    <>
    {/* Edit Credentials Modal */}
    {editingRep && (
      <DialogShell
        open={Boolean(editingRep)}
        onClose={() => setEditingRep(null)}
        width="min(500px, 95vw)"
        ariaLabel={__t('settings.user_management.unified_access_directory_panel.s33', "تعديل بيانات الدخول للمندوب")}
      >
        <div
          className="dialog-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '24px 28px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid #e2e8f0',
              paddingBottom: '12px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a', lineHeight: 1.4 }}>
              {__t('settings.user_management.unified_access_directory_panel.s34', "تعديل بيانات الدخول:")} {editingRep.name}
            </h3>
            <button
              type="button"
              onClick={() => setEditingRep(null)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                color: '#94a3b8',
                lineHeight: 1,
                padding: '4px',
              }}
              title={__t('settings.user_management.unified_access_directory_panel.s35', "إغلاق")}
            >
              ✕
            </button>
          </div>

          <div
            style={{
              background: '#f8fafc',
              padding: '12px 14px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              fontSize: '12.5px',
              color: '#475569',
              lineHeight: 1.5,
            }}
          >
            {__t('settings.user_management.unified_access_directory_panel.s36', "يستخدم المندوب رقم الهاتف والرمز السري (PIN) للدخول إلى تطبيق المندوب أو نقطة بيع الفان.")}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('settings.user_management.unified_access_directory_panel.s37', "رقم الهاتف المحمول (معرف تسجيل الدخول)")}
            </label>
            <input
              type="text"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder={__t('settings.user_management.unified_access_directory_panel.s38', "مثال: 01012345678")}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '7px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                direction: 'ltr',
                textAlign: 'right',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>
                {__t('settings.user_management.unified_access_directory_panel.s39', "كلمة المرور / الرمز السري (Password / Passcode)")}
              </label>
              <button
                type="button"
                onClick={() => setShowRepPassword((prev) => !prev)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '11.5px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: 0,
                }}
              >
                {showRepPassword ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                <span>{showRepPassword ? 'إخفاء' : 'إظهار'}</span>
              </button>
            </div>
            <input
              type={showRepPassword ? 'text' : 'password'}
              maxLength={64}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="أدخل كلمة مرور قوية أو رمز أرقام (4 خانات فأكثر)"
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '7px',
                border: '1px solid #cbd5e1',
                fontSize: '14px',
                direction: 'ltr',
                textAlign: 'left',
                boxSizing: 'border-box',
              }}
            />
            <span style={{ display: 'block', fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
              يمكنك تعيين كلمة مرور بأحرف وأرقام أو رمز PIN قوي. يُحظر استخدام الرموز البديهية مثل 0000 أو 1234 أو نهاية رقم الهاتف.
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <Button variant="secondary" onClick={() => setEditingRep(null)}>
              {__t('settings.user_management.unified_access_directory_panel.s41', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              style={{ background: '#170e5e', borderColor: '#170e5e' }}
              onClick={handleSaveCredentials}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? __t('settings.user_management.unified_access_directory_panel.s42', "جاري الحفظ...") : __t('settings.user_management.unified_access_directory_panel.s43', "حفظ التعديلات")}
            </Button>
          </div>
        </div>
      </DialogShell>
    )}
    </>
  );
}
