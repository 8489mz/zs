import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  kdsApi,
  KdsStation,
  KdsItemStatus,
} from '@/features/pos/api/kds.api';
import { ClockIcon } from '@/shared/components/icons/AppIcons';
import { KdsHeader } from '../components/kds/KdsHeader';
import { useIsolatedDisplayLanguage } from '@/features/pos/hooks/useIsolatedDisplayLanguage';
import { KdsKpiStrip } from '../components/kds/KdsKpiStrip';
import { KdsFilterBar } from '../components/kds/KdsFilterBar';
import { KdsStandbyState, KdsDisconnectedState } from '../components/kds/KdsStandbyState';
import { resolveKitchenTicketsState } from '@/features/pos/lib/kds-connection-state';
import { KdsTicketCard } from '../components/kds/KdsTicketCard';
import { Pos86ItemsModal } from '../components/pos-workspace/Pos86ItemsModal';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';
import { useProductsQuery } from '@/shared/hooks/use-catalog-queries';

export function KitchenDisplayPage() {
  const { currentLang, toggleLanguage } = useIsolatedDisplayLanguage('kds_ui_lang');
  const { t: __t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedStation, setSelectedStation] = useState<KdsStation>('all');
  const [selectedOrderType, setSelectedOrderType] = useState<string>('all');
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [is86ModalOpen, setIs86ModalOpen] = useState<boolean>(false);

  const { data: products = [] } = useProductsQuery();

  const { data: items86 = [] } = useQuery({
    queryKey: ['pos-86-items-kds'],
    queryFn: () => restaurantAdvancedFnbApi.get86Items(),
    refetchInterval: 15_000,
  });
  const active86Count = items86.length;

  const handleBack = () => {
    navigate('/displays');
  };

  // Keyboard navigation & Esc listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' ||
        (e.altKey && e.key === 'Backspace') ||
        (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
      ) {
        if (!document.fullscreenElement) {
          handleBack();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  const [lastRecallMessage, setLastRecallMessage] = useState<string | null>(null);
  const previousTicketIdsRef = useRef<Set<number>>(new Set());

  // Web Audio API acoustic chime synthesizer
  const playNewOrderChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);

      osc.start();
      osc.stop(ctx.currentTime + 0.7);
    } catch {
      // Audio context might be restricted before user gesture
    }
  };

  // Clock ticker every second
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('ar-EG', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Query tickets every 5 seconds
  // INV-REST-KDS-LOUD-FAILURE: the error state is read — a failed query
  // used to leave tickets empty and render the calm standby ("all stations
  // ready / no pending orders") as if nothing were wrong.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['kds-tickets', selectedStation, selectedOrderType],
    queryFn: () =>
      kdsApi.getTickets({
        station: selectedStation,
        orderType: selectedOrderType,
      }),
    refetchInterval: 5000,
  });

  const tickets = data?.tickets || [];
  const ticketsState = resolveKitchenTicketsState({ isLoading, isError, ticketCount: tickets.length });
  const stats = data?.stats || {
    pendingCount: 0,
    cookingCount: 0,
    readyCount: 0,
    criticalCount: 0,
    avgPrepMinutes: 0,
  };

  // Chime on new incoming ticket
  useEffect(() => {
    if (!tickets.length) return;
    const currentIds = new Set(tickets.map((t) => t.id));

    if (previousTicketIdsRef.current.size > 0) {
      let hasNewTicket = false;
      for (const id of currentIds) {
        if (!previousTicketIdsRef.current.has(id)) {
          hasNewTicket = true;
          break;
        }
      }
      if (hasNewTicket && soundEnabled) {
        playNewOrderChime();
      }
    }
    previousTicketIdsRef.current = currentIds;
  }, [tickets, soundEnabled]);

  // Mutations
  const advanceMutation = useMutation({
    mutationFn: (ticketId: number) => kdsApi.advanceStatus(ticketId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kds-tickets'] });
    },
  });

  const itemStatusMutation = useMutation({
    mutationFn: (vars: { ticketId: number; itemId: number; status: KdsItemStatus }) =>
      kdsApi.setItemStatus(vars.ticketId, vars.itemId, vars.status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kds-tickets'] });
    },
  });

  const recallMutation = useMutation({
    mutationFn: () => kdsApi.recallLastServed(),
    onSuccess: (res) => {
      if (res?.recalled) {
        setLastRecallMessage('تم استرجاع آخر طلب بنجاح إلى شاشة التجهيز');
        void queryClient.invalidateQueries({ queryKey: ['kds-tickets'] });
        setTimeout(() => setLastRecallMessage(null), 4000);
      } else {
        setLastRecallMessage('لا يوجد طلب مكتمل متاح للاسترجاع حالياً');
        setTimeout(() => setLastRecallMessage(null), 3000);
      }
    },
  });

  const handleToggleFullscreen = () => {
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
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        color: '#0f172a',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 1. Header Bar */}
      <KdsHeader
        currentLang={currentLang}
        onToggleLanguage={toggleLanguage}
        currentTime={currentTime}
        soundEnabled={soundEnabled}
        onToggleSound={() => {
          const next = !soundEnabled;
          setSoundEnabled(next);
          if (next) playNewOrderChime();
        }}
        onRecallLastServed={() => recallMutation.mutate()}
        isRecalling={recallMutation.isPending}
        onToggleFullscreen={handleToggleFullscreen}
        onBack={handleBack}
        onOpen86Modal={() => setIs86ModalOpen(true)}
        active86Count={active86Count}
      />

      {/* 2. Executive Kitchen KPI Strip */}
      <KdsKpiStrip stats={stats} />

      {/* 3. Filter Bar */}
      <KdsFilterBar
        selectedStation={selectedStation}
        onSelectStation={setSelectedStation}
        selectedOrderType={selectedOrderType}
        onSelectOrderType={setSelectedOrderType}
        selectedCourse={selectedCourse}
        onSelectCourse={setSelectedCourse}
      />

      {/* Alert toast for recall or info */}
      {lastRecallMessage && (
        <div
          style={{
            backgroundColor: '#170e5e',
            color: '#ffffff',
            padding: '8px 20px',
            textAlign: 'center',
            fontSize: '13px',
            fontWeight: 800,
            boxShadow: '0 2px 8px rgba(23, 14, 94, 0.2)',
          }}
        >
          {lastRecallMessage}
        </div>
      )}

      {/* 4. Main Tickets Grid or Executive Standby State */}
      <main style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
        {/* Expediter Pass Executive Strip */}
        {selectedStation === 'expo' && ticketsState !== 'disconnected' && (
          <div
            style={{
              background: '#170e5e',
              color: '#ffffff',
              borderRadius: '12px',
              padding: '12px 18px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              boxShadow: '0 3px 8px rgba(23, 14, 94, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  background: '#ffffff',
                  color: '#170e5e',
                  fontSize: '11px',
                  fontWeight: 900,
                  padding: '3px 8px',
                  borderRadius: '5px',
                  letterSpacing: '0.5px',
                }}
              >
                EXPO PASS
              </span>
              <div>
                <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 800 }}>
                  {__t('pos.kitchen_display_page.s0', __t('pos.kitchen_display_page.s0', "محطة منسق التسليم والتجميع المركزي (Kitchen Expediter Pass)"))}
                </h4>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#cbd5e1' }}>
                  {__t('pos.kitchen_display_page.s1', __t('pos.kitchen_display_page.s1', "مراقبة وتجميع كافة أطباق الوجبة عبر المحطات المتعددة (مشويات، ساخن، بار، حلويات) وتسليم الطلب مكتملاً"))}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div
                style={{
                  background: '#16a34a',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>{__t('pos.kitchen_display_page.s2', __t('pos.kitchen_display_page.s2', "مكتمل المحطات وجاهز للتسليم:"))}</span>
                <strong style={{ fontSize: '13px' }}>
                  {tickets.filter((t) => t.items.length > 0 && t.items.every((i) => i.status === 'ready')).length}
                </strong>
              </div>
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>{__t('pos.kitchen_display_page.s3', __t('pos.kitchen_display_page.s3', "قيد التحضير بالمحطات:"))}</span>
                <strong style={{ fontSize: '13px' }}>
                  {tickets.filter((t) => !t.items.every((i) => i.status === 'ready')).length}
                </strong>
              </div>
            </div>
          </div>
        )}

        {ticketsState === 'loading' ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '50vh',
              gap: '12px',
            }}
          >
            <ClockIcon size={36} color="#64748b" />
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#64748b' }}>
              {__t('pos.kitchen_display_page.s4', __t('pos.kitchen_display_page.s4', "جاري مزامنة تذاكر المطبخ النشطة..."))}
            </div>
          </div>
        ) : ticketsState === 'disconnected' ? (
          <KdsDisconnectedState onRetry={() => void refetch()} />
        ) : (
          <>
            {ticketsState === 'stale' && (
              <KdsDisconnectedState variant="banner" onRetry={() => void refetch()} />
            )}
            {ticketsState === 'standby' ? (
              <KdsStandbyState />
            ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: '16px',
              alignItems: 'start',
            }}
          >
            {tickets
              .filter((ticket) => {
                if (selectedCourse === 'all') return true;
                return ticket.course === selectedCourse;
              })
              .map((ticket) => (
                <KdsTicketCard
                  key={ticket.id}
                  ticket={ticket}
                  isExpoMode={selectedStation === 'expo'}
                  onAdvanceStatus={(id) => advanceMutation.mutate(id)}
                  isAdvancing={advanceMutation.isPending}
                  onItemStatusChange={(tId, iId, status) =>
                    itemStatusMutation.mutate({ ticketId: tId, itemId: iId, status })
                  }
                />
              ))}
          </div>
            )}
          </>
        )}
      </main>

      <Pos86ItemsModal
        open={is86ModalOpen}
        onClose={() => setIs86ModalOpen(false)}
        products={products}
      />
    </div>
  );
}

export default KitchenDisplayPage;
