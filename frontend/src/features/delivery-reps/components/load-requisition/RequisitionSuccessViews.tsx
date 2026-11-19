import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { CheckCircleIcon } from '@/shared/components/icons/AppIcons';

export interface AdminSubmitResult {
  docNo: string;
  dispatched: boolean;
  tripId?: number;
  repName: string;
}

export interface AdminSubmitSuccessViewProps {
  adminSubmitResult: AdminSubmitResult;
  onBack: () => void;
}

export interface DriverSubmitSuccessViewProps {
  submittedDocNo: string;
  onBack: () => void;
}

// Success view if submitted by Admin
export function AdminSubmitSuccessView({ adminSubmitResult, onBack }: AdminSubmitSuccessViewProps) {
  const { t } = useTranslation();
  return (
    <div
      dir="rtl"
      style={{
        minHeight: '85vh',
        backgroundColor: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '36px 28px',
          maxWidth: '560px',
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: '#ecfdf5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <CheckCircleIcon size={36} color="#10b981" />
        </div>

        <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>
          {adminSubmitResult.dispatched
            ? t('delivery_reps.driver_new_load_requisition_view.s0', "تم صرف البضاعة وتحميل السيارة وبدء رحلة التوزيع!")
            : t('delivery_reps.driver_new_load_requisition_view.s1', "تم حفظ إذن التحميل كمسودة معلقة بنجاح!")}
        </h2>

        <div
          style={{
            backgroundColor: '#f1f5f9',
            borderRadius: '8px',
            padding: '12px 18px',
            margin: '14px 0 20px',
            display: 'inline-flex',
            gap: '20px',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div>
            <span style={{ fontSize: '11.5px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s2', "رقم إذن التحميل:")}</span>
            <span style={{ fontSize: '17px', fontWeight: 900, color: '#170e5e', fontFamily: 'monospace' }}>
              #{adminSubmitResult.docNo}
            </span>
          </div>
          {adminSubmitResult.tripId && (
            <>
              <div style={{ height: '28px', width: '1px', backgroundColor: '#cbd5e1' }} />
              <div>
                <span style={{ fontSize: '11.5px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s3', "رقم رحلة التوزيع:")}</span>
                <span style={{ fontSize: '17px', fontWeight: 900, color: '#15803d', fontFamily: 'monospace' }}>
                  #{adminSubmitResult.tripId}
                </span>
              </div>
            </>
          )}
        </div>

        <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.6, margin: '0 0 24px' }}>
          {adminSubmitResult.dispatched
            ? `تم خصم كميات البضاعة من المستودع وتحويلها لعهدة سيارة المندوب "${adminSubmitResult.repName}". السيارة محملة والرحلة نشطة.`
            : `تم تسجيل طلب التحميل وإسناده للمندوب "${adminSubmitResult.repName}".`}
        </p>

        <Button
          variant="primary"
          onClick={onBack}
          style={{
            backgroundColor: '#170e5e',
            color: '#ffffff',
            fontSize: '13.5px',
            fontWeight: 800,
            padding: '10px 24px',
            width: '100%',
            borderRadius: '10px',
          }}
        >
          {t('delivery_reps.driver_new_load_requisition_view.s4', "العودة لقائمة أذونات التحميل")}
        </Button>
      </div>
    </div>
  );
}

// Success view if submitted in driver mode
export function DriverSubmitSuccessView({ submittedDocNo, onBack }: DriverSubmitSuccessViewProps) {
  const { t } = useTranslation();
  return (
    <div
      dir="rtl"
      style={{
        minHeight: '85vh',
        backgroundColor: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '36px 28px',
          maxWidth: '520px',
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: '#ecfdf5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <CheckCircleIcon size={36} color="#10b981" />
        </div>

        <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>
          {t('delivery_reps.driver_new_load_requisition_view.s5', "تم إرسال طلب شحن البضاعة بنجاح!")}
        </h2>

        <div
          style={{
            backgroundColor: '#f1f5f9',
            borderRadius: '8px',
            padding: '10px 14px',
            margin: '14px 0 20px',
            display: 'inline-block',
          }}
        >
          <span style={{ fontSize: '12px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s6', "رقم إذن التحميل المقترح:")}</span>
          <span style={{ fontSize: '18px', fontWeight: 900, color: '#170e5e', fontFamily: 'monospace' }}>
            #{submittedDocNo}
          </span>
        </div>

        <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.6, margin: '0 0 24px' }}>
          {t('delivery_reps.driver_new_load_requisition_view.s7', "تم رفع الطلب إلى المشرف المختص لمراجعة الأرصدة وإصدار أمر الصرف الفعلي لسيارتك.")}
        </p>

        <Button
          variant="primary"
          onClick={onBack}
          style={{
            backgroundColor: '#170e5e',
            color: '#ffffff',
            fontSize: '13.5px',
            fontWeight: 800,
            padding: '10px 24px',
            width: '100%',
            borderRadius: '10px',
          }}
        >
          {t('delivery_reps.driver_new_load_requisition_view.s8', "العودة للرئيسية")}
        </Button>
      </div>
    </div>
  );
}
