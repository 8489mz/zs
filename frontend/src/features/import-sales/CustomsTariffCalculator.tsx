import React, { useState } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import {
  useCustomsTariffsQuery,
  useCustomsTariffSectorsQuery,
  useCalculateCustomsMutation,
  useUpsertAciComplianceMutation,
  useSyncOfficialTariffsMutation,
  useShipmentsQuery,
} from './api/shipments.api';
import { todayLocalDateKey } from '@/lib/format';
import { StandardDialog } from '@/shared/components/StandardDialog';
import {
  SearchIcon,
  RefreshCwIcon,
  PlusCircleIcon,
  CheckShieldIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';

export default function CustomsTariffCalculator() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSector, setSelectedSector] = useState('all');
  const { data: tariffSectors = [] } = useCustomsTariffSectorsQuery();
  const { data: tariffs = [], refetch, isLoading: isTariffsLoading } = useCustomsTariffsQuery(searchTerm, selectedSector);
  // INV-IMPORT-COMPLIANCE-HS-ACI-DATES: the tariff list reads exactly
  // what the tenant stored — a tenant with no rows lists empty, by
  // design (INV-IMPORT-TARIFF-VERSIONING removed read-time seeding so
  // a refresh can never overwrite tenant-edited rates). The bundled
  // official snapshot only enters through the explicit sync endpoint,
  // and this page never called it: "تحديث البنود" only re-read the
  // same empty table. The button below is the sync's only UI entry.
  const syncOfficialMutation = useSyncOfficialTariffsMutation();
  const { data: shipmentsData } = useShipmentsQuery();
  const shipmentsList: any[] = shipmentsData?.rows || [];

  const handleSyncTariffs = async () => {
    try {
      const res: any = await syncOfficialMutation.mutateAsync();
      toast.success(`تم تحميل التعريفة الرسمية: ${res?.inserted ?? 0} بنداً جديداً من أصل ${res?.total ?? res?.count ?? ''}`);
      await refetch();
    } catch (err: any) {
      toast.error('حدث خطأ أثناء تحميل التعريفة الرسمية: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const availableSectors =
    tariffSectors && tariffSectors.length > 0
      ? tariffSectors
      : [
          { id: 'commercial_vehicles_spare_parts', name_ar: 'قطع غيار سيارات النقل والتريلات (5%)' },
          { id: 'electronics_it', name_ar: 'الإلكترونيات والاتصالات' },
          { id: 'home_appliances', name_ar: 'الأجهزة الكهربائية والمنزلية' },
          { id: 'textiles_garments', name_ar: 'الملابس والمنسوجات' },
          { id: 'plastics_raw', name_ar: 'اللدائن ومستلزمات التعبئة' },
          { id: 'sanitary_building', name_ar: 'الأدوات الصحية ومواد البناء' },
        ];

  const displayedTariffs = tariffs.filter((t: any) => {
    if (selectedSector && selectedSector !== 'all') {
      return t.sector === selectedSector;
    }
    return true;
  });
  const calculateCustomsMutation = useCalculateCustomsMutation();
  const upsertAciMutation = useUpsertAciComplianceMutation();

  // Calculator State
  const [selectedHsCode, setSelectedHsCode] = useState('8471.30');
  const [cifValueEgp, setCifValueEgp] = useState<number>(500000);
  const [calcResult, setCalcResult] = useState<any>(null);

  // ACI Modal State
  const [isAciModalOpen, setIsAciModalOpen] = useState(false);
  const [acidNumber, setAcidNumber] = useState('');
  // INV-IMPORT-COMPLIANCE-HS-ACI-DATES: local calendar parts, never
  // toISOString() — the UTC slice is the previous day for the first
  // two hours after midnight in the tenant's zone.
  const [acidIssueDate, setAcidIssueDate] = useState(todayLocalDateKey());
  const [acidExpiryDate, setAcidExpiryDate] = useState('');
  const [aciShipmentId, setAciShipmentId] = useState('');
  const [cargoxDocId, setCargoxDocId] = useState('');
  const [importerTaxNo, setImporterTaxNo] = useState('');
  const [exporterId, setExporterId] = useState('');
  const [aciNotes, setAciNotes] = useState('');

  const handleCalculate = async () => {
    try {
      const res = await calculateCustomsMutation.mutateAsync({
        hsCode: selectedHsCode,
        cifValueEgp: Number(cifValueEgp),
      });
      setCalcResult(res);
      // An undocumented HS code returns labelled zeros, never a
      // silent default: warn loudly instead of reporting success.
      if (res && res.isDocumentedTariff === false) {
        toast.warning(res.message || 'البند الجمركي غير مسجل بالتعريفة الرسمية المعتمدة. يلزم إدخال النسبة المعتمدة يدوياً.');
      } else {
        toast.success('تم احتساب الرسوم والضرائب الجمركية بنجاح');
      }
    } catch (err: any) {
      toast.error('حدث خطأ أثناء احتساب الرسوم: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const handleSaveAci = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acidNumber.trim()) {
      toast.error('رقم ACID مطلوب');
      return;
    }

    try {
      const linkedShipment = shipmentsList.find((s: any) => String(s.id) === String(aciShipmentId));
      await upsertAciMutation.mutateAsync({
        acidNumber: acidNumber.trim(),
        acidIssueDate,
        acidExpiryDate,
        // INV-IMPORT-COMPLIANCE-HS-ACI-DATES: the dialog used to send
        // no container/shipment at all, although the backend stores
        // shipment_id + project_id and reads the record back by them.
        // The link is optional — an ACID is issued before the container
        // exists in the system — but when a container is chosen its
        // project follows it, so the record is retrievable from the
        // shipment's traceability. The backend rejects a linked id
        // that belongs to another tenant.
        shipmentId: aciShipmentId || undefined,
        projectId: linkedShipment?.project_id || undefined,
        cargoxDocumentId: cargoxDocId,
        importerTaxNumber: importerTaxNo,
        exporterId,
        status: 'issued',
        notes: aciNotes,
        complianceChecklist: {
          proformaInvoiceUploaded: true,
          commercialInvoiceUploaded: Boolean(cargoxDocId),
          packingListUploaded: true,
          billOfLadingAcidEmbedded: true,
        },
      });
      toast.success('تم حفظ وتوثيق بيانات منظومة ACI بنجاح');
      setIsAciModalOpen(false);
      setAcidNumber('');
      setAciShipmentId('');
    } catch (err: any) {
      toast.error('حدث خطأ أثناء حفظ بيانات ACI: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title="الامتثال الجمركي المصري وحاسبة الرسوم"
          description="احتساب التعريفة الجمركية وضريبة القيمة المضافة وجهات الرقابة (GOEIC/NTRA) ومتابعة منظومة التسجيل المسبق للشحنات ACI."
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="primary"
                onClick={() => setIsAciModalOpen(true)}
                style={{
                  height: '38px',
                  padding: '0 18px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <PlusCircleIcon size={15} />
                <span>تسجيل شحنة بنظام ACI / نافذة</span>
              </Button>
            </div>
          }
        />

        {/* 2. Customs Calculator Box */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        <h2 style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', margin: '0 0 14px' }}>
          حاسبة الرسوم الجمركية والضرائب على القيمة CIF (Official Egypt Duty Calculator)
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
              البند الجمركي المستهدف (HS Code)
            </label>
            <select
              value={selectedHsCode}
              onChange={(e) => setSelectedHsCode(e.target.value)}
              style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            >
              {tariffs.map((t) => (
                <option key={t.id} value={t.hs_code}>
                  {t.hs_code} - {t.description_ar} (جمرك: {t.duty_rate_percent}% | ض.ق.م: {t.vat_rate_percent}%)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
              القيمة للأغراض الجمركية CIF (شاملة الشحن والتأمين بالجنيه)
            </label>
            <input
              type="number"
              value={cifValueEgp}
              onChange={(e) => setCifValueEgp(Number(e.target.value))}
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>

          <button
            type="button"
            onClick={handleCalculate}
            disabled={calculateCustomsMutation.isPending}
            style={{
              height: 36,
              padding: '0 20px',
              backgroundColor: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {calculateCustomsMutation.isPending ? 'جاري الاحتساب...' : 'احتساب الرسوم'}
          </button>
        </div>

        {/* Calculation Result */}
        {calcResult && (
          <div style={{ marginTop: 16, backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 10, padding: 14 }}>
            {calcResult.isDocumentedTariff === false && (
              <div style={{ marginBottom: 12, backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem', color: '#92400e' }}>
                {calcResult.message || 'البند الجمركي غير مسجل بالتعريفة الرسمية المعتمدة. يلزم إدخال النسبة المعتمدة يدوياً.'}
                {' '}الأرقام أدناه أصفار تقديرية وليست رسوماً فعلية.
              </div>
            )}            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>الرسوم الجمركية ({calcResult.dutyRatePercent}%)</span>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                  {calcResult.customsDuty.toLocaleString()} ج.م
                </div>
              </div>

              <div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>ضريبة القيمة المضافة ({calcResult.vatRatePercent}%)</span>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                  {calcResult.vatAmount.toLocaleString()} ج.م
                </div>
              </div>

              <div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>رسوم جهات الفحص والعرض</span>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                  {calcResult.inspectionFees.toLocaleString()} ج.م
                </div>
              </div>

              <div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>جهة الرقابة المختصة</span>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#170e5e', marginTop: 2 }}>
                  {calcResult.regulatoryBody}
                </div>
              </div>

              <div style={{ borderRight: '2px solid #cbd5e1', paddingRight: 14 }}>
                <span style={{ fontSize: '11px', color: '#170e5e', fontWeight: 700 }}>إجمالي المستحقات الجمركية</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#b91c1c', marginTop: 2 }}>
                  {calcResult.totalCustomsDues.toLocaleString()} ج.م
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Tariffs Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        {/* Sector Selection Pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setSelectedSector('all')}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              border: selectedSector === 'all' ? '2px solid #170e5e' : '1px solid #cbd5e1',
              backgroundColor: selectedSector === 'all' ? '#170e5e' : '#ffffff',
              color: selectedSector === 'all' ? '#ffffff' : '#334155',
            }}
          >
            <span>كافة القطاعات ({tariffs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedSector('commercial_vehicles_spare_parts')}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              border: selectedSector === 'commercial_vehicles_spare_parts' ? '2px solid #170e5e' : '1px solid #cbd5e1',
              backgroundColor: selectedSector === 'commercial_vehicles_spare_parts' ? '#170e5e' : '#ffffff',
              color: selectedSector === 'commercial_vehicles_spare_parts' ? '#ffffff' : '#334155',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <CheckShieldIcon size={14} />
            <span>قطع غيار سيارات النقل والتريلات (5%)</span>
          </button>

          {availableSectors
            .filter((s: any) => s.id !== 'commercial_vehicles_spare_parts')
            .map((sec: any) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => setSelectedSector(sec.id)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: selectedSector === sec.id ? '2px solid #170e5e' : '1px solid #cbd5e1',
                  backgroundColor: selectedSector === sec.id ? '#170e5e' : '#ffffff',
                  color: selectedSector === sec.id ? '#ffffff' : '#334155',
                }}
              >
                <span>{sec.name_ar}</span>
              </button>
            ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ position: 'relative', width: 340 }}>
            <input
              type="text"
              placeholder="بحث برقم البند أو اسم الصنف (مثال: 8708.30، فرامل، محرك)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', height: 36, padding: '4px 34px 4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
            <span style={{ position: 'absolute', right: 10, top: 10, color: '#94a3b8' }}>
              <SearchIcon size={15} />
            </span>
          </div>

          <button
            onClick={handleSyncTariffs}
            disabled={syncOfficialMutation.isPending}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px' }}
          >
            <RefreshCwIcon size={13} />
            {syncOfficialMutation.isPending ? 'جاري تحميل التعريفة...' : 'تحديث البنود'}
          </button>
        </div>

        {!isTariffsLoading && tariffs.length === 0 && (
          <div style={{ border: '1px dashed #cbd5e1', borderRadius: 8, padding: '18px', textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>لا توجد بنود تعريفة محفوظة لهذه المنشأة بعد</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: 12 }}>
              جدول البنود يقرأ ما حفظته المنشأة فقط — حمّل التعريفة الرسمية المعتمدة (مرسوم 218/2022) لتظهر البنود هنا وفي حاسبة الرسوم.
            </div>
            <button
              type="button"
              onClick={handleSyncTariffs}
              disabled={syncOfficialMutation.isPending}
              style={{ padding: '8px 20px', backgroundColor: '#170e5e', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#ffffff', cursor: 'pointer' }}
            >
              {syncOfficialMutation.isPending ? 'جاري تحميل التعريفة...' : 'تحميل التعريفة الرسمية'}
            </button>
          </div>
        )}

        <div style={{ overflowX: 'hidden', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right' }}>
            <colgroup>
              <col style={{ width: '110px' }} />
              <col style={{ width: '42%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '130px' }} />
            </colgroup>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>رقم البند (HS Code)</th>
                <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>بيان وتوصيف السلعة</th>
                <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>نسبة الوارد</th>
                <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>القيمة المضافة</th>
                <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>جهات العرض والرقابة</th>
                <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>إجراء سريع</th>
              </tr>
            </thead>
            <tbody>
              {displayedTariffs.map((t) => (
                <tr key={t.id || t.hs_code} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 800, color: '#170e5e', fontFamily: 'monospace' }}>{t.hs_code}</td>
                  <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#0f172a', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.45 }}>
                    <div>{t.description_ar}</div>
                    {t.description_en && (
                      <div style={{ fontSize: '10.5px', color: '#64748b', direction: 'ltr', textAlign: 'left', marginTop: 2 }}>{t.description_en}</div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 800, color: Number(t.duty_rate_percent) <= 5 ? '#15803d' : '#0f172a', textAlign: 'center' }}>
                    <span style={{ backgroundColor: Number(t.duty_rate_percent) <= 5 ? '#dcfce7' : '#f8fafc', padding: '2px 8px', borderRadius: 4 }}>
                      {t.duty_rate_percent}%
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 700, color: '#0f172a', textAlign: 'center' }}>
                    {t.vat_rate_percent}%
                    <span style={{ display: 'block', fontSize: '10px', color: '#94a3b8' }}>+ {t.inspection_fees_percent || 1}% فحص</span>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: '11px', color: '#475569' }}>
                    <div style={{ fontWeight: 600 }}>{t.category_ar || 'عام'}</div>
                    <span style={{ padding: '1px 6px', borderRadius: 4, backgroundColor: '#f1f5f9', fontWeight: 600, fontSize: '10px' }}>
                      {t.regulatory_body || 'GOEIC (صادرات وواردات)'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedHsCode(t.hs_code);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        fontSize: '11.5px',
                        fontWeight: 700,
                        color: '#170e5e',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      تطبيق في الحاسبة
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. ACI Registration Dialog */}
      <StandardDialog
        open={isAciModalOpen}
        onClose={() => setIsAciModalOpen(false)}
        title="تسجيل وتوثيق شحنة بنظام ACI / نافذة (Advance Cargo Information)"
        subtitle="توثيق رقم ACID المسبق الصادر من منصة نافذة وربطه بمستندات CargoX قبل الشحن"
        width="650px"
      >
        <form onSubmit={handleSaveAci} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              رقم ACID المسبق (19 رقماً من نافذة) *
            </label>
            <input
              type="text"
              required
              value={acidNumber}
              onChange={(e) => setAcidNumber(e.target.value)}
              placeholder="مثال: 2609140019284719283"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>

          {/* INV-IMPORT-COMPLIANCE-HS-ACI-DATES: the container/shipment
              this ACID belongs to. The dialog used to have no linkage
              field at all — the record could never be found from the
              shipment. Optional: an ACID is issued before the container
              exists in the system; when a container is chosen its
              project follows it. */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              الحاوية / الشحنة المرتبطة
            </label>
            <select
              value={aciShipmentId}
              onChange={(e) => setAciShipmentId(e.target.value)}
              style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            >
              <option value="">-- بدون ربط (يسجَّل الرقم فقط) --</option>
              {shipmentsList.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.container_number} — {s.status}
                  {s.bill_of_lading ? ` — بوليصة ${s.bill_of_lading}` : ''}
                </option>
              ))}
            </select>
            {!aciShipmentId && (
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4 }}>
                اربط الحاوية حتى يظهر سجل ACI في تتبع الشحنة؛ إن لم تُنشأ الحاوية بعد، احفظ الرقم الآن واربطه لاحقاً.
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>تاريخ الإصدار</label>
              <input
                type="date"
                value={acidIssueDate}
                onChange={(e) => setAcidIssueDate(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>تاريخ الانتهاء</label>
              <input
                type="date"
                value={acidExpiryDate}
                onChange={(e) => setAcidExpiryDate(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>رقم بوليصة أو ظرف CargoX</label>
              <input
                type="text"
                value={cargoxDocId}
                onChange={(e) => setCargoxDocId(e.target.value)}
                placeholder="معرف الشحنة في CargoX"
                style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>الرقم الضريبي للمستورد المصري</label>
              <input
                type="text"
                value={importerTaxNo}
                onChange={(e) => setImporterTaxNo(e.target.value)}
                placeholder="السجل الضريبي للمنشأة"
                style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>معرف المصدر الأجنبي</label>
              <input
                type="text"
                value={exporterId}
                onChange={(e) => setExporterId(e.target.value)}
                placeholder="رقم تسجيل المصدر في CargoX"
                style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>ملاحظات الامتثال الجمركي</label>
            <textarea
              rows={2}
              value={aciNotes}
              onChange={(e) => setAciNotes(e.target.value)}
              placeholder="تأكيد تطابق البيانات بين الفاتورة وقائمة التعبئة وبوليصة الشحن..."
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => setIsAciModalOpen(false)}
              style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={upsertAciMutation.isPending}
              style={{ padding: '8px 20px', backgroundColor: '#170e5e', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#ffffff', cursor: 'pointer' }}
            >
              {upsertAciMutation.isPending ? 'جاري الحفظ...' : 'حفظ بيانات ACI'}
            </button>
          </div>
        </form>
      </StandardDialog>
      </main>
    </div>
  );
}
