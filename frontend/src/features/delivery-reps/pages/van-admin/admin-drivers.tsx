import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { CopyIcon, RefreshCwIcon, SearchIcon, UsersIcon } from '@/shared/components/icons/AppIcons';
import type { DeliveryRep } from '../../hooks/useVanSalesAdmin';

export interface AdminDriversProps {
  copyCredentials: (d: DeliveryRep) => void;
  copyUrl: (path: string, label: string) => void;
  driverSearch: string;
  filteredDrivers: DeliveryRep[];
  handleRefreshDrivers: () => Promise<void>;
  handleToggleActive: (d: DeliveryRep) => Promise<void>;
  isRefreshingDrivers: boolean;
  isRepsLoading: boolean;
  setDriverSearch: Dispatch<SetStateAction<string>>;
  setEditingRep: Dispatch<SetStateAction<DeliveryRep | null>>;
  setIsUpsertRepOpen: Dispatch<SetStateAction<boolean>>;
  vanDrivers: DeliveryRep[];
}

export function AdminDrivers({
  copyCredentials,
  copyUrl,
  driverSearch,
  filteredDrivers,
  handleRefreshDrivers,
  handleToggleActive,
  isRefreshingDrivers,
  isRepsLoading,
  setDriverSearch,
  setEditingRep,
  setIsUpsertRepOpen,
  vanDrivers,
}: AdminDriversProps) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Info Banner */}
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '8px',
              background: '#f0f9ff',
              color: '#0284c7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <UsersIcon size={20} color="#0284c7" />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
              {t('delivery_reps.van_sales_admin_management_page.s16', "سائقي ومناديب التوزيع الميداني (Van Drivers)")}
            </h4>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {t('delivery_reps.van_sales_admin_management_page.s17', "تسجيل بيانات المناديب، ربطهم بسيارات التوزيع، وتفعيل بوابة البيع الميداني (/van-sales) برمز PIN.")}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <Button
            variant="secondary"
            style={{ fontSize: '12px', padding: '6px 12px' }}
            onClick={() => copyUrl('/van-sales', t('delivery_reps.van_sales_admin_management_page.s18', "بوابة مبيعات الفان"))}
          >
            <CopyIcon size={12} /> {t('delivery_reps.van_sales_admin_management_page.s19', "نسخ رابط البوابة (/van-sales)")}
          </Button>
          <Button
            variant="secondary"
            style={{ fontSize: '12px', padding: '6px 12px', background: '#170e5e', color: '#ffffff', borderColor: '#170e5e' }}
            onClick={() => window.open('/van-sales', '_blank')}
          >
            {t('delivery_reps.van_sales_admin_management_page.s20', "فتح البوابة ↗")}
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          background: '#ffffff',
          padding: '12px 16px',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ position: 'relative', flex: '1', minWidth: '240px' }}>
          <input
            type="text"
            placeholder={t('delivery_reps.van_sales_admin_management_page.s21', "بحث باسم المندوب أو رقم الهاتف أو لوحة السيارة...")}
            value={driverSearch}
            onChange={(e) => setDriverSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 36px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              boxSizing: 'border-box',
            }}
          />
          <span style={{ position: 'absolute', left: '10px', top: '10px', color: '#94a3b8' }}>
            <SearchIcon size={16} />
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
            {t('delivery_reps.van_sales_admin_management_page.s22', "مناديب الفان المسجلين:")} {vanDrivers.length}
          </span>
          <Button
            variant="secondary"
            disabled={isRefreshingDrivers}
            style={{
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: isRefreshingDrivers ? 'wait' : 'pointer',
              opacity: isRefreshingDrivers ? 0.75 : 1,
            }}
            onClick={handleRefreshDrivers}
            title={t('delivery_reps.van_sales_admin_management_page.s23', "تحديث قائمة المناديب من السيرفر")}
          >
            <RefreshCwIcon
              size={13}
              className={isRefreshingDrivers ? 'spin-animation' : undefined}
              style={isRefreshingDrivers ? { animation: 'spin 0.75s linear infinite' } : undefined}
            />
            {isRefreshingDrivers ? t('delivery_reps.van_sales_admin_management_page.s24', "جارٍ التحديث...") : t('delivery_reps.van_sales_admin_management_page.s25', "تحديث")}
          </Button>
        </div>
      </div>

      {/* Drivers Table */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          overflowX: 'auto',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        {isRepsLoading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontWeight: 700 }}>
            {t('delivery_reps.van_sales_admin_management_page.s26', "جاري تحميل بيانات المناديب...")}
          </div>
        ) : filteredDrivers.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>
            {t('delivery_reps.van_sales_admin_management_page.s27', "لا يوجد مناديب توزيع فان مسجلين حالياً. انقر على \"+ إضافة مندوب فان جديد\" لإنشاء حساب ميداني.")}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s28', "اسم المندوب")}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s29', "نوع التكليف")}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s30', "رقم الهاتف")}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s31', "المركبة الحالية")}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s32', "رمز الدخول (PIN)")}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s33', "الحالة")}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_sales_admin_management_page.s34', "الإجراءات")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map((d) => {
                const isBoth = d.rep_type === 'both';
                return (
                  <tr key={d.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13.5px' }}>{d.name}</div>
                      {d.full_name && (
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{d.full_name}</div>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {isBoth ? (
                        <span style={{ fontSize: '11px', color: '#6d28d9', background: '#ede9fe', padding: '2px 8px', borderRadius: '6px', border: '1px solid #ddd6fe', fontWeight: 700 }}>
                          {t('delivery_reps.van_sales_admin_management_page.s35', "شامل (فان ودليفري)")}
                        </span>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#0369a1', background: '#e0f2fe', padding: '2px 8px', borderRadius: '6px', border: '1px solid #bae6fd', fontWeight: 700 }}>
                          {t('delivery_reps.van_sales_admin_management_page.s36', "توزيع فان حصري")}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', direction: 'ltr', textAlign: 'right', fontFamily: 'monospace', fontSize: '12px' }}>
                      {d.phone || <span style={{ color: '#dc2626' }}>{t('delivery_reps.van_sales_admin_management_page.s37', "غير مسجل")}</span>}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {d.vehicle_plate ? (
                        <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#334155', padding: '2px 7px', borderRadius: '4px', border: '1px solid #e2e8f0', fontWeight: 700 }}>
                          {t('delivery_reps.van_sales_admin_management_page.s38', "لوحة:")} {d.vehicle_plate}
                        </span>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t('delivery_reps.van_sales_admin_management_page.s39', "بدون لوحة مسندة")}</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {(() => {
                        const hasPin = Boolean(d.has_pin || (d as any).hasPin || (d as any).pin_hash || d.pin_code);
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
                              fontSize: '11.5px',
                            }}
                          >
                            {hasPin ? t('delivery_reps.van_sales_admin_management_page.s40', "•••• مفعل") : t('delivery_reps.van_sales_admin_management_page.s41', "بدون رمز")}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: d.is_active ? '#ecfdf5' : '#fef2f2',
                          color: d.is_active ? '#065f46' : '#991b1b',
                          border: `1px solid ${d.is_active ? '#a7f3d0' : '#fecaca'}`,
                        }}
                      >
                        {d.is_active ? t('delivery_reps.van_sales_admin_management_page.s42', "نشط") : t('delivery_reps.van_sales_admin_management_page.s43', "موقوف")}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Button
                          variant="secondary"
                          style={{ fontSize: '11px', padding: '4px 10px', fontWeight: 600 }}
                          onClick={() => {
                            setEditingRep(d);
                            setIsUpsertRepOpen(true);
                          }}
                        >
                          {t('delivery_reps.van_sales_admin_management_page.s44', "تعديل البيانات")}
                        </Button>
                        <Button
                          variant="secondary"
                          title={t('delivery_reps.van_sales_admin_management_page.s45', "نسخ بيانات الدخول لإرسالها للمندوب عبر الواتساب")}
                          style={{ fontSize: '11px', padding: '4px 8px', background: '#f8fafc', color: '#1e293b' }}
                          onClick={() => copyCredentials(d)}
                        >
                          <CopyIcon size={12} /> {t('delivery_reps.van_sales_admin_management_page.s46', "نسخ بيانات الدخول")}
                        </Button>
                        <Button
                          variant="secondary"
                          style={{
                            fontSize: '11px',
                            padding: '4px 8px',
                            background: d.is_active ? '#fff1f2' : '#f0fdf4',
                            color: d.is_active ? '#b91c1c' : '#15803d',
                            border: `1px solid ${d.is_active ? '#fecdd3' : '#bbf7d0'}`,
                            fontWeight: 700,
                          }}
                          onClick={() => handleToggleActive(d)}
                        >
                          {d.is_active ? t('delivery_reps.van_sales_admin_management_page.s47', "إيقاف") : t('delivery_reps.van_sales_admin_management_page.s48', "تفعيل")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
