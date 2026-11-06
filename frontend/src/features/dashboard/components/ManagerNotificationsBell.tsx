import { useTranslation } from 'react-i18next';
import { CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useManagerActions } from '@/features/dashboard/hooks/useManagerActions';
import { importantManagerActions } from '@/features/dashboard/lib/manager-actions-ui';
import { useOfflineUpdateCheck } from '@/shared/hooks/use-offline-update-check';
import { RefreshCwIcon, BellIcon, BellOffIcon } from '@/shared/components/icons/AppIcons';
import { isAudioChimeEnabled, playNotificationChime, setAudioChimeEnabled } from '@/lib/audio-chime';

function formatCompactAlert(alert: { title: string; message: string; domain: string; severity: string; metrics?: Record<string, unknown> }) {
  let mainLabel = alert.title;
  let statusDetail = alert.message;

  if (alert.message && alert.message.includes(':')) {
    const colonIdx = alert.message.indexOf(':');
    const namePart = alert.message.substring(0, colonIdx).trim();
    const detailPart = alert.message.substring(colonIdx + 1).trim();
    if (namePart) {
      mainLabel = namePart;
      if (alert.title === 'نفد المخزون' || (alert.metrics && Number(alert.metrics.stockQty) <= 0) || detailPart.includes('الكمية الحالية صفر')) {
        statusDetail = 'الرصيد: 0';
      } else if (alert.metrics?.stockQty != null && alert.metrics?.minStockQty != null) {
        statusDetail = `متبقي ${alert.metrics.stockQty} (الحد ${alert.metrics.minStockQty})`;
      } else {
        statusDetail = detailPart;
      }
    }
  } else if (alert.title && alert.message) {
    mainLabel = alert.message;
    statusDetail = alert.title;
  }

  return { mainLabel, statusDetail };
}

