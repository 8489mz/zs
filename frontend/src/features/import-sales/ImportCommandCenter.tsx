import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { LoadingState } from '@/shared/ui/loading-state';
import {
  useImportCommandCenterQuery,
  useImportProjectsQuery,
  useShipmentsQuery,
} from './api/shipments.api';
import {
  TrendingUpIcon,
  ShieldAlertIcon,
  DollarSignIcon,
  TruckIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  PlusCircleIcon,
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';

export default function ImportCommandCenter() {
  const navigate = useNavigate();
  const { data: metrics, isLoading, refetch } = useImportCommandCenterQuery();
  const { data: projects = [], isLoading: isProjectsLoading } = useImportProjectsQuery();
  const { data: shipmentsData, isLoading: isShipmentsLoading } = useShipmentsQuery();

  const shipments = shipmentsData?.rows || [];

  const capital = metrics?.capital || { totalCapital: 0, deployedCapital: 0, availableCapital: 0, totalWithdrawn: 0 };
  const pipeline = metrics?.pipeline || { projects: {}, shipments: { inTransit: 0, inCustoms: 0, arrived: 0 } };
  const alerts = metrics?.alerts || { demurrageAlerts: [], aciExpiring: [] };
  const performance = metrics?.performance || { totalRevenue: 0, grossProfit: 0, netProfitPool: 0 };

  // While the metrics query is still in flight every value is unknown, not
  // zero: render an em dash (repo AGENTS.md §7) instead of a flashing 0.00.
  const money2 = (value: number) =>
    isLoading ? '—' : Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money0 = (value: number) => (isLoading ? '—' : Number(value || 0).toLocaleString('en-US'));
  const count = (value: number) => (isLoading ? '—' : value);

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title="مركز قيادة الاستيراد والتجارة الدولية"
          description="متابعة شاملة لدورة الاستيراد من الصين: دراسات الجدوى، المصانع، الشحن، الجمارك، المخزون، وتوزيع الأرباح."
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="primary"
                onClick={() => navigate('/import-sales/projects')}
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
                <span>مشروع استيراد جديد</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => refetch()}
                disabled={isLoading}
                style={{
                  height: '38px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <RefreshCwIcon size={15} />
                <span>تحديث المؤشرات</span>
              </Button>
            </div>
          }
        />

            {/* Executive Operational Hubs Toolbar */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, flexWrap: 'wrap' }}>
        {[
          { label: 'المخلصين الجمركيين والعهد', path: '/import-sales/customs-brokers' },
          { label: 'تأمينات الحاويات للخطوط', path: '/import-sales/container-deposits' },
          { label: 'محفظة النقد الأجنبي (FX)', path: '/import-sales/fx-treasury' },
          { label: 'مركز الرقابة والموافقات', path: '/import-sales/approvals' },
          { label: 'مطابقة الاستيراد وتسوية الفروقات', path: '/import-sales/reconciliation' },
          { label: 'مديونية الموردين والحوالات', path: '/import-sales/supplier-credit' },
        ].map((hub) => (
          <button
            key={hub.path}
            onClick={() => navigate(hub.path)}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
              color: '#1e293b',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            {hub.label}
          </button>
        ))}
      </div>

      {/* 2. Top KPI Cards */}
      {isLoading && <LoadingState title="جاري تحميل مؤشرات الاستيراد..." />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        {/* Card 1: Total Capital */}
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>رأس المال المرصود</span>
            <div style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#170e5e' }}>
              <DollarSignIcon size={17} />
            </div>
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
            {money2(capital.totalCapital)} <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748b' }}>ج.م</span>
          </div>
          <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600, marginTop: 4 }}>
            المتاح للتشغيل: {money0(capital.availableCapital)} ج.م
          </div>
        </div>

        {/* Card 2: Deployed Capital */}
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>الموظف في مشاريع وشحنات</span>
            <div style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4338ca' }}>
              <TrendingUpIcon size={17} />
            </div>
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
            {money2(capital.deployedCapital)} <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748b' }}>ج.م</span>
          </div>
          <div style={{ fontSize: '11px', color: '#6366f1', fontWeight: 600, marginTop: 4 }}>
            نسبة التوظيف: {isLoading ? '—' : capital.totalCapital > 0 ? ((capital.deployedCapital / capital.totalCapital) * 100).toFixed(1) : 0}%
          </div>
        </div>

        {/* Card 3: In Transit & Customs */}
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>بضائع الطريق والجمارك</span>
            <div style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b45309' }}>
              <TruckIcon size={17} />
            </div>
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
            {count(pipeline.shipments.inTransit + pipeline.shipments.inCustoms)} <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748b' }}>حاويات نشطة</span>
          </div>
          <div style={{ fontSize: '11px', color: '#b45309', fontWeight: 600, marginTop: 4 }}>
            {count(pipeline.shipments.inTransit)} بالبحر | {count(pipeline.shipments.inCustoms)} بالجمارك
          </div>
        </div>

        {/* Card 4: Supplier Liabilities */}
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>مديونية الصين والموردين</span>
            <div style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b91c1c' }}>
              <ShieldAlertIcon size={17} />
            </div>
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#b91c1c' }}>
            ${money2((metrics?.liabilities as any)?.unpaidProformaUsd ?? metrics?.liabilities?.totalDebtForeign ?? 0)}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginTop: 4 }}>
            الرصيد الدفتري: {money0((metrics?.liabilities as any)?.totalDebtEgp || 0)} ج.م
          </div>
        </div>

        {/* Card 5: Realized Net Profit */}
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>صافي الأرباح المحققة (الشهر)</span>
            <div style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#047857' }}>
              <CheckCircleIcon size={17} />
            </div>
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#047857' }}>
            {money2(performance.netProfitPool)} <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748b' }}>ج.م</span>
          </div>
          <div style={{ fontSize: '11px', color: '#047857', fontWeight: 600, marginTop: 4 }}>
            إجمالي المبيعات: {money0(performance.totalRevenue)} ج.م
          </div>
        </div>
      </div>

      {/* 3. Operational Risks & Warnings Center */}
      {(alerts.demurrageAlerts.length > 0 || alerts.aciExpiring.length > 0) && (
        <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <AlertTriangleIcon size={18} color="#d97706" />
            <h3 style={{ fontSize: '13.5px', fontWeight: 800, color: '#92400e', margin: 0 }}>
              مركز التنبيهات والمخاطر التشغيلية النشطة ({alerts.demurrageAlerts.length + alerts.aciExpiring.length})
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {alerts.demurrageAlerts.map((d, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #fef3c7',
                  borderRadius: 8,
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                    حاوية #{d.containerNumber}
                  </div>
                  <div style={{ fontSize: '11px', color: d.isOverdue ? '#dc2626' : '#d97706', fontWeight: 600 }}>
                    {d.isOverdue
                      ? `تجاوزت فترة السماح بـ ${d.overdueDays} يوم! غرامات متوقعة: ${d.estimatedFeesEgp} ج.م`
                      : `متبقي ${d.daysRemaining} يوم قبل بدء غرامات الأرضيات`}
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/import-sales/shipments/${d.shipmentId}`)}
                  style={{
                    backgroundColor: '#f1f5f9',
                    border: 'none',
                    borderRadius: 6,
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#170e5e',
                    cursor: 'pointer',
                  }}
                >
                  فحص الحاوية
                </button>
              </div>
            ))}

            {alerts.aciExpiring.map((a, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #fef3c7',
                  borderRadius: 8,
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                    شهادة ACID #{a.acid_number}
                  </div>
                  <div style={{ fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>
                    تنتهي الصلاحية في {a.acid_expiry_date}
                  </div>
                </div>
                <button
                  onClick={() => navigate('/import-sales/compliance')}
                  style={{
                    backgroundColor: '#f1f5f9',
                    border: 'none',
                    borderRadius: 6,
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#170e5e',
                    cursor: 'pointer',
                  }}
                >
                  الامتثال
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Import Workflow Pipeline Funnel */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              مسار تدفق عمليات الاستيراد والتجارة الدولية (End-to-End Import Pipeline)
            </h3>
            <p style={{ fontSize: '11.5px', color: '#64748b', margin: '2px 0 0' }}>
              تتبع الشحنات والمشاريع لحظيًا عبر مراحل الدورة التشغيلية الكاملة
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {/* Step 1: Feasibility */}
          <div
            onClick={() => navigate('/import-sales/projects')}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '14px 12px',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>1. دراسة الجدوى</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#170e5e', margin: '6px 0 2px' }}>
              {count(pipeline.projects['feasibility'] || 0)}
            </div>
            <div style={{ fontSize: '10.5px', color: '#64748b' }}>مشاريع قيد الدراسة</div>
          </div>

          {/* Step 2: Sourcing & Contracting */}
          <div
            onClick={() => navigate('/import-sales/china-sourcing')}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '14px 12px',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>2. تعاقد وتصنيع</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#4338ca', margin: '6px 0 2px' }}>
              {count((pipeline.projects['contracted'] || 0) + (pipeline.projects['manufacturing'] || 0))}
            </div>
            <div style={{ fontSize: '10.5px', color: '#64748b' }}>مصانع الصين وفحص QC</div>
          </div>

          {/* Step 3: Maritime & Air Freight */}
          <div
            onClick={() => navigate('/import-sales/shipments')}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '14px 12px',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>3. الشحن الدولي</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0284c7', margin: '6px 0 2px' }}>
              {count(pipeline.shipments.inTransit)}
            </div>
            <div style={{ fontSize: '10.5px', color: '#64748b' }}>حاويات بالبحر / الجو</div>
          </div>

          {/* Step 4: Egypt Customs Clearance */}
          <div
            onClick={() => navigate('/import-sales/compliance')}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '14px 12px',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>4. التخليص الجمركي</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#d97706', margin: '6px 0 2px' }}>
              {count(pipeline.shipments.inCustoms)}
            </div>
            <div style={{ fontSize: '10.5px', color: '#64748b' }}>نافذة وACI والرقابة</div>
          </div>

          {/* Step 5: Warehouse & Stock */}
          <div
            onClick={() => navigate('/import-sales/shipments')}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '14px 12px',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>5. استلام المخازن</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#10b981', margin: '6px 0 2px' }}>
              {count(pipeline.shipments.arrived)}
            </div>
            <div style={{ fontSize: '10.5px', color: '#64748b' }}>شحنات تم استلامها بالـ WAC</div>
          </div>

          {/* Step 6: Profit Pool & Settlements */}
          <div
            onClick={() => navigate('/import-sales/profit-pool')}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '14px 12px',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>6. أرباح الشركاء</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#059669', margin: '6px 0 2px' }}>
              {count(pipeline.projects['closed'] || 0)}
            </div>
            <div style={{ fontSize: '10.5px', color: '#64748b' }}>مشاريع مقفلة وموزعة</div>
          </div>
        </div>
      </div>

      {/* 5. Active Projects & Shipments Split View */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Active Projects */}
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              أحدث مشاريع الاستيراد (Import Projects)
            </h3>
            <button
              onClick={() => navigate('/import-sales/projects')}
              style={{ background: 'none', border: 'none', color: '#170e5e', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              عرض الكل ({isProjectsLoading ? '…' : projects.length})
            </button>
          </div>

          {isProjectsLoading ? (
            <LoadingState title="جاري تحميل مشاريع الاستيراد..." />
          ) : projects.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: '12.5px' }}>
              لا توجد مشاريع استيراد مسجلة حتى الآن.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {projects.slice(0, 4).map((p) => (
                <div
                  key={p.id}
                  onClick={() => navigate('/import-sales/projects')}
                  style={{
                    padding: '10px 14px',
                    backgroundColor: '#f8fafc',
                    borderRadius: 8,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>{p.title}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      كود: {p.project_no} | ميزانية: ${Number(p.allocated_capital || 0).toLocaleString()}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 6,
                      backgroundColor: p.status === 'closed' ? '#f1f5f9' : '#e0e7ff',
                      color: p.status === 'closed' ? '#64748b' : '#3730a3',
                    }}
                  >
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* In-Transit Containers */}
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              الشحنات والحاويات البحرية الحية
            </h3>
            <button
              onClick={() => navigate('/import-sales/shipments')}
              style={{ background: 'none', border: 'none', color: '#170e5e', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              عرض الكل ({isShipmentsLoading ? '…' : shipments.length})
            </button>
          </div>

          {isShipmentsLoading ? (
            <LoadingState title="جاري تحميل الشحنات..." />
          ) : shipments.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: '12.5px' }}>
              لا توجد شحنات بحرية مسجلة حاليًا.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {shipments.slice(0, 4).map((s) => (
                <div
                  key={s.id}
                  onClick={() => navigate(`/import-sales/shipments/${s.id}`)}
                  style={{
                    padding: '10px 14px',
                    backgroundColor: '#f8fafc',
                    borderRadius: 8,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                      حاوية #{s.container_number}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      {s.supplier_name || 'مورد دولي'} | {s.arrival_date ? `وصول: ${s.arrival_date}` : 'تاريخ غير محدد'}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 6,
                      backgroundColor:
                        s.status === 'Arrived' ? '#dcfce7' : s.status === 'In Customs' ? '#fef3c7' : '#e0f2fe',
                      color:
                        s.status === 'Arrived' ? '#166534' : s.status === 'In Customs' ? '#92400e' : '#075985',
                    }}
                  >
                    {s.status === 'Arrived' ? 'وصلت المخزن' : s.status === 'In Customs' ? 'بالجمارك' : 'بالبحر'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </main>
    </div>
  );
}
