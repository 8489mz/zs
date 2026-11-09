import { http } from '@/lib/http';
import { unwrapArray } from '@/lib/api/contracts';

export interface Addon {
  id?: number | string;
  name: string;
  price: number;
  costPrice?: number;
  isActive?: boolean;
}

export interface ModifierOption {
  id?: number;
  groupId?: number;
  name: string;
  nameEn?: string;
  price: number;
  costPrice?: number;
  isDefault?: boolean;
  isActive?: boolean;
  displayOrder?: number;
  componentProductId?: number | null;
  componentProductName?: string | null;
  consumptionQty?: number | null;
  unitName?: string | null;
}

export interface ModifierGroup {
  id: number;
  name: string;
  nameEn?: string;
  selectionType: 'single' | 'multiple';
  isMandatory: boolean;
  minSelections: number;
  maxSelections: number;
  displayOrder: number;
  isActive: boolean;
  // Optional: fixtures and older cached payloads may omit it; the
  // backend always returns it (addons.service listModifierGroups).
  isSplittableInHalf?: boolean;
  options: ModifierOption[];
}

export const addonsApi = {
  list: async () => unwrapArray<Addon>(await http<Addon[] | { addons: Addon[] }>('/api/addons'), 'addons'),
  create: (payload: Omit<Addon, 'id'>) => http<Addon>('/api/addons', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id: string | number, payload: Partial<Addon>) => http<Addon>(`/api/addons/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  remove: (id: string | number) => http<{ ok: boolean }>(`/api/addons/${id}`, { method: 'DELETE' }),

  // Modifier Groups & Combos
  listModifierGroups: async () => unwrapArray<ModifierGroup>(await http<{ groups: ModifierGroup[] }>('/api/addons/modifier-groups'), 'groups'),
  createModifierGroup: (payload: any) => http<{ ok: boolean; id: number }>('/api/addons/modifier-groups', { method: 'POST', body: JSON.stringify(payload) }),
  updateModifierGroup: (id: number, payload: any) => http<{ ok: boolean }>(`/api/addons/modifier-groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteModifierGroup: (id: number) => http<{ ok: boolean }>(`/api/addons/modifier-groups/${id}`, { method: 'DELETE' }),
  getProductModifiers: async (productId: number) => unwrapArray<ModifierGroup>(await http<{ groups: ModifierGroup[] }>(`/api/addons/products/${productId}/modifiers`), 'groups'),
  linkProductModifiers: (productId: number, groupIds: number[]) => http<{ ok: boolean }>(`/api/addons/products/${productId}/modifiers`, { method: 'POST', body: JSON.stringify({ groupIds }) }),
};
