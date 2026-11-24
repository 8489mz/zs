import { Button } from '@/shared/ui/button';
import { CopyIcon, CheckCircleIcon, XCircleIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';

export interface DeliveryRepsTableProps {
  __t: ReturnType<typeof useTranslation>['t'];
  repsQuery: UseQueryResult<DeliveryRep[], Error>;
  filteredReps: DeliveryRep[];
  copyUrl: (path: string, label: string) => void;
  setUpsertRep: Dispatch<SetStateAction<DeliveryRep | null>>;
  setIsUpsertOpen: Dispatch<SetStateAction<boolean>>;
  setEditingRep: Dispatch<SetStateAction<DeliveryRep | null>>;
  setPhoneInput: Dispatch<SetStateAction<string>>;
  setPinInput: Dispatch<SetStateAction<string>>;
  setShowRepPassword: Dispatch<SetStateAction<boolean>>;
  toggleActive: (rep: DeliveryRep) => void;
  updateMutation: UseMutationResult<DeliveryRep, any, { id: number; payload: Partial<DeliveryRep> & { pinCode?: string | undefined; }; }, unknown>;
}

export function DeliveryRepsTable({ __t, repsQuery, filteredReps, copyUrl, setUpsertRep, setIsUpsertOpen, setEditingRep, setPhoneInput, setPinInput, setShowRepPassword, toggleActive, updateMutation }: DeliveryRepsTableProps) {
  return (
    <>
    {/* Reps Table */}
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        overflowX: 'auto',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
            <th style={{ padding: '10px 12px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s5', "المندوب")}</th>
            <th style={{ padding: '10px 10px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s6', "طبيعة العمل")}</th>
            <th style={{ padding: '10px 10px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s7', "رقم الهاتف")}</th>
            <th style={{ padding: '10px 10px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s8', "رمز الـ PIN")}</th>
            <th style={{ padding: '10px 8px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s9', "البوابات")}</th>
            <th style={{ padding: '10px 8px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s10', "الحالة")}</th>
            <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('settings.user_management.unified_access_directory_panel.s11', "الإجراءات")}</th>
          </tr>
        </thead>
        <tbody>
          {repsQuery.isLoading ? (
            <tr>
              <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                {__t('settings.user_management.unified_access_directory_panel.s12', "جاري تحميل بيانات المناديب...")}
              </td>
            </tr>
          ) : filteredReps.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                {__t('settings.user_management.unified_access_directory_panel.s13', "لا توجد سجلات مناديب مطابقة للفلاتر.")}
              </td>
            </tr>
          ) : (
            filteredReps.map((rep) => {
              const isVan = rep.rep_type === 'van' || (!rep.rep_type && rep.is_van_rep);
              const isBoth = rep.rep_type === 'both';

              return (
                <tr key={rep.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>{rep.name}</div>
                    {rep.full_name && (
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{rep.full_name}</div>
                    )}
                    {rep.vehicle_plate && (
                      <div style={{ fontSize: '10px', color: '#475569', marginTop: '2px' }}>
                        {__t('settings.user_management.unified_access_directory_panel.s14', "لوحة:")} {rep.vehicle_plate}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 10px' }}>
                    {isBoth ? (
                      <span style={{ fontSize: '11px', color: '#6d28d9', background: '#ede9fe', padding: '2px 8px', borderRadius: '6px', border: '1px solid #ddd6fe', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {__t('settings.user_management.unified_access_directory_panel.s15', "شامل (فان ودليفري)")}
                      </span>
                    ) : isVan ? (
                      <span style={{ fontSize: '11px', color: '#0369a1', background: '#e0f2fe', padding: '2px 8px', borderRadius: '6px', border: '1px solid #bae6fd', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {__t('settings.user_management.unified_access_directory_panel.s16', "توزيع فان")}
                      </span>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#c2410c', background: '#ffedd5', padding: '2px 8px', borderRadius: '6px', border: '1px solid #fed7aa', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {__t('settings.user_management.unified_access_directory_panel.s17', "طيار دليفري")}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 10px', direction: 'ltr', textAlign: 'right', fontFamily: 'monospace', fontSize: '12px' }}>
                    {rep.phone || <span style={{ color: '#dc2626', fontSize: '11px' }}>{__t('settings.user_management.unified_access_directory_panel.s18', "غير محدد")}</span>}
                  </td>
                  <td style={{ padding: '10px 10px' }}>
                    {(() => {
                      const hasPin = Boolean(rep.has_pin || (rep as any).hasPin || (rep as any).pin_hash || rep.pin_code);
                      return (
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            background: hasPin ? '#ecfdf5' : '#fef2f2',
                            border: `1px solid ${hasPin ? '#a7f3d0' : '#fecaca'}`,
                            color: hasPin ? '#065f46' : '#b91c1c',
                            borderRadius: '6px',
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            letterSpacing: '1px',
                            fontSize: '11.5px',
                          }}
                        >
                          {hasPin ? __t('settings.user_management.unified_access_directory_panel.s19', "•••• مفعل") : __t('settings.user_management.unified_access_directory_panel.s20', "بدون رمز")}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      <span
                        onClick={() => copyUrl('/driver', __t('settings.user_management.unified_access_directory_panel.s21', "بوابة الدليفري"))}
                        title={__t('settings.user_management.unified_access_directory_panel.s22', "انقر لنسخ رابط بوابة الدليفري (/driver)")}
                        style={{
                          fontSize: '10.5px',
                          background: '#fff7ed',
                          color: '#c2410c',
                          border: '1px solid #ffedd5',
                          borderRadius: '4px',
                          padding: '2px 5px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <CopyIcon size={10} /> {__t('settings.user_management.unified_access_directory_panel.s23', "دليفري")}
                      </span>
                      <span
                        onClick={() => copyUrl('/van-sales', __t('settings.user_management.unified_access_directory_panel.s24', "مبيعات الفان"))}
                        title={__t('settings.user_management.unified_access_directory_panel.s25', "انقر لنسخ رابط مبيعات الفان (/van-sales)")}
                        style={{
                          fontSize: '10.5px',
                          background: '#f0f9ff',
                          color: '#0369a1',
                          border: '1px solid #e0f2fe',
                          borderRadius: '4px',
                          padding: '2px 5px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <CopyIcon size={10} /> {__t('settings.user_management.unified_access_directory_panel.s26', "فان")}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '2px 7px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: rep.is_active ? '#ecfdf5' : '#fef2f2',
                        color: rep.is_active ? '#065f46' : '#991b1b',
                        border: `1px solid ${rep.is_active ? '#a7f3d0' : '#fecaca'}`,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {rep.is_active ? <CheckCircleIcon size={11} /> : <XCircleIcon size={11} />}
                      {rep.is_active ? __t('settings.user_management.unified_access_directory_panel.s27', "نشط") : __t('settings.user_management.unified_access_directory_panel.s28', "موقوف")}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                      <Button
                        variant="secondary"
                        style={{ fontSize: '11px', padding: '3px 8px', whiteSpace: 'nowrap' }}
                        onClick={() => {
                          setUpsertRep(rep);
                          setIsUpsertOpen(true);
                        }}
                      >
                        {__t('settings.user_management.unified_access_directory_panel.s29', "تعديل البيانات")}
                      </Button>
                      <Button
                        variant="secondary"
                        style={{ fontSize: '11px', padding: '3px 8px', whiteSpace: 'nowrap' }}
                        onClick={() => {
                          setEditingRep(rep);
                          setPhoneInput(rep.phone || '');
                          setPinInput('');
                          setShowRepPassword(false);
                        }}
                      >
                        {__t('settings.user_management.unified_access_directory_panel.s30', "كلمة المرور / PIN")}
                      </Button>
                      <Button
                        variant={rep.is_active ? 'danger' : 'secondary'}
                        style={{ fontSize: '11px', padding: '3px 8px', whiteSpace: 'nowrap' }}
                        onClick={() => toggleActive(rep)}
                        disabled={updateMutation.isPending}
                      >
                        {rep.is_active ? __t('settings.user_management.unified_access_directory_panel.s31', "إيقاف") : __t('settings.user_management.unified_access_directory_panel.s32', "تفعيل")}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}
