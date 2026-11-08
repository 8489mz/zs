import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/shared/components/system-alert';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { BrandCombobox } from '@/shared/components/BrandCombobox';
import { PatternLockWidget } from './PatternLockWidget';
import { MaintenanceIcons as Icons } from './MaintenanceConstants';
import { maintenanceApi, type UpsertMaintenanceTicketPayload } from '../api/maintenance.api';
import type { MaintenanceTicket } from '@/types/domain-models/maintenance';
import type { getMaintenanceProfile } from '../constants/maintenance-profiles';

interface MaintenanceCreateTicketModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (ticket: MaintenanceTicket) => void;
  maintenanceProfile: ReturnType<typeof getMaintenanceProfile>;
}

const initialFormData: UpsertMaintenanceTicketPayload = {
  customerName: '',
  customerPhone: '',
  deviceBrand: '',
  deviceModel: '',
  serialNumber: '',
  passcode: '',
  problemDescription: '',
  deviceCondition: '',
  expectedCost: 0,
  advancePayment: 0,
  warrantyDays: 30,
  status: 'received',
};

export function MaintenanceCreateTicketModal({
  open,
  onClose,
  onSuccess,
  maintenanceProfile,
}: MaintenanceCreateTicketModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<UpsertMaintenanceTicketPayload>(initialFormData);
  const [lockType, setLockType] = useState<'pin' | 'pattern'>('pin');
  const [showFaultsPopover, setShowFaultsPopover] = useState(false);
  const [showAccessoriesPopover, setShowAccessoriesPopover] = useState(false);

  const createMutation = useMutation({
    mutationFn: (payload: UpsertMaintenanceTicketPayload) => maintenanceApi.create(payload),
    onSuccess: async (res) => {
      void queryClient.invalidateQueries({ queryKey: ['maintenance-tickets'] });
      const { ticket } = await maintenanceApi.get(res.id);
      setFormData(initialFormData);
      onSuccess(ticket);
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const missingFields: string[] = [];
    if (!formData.customerName.trim()) missingFields.push('اسم العميل');
    if (!formData.customerPhone.trim()) missingFields.push('الهاتف');
    if (!formData.deviceModel.trim()) missingFields.push('موديل الجهاز');
    if (!formData.problemDescription.trim()) missingFields.push('وصف العطل');
    if (missingFields.length > 0) {
      toast.error(`يرجى ملء الحقول الأساسية التالية: ${missingFields.join('، ')}`);
      return;
    }
    const expectedCost = Number(formData.expectedCost || 0);
    const advancePayment = Number(formData.advancePayment || 0);
    if (advancePayment > expectedCost) {
      toast.error(
        `العربون (${advancePayment.toFixed(2)}) أكبر من التكلفة التقديرية (${expectedCost.toFixed(2)}) — خفّض العربون أو ارفع التكلفة التقديرية قبل الحفظ`,
      );
      return;
    }
    createMutation.mutate(formData);
  };

  if (!open) return null;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      width="min(1040px, 96vw)"
      ariaLabel={t('maintenance.maintenance_create_ticket_modal.s0', "استلام جهاز صيانة جديد")}
    >
      <div style={{ padding: '24px 28px' }}>
        <form onSubmit={handleCreateSubmit} dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}>
                <Icons.Device />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>{t('maintenance.maintenance_create_ticket_modal.s1', "استلام جهاز صيانة جديد")}</h3>
                <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: '#64748b' }}>{t('maintenance.maintenance_create_ticket_modal.s2', "تسجيل بيانات العميل، فحص العطل المشتكى منه، وتوليد كود الصيانة")}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', width: '30px', height: '30px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}
              title={t('maintenance.maintenance_create_ticket_modal.s3', "إغلاق")}
            >
              <XIcon size={14} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
            {/* Left Column: Customer & Device Details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Customer Card */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#64748b' }}><Icons.User /></span>
                  <span>{t('maintenance.maintenance_create_ticket_modal.s4', "بيانات العميل")}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      {t('maintenance.maintenance_create_ticket_modal.s5', "اسم العميل")} <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      className="purchase-prototype-field-input"
                      value={formData.customerName}
                      onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                      placeholder={t('maintenance.maintenance_create_ticket_modal.s6', "الاسم الثلاثي أو الثنائي")}
                      style={{ width: '100%', background: '#fff', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.85rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      {t('maintenance.maintenance_create_ticket_modal.s7', "رقم الهاتف")} <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      dir="ltr"
                      className="purchase-prototype-field-input"
                      value={formData.customerPhone}
                      onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                      placeholder="01012345678"
                      style={{ width: '100%', background: '#fff', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', textAlign: 'right', boxSizing: 'border-box', fontSize: '0.85rem' }}
                    />
                  </div>
                </div>
              </div>

              {/* Device Specs Card */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#64748b' }}><Icons.Device /></span>
                  <span>{t('maintenance.maintenance_create_ticket_modal.s8', "مواصفات الجهاز و")} {maintenanceProfile.serialLabel}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      {t('maintenance.maintenance_create_ticket_modal.s9', "الماركة")}
                    </label>
                    <BrandCombobox
                      value={formData.deviceBrand || ''}
                      onChange={(val) => setFormData({ ...formData, deviceBrand: val })}
                      categoryKey={maintenanceProfile.key}
                      sampleBrands={maintenanceProfile.sampleBrands}
                      placeholder={`...${maintenanceProfile.sampleBrands.slice(0, 3).join(', ')}`}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      {t('maintenance.maintenance_create_ticket_modal.s10', "موديل الجهاز")} <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      className="purchase-prototype-field-input"
                      value={formData.deviceModel}
                      onChange={(e) => setFormData({ ...formData, deviceModel: e.target.value })}
                      placeholder={`مثال: ${maintenanceProfile.sampleBrands[0]}...`}
                      style={{ width: '100%', background: '#fff', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.85rem' }}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {maintenanceProfile.serialLabel} {t('maintenance.maintenance_create_ticket_modal.s11', "(مسح بالسكانر أو كتابة)")}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    className="purchase-prototype-field-input"
                    value={formData.serialNumber || ''}
                    onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                    placeholder={maintenanceProfile.serialPlaceholder}
                    style={{ width: '100%', background: '#fff', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontFamily: 'monospace', fontSize: '0.85rem', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            {/* Right Column: Problem & Passcode */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Problem Description & Faults */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#64748b' }}><Icons.Wrench /></span>
                  <span>{t('maintenance.maintenance_create_ticket_modal.s12', "وصف العطل والفحص الفني")}</span>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', margin: 0 }}>
                      {t('maintenance.maintenance_create_ticket_modal.s13', "العطل المشتكى منه")} <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    {maintenanceProfile.commonFaults?.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowFaultsPopover(!showFaultsPopover)}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          color: '#475569',
                          borderRadius: '5px',
                          padding: '2px 8px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <span>{t('maintenance.maintenance_create_ticket_modal.s14', "أعطال شائعة")}</span>
                        <span style={{ fontSize: '0.65rem' }}>{showFaultsPopover ? '▲' : '▼'}</span>
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    required
                    className="purchase-prototype-field-input"
                    value={formData.problemDescription}
                    onChange={(e) => setFormData({ ...formData, problemDescription: e.target.value })}
                    placeholder={t('maintenance.maintenance_create_ticket_modal.s15', "مثال: الشاشة مكسورة، الجهاز لا يشحن...")}
                    style={{ width: '100%', background: '#fff', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.85rem' }}
                  />
                  {showFaultsPopover && maintenanceProfile.commonFaults?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px', padding: '8px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                      <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, width: '100%', marginBottom: '2px' }}>{t('maintenance.maintenance_create_ticket_modal.s16', "اضغط للإضافة السريعة:")}</span>
                      {maintenanceProfile.commonFaults.map((fault) => (
                        <button
                          key={fault}
                          type="button"
                          onClick={() => {
                            const cur = formData.problemDescription ? `${formData.problemDescription} + ${fault}` : fault;
                            setFormData({ ...formData, problemDescription: cur });
                          }}
                          style={{
                            background: '#f8fafc',
                            border: '1px solid #cbd5e1',
                            borderRadius: '4px',
                            padding: '3px 8px',
                            fontSize: '0.72rem',
                            color: '#334155',
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                        >
                          + {fault}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '22px', marginBottom: '4px' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', margin: 0, whiteSpace: 'nowrap' }}>
                        {t('maintenance.maintenance_create_ticket_modal.s17', "الحالة والملحقات")}
                      </label>
                      {maintenanceProfile.defaultAccessories?.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAccessoriesPopover(!showAccessoriesPopover)}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            color: '#475569',
                            borderRadius: '4px',
                            padding: '1px 6px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <span>{t('maintenance.maintenance_create_ticket_modal.s18', "ملحقات")}</span>
                          <span style={{ fontSize: '0.62rem' }}>{showAccessoriesPopover ? '▲' : '▼'}</span>
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      className="purchase-prototype-field-input"
                      value={formData.deviceCondition || ''}
                      onChange={(e) => setFormData({ ...formData, deviceCondition: e.target.value })}
                      placeholder={t('maintenance.maintenance_create_ticket_modal.s19', "خدوش بالظهر، مستلم بدون شاحن...")}
                      style={{ width: '100%', background: '#fff', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.85rem' }}
                    />
                    {showAccessoriesPopover && maintenanceProfile.defaultAccessories?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px', padding: '8px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, width: '100%', marginBottom: '2px' }}>{t('maintenance.maintenance_create_ticket_modal.s20', "اضغط لإضافة الملحق:")}</span>
                        {maintenanceProfile.defaultAccessories.map((acc) => (
                          <button
                            key={acc}
                            type="button"
                            onClick={() => {
                              const cur = formData.deviceCondition ? `${formData.deviceCondition}، ${acc}` : acc;
                              setFormData({ ...formData, deviceCondition: cur });
                            }}
                            style={{
                              background: '#f8fafc',
                              border: '1px solid #cbd5e1',
                              borderRadius: '4px',
                              padding: '3px 8px',
                              fontSize: '0.72rem',
                              color: '#334155',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            + {acc}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', height: '22px', marginBottom: '4px' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', margin: 0, whiteSpace: 'nowrap' }}>
                        {t('maintenance.maintenance_create_ticket_modal.s21', "الفني المسؤول")}
                      </label>
                    </div>
                    <input
                      type="text"
                      className="purchase-prototype-field-input"
                      value={formData.technicianName || ''}
                      onChange={(e) => setFormData({ ...formData, technicianName: e.target.value })}
                      placeholder={t('maintenance.maintenance_create_ticket_modal.s22', "اسم الفني...")}
                      style={{ width: '100%', background: '#fff', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.85rem' }}
                    />
                  </div>
                </div>
              </div>

              {/* Passcode & Security Lock Card */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#64748b' }}><Icons.Lock /></span>
                    <span>{maintenanceProfile.passcodeLabel}</span>
                  </label>
                  {maintenanceProfile.passcodeType === 'mobile_lock' && (
                    <div style={{ display: 'flex', gap: '4px', background: '#e2e8f0', padding: '2px', borderRadius: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setLockType('pin')}
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: 'none',
                          background: lockType === 'pin' ? '#fff' : 'transparent',
                          fontWeight: 700,
                          color: lockType === 'pin' ? '#0f172a' : '#64748b',
                          cursor: 'pointer',
                          fontSize: '0.72rem',
                          whiteSpace: 'nowrap',
                          userSelect: 'none',
                          transition: 'background-color 0.15s ease, color 0.15s ease',
                        }}
                      >
                        {t('maintenance.maintenance_create_ticket_modal.s23', "PIN / رمز")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLockType('pattern')}
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: 'none',
                          background: lockType === 'pattern' ? '#fff' : 'transparent',
                          fontWeight: 700,
                          color: lockType === 'pattern' ? '#0f172a' : '#64748b',
                          cursor: 'pointer',
                          fontSize: '0.72rem',
                          whiteSpace: 'nowrap',
                          userSelect: 'none',
                          transition: 'background-color 0.15s ease, color 0.15s ease',
                        }}
                      >
                        {t('maintenance.maintenance_create_ticket_modal.s24', "نمط الشاشة")}
                      </button>
                    </div>
                  )}
                </div>

                {maintenanceProfile.passcodeType === 'mobile_lock' && lockType === 'pattern' ? (
                  <div style={{ background: '#fff', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <PatternLockWidget
                      value={formData.passcode || ''}
                      onChange={(pat) => setFormData({ ...formData, passcode: pat })}
                    />
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {t('maintenance.maintenance_create_ticket_modal.s25', "النمط المسجل:")} <strong dir="ltr" style={{ color: '#0f172a', fontFamily: 'monospace' }}>{formData.passcode || t('maintenance.maintenance_create_ticket_modal.s26', "لم يتم الرسم بعد")}</strong>
                    </div>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      dir={maintenanceProfile.passcodeType === 'password' ? 'ltr' : 'rtl'}
                      className="purchase-prototype-field-input"
                      value={formData.passcode || ''}
                      onChange={(e) => setFormData({ ...formData, passcode: e.target.value })}
                      placeholder={maintenanceProfile.passcodePlaceholder}
                      style={{ width: '100%', background: '#fff', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontFamily: maintenanceProfile.passcodeType === 'password' ? 'monospace' : 'inherit', fontSize: '0.85rem', boxSizing: 'border-box' }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Financial Overview & Warranty Days */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 18px' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#64748b' }}><Icons.Coins /></span>
              <span>{t('maintenance.maintenance_create_ticket_modal.s27', "الحساب المالي والضمان")}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <div style={{ background: '#fff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                  {t('maintenance.maintenance_create_ticket_modal.s28', "التكلفة التقديرية")}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="purchase-prototype-field-input"
                    value={formData.expectedCost || ''}
                    onChange={(e) => setFormData({ ...formData, expectedCost: Number(e.target.value) })}
                    placeholder="0.00"
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: '5px', fontWeight: 700, fontSize: '0.9rem' }}
                  />
                  <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}><CurrencySymbol /></span>
                </div>
              </div>

              <div style={{ background: '#fff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                  {t('maintenance.maintenance_create_ticket_modal.s29', "الدفعة المقدمة (عربون)")}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="purchase-prototype-field-input"
                    value={formData.advancePayment || ''}
                    onChange={(e) => setFormData({ ...formData, advancePayment: Number(e.target.value) })}
                    placeholder="0.00"
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: '5px', fontWeight: 700, fontSize: '0.9rem' }}
                  />
                  <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}><CurrencySymbol /></span>
                </div>
              </div>

              <div style={{ background: '#fff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                  {t('maintenance.maintenance_create_ticket_modal.s30', "المتبقي المتوقع")}
                </label>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', padding: '5px 0' }}>
                  {Math.max(0, (formData.expectedCost || 0) - (formData.advancePayment || 0)).toFixed(2)}{' '}
                  <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}><CurrencySymbol /></span>
                </div>
              </div>

              <div style={{ background: '#fff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                  {t('maintenance.maintenance_create_ticket_modal.s31', "أيام الضمان")}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    min="0"
                    className="purchase-prototype-field-input"
                    value={formData.warrantyDays || 30}
                    onChange={(e) => setFormData({ ...formData, warrantyDays: Number(e.target.value) })}
                    placeholder="30"
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: '5px', fontWeight: 700, fontSize: '0.9rem' }}
                  />
                  <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>{t('maintenance.maintenance_create_ticket_modal.s32', "يوم")}</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
            <Button type="button" variant="secondary" onClick={onClose} style={{ padding: '7px 20px', fontSize: '0.85rem' }}>
              {t('maintenance.maintenance_create_ticket_modal.s33', "إلغاء")}
            </Button>
            <Button type="submit" variant="primary" disabled={createMutation.isPending} style={{ padding: '7px 24px', fontWeight: 700, fontSize: '0.85rem' }}>
              {createMutation.isPending ? t('maintenance.maintenance_create_ticket_modal.s34', "جارٍ الحفظ...") : t('maintenance.maintenance_create_ticket_modal.s35', "حفظ واستخراج إيصال الاستلام")}
            </Button>
          </div>
        </form>
      </div>
    </DialogShell>
  );
}
