import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { systemAlert } from '@/shared/components/system-alert';
import { deliveryRepsApi, type DeliveryRep, type UpsertDeliveryRepPayload } from '@/shared/api/delivery-reps.api';
import { XIcon, TruckIcon, LayersIcon, PackageIcon, CheckShieldIcon } from '@/shared/components/icons/AppIcons';

export interface UpsertDeliveryRepModalProps {
  open: boolean;
  onClose: () => void;
  rep?: DeliveryRep | null;
  onSuccess?: (rep?: DeliveryRep) => void;
  defaultRepType?: 'delivery' | 'van' | 'both';
  hideDeliveryOption?: boolean;
}

export function UpsertDeliveryRepModal({
  open,
  onClose,
  rep,
  onSuccess,
  defaultRepType = 'delivery',
  hideDeliveryOption = false,
}: UpsertDeliveryRepModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const vehiclesQuery = useQuery({
    queryKey: ['fleet-vehicles-list'],
    queryFn: deliveryRepsApi.listVehicles,
    enabled: open,
  });
  const fleetVehicles = vehiclesQuery.data || [];

  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [pinCodeInput, setPinCodeInput] = useState('');
  const [repTypeInput, setRepTypeInput] = useState<'delivery' | 'van' | 'both'>(defaultRepType);
  const [fullNameInput, setFullNameInput] = useState('');
  const [nationalIdInput, setNationalIdInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [vehiclePlateInput, setVehiclePlateInput] = useState('');
  const [isActiveInput, setIsActiveInput] = useState<boolean>(true);

  // Field Rep Permissions & Governance
  const [canEditRoutes, setCanEditRoutes] = useState<boolean>(false);
  const [canAddCustomers, setCanAddCustomers] = useState<boolean>(true);
  const [requireGpsOnVisit, setRequireGpsOnVisit] = useState<boolean>(true);
  const [canGiveDiscount, setCanGiveDiscount] = useState<boolean>(false);
  // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: the invoice-discount
  // channel is a per-rep permission chosen here at creation (both
  // discounts, or per-line only). The tenant cap governs the AMOUNT
  // for every rep — there is no per-rep cap input anymore.
  const [canGiveInvoiceDiscount, setCanGiveInvoiceDiscount] = useState<boolean>(false);
  const [canSellOverCreditLimit, setCanSellOverCreditLimit] = useState<boolean>(false);
  const [canCollectCash, setCanCollectCash] = useState<boolean>(true);

  useEffect(() => {
    if (open) {
      if (rep) {
        setNameInput(rep.name || '');
        setPhoneInput(rep.phone || '');
        setPinCodeInput(rep.pin_code || '');
        setFullNameInput(rep.full_name || '');
        setNationalIdInput(rep.national_id || '');
        setAddressInput(rep.address || '');
        setVehiclePlateInput(rep.vehicle_plate || '');
        setIsActiveInput(rep.is_active !== false);
        const currentType = (rep.rep_type as 'delivery' | 'van' | 'both') || (rep.is_van_rep ? 'van' : 'delivery');
        setRepTypeInput(currentType);

        const perms = rep.permissions || {};
        setCanEditRoutes(Boolean(perms.can_edit_routes));
        setCanAddCustomers(perms.can_add_customers !== false);
        setRequireGpsOnVisit(perms.require_gps_on_visit !== false);
        setCanGiveDiscount(Boolean(perms.can_give_discount));
        setCanGiveInvoiceDiscount(Boolean(perms.can_give_invoice_discount));
        setCanSellOverCreditLimit(Boolean(perms.can_sell_over_credit_limit));
        setCanCollectCash(perms.can_collect_cash !== false);
      } else {
        setNameInput('');
        setPhoneInput('');
        setPinCodeInput('');
        setRepTypeInput(defaultRepType);
        setFullNameInput('');
        setNationalIdInput('');
        setAddressInput('');
        setVehiclePlateInput('');
        setIsActiveInput(true);

        setCanEditRoutes(false);
        setCanAddCustomers(true);
        setRequireGpsOnVisit(true);
        setCanGiveDiscount(false);
        setCanGiveInvoiceDiscount(false);
        setCanSellOverCreditLimit(false);
        setCanCollectCash(true);
      }
    }
  }, [open, rep, defaultRepType]);

  const createMutation = useMutation({
    mutationFn: (data: UpsertDeliveryRepPayload) => deliveryRepsApi.create(data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['delivery-reps'] });
      systemAlert('تمت إضافة المندوب بنجاح');
      onSuccess?.(data);
      onClose();
    },
    onError: (error: any) => {
      if (error?.status === 403 || error?.details?.statusCode === 403) {
        systemAlert('ليس لديك صلاحية. تواصل مع مدير النظام لتفعيل هذه الخاصية.');
      } else {
        systemAlert(error.message || 'حدث خطأ أثناء إضافة المندوب');
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; payload: UpsertDeliveryRepPayload }) =>
      deliveryRepsApi.update(data.id, data.payload),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['delivery-reps'] });
      systemAlert('تم تحديث بيانات المندوب بنجاح');
      onSuccess?.(data);
      onClose();
    },
    onError: (error: any) => {
      if (error?.status === 403 || error?.details?.statusCode === 403) {
        systemAlert('ليس لديك صلاحية. تواصل مع مدير النظام لتفعيل هذه الخاصية.');
      } else {
        systemAlert(error.message || 'حدث خطأ أثناء تعديل بيانات المندوب');
      }
    },
  });

  const handleSave = () => {
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      systemAlert('يرجى كتابة اسم المندوب');
      return;
    }

    const trimmedPhone = phoneInput.trim();
    if (!trimmedPhone) {
      systemAlert('يرجى إدخال رقم هاتف المندوب (إجباري لتسجيل الدخول إلى تطبيق الهاتف)');
      return;
    }

    const trimmedPin = pinCodeInput.trim();
    if (!rep && !trimmedPin) {
      systemAlert('يرجى تعيين رمز الدخول السريع (PIN) للمندوب');
      return;
    }

    if (trimmedPin && trimmedPin.length < 4) {
      systemAlert('يجب أن يتكون رمز الدخول (PIN) من 4 إلى 6 أرقام على الأقل');
      return;
    }

    const payload: UpsertDeliveryRepPayload = {
      name: trimmedName,
      phone: trimmedPhone,
      pinCode: trimmedPin || undefined,
      repType: repTypeInput,
      isVanRep: repTypeInput === 'van' || repTypeInput === 'both',
      fullName: fullNameInput.trim() || undefined,
      nationalId: nationalIdInput.trim() || undefined,
      address: addressInput.trim() || undefined,
      vehiclePlate: vehiclePlateInput.trim() || undefined,
      isActive: isActiveInput,
      permissions: {
        can_edit_routes: canEditRoutes,
        can_add_customers: canAddCustomers,
        require_gps_on_visit: requireGpsOnVisit,
        can_give_discount: canGiveDiscount,
        can_give_invoice_discount: canGiveInvoiceDiscount,
        can_sell_over_credit_limit: canSellOverCreditLimit,
        can_collect_cash: canCollectCash,
      },
    };

    if (rep) {
      updateMutation.mutate({ id: rep.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      width="min(1060px, 96vw)"
      ariaLabel={rep ? t('shared.delivery_reps.upsert_delivery_rep_modal.s0', "تعديل بيانات المندوب") : t('shared.delivery_reps.upsert_delivery_rep_modal.s1', "إضافة مندوب جديد")}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 18px', boxSizing: 'border-box' }} dir="rtl">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', minWidth: 0, gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  {rep ? t('shared.delivery_reps.upsert_delivery_rep_modal.s2', "تعديل بيانات المندوب") : t('shared.delivery_reps.upsert_delivery_rep_modal.s3', "إضافة مندوب جديد")}
                </h3>
                {rep && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '6px',
                      backgroundColor: isActiveInput ? '#dcfce7' : '#fee2e2',
                      color: isActiveInput ? '#15803d' : '#b91c1c',
                    }}
                  >
                    {isActiveInput ? t('shared.delivery_reps.upsert_delivery_rep_modal.s4', "نشط ويعمل") : t('shared.delivery_reps.upsert_delivery_rep_modal.s5', "موقوف ومُعطل")}
                  </span>
                )}
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#64748b' }}>
                {t('shared.delivery_reps.upsert_delivery_rep_modal.s6', "تحديد طبيعة عمل المندوب (دليفري أو فان)، بيانات الدخول للموبايل، وتفاصيل المركبة والصلاحيات")}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {rep && (
              <button
                type="button"
                onClick={() => setIsActiveInput(!isActiveInput)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: `1px solid ${isActiveInput ? '#fca5a5' : '#86efac'}`,
                  background: isActiveInput ? '#fff1f2' : '#f0fdf4',
                  color: isActiveInput ? '#dc2626' : '#16a34a',
                  transition: 'all 0.15s ease',
                }}
                title={isActiveInput ? t('shared.delivery_reps.upsert_delivery_rep_modal.s7', "إيقاف الحساب وتعطيل دخول التطبيق") : t('shared.delivery_reps.upsert_delivery_rep_modal.s8', "إعادة تفعيل الحساب وتصريح الدخول")}
              >
                {isActiveInput ? t('shared.delivery_reps.upsert_delivery_rep_modal.s9', "إيقاف الحساب") : t('shared.delivery_reps.upsert_delivery_rep_modal.s10', "إعادة التفعيل")}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: '#f1f5f9',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                color: '#64748b',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <XIcon size={14} />
            </button>
          </div>
        </div>

        {/* Form Body - Balanced 2-Column Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
            gap: '12px',
            alignItems: 'start',
            maxHeight: 'calc(88vh - 90px)',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
        >
          {/* Column 1 (Right): Type, Basic Info & Identity */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {/* 1. Work Type Selection */}
            <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                  {t('shared.delivery_reps.upsert_delivery_rep_modal.s11', "طبيعة العمل ونوع المندوب")} <span style={{ color: '#dc2626' }}>*</span>
                </span>
                <span style={{ fontSize: '10px', color: '#64748b' }}>{t('shared.delivery_reps.upsert_delivery_rep_modal.s12', "يحدد واجهة تطبيق الهاتف")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: hideDeliveryOption ? '1fr 1fr' : 'repeat(3, 1fr)', gap: '6px' }}>
                {[
                  ...(hideDeliveryOption
                    ? []
                    : [
                        {
                          key: 'delivery' as const,
                          label: t('shared.delivery_reps.upsert_delivery_rep_modal.s13', "طيار دليفري"),
                          subtitle: t('shared.delivery_reps.upsert_delivery_rep_modal.s14', "أوردرات (/driver)"),
                          icon: <PackageIcon size={16} color={repTypeInput === 'delivery' ? '#ea580c' : '#64748b'} />,
                          activeBorder: '#ea580c',
                          activeBg: '#fff7ed',
                          activeColor: '#9a3412',
                        },
                      ]),
                  {
                    key: 'van' as const,
                    label: t('shared.delivery_reps.upsert_delivery_rep_modal.s15', "توزيع فان"),
                    subtitle: t('shared.delivery_reps.upsert_delivery_rep_modal.s16', "بيع سيارة (/van-sales)"),
                    icon: <TruckIcon size={16} color={repTypeInput === 'van' ? '#0284c7' : '#64748b'} />,
                    activeBorder: '#0284c7',
                    activeBg: '#f0f9ff',
                    activeColor: '#075985',
                  },
                  {
                    key: 'both' as const,
                    label: t('shared.delivery_reps.upsert_delivery_rep_modal.s17', "مندوب شامل"),
                    subtitle: t('shared.delivery_reps.upsert_delivery_rep_modal.s18', "دليفري + توزيع"),
                    icon: <LayersIcon size={16} color={repTypeInput === 'both' ? '#7c3aed' : '#64748b'} />,
                    activeBorder: '#7c3aed',
                    activeBg: '#f5f3ff',
                    activeColor: '#5b21b6',
                  },
                ].map((item) => {
                  const isActive = repTypeInput === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setRepTypeInput(item.key)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        padding: '6px 8px',
                        borderRadius: '7px',
                        border: `1.5px solid ${isActive ? item.activeBorder : '#cbd5e1'}`,
                        background: isActive ? item.activeBg : '#ffffff',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        textAlign: 'right',
                      }}
                    >
                      {item.icon}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: '11.5px', fontWeight: 800, color: isActive ? item.activeColor : '#1e293b', lineHeight: 1.2 }}>
                          {item.label}
                        </span>
                        <span style={{ fontSize: '9px', color: '#64748b', lineHeight: 1.1 }}>
                          {item.subtitle}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Basic Info & Mobile Login */}
            <div style={{ background: '#ffffff', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{t('shared.delivery_reps.upsert_delivery_rep_modal.s19', "البيانات الأساسية وتطبيق الموبايل")}</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.1fr 0.9fr', gap: '8px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('shared.delivery_reps.upsert_delivery_rep_modal.s20', "اسم المندوب / الشهرة")} <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder={t('shared.delivery_reps.upsert_delivery_rep_modal.s21', "كابتن أحمد / طاهر")}
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      height: '32px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                      background: '#ffffff',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('shared.delivery_reps.upsert_delivery_rep_modal.s22', "رقم الهاتف / الموبايل")} <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="01012345678"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      height: '32px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                      background: '#ffffff',
                      boxSizing: 'border-box',
                      direction: 'ltr',
                      textAlign: 'right',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('shared.delivery_reps.upsert_delivery_rep_modal.s23', "رمز الدخول (PIN)")} {!rep && <span style={{ color: '#dc2626' }}>*</span>}
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    placeholder={rep && (rep.has_pin || (rep as any).hasPin || (rep as any).pin_hash || rep.pin_code) ? t('shared.delivery_reps.upsert_delivery_rep_modal.s24', "•••• (مفعّل)") : '1234'}
                    value={pinCodeInput}
                    onChange={(e) => setPinCodeInput(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      height: '32px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                      background: '#ffffff',
                      boxSizing: 'border-box',
                      direction: 'ltr',
                      textAlign: 'center',
                    }}
                    title={t('shared.delivery_reps.upsert_delivery_rep_modal.s25', "رمز مكون من 4 إلى 6 أرقام يتيح للمندوب تسجيل الدخول لتطبيق الهاتف")}
                  />
                  {rep && (rep.has_pin || (rep as any).hasPin || (rep as any).pin_hash || rep.pin_code) && (
                    <span style={{ display: 'block', fontSize: '9px', color: '#16a34a', marginTop: '2px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s26', "الرمز مفعّل (اتركه للحفظ)")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 3. Identity & Address (Optional) */}
            <div style={{ background: '#ffffff', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{t('shared.delivery_reps.upsert_delivery_rep_modal.s27', "بيانات الهوية والضمان (اختياري)")}</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('shared.delivery_reps.upsert_delivery_rep_modal.s28', "الاسم بالكامل (من واقع البطاقة)")}
                  </label>
                  <input
                    type="text"
                    placeholder={t('shared.delivery_reps.upsert_delivery_rep_modal.s29', "الاسم الرباعي كاملاً")}
                    value={fullNameInput}
                    onChange={(e) => setFullNameInput(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      height: '32px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                      background: '#ffffff',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('shared.delivery_reps.upsert_delivery_rep_modal.s30', "الرقم القومي (١٤ رقم)")}
                  </label>
                  <input
                    type="text"
                    maxLength={14}
                    placeholder={t('shared.delivery_reps.upsert_delivery_rep_modal.s31', "الرقم القومي كاملاً")}
                    value={nationalIdInput}
                    onChange={(e) => setNationalIdInput(e.target.value.replace(/\D/g, ''))}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      height: '32px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                      background: '#ffffff',
                      boxSizing: 'border-box',
                      direction: 'ltr',
                      textAlign: 'right',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {t('shared.delivery_reps.upsert_delivery_rep_modal.s32', "العنوان بالتفصيل")}
                </label>
                <input
                  type="text"
                  placeholder={t('shared.delivery_reps.upsert_delivery_rep_modal.s33', "المنطقة، الشارع، رقم العقار")}
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '5px 8px',
                    height: '32px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    fontSize: '12px',
                    background: '#ffffff',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Column 2 (Left): Vehicle & Field Permissions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {/* 4. Vehicle Data */}
            <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                {repTypeInput === 'van' ? t('shared.delivery_reps.upsert_delivery_rep_modal.s34', "بيانات سيارة التوزيع (الفان)") : repTypeInput === 'both' ? t('shared.delivery_reps.upsert_delivery_rep_modal.s35', "بيانات المركبة / السيارة") : t('shared.delivery_reps.upsert_delivery_rep_modal.s36', "بيانات دراجة التوصيل / المركبة")}
              </span>
              {fleetVehicles.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '8px', alignItems: 'flex-start' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s37', "اختيار من أسطول سيارات الشركة")}
                    </label>
                    <CustomSelect
                      options={[
                        { value: '', label: t('shared.delivery_reps.upsert_delivery_rep_modal.s38', "— إدخال يدوي / غير مسجلة —") },
                        ...fleetVehicles.map((v) => ({
                          value: v.plateNumber,
                          label: `${v.plateNumber}${v.modelName ? ` (${v.modelName})` : ''}`,
                        })),
                      ]}
                      value={fleetVehicles.some((v) => v.plateNumber === vehiclePlateInput) ? vehiclePlateInput : ''}
                      onChange={(val) => {
                        if (val) setVehiclePlateInput(val);
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s39', "رقم لوحة المركبة / السيارة")}
                    </label>
                    <input
                      type="text"
                      placeholder={repTypeInput === 'van' ? t('shared.delivery_reps.upsert_delivery_rep_modal.s40', "مثال: 5678 ن و ر") : t('shared.delivery_reps.upsert_delivery_rep_modal.s41', "مثال: 1234 ص ع")}
                      value={vehiclePlateInput}
                      onChange={(e) => setVehiclePlateInput(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        height: '32px',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontSize: '12px',
                        background: '#ffffff',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('shared.delivery_reps.upsert_delivery_rep_modal.s42', "رقم لوحة المركبة / السيارة")}
                  </label>
                  <input
                    type="text"
                    placeholder={repTypeInput === 'van' ? t('shared.delivery_reps.upsert_delivery_rep_modal.s43', "مثال: 5678 ن و ر (سيارة فان)") : t('shared.delivery_reps.upsert_delivery_rep_modal.s44', "مثال: 1234 ص ع")}
                    value={vehiclePlateInput}
                    onChange={(e) => setVehiclePlateInput(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      height: '32px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                      background: '#ffffff',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              )}
            </div>

            {/* 5. Field Rep Permissions & Governance */}
            <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <CheckShieldIcon size={14} color="#170e5e" />
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                    {t('shared.delivery_reps.upsert_delivery_rep_modal.s45', "صلاحيات وضوابط المندوب في تطبيق الميدان")}
                  </span>
                </div>
                <span style={{ fontSize: '10px', color: '#64748b' }}>
                  {t('shared.delivery_reps.upsert_delivery_rep_modal.s46', "الضوابط التشغيلية والمالية")}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                {/* Perm 1: Edit Routes */}
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '6px 8px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '7px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={canEditRoutes}
                    onChange={(e) => setCanEditRoutes(e.target.checked)}
                    style={{ marginTop: '2px', cursor: 'pointer' }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: '11px', color: '#0f172a', display: 'block', lineHeight: 1.25 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s47', "تعديل خطوط السير والزيارات")}
                    </strong>
                    <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', lineHeight: 1.2 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s48', "(مقتصر على المشرف افتراضياً)")}
                    </span>
                  </div>
                </label>

                {/* Perm 2: Add Customers in Field */}
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '6px 8px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '7px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={canAddCustomers}
                    onChange={(e) => setCanAddCustomers(e.target.checked)}
                    style={{ marginTop: '2px', cursor: 'pointer' }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: '11px', color: '#0f172a', display: 'block', lineHeight: 1.25 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s49', "تسجيل وإضافة محلات جديدة")}
                    </strong>
                    <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', lineHeight: 1.2 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s50', "السماح بتسجيل منافذ من الميدان")}
                    </span>
                  </div>
                </label>

                {/* Perm 3: Require GPS */}
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '6px 8px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '7px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={requireGpsOnVisit}
                    onChange={(e) => setRequireGpsOnVisit(e.target.checked)}
                    style={{ marginTop: '2px', cursor: 'pointer' }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: '11px', color: '#0f172a', display: 'block', lineHeight: 1.25 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s51', "إلزامية فتح الـ GPS")}
                    </strong>
                    <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', lineHeight: 1.2 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s52', "إلزام الموقع لبدء وتأكيد الزيارات")}
                    </span>
                  </div>
                </label>

                {/* Perm 4: Collect Cash */}
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '6px 8px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '7px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={canCollectCash}
                    onChange={(e) => setCanCollectCash(e.target.checked)}
                    style={{ marginTop: '2px', cursor: 'pointer' }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: '11px', color: '#0f172a', display: 'block', lineHeight: 1.25 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s53', "تحصيل دفعات نقدية")}
                    </strong>
                    <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', lineHeight: 1.2 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s54', "استلام نقدية وإصدار سندات قبض")}
                    </span>
                  </div>
                </label>

                {/* Perm 5: Sell Over Credit Limit */}
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '6px 8px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '7px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={canSellOverCreditLimit}
                    onChange={(e) => setCanSellOverCreditLimit(e.target.checked)}
                    style={{ marginTop: '2px', cursor: 'pointer' }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: '11px', color: '#0f172a', display: 'block', lineHeight: 1.25 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s55', "تجاوز سقف المديونية")}
                    </strong>
                    <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', lineHeight: 1.2 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s56', "إصدار آجل عند تخطي الحد الائتماني")}
                    </span>
                  </div>
                </label>

                {/* Perm 6: Discounts */}
                <div style={{ padding: '6px 8px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '7px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={canGiveDiscount}
                      onChange={(e) => setCanGiveDiscount(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <strong style={{ fontSize: '11px', color: '#0f172a', lineHeight: 1.25 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s57', "منح خصومات نقدية")}
                    </strong>
                  </label>
                  {canGiveDiscount ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginRight: '18px' }}>
                      <input
                        type="checkbox"
                        checked={canGiveInvoiceDiscount}
                        onChange={(e) => setCanGiveInvoiceDiscount(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '10px', color: '#475569' }}>{t('shared.delivery_reps.upsert_delivery_rep_modal.s58', "خصم على الفاتورة أيضاً (بجانب خصم السطور)")}</span>
                    </label>
                  ) : (
                    <span style={{ fontSize: '9.5px', color: '#64748b', marginRight: '18px', display: 'block', lineHeight: 1.2 }}>
                      {t('shared.delivery_reps.upsert_delivery_rep_modal.s59', "السماح بخصم نسبي على الفاتورة")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
          <Button variant="secondary" onClick={onClose} style={{ height: '34px', minHeight: '34px', padding: '0 16px', fontSize: '12px' }}>
            {t('shared.delivery_reps.upsert_delivery_rep_modal.s60', "إلغاء")}
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!nameInput.trim() || isSaving}
            style={{ height: '34px', minHeight: '34px', padding: '0 22px', fontSize: '12px', fontWeight: 700, background: '#170e5e' }}
          >
            {isSaving ? t('shared.delivery_reps.upsert_delivery_rep_modal.s61', "جاري الحفظ...") : rep ? t('shared.delivery_reps.upsert_delivery_rep_modal.s62', "تحديث البيانات") : t('shared.delivery_reps.upsert_delivery_rep_modal.s63', "حفظ المندوب")}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
