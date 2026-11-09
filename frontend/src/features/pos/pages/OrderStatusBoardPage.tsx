import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrderStatusBoard } from '@/features/pos/hooks/useOrderStatusBoard';
import { KdsDisconnectedState } from '@/features/pos/components/kds/KdsStandbyState';
import { DisplayLanguageToggle } from '@/shared/components/DisplayLanguageToggle';
import { useIsolatedDisplayLanguage } from '@/features/pos/hooks/useIsolatedDisplayLanguage';
import { ClockIcon, ArrowRightIcon } from '@/shared/components/icons/AppIcons';

export function OrderStatusBoardPage() {
  const { currentLang, toggleLanguage } = useIsolatedDisplayLanguage('pickup_ui_lang');
  const { t: __t } = useTranslation();
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState<string>('');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const previousReadyIdsRef = useRef<Set<number>>(new Set());
  const [newlyReadyId, setNewlyReadyId] = useState<number | null>(null);

  // Digital clock ticker
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('ar-EG', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Web Audio acoustic chime for order ready
  const playReadyChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      // Double melodic tone: C5 -> G5
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      gain1.gain.setValueAtTime(0.3, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.4);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(783.99, ctx.currentTime + 0.25); // G5
      gain2.gain.setValueAtTime(0.35, ctx.currentTime + 0.25);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.7);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.25);
      osc2.stop(ctx.currentTime + 0.7);
    } catch {
      // Audio playback silently guarded
    }
  };

  // Poll KDS tickets via feature hook
  const { preparingTickets, readyTickets, screenState, refetch } = useOrderStatusBoard();

  // Detect newly ready tickets to trigger acoustic chime
  useEffect(() => {
    const currentReadyIds = new Set(readyTickets.map((t) => t.id));
    if (previousReadyIdsRef.current.size > 0) {
      for (const id of currentReadyIds) {
        if (!previousReadyIdsRef.current.has(id)) {
          if (soundEnabled) playReadyChime();
          setNewlyReadyId(id);
          const t = setTimeout(() => setNewlyReadyId(null), 8000);
          return () => clearTimeout(t);
        }
      }
    }
    previousReadyIdsRef.current = currentReadyIds;
  }, [readyTickets, soundEnabled]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div
      dir="rtl"
      style={{
        width: '100vw',
        height: '100vh',
        background: '#f8fafc',
        color: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Top Header Bar */}
      <header
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          padding: '14px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            type="button"
            onClick={() => navigate('/displays')}
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '7px 14px',
              color: '#334155',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            <ArrowRightIcon size={14} color="#170e5e" />
            <span>{__t('pos.order_status_board_page.s0', __t('pos.order_status_board_page.s0', "بوابة الشاشات"))}</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ width: '4px', height: '24px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
            <div>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em' }}>
                {__t('pos.order_status_board_page.s1', __t('pos.order_status_board_page.s1', "شاشة إعلان جاهزية الطلبات (Pickup & Order Status Board)"))}
              </h1>
              <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                {__t('pos.order_status_board_page.s2', __t('pos.order_status_board_page.s2', "صالة الانتظار والاستلام • نداء حي ولحظي مباشر"))}
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Live Clock Ticker */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '6px 16px',
            }}
          >
            <ClockIcon size={16} color="#170e5e" />
            <span style={{ fontSize: '1.05rem', fontWeight: 900, color: '#170e5e', letterSpacing: '0.04em', fontFamily: 'monospace' }}>
              {currentTime}
            </span>
          </div>

          {/* Sound Toggle */}
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            style={{
              background: soundEnabled ? '#eef2ff' : '#f8fafc',
              border: soundEnabled ? '1px solid #c7d2fe' : '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '7px 14px',
              color: soundEnabled ? '#170e5e' : '#64748b',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: soundEnabled ? '#10b981' : '#94a3b8', display: 'inline-block' }} />
            <span>{soundEnabled ? __t('pos.order_status_board_page.s3', __t('pos.order_status_board_page.s3', "التنبيه الصوتي: مفعل")) : __t('pos.order_status_board_page.s4', __t('pos.order_status_board_page.s4', "التنبيه الصوتي: صامت"))}</span>
          </button>

          <DisplayLanguageToggle currentLang={currentLang} onToggle={toggleLanguage} />

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            style={{
              background: '#170e5e',
              border: 'none',
              borderRadius: '8px',
              padding: '7px 18px',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(23, 14, 94, 0.25)',
            }}
          >
            {__t('pos.order_status_board_page.s5', __t('pos.order_status_board_page.s5', "ملء الشاشة (TV Mode)"))}
          </button>
        </div>
      </header>

      {/* Main Dual Columns Content */}
      <main
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '20px',
          padding: '20px 28px',
          overflow: 'hidden',
        }}
      >
        {/* INV-REST-KDS-LOUD-FAILURE: a failed query never renders the calm
            "no orders" columns — disconnected replaces them, stale banners
            above them. */}
        {screenState === 'disconnected' ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <KdsDisconnectedState onRetry={() => void refetch()} />
          </div>
        ) : (
          <>
            {screenState === 'stale' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <KdsDisconnectedState variant="banner" onRetry={() => void refetch()} />
              </div>
            )}
        {/* COLUMN 1: PREPARING (قيد التجهيز) */}
        <section
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 4px 16px rgba(15, 23, 42, 0.03)',
          }}
        >
          <div
            style={{
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
              <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 900, color: '#0f172a' }}>
                {__t('pos.order_status_board_page.s6', __t('pos.order_status_board_page.s6', "قيد التجهيز (Preparing)"))}
              </h2>
            </div>
            <span
              style={{
                background: '#fef3c7',
                color: '#92400e',
                border: '1px solid #fde68a',
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '0.88rem',
                fontWeight: 800,
              }}
            >
              {preparingTickets.length} {__t('pos.order_status_board_page.s7', __t('pos.order_status_board_page.s7', "قيد التحضير"))}
            </span>
          </div>

          <div
            style={{
              flex: 1,
              padding: '18px',
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '14px',
              alignContent: 'start',
            }}
          >
            {preparingTickets.length === 0 ? (
              <div
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  padding: '90px 20px',
                  color: '#94a3b8',
                  fontSize: '1.15rem',
                  fontWeight: 600,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ClockIcon size={24} color="#f59e0b" />
                </div>
                <span>{__t('pos.order_status_board_page.s8', __t('pos.order_status_board_page.s8', "لا توجد طلبات قيد التحضير حالياً."))}</span>
              </div>
            ) : (
              preparingTickets.map((t) => {
                const orderNum = t.orderNumber || t.docNo || `#${t.id}`;
                return (
                  <div
                    key={t.id}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '12px',
                      padding: '16px 12px',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 2px 6px rgba(15, 23, 42, 0.04)',
                    }}
                  >
                    <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#0f172a', letterSpacing: '0.04em' }}>
                      {orderNum}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
                      {t.tableNumber && (
                        <span style={{ background: '#e2e8f0', color: '#334155', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                          {__t('pos.order_status_board_page.s9', __t('pos.order_status_board_page.s9', "طاولة"))} {t.tableNumber}
                        </span>
                      )}
                      {t.pagerNumber && (
                        <span style={{ background: '#fef3c7', color: '#92400e', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 800 }}>
                          {__t('pos.order_status_board_page.s10', __t('pos.order_status_board_page.s10', "بيجر:"))} {t.pagerNumber}
                        </span>
                      )}
                      {t.aggregatorChannel ? (
                        <span style={{ background: '#fef3c7', color: '#92400e', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 800 }}>
                          {t.aggregatorChannel}
                        </span>
                      ) : (
                        <span style={{ background: '#e2e8f0', color: '#334155', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                          {t.orderType === 'dine_in' ? __t('pos.order_status_board_page.s11', __t('pos.order_status_board_page.s11', "صالة")) : t.orderType === 'takeaway' ? __t('pos.order_status_board_page.s12', __t('pos.order_status_board_page.s12', "سفري")) : __t('pos.order_status_board_page.s13', __t('pos.order_status_board_page.s13', "توصيل"))}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* COLUMN 2: READY FOR PICKUP (جاهز للاستلام) */}
        <section
          style={{
            background: '#ffffff',
            border: '2px solid #10b981',
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 6px 24px rgba(16, 185, 129, 0.08)',
          }}
        >
          <div
            style={{
              background: '#ecfdf5',
              borderBottom: '2px solid #a7f3d0',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 8px #10b981' }} />
              <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 900, color: '#065f46' }}>
                {__t('pos.order_status_board_page.s14', __t('pos.order_status_board_page.s14', "جاهز للاستلام (Ready for Pickup)"))}
              </h2>
            </div>
            <span
              style={{
                background: '#047857',
                color: '#ffffff',
                padding: '4px 14px',
                borderRadius: '20px',
                fontSize: '0.88rem',
                fontWeight: 800,
                border: '1px solid #059669',
              }}
            >
              {readyTickets.length} {__t('pos.order_status_board_page.s15', __t('pos.order_status_board_page.s15', "جاهز"))}
            </span>
          </div>

          <div
            style={{
              flex: 1,
              padding: '18px',
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '14px',
              alignContent: 'start',
            }}
          >
            {readyTickets.length === 0 ? (
              <div
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  padding: '90px 20px',
                  color: '#94a3b8',
                  fontSize: '1.15rem',
                  fontWeight: 600,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#10b981' }} />
                </div>
                <span>{__t('pos.order_status_board_page.s16', __t('pos.order_status_board_page.s16', "بانتظار خروج الوجبات والطلبات من المطبخ..."))}</span>
              </div>
            ) : (
              readyTickets.map((t) => {
                const isPulse = newlyReadyId === t.id;
                const orderNum = t.orderNumber || t.docNo || `#${t.id}`;
                return (
                  <div
                    key={t.id}
                    style={{
                      background: isPulse ? '#dcfce7' : '#f0fdf4',
                      border: isPulse ? '2px solid #10b981' : '1.5px solid #a7f3d0',
                      borderRadius: '12px',
                      padding: '16px 12px',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: isPulse ? '0 0 24px rgba(16, 185, 129, 0.35)' : '0 2px 8px rgba(16, 185, 129, 0.08)',
                      transition: 'all 0.3s ease',
                    }}
                  >
                    <div style={{ fontSize: '2.6rem', fontWeight: 900, color: '#047857', letterSpacing: '0.04em' }}>
                      {orderNum}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
                      {t.tableNumber && (
                        <span style={{ background: '#dcfce7', color: '#065f46', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                          {__t('pos.order_status_board_page.s17', __t('pos.order_status_board_page.s17', "طاولة"))} {t.tableNumber}
                        </span>
                      )}
                      {t.pagerNumber && (
                        <span style={{ background: '#fef3c7', color: '#92400e', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 800, border: '1px solid #fde68a' }}>
                          {__t('pos.order_status_board_page.s18', __t('pos.order_status_board_page.s18', "بيجر:"))} {t.pagerNumber}
                        </span>
                      )}
                      {t.aggregatorChannel ? (
                        <span style={{ background: '#047857', color: '#ffffff', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 800 }}>
                          {t.aggregatorChannel}
                        </span>
                      ) : (
                        <span style={{ background: '#dcfce7', color: '#065f46', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                          {t.orderType === 'dine_in' ? __t('pos.order_status_board_page.s19', __t('pos.order_status_board_page.s19', "صالة")) : t.orderType === 'takeaway' ? __t('pos.order_status_board_page.s20', __t('pos.order_status_board_page.s20', "سفري")) : __t('pos.order_status_board_page.s21', __t('pos.order_status_board_page.s21', "توصيل"))}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
          </>
        )}
      </main>

      {/* Bottom Footer Info */}
      <footer
        style={{
          background: '#ffffff',
          borderTop: '1px solid #e2e8f0',
          padding: '10px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px',
          color: '#64748b',
          fontWeight: 600,
        }}
      >
        <span>{__t('pos.order_status_board_page.s22', __t('pos.order_status_board_page.s22', "يرجى التوجه إلى كاونتر الاستلام فور ظهور رقم طلبك في قائمة «جاهز للاستلام»."))}</span>
        <span>{__t('pos.order_status_board_page.s23', __t('pos.order_status_board_page.s23', "منظومة Z-Systems ERP • شاشة عرض العملاء والتوصيل"))}</span>
      </footer>
    </div>
  );
}
export default OrderStatusBoardPage;
