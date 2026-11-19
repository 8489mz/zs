// Multi-zone dining tabs + canvas/grid view-mode switcher.
// Pure move; the dialog keeps all state and mounts this component
// with the zone and view-mode values and callbacks.

import { useTranslation } from 'react-i18next';
import type { RestaurantTableZone } from '@/features/pos/api/restaurant-advanced-fnb.api';

export interface PosFloorZoneBarProps {
  setSelectedZone: React.Dispatch<React.SetStateAction<string>>;
  selectedZone: string;
  defaultTables: string[];
  zones: RestaurantTableZone[];
  getZoneDisplayName: (z: { zone_code?: string; name: string }) => string;
  setFloorViewMode: React.Dispatch<React.SetStateAction<'canvas' | 'grid'>>;
  floorViewMode: 'canvas' | 'grid';
}

export function PosFloorZoneBar({
  setSelectedZone,
  selectedZone,
  defaultTables,
  zones,
  getZoneDisplayName,
  setFloorViewMode,
  floorViewMode,
}: PosFloorZoneBarProps) {
  const { t: __t } = useTranslation();
  return (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#475569', marginLeft: '4px' }}>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s36', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s36', "أجنحة الصالة:"))}</span>
                <button
                  type="button"
                  onClick={() => setSelectedZone('all')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    border: selectedZone === 'all' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                    background: selectedZone === 'all' ? '#170e5e' : '#fff',
                    color: selectedZone === 'all' ? '#fff' : '#334155',
                    cursor: 'pointer',
                  }}
                >
                  {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s37', 'كافة الطاولات')} ({defaultTables.length})
                </button>
                {zones.map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => setSelectedZone(z.zone_code)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 700,
                      border: selectedZone === z.zone_code ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                      background: selectedZone === z.zone_code ? '#170e5e' : '#fff',
                      color: selectedZone === z.zone_code ? '#fff' : '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    {getZoneDisplayName(z)}
                  </button>
                ))}
              </div>

              {/* View Switcher: 2D Visual Floor Canvas vs Quick Grid */}
              <div style={{ display: 'flex', gap: '3px', background: '#f1f5f9', padding: '3px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  onClick={() => setFloorViewMode('canvas')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '5px',
                    border: 'none',
                    background: floorViewMode === 'canvas' ? '#170e5e' : 'transparent',
                    color: floorViewMode === 'canvas' ? '#ffffff' : '#475569',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s38', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s38', "مخطط الصالة 2D"))}
                </button>
                <button
                  type="button"
                  onClick={() => setFloorViewMode('grid')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '5px',
                    border: 'none',
                    background: floorViewMode === 'grid' ? '#170e5e' : 'transparent',
                    color: floorViewMode === 'grid' ? '#ffffff' : '#475569',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s39', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s39', "شبكة الطاولات"))}
                </button>
              </div>
            </div>
  );
}