export function ManagerNotificationsBell() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const [soundEnabled, setSoundEnabled] = useState(isAudioChimeEnabled);
  const previousCountRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const managerActions = useManagerActions(30);
  const { data: updateInfo } = useOfflineUpdateCheck('desktop');
  const importantActions = importantManagerActions(managerActions.data?.insights || []);
  const hasUpdate = Boolean(updateInfo?.updateAvailable && updateInfo.latestVersion);
  const badgeCount = importantActions.length + (hasUpdate ? 1 : 0);
  const compactCount = 7;

  useEffect(() => {
    if (previousCountRef.current !== null && badgeCount > previousCountRef.current) {
      playNotificationChime();
    }
    previousCountRef.current = badgeCount;
  }, [badgeCount]);

  const vanSuspicionCount = importantActions.filter((a) => a.domain === 'van_suspicion').length;
  const onlineOrdersCount = importantActions.filter((a) => a.domain === 'online_orders').length;
  const inventoryCount = importantActions.filter((a) => a.domain === 'inventory' || a.domain === 'products').length;
  const pharmacyCount = importantActions.filter((a) => a.domain === 'pharmacy_expiry').length;
  const installmentsCount = importantActions.filter((a) => a.domain === 'installments').length;
  const customersCount = importantActions.filter((a) => a.domain === 'customers').length;
  const salesCount = importantActions.filter((a) => a.domain === 'sales').length;
  const accountsCount = importantActions.filter((a) => a.domain === 'accounts' || a.domain === 'purchases').length;

  const filteredAlerts = selectedDomain === 'all'
    ? importantActions
    : importantActions.filter((a) => {
        if (selectedDomain === 'van_suspicion') return a.domain === 'van_suspicion';
        if (selectedDomain === 'online_orders') return a.domain === 'online_orders';
        if (selectedDomain === 'inventory') return a.domain === 'inventory' || a.domain === 'products';
        if (selectedDomain === 'pharmacy_expiry') return a.domain === 'pharmacy_expiry';
        if (selectedDomain === 'installments') return a.domain === 'installments';
        if (selectedDomain === 'customers') return a.domain === 'customers';
        if (selectedDomain === 'sales') return a.domain === 'sales';
        if (selectedDomain === 'accounts') return a.domain === 'accounts' || a.domain === 'purchases';
        return true;
      });

  const shouldShowExpand = filteredAlerts.length > compactCount;
  const visibleAlerts = showAllAlerts ? filteredAlerts : filteredAlerts.slice(0, compactCount);

  const updateMenuPosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportPadding = 16;
    const menuWidth = Math.min(440, window.innerWidth - (viewportPadding * 2));
    const left = Math.min(
      Math.max(viewportPadding, rect.right - menuWidth),
      window.innerWidth - menuWidth - viewportPadding,
    );

    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      left,
      width: menuWidth,
      zIndex: 1000,
      visibility: 'visible',
    });
  }, []);

  useEffect(() => {
    setIsOpen(false);
    setShowAllAlerts(false);
  }, [location.pathname]);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    updateMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsOpen(false);
        setShowAllAlerts(false);
      }
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setShowAllAlerts(false);
      }
    };

    const handleReposition = () => updateMenuPosition();

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const handleCenterAction = () => {
    setIsOpen(false);
    setShowAllAlerts(false);

    const scrollToDecisionCenter = () => {
      const target = document.getElementById('manager-decision-center');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    if (location.pathname !== '/') {
      navigate('/#manager-decision-center');
      window.setTimeout(scrollToDecisionCenter, 150);
      return;
    }

    if (location.hash !== '#manager-decision-center') {
      navigate('/#manager-decision-center', { replace: true });
    }
    window.setTimeout(scrollToDecisionCenter, 50);
  };

  const menu = isOpen ? (
    <div
      role="dialog"
      aria-label={t('dashboard.manager_notifications_bell.s0', "تنبيهات النظام")}
      ref={menuRef}
      style={{
        ...menuStyle,
        background: '#ffffff',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 18px 40px rgba(15, 23, 42, 0.12), 0 4px 12px rgba(0, 0, 0, 0.04)',
        padding: '16px',
        direction: 'rtl',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <strong style={{ fontSize: '0.98rem', fontWeight: 800, color: '#0f172a' }}>
            {t('dashboard.manager_notifications_bell.s1', "تنبيهات النظام")}
          </strong>
          {badgeCount > 0 ? (
            <span style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fee2e2', fontSize: '0.75rem', fontWeight: 800, padding: '2px 8px', borderRadius: '12px' }}>
              {badgeCount}
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              setAudioChimeEnabled(next);
            }}
            title={soundEnabled ? t('dashboard.manager_notifications_bell.s2', "صوت التنبيهات: مفعّل (اضغط للكتم)") : t('dashboard.manager_notifications_bell.s3', "صوت التنبيهات: صامت (اضغط للتشغيل)")}
            style={{
              background: soundEnabled ? '#eff6ff' : '#f1f5f9',
              border: soundEnabled ? '1px solid #bfdbfe' : '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '2px 8px',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {soundEnabled ? <BellIcon size={13} color="#1e40af" /> : <BellOffIcon size={13} color="#64748b" />}
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: soundEnabled ? '#1e40af' : '#64748b' }}>
              {soundEnabled ? t('dashboard.manager_notifications_bell.s4', "صوت") : t('dashboard.manager_notifications_bell.s5', "صامت")}
            </span>
          </button>
          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
            {badgeCount ? `${badgeCount} تنبيه بحاجة لمتابعة` : t('dashboard.manager_notifications_bell.s6', "الكل مستقر ومحدث")}
          </span>
        </div>
      </div>

      {/* Pinned System Update Notification */}
      {hasUpdate && (
        <div
          style={{
            padding: '10px 14px',
            background: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)',
            color: '#ffffff',
            borderRadius: '10px',
            marginBottom: '10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            boxShadow: '0 3px 10px rgba(6, 95, 70, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
          }}
          onClick={() => {
            setIsOpen(false);
            navigate('/updates');
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RefreshCwIcon size={18} color="#ffffff" />
            <div>
              <div style={{ fontWeight: 800, fontSize: '12.5px', color: '#ffffff' }}>{t('dashboard.manager_notifications_bell.s7', "تحديث جديد للمنظومة (v")}{updateInfo?.latestVersion})</div>
              <div style={{ fontSize: '10.5px', color: '#a7f3d0', marginTop: 1 }}>{t('dashboard.manager_notifications_bell.s8', "اضغط هنا للانتقال لصفحة الترقية وتطبيق التحديث")}</div>
            </div>
          </div>
          <span style={{ fontSize: '11px', fontWeight: 800, background: '#10b981', color: '#ffffff', padding: '3px 9px', borderRadius: '6px', whiteSpace: 'nowrap' }}>{t('dashboard.manager_notifications_bell.s9', "ترقية الآن")}</span>
        </div>
      )}

      {/* Category Tabs */}
      {badgeCount > 0 && (
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '6px', marginBottom: '10px' }}>
          <button
            type="button"
            onClick={() => setSelectedDomain('all')}
            style={{
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 700,
              borderRadius: '6px',
              border: selectedDomain === 'all' ? '1px solid #0f172a' : '1px solid #e2e8f0',
              background: selectedDomain === 'all' ? '#0f172a' : '#f8fafc',
              color: selectedDomain === 'all' ? '#ffffff' : '#475569',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t('dashboard.manager_notifications_bell.s10', "الكل (")}{badgeCount})
          </button>

          {vanSuspicionCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDomain('van_suspicion')}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: selectedDomain === 'van_suspicion' ? '1px solid #991b1b' : '1px solid #fecaca',
                background: selectedDomain === 'van_suspicion' ? '#991b1b' : '#fef2f2',
                color: selectedDomain === 'van_suspicion' ? '#ffffff' : '#dc2626',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('dashboard.manager_notifications_bell.s11', "رادار المناديب (")}{vanSuspicionCount})
            </button>
          )}

          {onlineOrdersCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDomain('online_orders')}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: selectedDomain === 'online_orders' ? '1px solid #0f172a' : '1px solid #e2e8f0',
                background: selectedDomain === 'online_orders' ? '#0f172a' : '#eff6ff',
                color: selectedDomain === 'online_orders' ? '#ffffff' : '#1d4ed8',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {t('dashboard.manager_notifications_bell.s12', "طلبات المتجر (")}{onlineOrdersCount})
            </button>
          )}

          {inventoryCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDomain('inventory')}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: selectedDomain === 'inventory' ? '1px solid #0f172a' : '1px solid #e2e8f0',
                background: selectedDomain === 'inventory' ? '#0f172a' : '#f8fafc',
                color: selectedDomain === 'inventory' ? '#ffffff' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {t('dashboard.manager_notifications_bell.s13', "المخزون (")}{inventoryCount})
            </button>
          )}

          {pharmacyCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDomain('pharmacy_expiry')}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: selectedDomain === 'pharmacy_expiry' ? '1px solid #0f172a' : '1px solid #e2e8f0',
                background: selectedDomain === 'pharmacy_expiry' ? '#0f172a' : '#fef2f2',
                color: selectedDomain === 'pharmacy_expiry' ? '#ffffff' : '#b91c1c',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {t('dashboard.manager_notifications_bell.s14', "صلاحية الأدوية (")}{pharmacyCount})
            </button>
          )}

          {installmentsCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDomain('installments')}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: selectedDomain === 'installments' ? '1px solid #0f172a' : '1px solid #e2e8f0',
                background: selectedDomain === 'installments' ? '#0f172a' : '#fffbeb',
                color: selectedDomain === 'installments' ? '#ffffff' : '#b45309',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {t('dashboard.manager_notifications_bell.s15', "الأقساط (")}{installmentsCount})
            </button>
          )}

          {customersCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDomain('customers')}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: selectedDomain === 'customers' ? '1px solid #0f172a' : '1px solid #e2e8f0',
                background: selectedDomain === 'customers' ? '#0f172a' : '#f8fafc',
                color: selectedDomain === 'customers' ? '#ffffff' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {t('dashboard.manager_notifications_bell.s16', "العملاء (")}{customersCount})
            </button>
          )}

          {salesCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDomain('sales')}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: selectedDomain === 'sales' ? '1px solid #0f172a' : '1px solid #e2e8f0',
                background: selectedDomain === 'sales' ? '#0f172a' : '#f8fafc',
                color: selectedDomain === 'sales' ? '#ffffff' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {t('dashboard.manager_notifications_bell.s17', "المبيعات (")}{salesCount})
            </button>
          )}

          {accountsCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDomain('accounts')}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: selectedDomain === 'accounts' ? '1px solid #0f172a' : '1px solid #e2e8f0',
                background: selectedDomain === 'accounts' ? '#0f172a' : '#f8fafc',
                color: selectedDomain === 'accounts' ? '#ffffff' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {t('dashboard.manager_notifications_bell.s18', "المالية (")}{accountsCount})
            </button>
          )}
        </div>
      )}

      {/* Alerts List */}
      {visibleAlerts.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: showAllAlerts ? '380px' : '260px', overflowY: 'auto', paddingRight: '2px', paddingLeft: '2px' }}>
          {visibleAlerts.map((alert) => {
            const isDanger = alert.severity === 'danger';
            const isWarning = alert.severity === 'warning';
            const { mainLabel, statusDetail } = formatCompactAlert(alert);

            return (
              <Link
                key={alert.id}
                to={alert.actionHref}
                title={`${mainLabel} (${statusDetail})`}
                onClick={() => {
                  setIsOpen(false);
                  setShowAllAlerts(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: isDanger ? '1px solid #fee2e2' : isWarning ? '1px solid #fef3c7' : '1px solid #f1f5f9',
                  background: isDanger ? '#fffaf9' : isWarning ? '#fffdfa' : '#fafafa',
                  textDecoration: 'none',
                  color: '#0f172a',
                  transition: 'all 0.15s ease',
                  overflow: 'hidden',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#cbd5e1';
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.transform = 'translateX(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = isDanger ? '#fee2e2' : isWarning ? '#fef3c7' : '#f1f5f9';
                  e.currentTarget.style.background = isDanger ? '#fffaf9' : isWarning ? '#fffdfa' : '#fafafa';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                {/* Right: Dot + Item Name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1, overflow: 'hidden' }}>
                  <span style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: isDanger ? '#ef4444' : isWarning ? '#f59e0b' : '#3b82f6',
                    flexShrink: 0,
                  }} />

                  <strong style={{
                    fontSize: '0.84rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                  }}>
                    {mainLabel}
                  </strong>
                </div>

                {/* Left: Status Pill Badge & Arrow */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: isDanger ? '#fee2e2' : isWarning ? '#fef3c7' : '#f1f5f9',
                    color: isDanger ? '#dc2626' : isWarning ? '#b45309' : '#475569',
                    border: isDanger ? '1px solid #fca5a5' : isWarning ? '1px solid #fde68a' : '1px solid #e2e8f0',
                    whiteSpace: 'nowrap',
                  }}>
                    {statusDetail}
                  </span>

                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>
                    ←
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '28px 16px', color: '#64748b' }}>
          <strong style={{ display: 'block', fontSize: '0.92rem', color: '#0f172a', marginBottom: '4px' }}>{t('dashboard.manager_notifications_bell.s19', "لا توجد تنبيهات عاجلة")}</strong>
          <span style={{ fontSize: '0.8rem' }}>{t('dashboard.manager_notifications_bell.s20', "جميع العمليات والمخزون في الحدود الطبيعية.")}</span>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        {shouldShowExpand ? (
          <button
            type="button"
            onClick={() => setShowAllAlerts((current) => !current)}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#475569',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '6px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#0f172a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#475569'; }}
          >
            {showAllAlerts ? t('dashboard.manager_notifications_bell.s21', "عرض أقل") : `عرض الكل (${badgeCount})`}
          </button>
        ) : <div />}

        <button
          type="button"
          onClick={handleCenterAction}
          style={{
            border: '1px solid #0f172a',
            background: '#0f172a',
            color: '#ffffff',
            fontSize: '0.8rem',
            fontWeight: 700,
            cursor: 'pointer',
            padding: '6px 14px',
            borderRadius: '6px',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#1e293b'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#0f172a'; }}
        >
          {t('dashboard.manager_notifications_bell.s22', "مركز القرارات ←")}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="manager-notifications" ref={rootRef}>
      <button
        type="button"
        className="manager-notifications-button"
        aria-label={t('dashboard.manager_notifications_bell.s23', "تنبيهات المدير")}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <BellIcon />
        {badgeCount ? <span className="manager-notifications-badge">{badgeCount}</span> : null}
      </button>

      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
