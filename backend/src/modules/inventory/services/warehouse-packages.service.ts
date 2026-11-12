import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import {
  CreateWarehousePackageDto,
  UnpackPackageDto,
  UpdatePackageStatusDto,
} from '../dto/warehouse-package.dto';
import {
  calculatePackageGrossWeight,
  flattenPackageContents,
  validatePackageHierarchy,
  validateUnpackAction,
  type PackageHierarchyNode,
} from '../engines/package-barcode.engine';
import {
  releaseLocationStock,
  reserveLocationStock,
} from '../../../common/utils/location-stock-ledger';

@Injectable()
export class WarehousePackagesService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private assertAccess(auth: AuthContext): void {
    if (
      auth.role === 'super_admin' ||
      auth.role === 'admin' ||
      auth.permissions.includes('inventory') ||
      auth.permissions.includes('purchases') ||
      auth.permissions.includes('sales')
    ) {
      return;
    }
    throw new ForbiddenException('Missing required inventory permissions');
  }

  private round3(value: number | string | null | undefined): number {
    return Number((Number(value || 0) + Number.EPSILON).toFixed(3));
  }

  private validatePackageQty(value: unknown, label: string): number {
    const qty = Number(value);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BadRequestException(`${label} must be greater than zero (received ${String(value)})`);
    }
    if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 0.000001) {
      throw new BadRequestException(`${label} must have at most three decimal places (received ${String(value)})`);
    }
    return this.round3(qty);
  }

  private async resolveBranchId(trx: any, tenantId: string, locationId: number | null): Promise<number | null> {
    if (locationId == null) return null;
    const loc = await trx
      .selectFrom('stock_locations')
      .select(['branch_id'])
      .where('id', '=', locationId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    return loc?.branch_id == null ? null : Number(loc.branch_id);
  }

  /**
   * Creates a new warehouse package (Pallet, Box, etc.) with optional nested items and parent
   */
  async createPackage(auth: AuthContext, dto: CreateWarehousePackageDto): Promise<any> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    // Check parent package if provided
    let parentPkg: any = null;
    if (dto.parentPackageId) {
      parentPkg = await (this.db as any)
        .selectFrom('warehouse_packages')
        .selectAll()
        .where('id', '=', dto.parentPackageId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!parentPkg) {
        throw new NotFoundException('Parent package not found');
      }

      const hierarchyCheck = validatePackageHierarchy(parentPkg.package_type, dto.packageType);
      if (!hierarchyCheck.valid) {
        throw new BadRequestException(hierarchyCheck.reason);
      }
    }

    // Auto-generate barcode/number if not provided
    let packageNumber = dto.packageNumber;
    if (!packageNumber) {
      const prefix = dto.packageType === 'pallet' ? 'PAL' : 'BOX';
      const countRes = await (this.db as any)
        .selectFrom('warehouse_packages')
        .select(sql<number>`COUNT(*)`.as('count'))
        .where('tenant_id', '=', tenantId)
        .where('package_type', '=', dto.packageType)
        .executeTakeFirst();
      const seq = Number(countRes?.count || 0) + 1;
      packageNumber = formatDailyDocumentNumber(prefix, seq);
    }

    const packageId = `pkg_${randomUUID()}`;
    const locationId = dto.locationId || parentPkg?.location_id || null;
    // Validate every item quantity up front (finite, > 0, at most 3dp) and
    // aggregate duplicate product lines so the availability check sees
    // the true total per product, not one line at a time.
    const validatedItems = (dto.items || []).map((item) => ({
      productId: Number(item.productId),
      quantity: this.validatePackageQty(item.quantity, 'Package item quantity'),
      unitName: item.unitName || 'قطعة',
      batchNumber: item.batchNumber || null,
      serialNumbers: item.serialNumbers ? JSON.stringify(item.serialNumbers) : null,
    }));
    const reserveByProduct = new Map<number, number>();
    for (const item of validatedItems) {
      reserveByProduct.set(item.productId, this.round3((reserveByProduct.get(item.productId) || 0) + item.quantity));
    }
    const reserveItems = Array.from(reserveByProduct.entries()).map(([productId, qty]) => ({ productId, qty }));

    // Execute in transaction
    await (this.db as any).transaction().execute(async (trx: any) => {
      // INV-WAREHOUSE-PACKAGE-STOCK-MOVEMENT: sealing stock is a
      // reservation through the canonical ledger, not a second stock.
      // The on-hand quantities do not move (no journal: this is a
      // reservation, not a physical count), but the reserved quantity
      // rises so the sealed units are no longer sellable — a second
      // pack of the same stock is refused by the ledger's
      // availability check. The reserve runs first, inside the same
      // transaction, so a refused pack leaves no package row behind.
      // A child package reserves its OWN items only; stock already
      // sealed in the parent is never re-reserved here, so a nested
      // pack cannot double-count the same units.
      if (reserveItems.length > 0) {
        const branchId = await this.resolveBranchId(trx, tenantId, locationId);
        await reserveLocationStock(trx, {
          tenantId,
          accountId: scope.accountId,
          branchId,
          locationId,
          items: reserveItems,
        });
      }

      await trx
        .insertInto('warehouse_packages')
        .values({
          id: packageId,
          tenant_id: tenantId,
          package_number: packageNumber,
          package_type: dto.packageType,
          parent_package_id: dto.parentPackageId || null,
          warehouse_id: dto.warehouseId || parentPkg?.warehouse_id || null,
          location_id: locationId,
          status: 'sealed',
          gross_weight_kg: dto.grossWeightKg || null,
          net_weight_kg: dto.netWeightKg || null,
          notes: dto.notes || null,
          created_by: String(auth.userId),
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();

      if (validatedItems.length > 0) {
        for (const item of validatedItems) {
          await trx
            .insertInto('warehouse_package_items')
            .values({
              id: `pkgi_${randomUUID()}`,
              tenant_id: tenantId,
              package_id: packageId,
              product_id: item.productId,
              quantity: item.quantity,
              unit_name: item.unitName,
              batch_number: item.batchNumber,
              serial_numbers: item.serialNumbers,
              created_at: new Date(),
            })
            .execute();
        }
      }
    });

    return {
      success: true,
      packageId,
      packageNumber,
      packageType: dto.packageType,
    };
  }

  /**
   * Retrieves list of packages with summary stats
   */
  async getPackages(
    auth: AuthContext,
    params?: { packageType?: string; status?: string; search?: string },
  ): Promise<any[]> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    let query = (this.db as any)
      .selectFrom('warehouse_packages as p')
      .leftJoin('warehouse_packages as parent', 'parent.id', 'p.parent_package_id')
      .select([
        'p.id',
        'p.package_number',
        'p.package_type',
        'p.parent_package_id',
        'parent.package_number as parent_package_number',
        'p.warehouse_id',
        'p.location_id',
        'p.status',
        'p.gross_weight_kg',
        'p.net_weight_kg',
        'p.notes',
        'p.created_at',
      ])
      .where('p.tenant_id', '=', tenantId);

    if (params?.packageType && params.packageType !== 'all') {
      query = query.where('p.package_type', '=', params.packageType);
    }
    if (params?.status && params.status !== 'all') {
      query = query.where('p.status', '=', params.status);
    }
    if (params?.search && params.search.trim()) {
      const term = `%${params.search.trim()}%`;
      query = query.where((eb: any) =>
        eb.or([
          eb('p.package_number', 'ilike', term),
          eb('p.notes', 'ilike', term),
        ]),
      );
    }

    const packages = await query.orderBy('p.created_at', 'desc').execute();

    // Fetch items counts & child packages counts
    const packageIds = packages.map((p: any) => p.id);
    if (packageIds.length === 0) return [];

    const itemsCounts = await (this.db as any)
      .selectFrom('warehouse_package_items')
      .select(['package_id', sql<number>`COUNT(*)`.as('items_count'), sql<number>`SUM(quantity)`.as('total_qty')])
      .where('tenant_id', '=', tenantId)
      .where('package_id', 'in', packageIds)
      .groupBy('package_id')
      .execute();

    const childCounts = await (this.db as any)
      .selectFrom('warehouse_packages')
      .select(['parent_package_id', sql<number>`COUNT(*)`.as('children_count')])
      .where('tenant_id', '=', tenantId)
      .where('parent_package_id', 'in', packageIds)
      .groupBy('parent_package_id')
      .execute();

    const itemsMap = new Map<string, any>(itemsCounts.map((i: any) => [i.package_id, i]));
    const childrenMap = new Map<string, number>(childCounts.map((c: any) => [c.parent_package_id, Number(c.children_count || 0)]));

    return packages.map((p: any) => ({
      ...p,
      itemsCount: Number(itemsMap.get(p.id)?.items_count || 0),
      totalQuantity: Number(itemsMap.get(p.id)?.total_qty || 0),
      childrenCount: Number(childrenMap.get(p.id) || 0),
    }));
  }

  /**
   * Retrieves full package hierarchy tree (scanned by barcode or ID) with recursive contents
   */
  async getPackageDetails(auth: AuthContext, identifier: string): Promise<any> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    // Search by ID or Package Number (Barcode)
    const pkg = await (this.db as any)
      .selectFrom('warehouse_packages as p')
      .selectAll()
      .where('p.tenant_id', '=', tenantId)
      .where((eb: any) => eb.or([eb('p.id', '=', identifier), eb('p.package_number', '=', identifier)]))
      .executeTakeFirst();

    if (!pkg) {
      throw new NotFoundException('Package not found');
    }

    // Build hierarchy node recursively
    const buildNode = async (packageRecord: any): Promise<PackageHierarchyNode> => {
      const items = await (this.db as any)
        .selectFrom('warehouse_package_items as pi')
        .leftJoin('products as pr', 'pr.id', 'pi.product_id')
        .select([
          'pi.id as item_id',
          'pi.product_id',
          'pr.name as product_name',
          'pr.code as product_code',
          'pi.quantity',
          'pi.unit_name',
          'pi.batch_number',
          'pi.serial_numbers',
        ])
        .where('pi.package_id', '=', packageRecord.id)
        .where('pi.tenant_id', '=', tenantId)
        .execute();

      const children = await (this.db as any)
        .selectFrom('warehouse_packages')
        .selectAll()
        .where('parent_package_id', '=', packageRecord.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      const childNodes: PackageHierarchyNode[] = [];
      for (const child of children) {
        childNodes.push(await buildNode(child));
      }

      return {
        id: packageRecord.id,
        packageNumber: packageRecord.package_number,
        packageType: packageRecord.package_type,
        status: packageRecord.status,
        grossWeightKg: Number(packageRecord.gross_weight_kg || 0),
        items: items.map((i: any) => ({
          itemId: i.item_id,
          productId: i.product_id,
          productName: i.product_name,
          productCode: i.product_code,
          quantity: Number(i.quantity),
          unitName: i.unit_name,
          batchNumber: i.batch_number,
          serialNumbers: i.serial_numbers,
        })),
        children: childNodes,
      };
    };

    const tree = await buildNode(pkg);
    const aggregatedContents = flattenPackageContents(tree);

    return {
      package: pkg,
      tree,
      aggregatedContents,
    };
  }

  /**
   * Unpacks a package or de-nests child packages / items
   */
  async unpack(auth: AuthContext, id: string, dto: UnpackPackageDto): Promise<any> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    const pkg = await (this.db as any)
      .selectFrom('warehouse_packages')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!pkg) {
      throw new NotFoundException('Package not found');
    }

    const check = validateUnpackAction(pkg.status, dto.action);
    if (!check.allowed) {
      throw new BadRequestException(check.reason);
    }

    await (this.db as any).transaction().execute(async (trx: any) => {
      // INV-WAREHOUSE-PACKAGE-STOCK-MOVEMENT: every release below runs
      // at the package's own location — the same location the pack
      // reserved at — in the same transaction as the item-row write,
      // so a release can never land without its row disappearing (or
      // shrinking) and can never run twice for the same row: a second
      // unpack finds no row left to release. Child packages are only
      // detached, never unpacked, so their own reservations survive.
      const branchId = await this.resolveBranchId(trx, tenantId, pkg.location_id == null ? null : Number(pkg.location_id));
      const locationId = pkg.location_id == null ? null : Number(pkg.location_id);

      if (dto.action === 'unpack_all') {
        // Release only this package's DIRECT items. Nested child
        // packages stay sealed with their own reservations intact —
        // releasing them here would return stock that is still sealed
        // inside a child, and the child would release it again when
        // it is unpacked.
        const directItems = await trx
          .selectFrom('warehouse_package_items')
          .select(['product_id', 'quantity'])
          .where('package_id', '=', id)
          .where('tenant_id', '=', tenantId)
          .execute();
        const releaseByProduct = new Map<number, number>();
        for (const row of directItems as any[]) {
          const productId = Number(row.product_id);
          releaseByProduct.set(productId, this.round3((releaseByProduct.get(productId) || 0) + Number(row.quantity || 0)));
        }
        const releaseItems = Array.from(releaseByProduct.entries()).map(([productId, qty]) => ({ productId, qty }));
        if (releaseItems.length > 0) {
          await releaseLocationStock(trx, {
            tenantId,
            accountId: scope.accountId,
            branchId,
            locationId,
            items: releaseItems,
          });
        }

        // Detach all nested child packages
        await trx
          .updateTable('warehouse_packages')
          .set({ parent_package_id: null, updated_at: new Date() })
          .where('parent_package_id', '=', id)
          .where('tenant_id', '=', tenantId)
          .execute();

        // Delete direct items
        await trx
          .deleteFrom('warehouse_package_items')
          .where('package_id', '=', id)
          .where('tenant_id', '=', tenantId)
          .execute();

        // Mark as opened or consumed
        await trx
          .updateTable('warehouse_packages')
          .set({ status: 'opened', updated_at: new Date() })
          .where('id', '=', id)
          .where('tenant_id', '=', tenantId)
          .execute();
      } else if (dto.action === 'remove_child_package' && dto.targetChildPackageId) {
        // Detach only: the child stays sealed, so its reservation
        // stays with it. Releasing here would make sealed stock
        // sellable while it is still inside the child package.
        await trx
          .updateTable('warehouse_packages')
          .set({ parent_package_id: null, updated_at: new Date() })
          .where('id', '=', dto.targetChildPackageId)
          .where('parent_package_id', '=', id)
          .where('tenant_id', '=', tenantId)
          .execute();
      } else if (dto.action === 'remove_item' && dto.targetPackageItemId) {
        const itemRow = await trx
          .selectFrom('warehouse_package_items')
          .select(['id', 'product_id', 'quantity'])
          .where('id', '=', dto.targetPackageItemId)
          .where('package_id', '=', id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        if (!itemRow) {
          throw new NotFoundException('Package item not found');
        }
        const itemQty = this.round3((itemRow as any).quantity);
        // Partial unpack: release only the unpacked quantity and
        // shrink the row; a full unpack releases it all and deletes
        // the row. Either way the released quantity is exactly the
        // quantity taken out of the package, once.
        let releaseQty = itemQty;
        if (dto.quantity != null) {
          releaseQty = this.validatePackageQty(dto.quantity, 'Unpack quantity');
          if (releaseQty > itemQty) {
            throw new BadRequestException(
              `Unpack quantity ${releaseQty} exceeds the packaged quantity ${itemQty} for this item`,
            );
          }
        }
        await releaseLocationStock(trx, {
          tenantId,
          accountId: scope.accountId,
          branchId,
          locationId,
          items: [{ productId: Number((itemRow as any).product_id), qty: releaseQty }],
        });
        if (releaseQty < itemQty) {
          await trx
            .updateTable('warehouse_package_items')
            .set({ quantity: this.round3(itemQty - releaseQty) })
            .where('id', '=', dto.targetPackageItemId)
            .where('package_id', '=', id)
            .where('tenant_id', '=', tenantId)
            .execute();
        } else {
          await trx
            .deleteFrom('warehouse_package_items')
            .where('id', '=', dto.targetPackageItemId)
            .where('package_id', '=', id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
      }
    });

    return { success: true };
  }

  /**
   * Updates package status
   */
  async updateStatus(auth: AuthContext, id: string, dto: UpdatePackageStatusDto): Promise<any> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);

    await (this.db as any)
      .updateTable('warehouse_packages')
      .set({ status: dto.status, updated_at: new Date() })
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    return { success: true };
  }
}
