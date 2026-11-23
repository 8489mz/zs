import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { ReactNode } from 'react';

const TRADE_CATEGORY_ALIASES: Record<string, string> = {
  civil: 'civil_concrete',
  concrete: 'civil_concrete',
  finishes: 'finishing_decor',
  doors_windows_facades: 'doors_windows_aluminum',
  doors_windows: 'doors_windows_aluminum',
  electrical: 'electrical_lighting',
  elv: 'smart_elv_systems',
  plumbing: 'plumbing_sanitary',
  hvac: 'hvac_mechanical',
  fire: 'fire_fighting',
  infrastructure: 'site_infrastructure',
};

export function normalizeTradeCategory(cat?: string | null): string {
  if (!cat) return '';
  const trimmed = cat.trim();
  return TRADE_CATEGORY_ALIASES[trimmed] || trimmed;
}

export interface SectorDef {
  id: string;
  name: string;
  tradeCategories: string[];
  icon: (props: any) => ReactNode;
}

export const SECTORS: SectorDef[] = [
  {
    id: 'all',
    name: 'كافة القطاعات والتخصصات',
    tradeCategories: [],
    icon: AppIcons.Layers,
  },
  {
    id: 'civil_structural',
    name: 'الإنشائي والمدني',
    tradeCategories: ['site_mobilization', 'civil_concrete', 'civil', 'concrete', 'masonry_insulation', 'steel_structure'],
    icon: AppIcons.Building,
  },
  {
    id: 'architectural',
    name: 'التشطيبات والمعماري',
    tradeCategories: ['finishing_decor', 'finishes', 'doors_windows_aluminum', 'doors_windows_facades', 'doors_windows'],
    icon: AppIcons.Edit,
  },
  {
    id: 'mep',
    name: 'الكهروميكانيك MEP',
    tradeCategories: ['electrical_lighting', 'electrical', 'smart_elv_systems', 'elv', 'plumbing_sanitary', 'plumbing', 'hvac_mechanical', 'hvac', 'fire_fighting', 'fire'],
    icon: AppIcons.Tool,
  },
  {
    id: 'infrastructure',
    name: 'الموقع العام واللاندسكيب',
    tradeCategories: ['site_infrastructure', 'infrastructure'],
    icon: AppIcons.Truck,
  },
];

export const TRADE_ICONS: Record<string, (props: any) => ReactNode> = {
  site_mobilization: AppIcons.Truck,
  civil_concrete: AppIcons.Building,
  masonry_insulation: AppIcons.Layers,
  steel_structure: AppIcons.Package,
  finishing_decor: AppIcons.Edit,
  doors_windows_aluminum: AppIcons.Warehouse,
  electrical_lighting: AppIcons.Sliders,
  smart_elv_systems: AppIcons.Sliders,
  plumbing_sanitary: AppIcons.Tool,
  hvac_mechanical: AppIcons.RefreshCw,
  fire_fighting: AppIcons.ShieldCheck,
  site_infrastructure: AppIcons.Globe,
};
