import { useTranslation } from 'react-i18next';
import React from 'react';
import { KdsStation } from '@/features/pos/api/kds.api';

interface KdsFilterBarProps {
  selectedStation: KdsStation;
  onSelectStation: (station: KdsStation) => void;
  selectedOrderType: string;
  onSelectOrderType: (orderType: string) => void;
  selectedCourse?: string;
  onSelectCourse?: (course: string) => void;
}

const STATIONS: { key: KdsStation; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'kitchen', label: 'المطبخ الساخن' },
  { key: 'grill', label: 'المشويات' },
  { key: 'beverages', label: 'المشروبات والبار' },
  { key: 'bakery', label: 'المخبوزات والحلويات' },
  // R4-E I15: products configured 'general' had no pill — any other station
  // filter dropped them entirely, so they were invisible on the KDS.
  { key: 'general', label: 'عام' },
  { key: 'expo', label: 'منسق التسليم (Expo)' },
];

const ORDER_TYPES = [
  { key: 'all', label: 'الكل' },
  { key: 'dine_in', label: 'صالة' },
  { key: 'takeaway', label: 'سفري' },
  { key: 'delivery', label: 'دليفري' },
];

const COURSES = [
  { key: 'all', label: 'كل الأطباق' },
  { key: 'appetizer', label: 'مقبلات' },
  { key: 'main', label: 'أطباق رئيسية' },
  { key: 'dessert', label: 'حلويات' },
];

export const KdsFilterBar: React.FC<KdsFilterBarProps> = ({
  selectedStation,
  onSelectStation,
  selectedOrderType,
  onSelectOrderType,
  selectedCourse = 'all',
  onSelectCourse,
}) => {
  const { t } = useTranslation();
  return (
    <div
      style={{
        backgroundColor: '#f8fafc',
        borderBottom: '1px solid #e2e8f0',
        padding: '8px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
      }}
    >
      {/* Station Filter Pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b' }}>{t('pos.kds.kds_filter_bar.s0', "المحطة:")}</span>
        {STATIONS.map((s) => {
          const isActive = selectedStation === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelectStation(s.key)}
              style={{
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                border: `1px solid ${isActive ? '#170e5e' : '#cbd5e1'}`,
                backgroundColor: isActive ? '#170e5e' : '#ffffff',
                color: isActive ? '#ffffff' : '#334155',
                boxShadow: isActive ? '0 2px 6px rgba(23, 14, 94, 0.2)' : 'none',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Course Filter Pills */}
      {onSelectCourse && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b' }}>{t('pos.kds.kds_filter_bar.s1', "المسار:")}</span>
          {COURSES.map((c) => {
            const isActive = selectedCourse === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onSelectCourse(c.key)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: `1px solid ${isActive ? '#170e5e' : '#cbd5e1'}`,
                  backgroundColor: isActive ? '#170e5e' : '#ffffff',
                  color: isActive ? '#ffffff' : '#334155',
                  boxShadow: isActive ? '0 2px 6px rgba(23, 14, 94, 0.2)' : 'none',
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Order Type Filter Pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b' }}>{t('pos.kds.kds_filter_bar.s2', "النوع:")}</span>
        {ORDER_TYPES.map((ot) => {
          const isActive = selectedOrderType === ot.key;
          return (
            <button
              key={ot.key}
              type="button"
              onClick={() => onSelectOrderType(ot.key)}
              style={{
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                border: `1px solid ${isActive ? '#170e5e' : '#cbd5e1'}`,
                backgroundColor: isActive ? '#170e5e' : '#ffffff',
                color: isActive ? '#ffffff' : '#334155',
                boxShadow: isActive ? '0 2px 6px rgba(23, 14, 94, 0.2)' : 'none',
              }}
            >
              {ot.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
