// Empty-state prompt — shown when no customer is selected and no search
// is running: a search hint plus shortcuts to the recent-calls tab and to
// creating a new customer. Pure move; the dialog keeps all state and
// mounts this component with the tab setter and the phone query.

import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { ClockIcon, PhoneIcon, PlusIcon } from '@/shared/components/icons/AppIcons';

export function PosPhoneOrderEmptyPrompt({
  setActiveTab,
  setIsForceNewCustomer,
  setNewPhone,
  phoneQuery,
}: {
  setActiveTab: Dispatch<SetStateAction<'desk' | 'recent_calls' | 'hardware'>>;
  setIsForceNewCustomer: Dispatch<SetStateAction<boolean>>;
  setNewPhone: Dispatch<SetStateAction<string>>;
  phoneQuery: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '36px 20px',
        textAlign: 'center',
        background: '#f8fafc',
        borderRadius: '10px',
        border: '1px dashed #cbd5e1',
      }}
    >
      <PhoneIcon size={36} color="#94a3b8" style={{ marginBottom: '8px' }} />
      <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
        {t('pos.pos_workspace.pos_phone_order_dialog.s41', "مكتب استقبال طلبات الهاتف والتوصيل السريع")}
      </div>
      <p style={{ fontSize: '0.78rem', color: '#64748b', maxWidth: '440px', margin: '0 0 12px 0', lineHeight: 1.5 }}>
        {t('pos.pos_workspace.pos_phone_order_dialog.s42', "أدخل")} <strong>{t('pos.pos_workspace.pos_phone_order_dialog.s43', "6 أرقام على الأقل")}</strong> {t('pos.pos_workspace.pos_phone_order_dialog.s44', "للبحث برقم الهاتف لتجاوز بادئة شركات المحمول (010 / 011 / 012 / 015)، أو ابدأ بكتابة اسم العميل.")}
      </p>
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setActiveTab('recent_calls')}
          style={{ fontSize: '0.75rem', fontWeight: 700 }}
        >
          <ClockIcon size={12} style={{ marginLeft: '4px' }} />
          {t('pos.pos_workspace.pos_phone_order_dialog.s45', "سجل المكالمات الواردة")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setIsForceNewCustomer(true);
            setNewPhone(phoneQuery || '');
          }}
          style={{ fontSize: '0.75rem', fontWeight: 700 }}
        >
          <PlusIcon size={12} style={{ marginLeft: '4px' }} />
          {t('pos.pos_workspace.pos_phone_order_dialog.s46', "تسجيل عميل جديد مباشرة")}
        </Button>
      </div>
    </div>
  );
}
