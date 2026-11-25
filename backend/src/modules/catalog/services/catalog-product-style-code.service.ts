import { Injectable } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { NormalizedUpsertProduct } from '../dto/upsert-product.dto';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';

/**
 * CatalogProductStyleCodeService — slice P3 of the catalog-product split.
 * Pure move of 5 methods from CatalogProductService (style codes: the
 * next-code scan, the transactional counter allocator, the Arabic-digit
 * normalizer, the new-code coercion, and the availability check). No
 * behavior change: the bodies are byte-identical except coerceNewStyleCode
 * + ensureStyleCodeAvailable are PUBLIC here (private in the facade
 * delegate — the facade, a different class, cannot call a private slice
 * method, tsc TS2341; the facade keeps thin PRIVATE delegates for them,
 * and P6/P8 call them via bound deps at their merge). normalizeArabicDigits
 * stays private (called only by coerceNewStyleCode, same slice) and has
 * NO facade delegate. Deps: db + the kernel tenantPredicate (stays a REAL
 * private method in the facade, passed bound via the HR kernel pattern;
 * its return type is RawBuilder<boolean> — the exact inferred type of the
 * kernel method, tsc-probed at generation). No clock sites, no toFixed2,
 * no inlineRound, no FX in this slice. No driving spec (prep §6.5).
 * Whitespace note: 8 whitespace-only lines in the pristine spans
 * (L253, L264, L286, L296, L307, L335, L1738, L1764) are normalized to
 * truly empty lines here — otherwise `git diff --check` flags them as
 * added lines; semantics unchanged. MERGE NOTE: P6/P8's
 * this.coerceNewStyleCode( / this.ensureStyleCodeAvailable( calls must
 * resolve through bound deps wired from this slice instance in the
 * facade ctor (this.styleCodeService.<method>.bind(this.styleCodeService));
 * the facade's private delegates keep them working until then.
 */

export interface CatalogProductStyleCodeDeps {
  db: Kysely<Database>;
  // Bound kernel helper (stays a REAL private method in the facade, HR kernel
  // pattern): the tenant predicate, passed bound so the moved bodies stay
  // byte-identical. Return type is the exact inferred type of the kernel
  // method (sql<boolean>`...` is RawBuilder<boolean>; tsc-probed at generation).
  tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
}

@Injectable()
export class CatalogProductStyleCodeService {
  private readonly db: Kysely<Database>;
  private readonly tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;

  constructor(deps: CatalogProductStyleCodeDeps) {
    this.db = deps.db;
    this.tenantPredicate = deps.tenantPredicate;
  }

  async getNextStyleCode(actor: AuthContext): Promise<{ styleCode: string }> {
    const result = await this.db
      .selectFrom('products')
      .select(['style_code'])
      .where('style_code', 'is not', null)
      .where(this.tenantPredicate(actor))
      .execute();

    let maxNumeric = 1000;
    for (const row of result) {
      if (!row.style_code) continue;
      const parsed = parseInt(row.style_code.trim(), 10);
      if (!isNaN(parsed) && parsed.toString() === row.style_code.trim()) {
        if (parsed > maxNumeric) {
          maxNumeric = parsed;
        }
      }
    }

    return { styleCode: (maxNumeric + 1).toString() };
  }

