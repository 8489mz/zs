// Hardware configuration tab — the USB serial caller-ID device: an intro
// card, the live connection status with its connect button, and the
// simulate-a-ring test card. Pure move; the dialog keeps all state and
// mounts this component with the status flags and its callbacks.

import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { PhoneIncomingIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';

export function PosPhoneOrderDialogHardware({
  isSerialConnected,
  isSerialSupported,
  isConnectingHardware,
  handleConnectHardware,
  handleSimulateCall,
}: {
  isSerialConnected: boolean;
  isSerialSupported: boolean;
  isConnectingHardware: boolean;
  handleConnectHardware: () => Promise<void>;
  handleSimulateCall: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
          {t('pos.pos_workspace.pos_phone_order_dialog.s26', "إعدادات جهاز كاشف رقم المتصل (USB Serial Caller ID)")}
        </h3>
        <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: 0, lineHeight: 1.6 }}>
          {t('pos.pos_workspace.pos_phone_order_dialog.s27', "يتيح ربط جهاز كاشف الرقم التقاط رقم المتصل فور رنين هاتف المطعم وفتح ملف العميل تلقائياً بضغطة واحدة دون الحاجة لكتابة الرقم يدوياً.")}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s28', "حالة التوصيل المباشر")}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: isSerialConnected ? '#10b981' : '#94a3b8',
              }}
            />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: isSerialConnected ? '#065f46' : '#64748b' }}>
              {isSerialConnected ? t('pos.pos_workspace.pos_phone_order_dialog.s29', "متصل بجهاز كاشف الرقم") : t('pos.pos_workspace.pos_phone_order_dialog.s30', "غير متصل")}
            </span>
          </div>
          <Button
            style={{ width: '100%', background: '#170e5e', color: '#ffffff', fontWeight: 700 }}
            disabled={!isSerialSupported || isConnectingHardware}
            onClick={handleConnectHardware}
          >
            <RefreshCwIcon size={14} style={{ marginLeft: '6px' }} />
            {isConnectingHardware ? t('pos.pos_workspace.pos_phone_order_dialog.s31', "جاري الاتصال...") : t('pos.pos_workspace.pos_phone_order_dialog.s32', "توصيل جهاز كاشف الأرقام USB")}
          </Button>
          {!isSerialSupported && (
            <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '8px' }}>
              {t('pos.pos_workspace.pos_phone_order_dialog.s33', "المتصفح الحالي لا يدعم Web Serial API. يرجى استخدام متصفح Chrome أو Edge.")}
            </div>
          )}
        </div>

        <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s34', "محاكاة واختبار الرنين (QA & Testing)")}
          </div>
          <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '16px', lineHeight: 1.5 }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s35', "يمكنك محاكاة مكالمة هاتفية واردة لتجربة التنبيه الصوتي والنافذة المنبثقة فورياً.")}
          </p>
          <Button
            variant="secondary"
            style={{ width: '100%', fontWeight: 700 }}
            onClick={handleSimulateCall}
          >
            <PhoneIncomingIcon size={14} style={{ marginLeft: '6px' }} />
            {t('pos.pos_workspace.pos_phone_order_dialog.s36', "محاكاة اتصال هاتفي وارد الآن")}
          </Button>
        </div>
      </div>
    </div>
  );
}
