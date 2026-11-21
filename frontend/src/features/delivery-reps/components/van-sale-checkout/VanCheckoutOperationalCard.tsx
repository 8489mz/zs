import type React from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { CameraIcon, CheckCircleIcon, EditIcon, PackageIcon, SendIcon } from '@/shared/components/icons/AppIcons';
import type { RecipientSignatureData } from '../VanSignaturePadModal';

export interface VanCheckoutOperationalCardProps {
  t: TFunction;
  cartonsCount: string;
  onCartonsCountChange: (count: string) => void;
  deliveryProofPhoto: string;
  onDeliveryProofPhotoChange: (photo: string) => void;
  clearCanvasSignature: () => void;
  handlePhotoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  recipientSignatureData: RecipientSignatureData | null;
  setShowSignatureModal: Dispatch<SetStateAction<boolean>>;
  isCreditOrSplitDebt: boolean;
  localNotes: string;
  setLocalNotes: Dispatch<SetStateAction<string>>;
  onNotesChange?: (notes: string) => void;
  autoShareWhatsApp: boolean;
  setAutoShareWhatsApp: Dispatch<SetStateAction<boolean>>;
  showSignaturePad: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  handleStartDraw: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handleDraw: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handleEndDraw: () => void;
}

export function VanCheckoutOperationalCard({
  t,
  cartonsCount,
  onCartonsCountChange,
  deliveryProofPhoto,
  onDeliveryProofPhotoChange,
  clearCanvasSignature,
  handlePhotoUpload,
  recipientSignatureData,
  setShowSignatureModal,
  isCreditOrSplitDebt,
  localNotes,
  setLocalNotes,
  onNotesChange,
  autoShareWhatsApp,
  setAutoShareWhatsApp,
  showSignaturePad,
  canvasRef,
  handleStartDraw,
  handleDraw,
  handleEndDraw,
}: VanCheckoutOperationalCardProps) {
  return (
    <>
      {/* Operational Card: Cartons, Proof Photo, Signature, Notes */}
      <div
        style={{
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {/* Row 1: Cartons on Right, Photo & Signature on Left */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <PackageIcon size={14} color="#170e5e" />
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>{t('delivery_reps.van_sale_checkout_modal.s59', "عدد الطرود:")}</span>
            <input
              type="number"
              min="0"
              value={cartonsCount}
              onChange={(e) => onCartonsCountChange(e.target.value)}
              placeholder="0"
              style={{
                width: '46px',
                height: '30px',
                borderRadius: '5px',
                border: '1px solid #cbd5e1',
                textAlign: 'center',
                fontSize: '12px',
                fontWeight: 800,
                backgroundColor: '#ffffff',
              }}
            />
          </div>

          {/* Proof Photo & Touch Signature Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {deliveryProofPhoto ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <img
                  src={deliveryProofPhoto}
                  alt="Proof"
                  style={{ width: '28px', height: '22px', borderRadius: '4px', objectFit: 'contain', border: '1px solid #cbd5e1', backgroundColor: '#ffffff' }}
                />
                <span style={{ fontSize: '10.5px', color: '#16a34a', fontWeight: 700 }}>{t('delivery_reps.van_sale_checkout_modal.s60', "تم التوثيق")}</span>
                <button
                  type="button"
                  onClick={() => {
                    onDeliveryProofPhotoChange('');
                    clearCanvasSignature();
                  }}
                  style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', fontWeight: 700 }}
                >
                  {t('delivery_reps.van_sale_checkout_modal.s61', "حذف")}
                </button>
              </div>
            ) : (
              <label
                style={{
                  height: '30px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '5px',
                  padding: '0 9px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#170e5e',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                }}
              >
                <CameraIcon size={12} color="#170e5e" />
                <span>{t('delivery_reps.van_sale_checkout_modal.s62', "+ صورة")}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoUpload}
                  style={{ display: 'none' }}
                />
              </label>
            )}

            {recipientSignatureData ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '5px',
                  padding: '2px 6px',
                }}
              >
                <CheckCircleIcon size={12} color="#15803d" />
                <span style={{ fontSize: '10.5px', fontWeight: 800, color: '#15803d' }}>
                  {t('delivery_reps.van_sale_checkout_modal.s63', "مستلم:")} {recipientSignatureData.recipientName} ({recipientSignatureData.recipientRole})
                </span>
                <button
                  type="button"
                  onClick={() => setShowSignatureModal(true)}
                  style={{ color: '#15803d', background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', fontWeight: 700 }}
                >
                  {t('delivery_reps.van_sale_checkout_modal.s64', "تعديل")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSignatureModal(true)}
                style={{
                  height: '30px',
                  backgroundColor: isCreditOrSplitDebt ? '#fffbeb' : '#ffffff',
                  border: isCreditOrSplitDebt ? '1.5px solid #d97706' : '1px solid #cbd5e1',
                  borderRadius: '5px',
                  padding: '0 8px',
                  fontSize: '11px',
                  fontWeight: 800,
                  color: isCreditOrSplitDebt ? '#92400e' : '#170e5e',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                }}
              >
                <EditIcon size={12} color={isCreditOrSplitDebt ? '#92400e' : '#170e5e'} />
                <span>{t('delivery_reps.van_sale_checkout_modal.s65', "+ هوية وتوقيع المستلم")}</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Full Width Notes Input */}
        <input
          type="text"
          value={localNotes}
          onChange={(e) => {
            setLocalNotes(e.target.value);
            onNotesChange?.(e.target.value);
          }}
          placeholder={t('delivery_reps.van_sale_checkout_modal.s66', "ملاحظات على الفاتورة أو التسليم (اختياري)...")}
          style={{
            width: '100%',
            height: '30px',
            padding: '0 9px',
            borderRadius: '5px',
            border: '1px solid #cbd5e1',
            fontSize: '11.5px',
            backgroundColor: '#ffffff',
            boxSizing: 'border-box',
          }}
        />

        {/* Quick WhatsApp Share Switch */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11px',
            fontWeight: 700,
            color: autoShareWhatsApp ? '#15803d' : '#64748b',
            backgroundColor: autoShareWhatsApp ? '#f0fdf4' : '#f8fafc',
            border: `1px solid ${autoShareWhatsApp ? '#bbf7d0' : '#e2e8f0'}`,
            borderRadius: '6px',
            padding: '6px 10px',
            cursor: 'pointer',
            userSelect: 'none',
            boxSizing: 'border-box',
            transition: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={autoShareWhatsApp}
            onChange={(e) => setAutoShareWhatsApp(e.target.checked)}
            style={{ width: '15px', height: '15px', accentColor: '#16a34a', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <SendIcon size={13} color={autoShareWhatsApp ? '#16a34a' : '#64748b'} />
            <span>{t('delivery_reps.van_sale_checkout_modal.s67', "مشاركة الفاتورة مع العميل عبر واتساب فور الإصدار")}</span>
          </div>
        </label>

        {/* Interactive Signature Pad if opened */}
        {showSignaturePad && !deliveryProofPhoto && (
          <div
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '10.5px', fontWeight: 800, color: '#0f172a' }}>
                {t('delivery_reps.van_sale_checkout_modal.s68', "توقيع العميل / المستلم على الشاشة:")}
              </span>
              <button
                type="button"
                onClick={clearCanvasSignature}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#dc2626',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('delivery_reps.van_sale_checkout_modal.s69', "مسح")}
              </button>
            </div>
            <canvas
              ref={canvasRef}
              width={400}
              height={70}
              onPointerDown={handleStartDraw}
              onPointerMove={handleDraw}
              onPointerUp={handleEndDraw}
              style={{
                width: '100%',
                height: '70px',
                backgroundColor: '#f8fafc',
                border: '1px dashed #94a3b8',
                borderRadius: '4px',
                touchAction: 'none',
                cursor: 'crosshair',
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}
