import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { UpsertCategoryDto } from '../dto/upsert-category.dto';

@Injectable()
export class CatalogCategoryService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  private tenantId(actor: AuthContext): string {
    return requireTenantScope(actor).tenantId;
  }

  private accountId(actor: AuthContext): string {
    return requireTenantScope(actor).accountId;
  }

  private tenantPredicate(actor: AuthContext) {
    return sql<boolean>`tenant_id = ${this.tenantId(actor)}`;
  }

  async listCategories(actor: AuthContext): Promise<Record<string, unknown>> {
    const categories = await this.db
      .selectFrom('product_categories')
      .leftJoin('products', (join) =>
        join.onRef('products.category_id', '=', 'product_categories.id').on('products.is_active', '=', true),
      )
      .select([
        'product_categories.id',
        'product_categories.name',
        (eb) => eb.fn.count<number>('products.id').as('productCount'),
      ])
      .where('product_categories.is_active', '=', true)
      .where(sql<boolean>`product_categories.tenant_id = ${this.tenantId(actor)}`)
      .groupBy(['product_categories.id', 'product_categories.name'])
      .orderBy('product_categories.id', 'asc')
      .execute();
    return {
      categories: categories.map((entry) => ({
        id: String(entry.id),
        name: entry.name,
        productCount: Number(entry.productCount || 0),
      })),
    };
  }

  async createCategory(payload: UpsertCategoryDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Category name is required', 'CATEGORY_NAME_REQUIRED', 400);
    const duplicate = await this.db
      .selectFrom('product_categories')
      .select('id')
      .where(sql`LOWER(name)`, '=', name.toLowerCase())
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (duplicate) throw new AppError('Category already exists', 'CATEGORY_EXISTS', 400);
    await this.db
      .insertInto('product_categories')
      .values({ name, is_active: true, tenant_id: this.tenantId(actor), account_id: this.accountId(actor) })
      .execute();
    await this.audit.log('إضافة تصنيف', `تم إضافة تصنيف ${name} بواسطة ${actor.username}`, actor);
    return { ok: true, ...(await this.listCategories(actor)) };
  }

  async updateCategory(id: number, payload: UpsertCategoryDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Category name is required', 'CATEGORY_NAME_REQUIRED', 400);
    const existing = await this.db
      .selectFrom('product_categories')
      .select(['id'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!existing) throw new AppError('Category not found', 'CATEGORY_NOT_FOUND', 404);
    const duplicate = await this.db
      .selectFrom('product_categories')
      .select('id')
      .where(sql`LOWER(name)`, '=', name.toLowerCase())
      .where('id', '!=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (duplicate) throw new AppError('Category already exists', 'CATEGORY_EXISTS', 400);
    await this.db
      .updateTable('product_categories')
      .set({ name, updated_at: sql`NOW()` })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();
    await this.audit.log('تعديل تصنيف', `تم تحديث تصنيف #${id} بواسطة ${actor.username}`, actor);
    return { ok: true, ...(await this.listCategories(actor)) };
  }

  async deleteCategory(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const inUse = await this.db
      .selectFrom('products')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('category_id', '=', id)
      .where('is_active', '=', true)
      .where(sql<boolean>`tenant_id = ${this.tenantId(actor)}`)
      .executeTakeFirstOrThrow();
    if (Number(inUse.count || 0) > 0) throw new AppError('Category is used by products', 'CATEGORY_IN_USE', 400);
    await this.db
      .updateTable('product_categories')
      .set({ is_active: false, updated_at: sql`NOW()` })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();
    await this.audit.log('حذف تصنيف', `تم حذف تصنيف #${id} بواسطة ${actor.username}`, actor);
    return { ok: true, ...(await this.listCategories(actor)) };
  }

  async transferProducts(id: number, toCategoryId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    if (id === toCategoryId) throw new AppError('Cannot transfer to the same category', 'INVALID_TARGET_CATEGORY', 400);

    const targetCategory = await this.db
      .selectFrom('product_categories')
      .select('id')
      .where('id', '=', toCategoryId)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!targetCategory) throw new AppError('Target category not found', 'TARGET_CATEGORY_NOT_FOUND', 404);

    await this.db
      .updateTable('products')
      .set({ category_id: toCategoryId, updated_at: sql`NOW()` })
      .where('category_id', '=', id)
      .where(sql<boolean>`tenant_id = ${this.tenantId(actor)}`)
      .execute();

    await this.audit.log(
      'نقل أصناف',
      `تم نقل الأصناف من تصنيف #${id} إلى تصنيف #${toCategoryId} بواسطة ${actor.username}`,
      actor,
    );
    return { ok: true, ...(await this.listCategories(actor)) };
  }
}
