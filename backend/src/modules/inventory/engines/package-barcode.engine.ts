/**
 * Pure calculation & validation engine for Pack-in-Pack & Pallet Hierarchies.
 * Fully isolated from database and framework dependencies.
 */

export type PackageType = 'pallet' | 'crate' | 'carton' | 'box' | 'unit';
export type PackageStatus = 'sealed' | 'opened' | 'shipped' | 'consumed';

export interface PackageHierarchyNode {
  id: string;
  packageNumber: string;
  packageType: PackageType;
  status: PackageStatus;
  grossWeightKg?: number;
  items: Array<{
    productId: number;
    productName?: string;
    quantity: number;
    unitName?: string;
  }>;
  children?: PackageHierarchyNode[];
}

const HIERARCHY_RANKS: Record<PackageType, number> = {
  pallet: 4,
  crate: 3,
  carton: 2,
  box: 2,
  unit: 1,
};

/**
 * Validates whether childType can be packed inside parentType.
 * Higher rank can contain equal or lower rank (e.g., Pallet rank 4 can contain Box rank 2).
 * Lower rank cannot contain higher rank (e.g., Box cannot contain Pallet).
 */
export function validatePackageHierarchy(
  parentType: PackageType,
  childType: PackageType,
): {
  valid: boolean;
  reason?: string;
} {
  const parentRank = HIERARCHY_RANKS[parentType] || 0;
  const childRank = HIERARCHY_RANKS[childType] || 0;

  if (childRank > parentRank) {
    return {
      valid: false,
      reason: `لا يمكن تعبئة مستوى أعلى (${childType}) داخل مستوى أدنى (${parentType})`,
    };
  }

  if (parentType === 'box' && childType === 'box') {
    return {
      valid: true, // nested sub-boxes are allowed in enterprise packaging
    };
  }

  return { valid: true };
}

/**
 * Calculates total gross weight for a package:
 * Tare weight + Direct items weight + All nested children gross weights
 */
export function calculatePackageGrossWeight(
  tareWeightKg: number,
  items: Array<{ quantity: number; unitWeightKg?: number }>,
  childPackagesGrossWeightKg: number[] = [],
): number {
  const safeTare = Math.max(0, Number(tareWeightKg) || 0);
  const itemsWeight = items.reduce((sum, item) => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const w = Math.max(0, Number(item.unitWeightKg) || 0);
    return sum + qty * w;
  }, 0);

  const childrenWeight = childPackagesGrossWeightKg.reduce((sum, w) => sum + Math.max(0, Number(w) || 0), 0);

  return Math.round((safeTare + itemsWeight + childrenWeight) * 1000) / 1000;
}

/**
 * Recursively flattens an entire package tree to summarize total quantities per product
 */
export function flattenPackageContents(
  root: PackageHierarchyNode,
): Array<{ productId: number; productName?: string; totalQuantity: number }> {
  const productMap = new Map<number, { name?: string; qty: number }>();

  function traverse(node: PackageHierarchyNode) {
    for (const item of node.items || []) {
      const current = productMap.get(item.productId) || { name: item.productName, qty: 0 };
      current.qty += Number(item.quantity) || 0;
      if (!current.name && item.productName) {
        current.name = item.productName;
      }
      productMap.set(item.productId, current);
    }

    for (const child of node.children || []) {
      traverse(child);
    }
  }

  traverse(root);

  return Array.from(productMap.entries()).map(([productId, data]) => ({
    productId,
    productName: data.name,
    totalQuantity: Math.round(data.qty * 10000) / 10000,
  }));
}

/**
 * Validates unpack or de-nest operations
 */
export function validateUnpackAction(
  status: PackageStatus,
  action: 'unpack_all' | 'remove_item' | 'remove_child_package',
): { allowed: boolean; reason?: string } {
  if (status === 'shipped') {
    return {
      allowed: false,
      reason: 'لا يمكن تفكيك أو تعديل طرد تم شحنه للعميل بالفعل',
    };
  }

  if (status === 'consumed') {
    return {
      allowed: false,
      reason: 'الطرد مستهلك ومفرغ بالكامل بالفعل',
    };
  }

  return { allowed: true };
}
