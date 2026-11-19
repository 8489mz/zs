import { useTranslation } from 'react-i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { maritimeApi, MaritimeJob, MaritimeContainer, WarehouseReceipt } from '../../api/maritime-freight.api';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { printTruckingWaybill, printWarehouseReceipt } from '../../utils/maritime-documents';

interface Props {
  job: MaritimeJob;
  warehouseReceiptsList: WarehouseReceipt[];
  loadingWarehouseReceipts: boolean;
  submitOnce: (key: string, action: () => Promise<void>) => Promise<void>;
  setShowAddContainer: (show: boolean) => void;
  handleOpenEditContainer: (c: MaritimeContainer) => void;
  setShowAddWarehouseReceiptDialog: (show: boolean) => void;
  handleReleaseWarehouseReceipt: (receipt: WarehouseReceipt) => void;
  fetchJob: (specificId?: string) => Promise<void>;
  onUpdated: () => void;
}

export function JobContainersTab({
  job,
  warehouseReceiptsList,
  loadingWarehouseReceipts,
  submitOnce,
  setShowAddContainer,
  handleOpenEditContainer,
  setShowAddWarehouseReceiptDialog,
  handleReleaseWarehouseReceipt,
  fetchJob,
  onUpdated,
}: Props) {
  const { t } = useTranslation();

  // Container quick movement triggers
  const handleContainerDischarge = async (c: MaritimeContainer) => {
    const confirmed = await systemConfirm({
      title: 'تسجيل تفريغ الحاوية بميناء الوصول (Discharged)',
      badge: c.container_number,
      message: `هل تريد تسجيل تفريغ الحاوية ${c.container_number} وبدء سريان فترة السماح (${c.free_days ?? 14} يوم)؟`,
      confirmText: 'تأكيد التفريغ',
      cancelText: 'تراجع',
      variant: 'primary',
    });
    if (!confirmed) return;
    try {
      const nowIso = new Date().toISOString();
      await maritimeApi.updateContainer(c.id, { dischargedAt: nowIso });
      toast.success(`تم تسجيل تفريغ الحاوية ${c.container_number} وحساب مهلة الإرجاع`);
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل تفريغ الحاوية');
    }
  };

  const handleContainerGateOut = async (c: MaritimeContainer) => {
    const confirmed = await systemConfirm({
      title: 'تسجيل خروج الحاوية من بوابة الميناء (Gate Out)',
      badge: c.container_number,
      message: `هل تم خروج الحاوية ${c.container_number} من ساحات الميناء وتوجيهها لمقر العميل؟`,
      confirmText: 'تسجيل الخروج',
      cancelText: 'تراجع',
      variant: 'primary',
    });
    if (!confirmed) return;
    try {
      const nowIso = new Date().toISOString();
      await maritimeApi.updateContainer(c.id, { gatedOutAt: nowIso });
      toast.success(`تم تسجيل خروج الحاوية ${c.container_number} بنجاح`);
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل خروج الحاوية');
    }
  };

  const handleContainerEmptyReturned = async (c: MaritimeContainer) => {
    const confirmed = await systemConfirm({
      title: 'تسجيل إرجاع الحاوية الفارغة (Empty Returned)',
      badge: c.container_number,
      message: `هل تم تسليم الحاوية الفارغة ${c.container_number} لساحة الخط الملاحي وإغلاق مهلة الغرامات؟`,
      confirmText: 'تأكيد الإرجاع',
      cancelText: 'تراجع',
      variant: 'primary',
    });
    if (!confirmed) return;
    try {
      const nowIso = new Date().toISOString();
      await maritimeApi.updateContainer(c.id, {
        emptyReturnedAt: nowIso,
        depositStatus: 'pending_return_proof',
      });
      toast.success(`تم إغلاق ملف الحاوية ${c.container_number} وتحويل التأمين لمعالجة الرد`);
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل إرجاع الحاوية');
    }
  };
  return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {job.transport_mode === 'air' ? (
            /* بطاقة تفاصيل الشحنة الجوية للأوزان والأبعاد */
            <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#e0f2fe', color: '#0369a1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AppIcons.Plane size={20} />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.96rem', fontWeight: 800, color: '#0f172a' }}>
                      {t('maritime_freight.job_details_modal.s79', "مواصفات الشحنة الجوية (Air Cargo Specifications)")}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {t('maritime_freight.job_details_modal.s80', "الناقل الجوي:")} <strong>{job.shipping_line_name}</strong> {t('maritime_freight.job_details_modal.s81', "| الرحلة:")} <strong>{job.flight_number || t('maritime_freight.job_details_modal.s82', "قيد التحديد")}</strong>
                    </div>
                  </div>
                </div>
                <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.76rem', fontWeight: 800, background: '#e0f2fe', color: '#0369a1' }}>
                  {t('maritime_freight.job_details_modal.s83', "معيار إياتا IATA (1:6000)")}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', background: '#f8fafc', padding: '14px', borderRadius: '10px' }}>
                <div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s84', "الوزن القائم الفعلي (Gross Weight)")}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {Number(job.gross_weight_kg || 0).toLocaleString()} {t('maritime_freight.job_details_modal.s85', "كجم")}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s86', "الوزن الحجمي (Volumetric Weight)")}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0369a1', marginTop: '4px' }}>
                    {Number(job.volumetric_weight_kg || 0).toLocaleString()} {t('maritime_freight.job_details_modal.s87', "كجم")}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s88', "الوزن الخاضع للتحصيل (Chargeable)")}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#15803d', marginTop: '4px' }}>
                    {Number(job.chargeable_weight_kg || Math.max(job.gross_weight_kg || 0, job.volumetric_weight_kg || 0)).toLocaleString()} {t('maritime_freight.job_details_modal.s89', "كجم")}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s90', "الحجم وعدد الطرود")}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#170e5e', marginTop: '4px' }}>
                    {job.package_count || 1} {t('maritime_freight.job_details_modal.s91', "طرد (")}{job.total_cbm || 0} {t('maritime_freight.job_details_modal.s92', "م³)")}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#170e5e' }}>
                  {t('maritime_freight.job_details_modal.s93', "إدارة الحاويات وتتبع فترة السماح والغرامات")}
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddContainer(true)}
                  style={{
                    padding: '6px 14px',
                    background: '#170e5e',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t('maritime_freight.job_details_modal.s94', "إضافة حاوية جديدة")}
                </button>
              </div>

              {job.containers?.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#64748b', fontSize: '0.85rem' }}>
                  {t('maritime_freight.job_details_modal.s95', "لا توجد حاويات مسجلة في هذا الملف بعد. انقر على \"إضافة حاوية جديدة\" لإدراج حاويات الشحنة.")}
                </div>
              ) : (
                job.containers?.map((c) => (
                  <div key={c.id} style={{ background: '#ffffff', padding: '14px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '1.05rem', fontWeight: 900, color: '#170e5e' }}>{c.container_number}</span>
                        <span style={{ padding: '3px 10px', background: '#f1f5f9', color: '#1e293b', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 700 }}>
                          {c.container_type}
                        </span>
                        {c.seal_number && (
                          <span style={{ fontSize: '0.78rem', color: '#64748b', background: '#fafafa', padding: '2px 8px', borderRadius: '4px', border: '1px solid #f1f5f9' }}>
                            {t('maritime_freight.job_details_modal.s96', "ختم:")} {c.seal_number}
                          </span>
                        )}
                      </div>
                      <div>
                        {c.empty_returned_at ? (
                          <span style={{ padding: '4px 12px', background: '#f1f5f9', color: '#475569', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700 }}>
                            {t('maritime_freight.job_details_modal.s97', "تم إرجاع الفارغ بنجاح")}
                          </span>
                        ) : (
                          <span style={{ padding: '4px 12px', background: c.is_overdue ? '#fef2f2' : '#f0fdf4', color: c.is_overdue ? '#b91c1c' : '#15803d', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700 }}>
                            {c.is_overdue ? `تجاوزت المهلة (${c.overdue_days || 0} يوم غرامة)` : t('maritime_freight.job_details_modal.s98', "سارية ضمن فترة السماح")}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', fontSize: '0.78rem' }}>
                      <div>
                        <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s99', "فترة السماح:")} </span>
                        <strong style={{ color: '#0f172a' }}>{c.free_days || 14} {t('maritime_freight.job_details_modal.s100', "يوم")}</strong>
                      </div>
                      <div>
                        <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s101', "موعد الإرجاع:")} </span>
                        <strong style={{ color: c.is_overdue ? '#b91c1c' : '#0f172a' }}>{c.return_deadline || t('maritime_freight.job_details_modal.s102', "لم يحدد")}</strong>
                      </div>
                      <div>
                        <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s103', "مبلغ التأمين:")} </span>
                        <strong style={{ color: '#0f172a' }}>{Number(c.deposit_amount).toLocaleString()} {c.deposit_currency || 'USD'}</strong>
                      </div>
                      <div>
                        <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s104', "حالة التأمين:")} </span>
                        <strong style={{ color: '#170e5e' }}>{c.deposit_status || 'not_required'}</strong>
                      </div>
                    </div>

                    {/* أزرار الإجراءات السريعة للحاوية */}
                    <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid #f1f5f9', paddingTop: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => printTruckingWaybill(job, c)}
                        style={{
                          padding: '4px 10px',
                          background: '#f8fafc',
                          color: '#170e5e',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <AppIcons.Truck size={13} />
                        <span>{t('maritime_freight.job_details_modal.s105', "إذن النقل البري (CMR)")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEditContainer(c)}
                        style={{
                          padding: '4px 10px',
                          background: '#f8fafc',
                          color: '#334155',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {t('maritime_freight.job_details_modal.s106', "تعديل الحاوية")}
                      </button>
                      {!c.discharged_at && (
                        <button
                          type="button"
                          onClick={() => submitOnce(`discharge-${c.id}`, () => handleContainerDischarge(c))}
                          style={{
                            padding: '4px 10px',
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            border: '1px solid #bfdbfe',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {t('maritime_freight.job_details_modal.s107', "تسجيل تفريغ الميناء (Discharged)")}
                        </button>
                      )}
                      {c.discharged_at && !c.gated_out_at && (
                        <button
                          type="button"
                          onClick={() => submitOnce(`gate-out-${c.id}`, () => handleContainerGateOut(c))}
                          style={{
                            padding: '4px 10px',
                            background: '#fffbeb',
                            color: '#b45309',
                            border: '1px solid #fde68a',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {t('maritime_freight.job_details_modal.s108', "تسجيل خروج البوابة (Gate Out)")}
                        </button>
                      )}
                      {!c.empty_returned_at && (
                        <button
                          type="button"
                          onClick={() => submitOnce(`return-${c.id}`, () => handleContainerEmptyReturned(c))}
                          style={{
                            padding: '4px 10px',
                            background: '#f0fdf4',
                            color: '#15803d',
                            border: '1px solid #bbf7d0',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {t('maritime_freight.job_details_modal.s109', "تسجيل إرجاع الفارغ (Empty Returned)")}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {/* قسم أذون استلام وإيداع المستودع الترانزيت والجمركي (Transit & Bonded Warehouse Intake Receipts - MWR) */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AppIcons.Archive size={17} />
                <div>
                  <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#170e5e' }}>
                    {t('maritime_freight.job_details_modal.s110', "أذون استلام وإيداع المستودع الترانزيت والجمركي (Warehouse Intake - MWR)")}
                  </span>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    {t('maritime_freight.job_details_modal.s111', "إدارة استلام الطرود، تخصيص الأرفف والساحات (Bay/Rack/Bin)، وأوامر الإفراج والتسليم")}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddWarehouseReceiptDialog(true)}
                style={{
                  padding: '6px 14px',
                  background: '#047857',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('maritime_freight.job_details_modal.s112', "+ إذن استلام مستودع (MWR)")}
              </button>
            </div>

            {loadingWarehouseReceipts ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '0.8rem' }}>
                {t('maritime_freight.job_details_modal.s113', "جاري تحميل أذون استلام المستودع...")}
              </div>
            ) : warehouseReceiptsList.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                {t('maritime_freight.job_details_modal.s114', "لا توجد أذون استلام مستودع مسجلة لهذه العملية بعد. يمكنك إصدار إذن استلام لتسجيل إيداع الطرود بمستودع الترانزيت أو الإيداع الجمركي.")}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'right' }}>
                    <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s115', "رقم الإذن (MWR)")}</th>
                    <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s116', "تاريخ الاستلام")}</th>
                    <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s117', "عدد الطرود")}</th>
                    <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s118', "الوزن / الحجم")}</th>
                    <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s119', "موقع التخزين (Bay/Rack/Bin)")}</th>
                    <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'center' }}>{t('maritime_freight.job_details_modal.s120', "الحالة")}</th>
                    <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'center' }}>{t('maritime_freight.job_details_modal.s121', "الإجراءات")}</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouseReceiptsList.map((rcpt) => (
                    <tr key={rcpt.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 800, fontFamily: 'monospace', color: '#170e5e' }}>
                        {rcpt.receipt_number}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#64748b' }}>
                        {rcpt.received_date ? new Date(rcpt.received_date).toLocaleString('ar-EG') : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0f172a' }}>
                        {rcpt.package_count || 1} {t('maritime_freight.job_details_modal.s122', "طرد")}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#334155' }}>
                        {Number(rcpt.gross_weight_kg || 0).toLocaleString()} {t('maritime_freight.job_details_modal.s123', "كجم |")} {Number(rcpt.cbm || 0).toFixed(2)} {t('maritime_freight.job_details_modal.s124', "م³")}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#1e293b', fontWeight: 600 }}>
                        {rcpt.bay_rack_bin || t('maritime_freight.job_details_modal.s125', "ساحة الاستلام والتفتيش")}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            background: rcpt.warehouse_status === 'released' ? '#dcfce7' : '#eff6ff',
                            color: rcpt.warehouse_status === 'released' ? '#15803d' : '#1e40af',
                          }}
                        >
                          {rcpt.warehouse_status === 'released' ? t('maritime_freight.job_details_modal.s126', "تم الإفراج والتسليم") : t('maritime_freight.job_details_modal.s127', "مودعة بالمستودع")}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => printWarehouseReceipt(job, rcpt)}
                            style={{
                              padding: '3px 8px',
                              background: '#170e5e',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {t('maritime_freight.job_details_modal.s128', "طباعة الإذن")}
                          </button>
                          {rcpt.warehouse_status !== 'released' && (
                            <button
                              type="button"
                              onClick={() => handleReleaseWarehouseReceipt(rcpt)}
                              style={{
                                padding: '3px 8px',
                                background: '#16a34a',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {t('maritime_freight.job_details_modal.s129', "إفراج وتسليم")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
  );
}
