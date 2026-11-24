export interface QuickCashAdvanceFormErrorProps {
  formError: string;
}

export function QuickCashAdvanceFormError({ formError }: QuickCashAdvanceFormErrorProps) {
  return (
    <>
    {formError && (
      <div
        className="error-box"
        style={{
          marginBottom: 10,
          padding: '8px 10px',
          backgroundColor: '#fef2f2',
          border: '1px solid #fca5a5',
          borderRadius: 6,
          color: '#991b1b',
          fontSize: '0.78rem',
        }}
      >
        {formError}
      </div>
    )}
    </>
  );
}
