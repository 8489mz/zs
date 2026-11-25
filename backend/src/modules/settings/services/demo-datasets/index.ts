import { DemoActivityDataset } from './types';
import { supermarketDataset } from './supermarket.dataset';
import { fashionDataset } from './fashion.dataset';
import { cafeDataset } from './cafe.dataset';
import { electronicsDataset } from './electronics.dataset';
import { pharmacyDataset } from './pharmacy.dataset';

export * from './types';

export const DEMO_DATASETS: Record<string, DemoActivityDataset> = {
  supermarket: supermarketDataset,
  fashion: fashionDataset,
  cafe_restaurant: cafeDataset,
  electronics_mobile: electronicsDataset,
  pharmacy: pharmacyDataset,
};

export function getDemoDataset(activityKey?: string): DemoActivityDataset {
  const key = String(activityKey || 'supermarket')
    .trim()
    .toLowerCase();
  return DEMO_DATASETS[key] || supermarketDataset;
}

export function mapIndustryToDemoActivity(industry?: string): string {
  const norm = String(industry || '')
    .trim()
    .toLowerCase();
  switch (norm) {
    case 'restaurant':
    case 'cafe':
    case 'cafe_restaurant':
      return 'cafe_restaurant';
    case 'fashion':
    case 'clothing':
      return 'fashion';
    case 'electronics':
    case 'electronics_mobile':
    case 'maintenance':
    case 'services':
      return 'electronics_mobile';
    case 'pharmacy':
      return 'pharmacy';
    case 'supermarket':
    case 'retail':
    case 'wholesale':
    default:
      return 'supermarket';
  }
}

export function listSupportedDemoActivities() {
  return Object.values(DEMO_DATASETS).map((d) => ({
    key: d.key,
    name: d.name,
    icon: d.icon,
    tagline: d.tagline,
    description: d.description,
    categoriesCount: d.categories.length,
    categoryCount: d.categories.length,
    productsCount: d.products.length,
    productCount: d.products.length,
    sampleItems: d.products.slice(0, 4).map((p) => p.name),
    sampleProducts: d.products.slice(0, 4).map((p) => p.name),
    sampleCategories: d.categories.slice(0, 4),
  }));
}
