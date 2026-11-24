import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { EyeIcon, EyeOffIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { HrEmployee } from '@/types/domain';

export interface EmployeeSelfServiceEditModalProps {
  editingEmployee: HrEmployee | null;
  setEditingEmployee: Dispatch<SetStateAction<HrEmployee | null>>;
  __t: ReturnType<typeof useTranslation>['t'];
  phoneInput: string;
  setPhoneInput: Dispatch<SetStateAction<string>>;
  setShowEmployeePassword: Dispatch<SetStateAction<boolean>>;
  showEmployeePassword: boolean;
  pinInput: string;
  setPinInput: Dispatch<SetStateAction<string>>;
  handleSaveCredentials: () => Promise<void>;
  isSubmitting: boolean;
}

export function EmployeeSelfServiceEditModal({ editingEmployee, setEditingEmployee, __t, phoneInput, setPhoneInput, setShowEmployeePassword, showEmployeePassword, pinInput, setPinInput, handleSaveCredentials, isSubmitting }: EmployeeSelfServiceEditModalProps) {
  return (
    <>
    {/* Edit Credentials Modal */}
    {editingEmployee && (
      <DialogShell
        open={Boolean(editingEmployee)}
        onClose={() => setEditingEmployee(null)}
        width="min(500px, 95vw)"
        ariaLabel={__t('settings.user_management.unified_access_directory_panel.s74', "تعديل بيانات الدخول للموظف")}
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
              {__t('settings.user_management.unified_access_directory_panel.s75', "تعديل بيانات الدخول:")} {editingEmployee.displayName || editingEmployee.firstName}
            </h3>
            <button
              type="button"
              onClick={() => setEditingEmployee(null)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                color: '#94a3b8',
                lineHeight: 1,
                padding: '4px',
              }}
              title={__t('settings.user_management.unified_access_directory_panel.s76', "إغلاق")}
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
            {__t('settings.user_management.unified_access_directory_panel.s77', "يستخدم الموظف رقم الهاتف المحمول والرمز السري (PIN) لتسجيل بصمة الحضور والانصراف الذكية (GPS) وللدخول إلى بوابة الموظف الذاتية (ESS).")}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('settings.user_management.unified_access_directory_panel.s78', "رقم الهاتف المحمول (معرف تسجيل الدخول للبوابات الذاتية)")}
            </label>
            <input
              type="text"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder={__t('settings.user_management.unified_access_directory_panel.s79', "مثال: 01012345678")}
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
                {__t('settings.user_management.unified_access_directory_panel.s80', "كلمة المرور / الرمز السري (Password / Passcode)")}
              </label>
              <button
                type="button"
                onClick={() => setShowEmployeePassword((prev) => !prev)}
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
                {showEmployeePassword ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                <span>{showEmployeePassword ? 'إخفاء' : 'إظهار'}</span>
              </button>
            </div>
            <input
              type={showEmployeePassword ? 'text' : 'password'}
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
            <Button variant="secondary" onClick={() => setEditingEmployee(null)}>
              {__t('settings.user_management.unified_access_directory_panel.s82', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              style={{ background: '#170e5e', borderColor: '#170e5e' }}
              onClick={handleSaveCredentials}
              disabled={isSubmitting}
            >
              {isSubmitting ? __t('settings.user_management.unified_access_directory_panel.s83', "جاري الحفظ...") : __t('settings.user_management.unified_access_directory_panel.s84', "حفظ التعديلات")}
            </Button>
          </div>
        </div>
      </DialogShell>
    )}
    </>
  );
}
