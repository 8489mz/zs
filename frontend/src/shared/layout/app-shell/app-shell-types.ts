export type SidebarGroupDefinition = {
  key: string;
  label: string;
  itemKeys: string[];
  iconKey?: string;
};

export type IconTone = {
  bg: string;
  border: string;
  fg: string;
  glow: string;
};

export const defaultIconTone: IconTone = {
  bg: '#f8fafc',
  border: '#e2e8f0',
  fg: '#475569',
  glow: 'transparent',
};

export const activeIconTone: IconTone = {
  bg: '#eef2ff',
  border: '#c7d2fe',
  fg: '#170e5e',
  glow: 'rgba(23, 14, 94, 0.08)',
};