  async allocateStyleCode(actor: AuthContext): Promise<{ styleCode: string }> {
    return this.db.transaction().execute(async (trx) => {
      const { tenantId } = requireTenantScope(actor);
      let counter = await trx
        .selectFrom('style_code_counters')
        .select('next_value')
        .where('tenant_id', '=', tenantId)
        .where('scope', '=', 'fashion')
        .forUpdate()
        .executeTakeFirst();

      if (!counter) {
        const maxResult = await trx
          .selectFrom('products')
          .select(['style_code'])
          .where('style_code', 'is not', null)
          .where(this.tenantPredicate(actor))
          .execute();

        let maxNumeric = 1000;
        for (const row of maxResult) {
          if (!row.style_code) continue;
          const parsed = parseInt(row.style_code.trim(), 10);
          // Exclude legacy timestamp-like codes: the counter column is an INTEGER.
          if (Number.isSafeInteger(parsed) && parsed <= 2_000_000_000 && parsed.toString() === row.style_code.trim()) {
            if (parsed > maxNumeric) maxNumeric = parsed;
          }
        }

        const seedValue = maxNumeric + 1;
        await trx
          .insertInto('style_code_counters')
          .values({
            tenant_id: tenantId,
            scope: 'fashion',
            next_value: seedValue,
          })
          .onConflict((oc) => oc.columns(['tenant_id', 'scope']).doNothing())
          .execute();

        counter = await trx
          .selectFrom('style_code_counters')
          .select('next_value')
          .where('tenant_id', '=', tenantId)
          .where('scope', '=', 'fashion')
          .forUpdate()
          .executeTakeFirst();
      }

      let allocated = Math.max(1001, Number(counter!.next_value));
      // Manual product codes can be created after the counter was seeded.
      // Never suggest a style code that is already in use by this tenant.
      while (allocated <= 2_000_000_000) {
        const taken = await trx
          .selectFrom('products')
          .select('id')
          .where('style_code', '=', String(allocated))
          .where('is_active', '=', true)
          .where(this.tenantPredicate(actor))
          .executeTakeFirst();
        if (!taken) break;
        allocated++;
      }
      if (allocated > 2_000_000_000) throw new AppError('نفدت أكواد الموديلات المتاحة', 'STYLE_CODE_EXHAUSTED', 409);

      await trx
        .updateTable('style_code_counters')
        .set({ next_value: allocated + 1 })
        .where('tenant_id', '=', tenantId)
        .where('scope', '=', 'fashion')
        .execute();

      return { styleCode: allocated.toString() };
    });
  }

  private normalizeArabicDigits(value: string): string {
    const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
    return String(value || '').replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)));
  }

  coerceNewStyleCode(rawValue: string): string {
    const trimmed = String(rawValue || '').trim();
    if (!trimmed) return '';
    const normalized = this.normalizeArabicDigits(trimmed);
    if (!/^\d+$/.test(normalized)) {
      throw new AppError('كود المجموعة / الصنف الرئيسي يجب أن يكون أرقامًا فقط', 'STYLE_CODE_INVALID', 400);
    }
    return normalized;
  }

  async ensureStyleCodeAvailable(
    styleCode: string | null | undefined,
    itemKind: 'standard' | 'fashion' | null | undefined,
    actor: AuthContext,
    excludeProductIds: number[] = [],
    drafts: Pick<NormalizedUpsertProduct, 'color' | 'size'>[] = [],
  ): Promise<void> {
    const normalized = String(styleCode || '').trim();
    if (!normalized) return;

    let query = this.db
      .selectFrom('products')
      .select(['id', 'item_kind', 'color', 'size'])
      .where('is_active', '=', true)
      .where('style_code', '=', normalized)
      .where(this.tenantPredicate(actor));

    if (excludeProductIds.length) {
      query = query.where('id', 'not in', excludeProductIds);
    }
    const existingRows = await query.execute();
    if (existingRows.length === 0) return;

    if (itemKind !== 'fashion') {
      throw new AppError('هذا الكود مستخدم بالفعل في صنف سابق', 'STYLE_CODE_EXISTS', 400);
    }

    const hasNonFashion = existingRows.some((row) => row.item_kind !== 'fashion');
    if (hasNonFashion) {
      throw new AppError('هذا الكود مستخدم بالفعل في صنف غير ملابس', 'STYLE_CODE_EXISTS', 400);
    }

    for (const row of existingRows) {
      const normExistingColor = normalizeArabicSearch(row.color || '');
      const normExistingSize = normalizeArabicSearch(row.size || '');

      for (const draft of drafts) {
        const normDraftColor = normalizeArabicSearch(draft.color || '');
        const normDraftSize = normalizeArabicSearch(draft.size || '');
        if (normExistingColor === normDraftColor && normExistingSize === normDraftSize) {
          throw new AppError('هذا اللون والمقاس موجودان بالفعل لهذا الموديل', 'VARIANT_EXISTS', 400);
        }
      }
    }
  }
}
