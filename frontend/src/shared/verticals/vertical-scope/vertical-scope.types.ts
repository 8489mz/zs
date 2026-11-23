export type BusinessVertical =
  | 'maritime'
  | 'contracting'
  | 'wholesale_van'
  | 'warehousing'
  | 'manufacturing'
  | 'restaurant'
  | 'pharmacy'
  | 'maintenance'
  | 'services'
  | 'import_export'
  | 'retail_general';

export interface MobileNavItemConfig {
  to: string;
  label: string;
  iconType: 'home' | 'sales' | 'maritime-jobs' | 'contracting-projects' | 'contracting-invoices' | 'van-sales' | 'manufacturing-orders' | 'pos' | 'inventory' | 'quotations';
  activeMatchPrefixes: string[];
}

export interface MobileBottomNavConfig {
  home: MobileNavItemConfig;
  secondary: MobileNavItemConfig;
  centerActionLabel: string;
  primary: MobileNavItemConfig;
}

export interface MobileQuickActionItem {
  id: string;
  title: string;
  subtitle: string;
  to?: string;
  actionKey?: 'quickProduct' | 'priceChecker';
  bg: string;
  color: string;
  iconType:
    | 'ship'
    | 'container'
    | 'inquiry'
    | 'quotation'
    | 'customer'
    | 'treasury'
    | 'project'
    | 'ipc'
    | 'dailyLog'
    | 'changeOrder'
    | 'supplier'
    | 'truck'
    | 'invoice'
    | 'checker'
    | 'reps'
    | 'gear'
    | 'bom'
    | 'purchase'
    | 'pos'
    | 'product'
    | 'inventory';
}
