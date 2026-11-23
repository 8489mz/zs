import { ShoppingCartIcon, TagIcon, UtensilsIcon, SmartphoneIcon, ShieldCheckIcon, PackageIcon } from '@/shared/components/icons/AppIcons';

export function getActivityIcon(key: string, isSelected: boolean, size = 20) {
  const color = isSelected ? '#170e5e' : '#64748b';
  switch (key) {
    case 'supermarket':
      return <ShoppingCartIcon size={size} color={isSelected ? '#170e5e' : color} />;
    case 'fashion':
      return <TagIcon size={size} color={isSelected ? '#7c3aed' : color} />;
    case 'cafe_restaurant':
      return <UtensilsIcon size={size} color={isSelected ? '#d97706' : color} />;
    case 'electronics_mobile':
      return <SmartphoneIcon size={size} color={isSelected ? '#0284c7' : color} />;
    case 'pharmacy':
      return <ShieldCheckIcon size={size} color={isSelected ? '#16a34a' : color} />;
    default:
      return <PackageIcon size={size} color={color} />;
  }
}
