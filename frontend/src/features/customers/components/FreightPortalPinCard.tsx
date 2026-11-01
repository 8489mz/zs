import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { useSetFreightPortalPinMutation } from '@/features/customers/hooks/useSetFreightPortalPinMutation';
import {
  validateFreightPortalPin,
  type FreightPortalPinValidationCode,
} from '@/features/customers/lib/freight-portal-pin';

const CLIENT_ERROR_TEXT: Record<FreightPortalPinValidationCode, string> = {
  PIN_REQUIRED: 'freight_portal_pin_required',
  PIN_TOO_SHORT: 'freight_portal_pin_too_short',
  PIN_MISMATCH: 'freight_portal_pin_mismatch',
};

/**
 * Staff-only freight-portal PIN reset for one customer
 * (INV-FREIGHT-PORTAL-PIN-UI). Deliberately separate from the customer
 * edit form: resetting a PIN must never ride on saving customer data,
 * and it must never mark the customer form dirty. The PIN fields are
 * cleared on success, the PIN value is never displayed, logged, or
 * stored, and strength beyond presence/length/match is decided by
 * the server, whose rejection is shown verbatim.
 */
export function FreightPortalPinCard({ customerId }: { customerId: string }) {
  const { t: __t } = useTranslation();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [clientErrors, setClientErrors] = useState<FreightPortalPinValidationCode[]>([]);

  const mutation = useSetFreightPortalPinMutation(customerId, () => {
    setPin('');
    setConfirmPin('');
    setClientErrors([]);
  });

  const handleSubmit = () => {
    const errors = validateFreightPortalPin(pin, confirmPin);
    setClientErrors(errors);
    if (errors.length > 0) return;
    mutation.mutate(pin.trim());
  };

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '14px 16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
          {__t('customers.freight_portal_pin_card.s0', 'رمز دخول بوابة الشحن للعميل')}
        </h4>
      </div>

      <p style={{ margin: 0, fontSize: '12px', color: '#475569' }}>
        {__t(
          'customers.freight_portal_pin_card.s1',
          'تعيين رمز جديد يلغي الرمز القديم فورًا. الرمز يُحفظ مشفرًا ولا يظهر مرة أخرى، فأبلغه للعميل بطريقة آمنة بعد التعيين.',
        )}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
        <Field label={__t('customers.freight_portal_pin_card.s2', 'الرمز الجديد')}>
          <input
            type="password"
            autoComplete="new-password"
            value={pin}
            disabled={mutation.isPending}
            onChange={(event) => {
              setPin(event.target.value);
              setClientErrors([]);
            }}
            style={{ height: '36px', fontSize: '12.5px' }}
          />
        </Field>
        <Field label={__t('customers.freight_portal_pin_card.s3', 'تأكيد الرمز الجديد')}>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPin}
            disabled={mutation.isPending}
            onChange={(event) => {
              setConfirmPin(event.target.value);
              setClientErrors([]);
            }}
            style={{ height: '36px', fontSize: '12.5px' }}
          />
        </Field>
      </div>

      {clientErrors.length > 0 && (
        <div className="error-box">
          {clientErrors
            .map((code) =>
              __t(
                `customers.freight_portal_pin_card.${CLIENT_ERROR_TEXT[code]}`,
                code === 'PIN_REQUIRED'
                  ? 'اكتب الرمز الجديد.'
                  : code === 'PIN_TOO_SHORT'
                    ? 'الرمز لازم يكون 4 خانات على الأقل.'
                    : 'تأكيد الرمز مش مطابق للرمز الجديد.',
              ),
            )
            .join(' ')}
        </div>
      )}

      <MutationFeedback
        isError={mutation.isError}
        isSuccess={mutation.isSuccess}
        error={mutation.error}
        errorFallback={__t('customers.freight_portal_pin_card.s4', 'تعذر تعيين رمز بوابة الشحن')}
        successText={__t('customers.freight_portal_pin_card.s5', 'تم تعيين رمز دخول بوابة الشحن الجديد بنجاح.')}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          type="button"
          variant="primary"
          onClick={handleSubmit}
          disabled={mutation.isPending}
          style={{ minHeight: '36px', padding: '0 24px', fontSize: '12.5px', fontWeight: 800 }}
        >
          {mutation.isPending
            ? __t('customers.freight_portal_pin_card.s6', 'جارٍ تعيين الرمز...')
            : __t('customers.freight_portal_pin_card.s7', 'تعيين رمز بوابة الشحن')}
        </Button>
      </div>
    </div>
  );
}
