import { AlertTriangleIcon } from '@/shared/components/icons/AppIcons';

export interface VanCheckoutValidationBannerProps {
  validationError: string;
}

export function VanCheckoutValidationBanner({
  validationError,
}: VanCheckoutValidationBannerProps) {
  return (
    <>
      {/* Validation Error Banner */}
      {validationError && (
        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '6px 10px',
            borderRadius: '6px',
            fontSize: '11.5px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <AlertTriangleIcon size={14} color="#dc2626" />
          <span>{validationError}</span>
        </div>
      )}
    </>
  );
}
