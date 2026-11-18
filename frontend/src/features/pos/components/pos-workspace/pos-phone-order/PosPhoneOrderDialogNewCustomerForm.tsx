// New-customer form — the fallback branch when no stored customer matches:
// name, phone and address fields, Kuwait PACI helpers, zone and payment
// at the door, then the save action. Pure move; the dialog keeps all state
// and mounts this component with the form values and their callbacks.

import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseMutationResult } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import type { PosCustomerDeliveryProfile } from '@/features/pos/api/pos.api';
import type { Customer } from '@/types/domain';
import type { DoorstepPaymentMethod } from '@/features/pos/types/pos.types';
import { CheckCircleIcon, PlusIcon } from '@/shared/components/icons/AppIcons';

export function PosPhoneOrderDialogNewCustomerForm({
  isForceNewCustomer,
  matchedCustomers,
  setIsForceNewCustomer,
  newName,
  createCustomerMutation,
  newPhone,
  newAddress,
  newNotes,
  setNewName,
  setNewPhone,
  isKwd,
  isKsa,
  setAddressTag,
  addressTag,
  setNewAddress,
  buildPaciAddress,
  paciArea,
  setPaciArea,
  paciBlock,
  setPaciBlock,
  paciStreet,
  setPaciStreet,
  paciAvenue,
  setPaciAvenue,
  paciHouse,
  setPaciHouse,
  paciFloor,
  setPaciFloor,
  paciApt,
  setPaciApt,
  paciAutoNumber,
  setPaciAutoNumber,
  selectedZoneId,
  handleZoneChange,
  deliveryZones,
  currencySym,
  paymentMethodAtDoor,
  setPaymentMethodAtDoor,
  setNewNotes,
}: {
  isForceNewCustomer: boolean;
  matchedCustomers: NonNullable<PosCustomerDeliveryProfile['matchedCustomers']>;
  setIsForceNewCustomer: Dispatch<SetStateAction<boolean>>;
  newName: string;
  createCustomerMutation: UseMutationResult<Customer, any, { name: string; phone: string; address: string; notes?: string }, unknown>;
  newPhone: string;
  newAddress: string;
  newNotes: string;
  setNewName: Dispatch<SetStateAction<string>>;
  setNewPhone: Dispatch<SetStateAction<string>>;
  isKwd: boolean;
  isKsa: boolean;
  setAddressTag: Dispatch<SetStateAction<'home' | 'work' | 'other'>>;
  addressTag: 'home' | 'work' | 'other';
  setNewAddress: Dispatch<SetStateAction<string>>;
  buildPaciAddress: (overrides?: {
    area?: string;
    block?: string;
    street?: string;
    avenue?: string;
    house?: string;
    floor?: string;
    apt?: string;
    autoNumber?: string;
  }) => string;
  paciArea: string;
  setPaciArea: Dispatch<SetStateAction<string>>;
  paciBlock: string;
  setPaciBlock: Dispatch<SetStateAction<string>>;
  paciStreet: string;
  setPaciStreet: Dispatch<SetStateAction<string>>;
  paciAvenue: string;
  setPaciAvenue: Dispatch<SetStateAction<string>>;
  paciHouse: string;
  setPaciHouse: Dispatch<SetStateAction<string>>;
  paciFloor: string;
  setPaciFloor: Dispatch<SetStateAction<string>>;
  paciApt: string;
  setPaciApt: Dispatch<SetStateAction<string>>;
  paciAutoNumber: string;
  setPaciAutoNumber: Dispatch<SetStateAction<string>>;
  selectedZoneId: string;
  handleZoneChange: (zoneId: string) => void;
  deliveryZones: { id: string; name: string; fee: number; eta: number }[];
  currencySym: string;
  paymentMethodAtDoor: DoorstepPaymentMethod;
  setPaymentMethodAtDoor: Dispatch<SetStateAction<DoorstepPaymentMethod>>;
  setNewNotes: Dispatch<SetStateAction<string>>;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: '#ffffff',
        padding: '12px 16px',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <PlusIcon size={16} color="#2563eb" />
          <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s101', "تسجيل عميل جديد وتجهيز طلب التوصيل")}
          </h3>
        </div>
        {isForceNewCustomer && matchedCustomers.length > 0 && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setIsForceNewCustomer(false)}
            style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px' }}
          >
            {t('pos.pos_workspace.pos_phone_order_dialog.s102', "العودة لنتائج البحث (")}{matchedCustomers.length})
          </Button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) {
            toast.error(t('pos.pos_workspace.pos_phone_order_dialog.s103', "اسم العميل مطلوب"));
            return;
          }
          createCustomerMutation.mutate({
            name: newName,
            phone: newPhone,
            address: newAddress,
            notes: newNotes,
          });
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '2px' }}>
              {t('pos.pos_workspace.pos_phone_order_dialog.s104', "اسم العميل")} <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s105', "اسم العميل الكامل...")}
              style={{
                width: '100%',
                padding: '5px 8px',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                fontSize: '0.78rem',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '2px' }}>
              {t('pos.pos_workspace.pos_phone_order_dialog.s106', "رقم الهاتف")}
            </label>
            <input
              type="text"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder={
                isKwd
                  ? t('pos.pos_workspace.pos_phone_order_dialog.s107', "رقم الهاتف بالكويت (8 أرقام)...")
                  : isKsa
                  ? t('pos.pos_workspace.pos_phone_order_dialog.s108', "رقم الهاتف بالسعودية (05xxxxxxxx)...")
                  : t('pos.pos_workspace.pos_phone_order_dialog.s109', "رقم الهاتف (مثال: 01012345678)...")
              }
              style={{
                width: '100%',
                padding: '5px 8px',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                fontSize: '0.78rem',
              }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#334155', margin: 0 }}>
              {t('pos.pos_workspace.pos_phone_order_dialog.s110', "عنوان التوصيل التفصيلي (المنطقة، الشارع، العقار، الدور، الشقة)")}
            </label>
            <div style={{ display: 'flex', gap: '3px' }}>
              {(['home', 'work', 'other'] as const).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setAddressTag(tag)}
                  style={{
                    background: addressTag === tag ? '#2563eb' : '#f1f5f9',
                    color: addressTag === tag ? '#ffffff' : '#475569',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '1px 5px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {tag === 'home' ? t('pos.pos_workspace.pos_phone_order_dialog.s111', "المنزل") : tag === 'work' ? t('pos.pos_workspace.pos_phone_order_dialog.s112', "العمل") : t('pos.pos_workspace.pos_phone_order_dialog.s113', "أخرى")}
                </button>
              ))}
            </div>
          </div>
          <input
            type="text"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder={
              isKwd
                ? t('pos.pos_workspace.pos_phone_order_dialog.s114', "مثال: حولي - ق 4 - ش تونس - جادة 2 - منزل 18 - دور 3 شقة 6")
                : isKsa
                ? t('pos.pos_workspace.pos_phone_order_dialog.s115', "مثال: الرياض - حي الملقا - شارع وادي حنيفة - عمارة 12 - شقة 4")
                : t('pos.pos_workspace.pos_phone_order_dialog.s116', "مثال: المعادي - شارع 9 - عمارة 14 - الدور الثالث شقة 6")
            }
            style={{
              width: '100%',
              padding: '5px 8px',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
              fontSize: '0.78rem',
            }}
          />
        </div>

        {isKwd && (
          <div style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#170e5e' }}>
                {t('pos.pos_workspace.pos_phone_order_dialog.s117', "نموذج المعلومات المدنية الكويتية (PACI):")}
              </span>
              <button
                type="button"
                onClick={() => {
                  setNewAddress(buildPaciAddress());
                }}
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  color: '#1d4ed8',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  cursor: 'pointer',
                }}
              >
                {t('pos.pos_workspace.pos_phone_order_dialog.s118', "توليد العنوان تلقائياً")}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              <input
                type="text"
                placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s119', "المنطقة (حولي)")}
                value={paciArea}
                onChange={(e) => {
                  const val = e.target.value;
                  setPaciArea(val);
                  setNewAddress(buildPaciAddress({ area: val }));
                }}
                style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
              />
              <input
                type="text"
                placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s120', "القطعة (Block)")}
                value={paciBlock}
                onChange={(e) => {
                  const val = e.target.value;
                  setPaciBlock(val);
                  setNewAddress(buildPaciAddress({ block: val }));
                }}
                style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
              />
              <input
                type="text"
                placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s121', "الشارع")}
                value={paciStreet}
                onChange={(e) => {
                  const val = e.target.value;
                  setPaciStreet(val);
                  setNewAddress(buildPaciAddress({ street: val }));
                }}
                style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
              />
              <input
                type="text"
                placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s122', "الجادة (اختياري)")}
                value={paciAvenue}
                onChange={(e) => {
                  const val = e.target.value;
                  setPaciAvenue(val);
                  setNewAddress(buildPaciAddress({ avenue: val }));
                }}
                style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              <input
                type="text"
                placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s123', "المنزل / القسيمة / المبنى")}
                value={paciHouse}
                onChange={(e) => {
                  const val = e.target.value;
                  setPaciHouse(val);
                  setNewAddress(buildPaciAddress({ house: val }));
                }}
                style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
              />
              <input
                type="text"
                placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s124', "الدور (اختياري)")}
                value={paciFloor}
                onChange={(e) => {
                  const val = e.target.value;
                  setPaciFloor(val);
                  setNewAddress(buildPaciAddress({ floor: val }));
                }}
                style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
              />
              <input
                type="text"
                placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s125', "الشقة (اختياري)")}
                value={paciApt}
                onChange={(e) => {
                  const val = e.target.value;
                  setPaciApt(val);
                  setNewAddress(buildPaciAddress({ apt: val }));
                }}
                style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
              />
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s126', "الرقم الآلي (8 أرقام)")}
                title={t('pos.pos_workspace.pos_phone_order_dialog.s127', "الرقم الآلي للعنوان المعتمد من PACI كويت فايندر")}
                value={paciAutoNumber}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 8);
                  setPaciAutoNumber(val);
                  setNewAddress(buildPaciAddress({ autoNumber: val }));
                }}
                style={{ padding: '3px 6px', borderRadius: '4px', border: '1.5px solid #3b82f6', background: '#eff6ff', fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 700, color: '#1e40af' }}
              />
            </div>
          </div>
        )}

        {/* Delivery Zone & Payment in New Customer Form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: '#f8fafc', padding: '6px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
          <div>
            <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>
              {t('pos.pos_workspace.pos_phone_order_dialog.s128', "منطقة التوصيل")}
            </label>
            <select
              value={selectedZoneId}
              onChange={(e) => handleZoneChange(e.target.value)}
              style={{
                width: '100%',
                padding: '4px 6px',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                fontSize: '0.72rem',
                background: '#ffffff',
              }}
            >
              {deliveryZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} ({z.fee} {currencySym})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>
              {t('pos.pos_workspace.pos_phone_order_dialog.s129', "طريقة الدفع عند الاستلام")}
            </label>
            <select
              value={paymentMethodAtDoor}
              onChange={(e) => setPaymentMethodAtDoor(e.target.value as DoorstepPaymentMethod)}
              style={{
                width: '100%',
                padding: '4px 6px',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                fontSize: '0.72rem',
                background: '#ffffff',
              }}
            >
              <option value="cash">{t('pos.pos_workspace.pos_phone_order_dialog.s130', "كاش عند الاستلام")}</option>
              <option value="card_pos">
                {isKwd
                  ? t('pos.pos_workspace.pos_phone_order_dialog.s131', "كي نت مع المندوب (K-NET)")
                  : isKsa
                  ? t('pos.pos_workspace.pos_phone_order_dialog.s132', "مدى مع المندوب (mada POS)")
                  : t('pos.pos_workspace.pos_phone_order_dialog.s133', "فيزا مع الطيار (POS)")}
              </option>
              <option value="instapay_wallet">
                {isKwd
                  ? t('pos.pos_workspace.pos_phone_order_dialog.s134', "رابط دفع أونلاين (K-NET Link)")
                  : isKsa
                  ? t('pos.pos_workspace.pos_phone_order_dialog.s135', "STC Pay / محفظة رقمية")
                  : t('pos.pos_workspace.pos_phone_order_dialog.s136', "إنستاباي / محفظة إلكترونية")}
              </option>
            </select>
          </div>
        </div>

        <div>
          <input
            type="text"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s137', "ملاحظات أو علامات مميزة للعنوان (مثال: أمام مسجد الفتح، مدخل العمارة من الجانب)...")}
            style={{
              width: '100%',
              padding: '5px 8px',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
              fontSize: '0.75rem',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '4px' }}>
          <Button
            type="submit"
            disabled={createCustomerMutation.isPending}
            size="sm"
            style={{ background: '#170e5e', color: '#ffffff', fontWeight: 700, fontSize: '0.78rem' }}
          >
            <CheckCircleIcon size={14} style={{ marginLeft: '4px' }} />
            {createCustomerMutation.isPending ? t('pos.pos_workspace.pos_phone_order_dialog.s138', "جاري الحفظ...") : t('pos.pos_workspace.pos_phone_order_dialog.s139', "حفظ العميل وبدء طلب التوصيل")}
          </Button>
        </div>
      </form>
    </div>
  );
}
