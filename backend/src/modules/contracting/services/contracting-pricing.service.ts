import { Injectable, NotFoundException } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import {
  CreateMasterPriceItemDto,
  UpdateMasterPriceItemDto,
  CreateEngineeringConstantDto,
  AutoPriceBoqItemDto,
} from '../dto/contracting.dto';

/**
 * ContractingPricingService — slice C6 of the contracting split.
 * Pure move of 8 methods from ContractingService (master price list (4) +
 * engineering constants / auto-pricing (4)). No behavior change: the bodies
 * are byte-identical; the facade keeps thin delegates with the same names
 * and signatures for the 7 public methods. seedDefaultEngineeringConstants
 * is private and stays private here — its only caller (getEngineeringConstants)
 * moves with it, so the facade needs no delegate for it (prep §6: 151 public
 * delegates; private helpers get none). This slice takes db only: it posts
 * no journals (the 2 posting methods live in C4), has no FX sites
 * (resolveFxRate 0 in the whole file), and its 6 inline Math.round(x*100)/100
 * sites stay as-is (dispositioned in the allowlist, not roundMoney — prep
 * §7.8a). No clock pin follows these methods (C6 has no spec — gap recorded
 * in the prep §6.5); the one new Date() is an updated_at server-instant stamp.
 */

export interface ContractingPricingDeps {
  db: Kysely<any>;
}

@Injectable()
export class ContractingPricingService {
  private readonly db: Kysely<any>;

  constructor(deps: ContractingPricingDeps) {
    this.db = deps.db;
  }

  async getMasterPriceList(auth: AuthContext, query?: { itemType?: string; category?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let q = (this.db)
      .selectFrom('contracting_master_price_list')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (query?.itemType && query.itemType !== 'all') {
      q = q.where('item_type', '=', query.itemType);
    }
    if (query?.category && query.category !== 'all') {
      q = q.where('category', '=', query.category);
    }
    if (query?.search) {
      const s = `%${query.search.trim()}%`;
      q = q.where((eb: any) =>
        eb.or([
          eb('name', 'ilike', s),
          eb('code', 'ilike', s),
        ])
      );
    }

    const rows = await q.orderBy('created_at', 'desc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      itemType: r.item_type,
      code: r.code,
      name: r.name,
      unit: r.unit,
      unitRate: Number(r.unit_rate || 0),
      category: r.category,
      notes: r.notes || null,
      createdAt: r.created_at?.toISOString?.() || String(r.created_at),
      updatedAt: r.updated_at?.toISOString?.() || String(r.updated_at),
    }));
  }

  async createMasterPriceItem(auth: AuthContext, dto: CreateMasterPriceItemDto) {
    const { tenantId } = requireTenantScope(auth);
    const [inserted] = await (this.db)
      .insertInto('contracting_master_price_list')
      .values({
        tenant_id: tenantId,
        item_type: dto.itemType,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        unit: dto.unit || 'm3',
        unit_rate: Number(dto.unitRate || 0),
        category: dto.category || 'general',
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    return {
      id: String(inserted.id),
      itemType: inserted.item_type,
      code: inserted.code,
      name: inserted.name,
      unit: inserted.unit,
      unitRate: Number(inserted.unit_rate || 0),
      category: inserted.category,
      notes: inserted.notes,
      createdAt: inserted.created_at?.toISOString?.() || String(inserted.created_at),
      updatedAt: inserted.updated_at?.toISOString?.() || String(inserted.updated_at),
    };
  }

  async updateMasterPriceItem(auth: AuthContext, id: string, dto: UpdateMasterPriceItemDto) {
    const { tenantId } = requireTenantScope(auth);
    const updates: Record<string, any> = { updated_at: new Date() };
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.unit !== undefined) updates.unit = dto.unit;
    if (dto.unitRate !== undefined) updates.unit_rate = Number(dto.unitRate);
    if (dto.category !== undefined) updates.category = dto.category;
    if (dto.notes !== undefined) updates.notes = dto.notes;

    const [updated] = await (this.db)
      .updateTable('contracting_master_price_list')
      .set(updates)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    if (!updated) {
      throw new NotFoundException(`بند السعر برقم ${id} غير موجود`);
    }

    return {
      id: String(updated.id),
      itemType: updated.item_type,
      code: updated.code,
      name: updated.name,
      unit: updated.unit,
      unitRate: Number(updated.unit_rate || 0),
      category: updated.category,
      notes: updated.notes,
      createdAt: updated.created_at?.toISOString?.() || String(updated.created_at),
      updatedAt: updated.updated_at?.toISOString?.() || String(updated.updated_at),
    };
  }

  async deleteMasterPriceItem(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await (this.db)
      .deleteFrom('contracting_master_price_list')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();
    return { success: true };
  }

  async getEngineeringConstants(auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    let rows = await (this.db)
      .selectFrom('contracting_engineering_constants')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('item_code', 'asc')
      .execute();

    if (rows.length === 0) {
      await this.seedDefaultEngineeringConstants(tenantId);
      rows = await (this.db)
        .selectFrom('contracting_engineering_constants')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .orderBy('item_code', 'asc')
        .execute();
    }

    // Fetch master prices to compute real-time direct costs
    const masterPrices = await this.getMasterPriceList(auth);
    const priceMap = new Map<string, number>(masterPrices.map((p: any) => [p.code, Number(p.unitRate || 0)]));

    return rows.map((r: any) => {
      const components = Array.isArray(r.components_json) ? r.components_json : [];
      let calculatedDirectCost = 0;
      const enrichedComponents = components.map((c: any) => {
        const rate = Number(priceMap.get(c.componentCode) ?? Number(c.unitRate || 0));
        const compCost = Number(c.qtyPerUnit || 0) * rate;
        calculatedDirectCost += compCost;
        return { ...c, unitRate: rate, totalCost: compCost };
      });

      const wastePct = Number(r.waste_percent || 0) / 100;
      const overheadPct = Number(r.overhead_percent || 0) / 100;
      const markupPct = Number(r.profit_markup_percent || 0) / 100;

      const totalCostWithWaste = calculatedDirectCost * (1 + wastePct);
      const totalCostWithOverhead = totalCostWithWaste * (1 + overheadPct);
      const calculatedSellingPrice = totalCostWithOverhead * (1 + markupPct);

      return {
        id: String(r.id),
        itemCode: r.item_code,
        itemName: r.item_name,
        unit: r.unit,
        wastePercent: Number(r.waste_percent || 0),
        overheadPercent: Number(r.overhead_percent || 0),
        profitMarkupPercent: Number(r.profit_markup_percent || 0),
        components: enrichedComponents,
        calculatedDirectCost: Math.round(calculatedDirectCost * 100) / 100,
        calculatedSellingPrice: Math.round(calculatedSellingPrice * 100) / 100,
        notes: r.notes || null,
        createdAt: r.created_at?.toISOString?.() || String(r.created_at),
        updatedAt: r.updated_at?.toISOString?.() || String(r.updated_at),
      };
    });
  }

  private async seedDefaultEngineeringConstants(tenantId: string) {
    const defaultConstants = [
      {
        item_code: 'BRK-RED-12',
        item_name: 'مباني طوب أحمر طفلي 12 سم (قاطع نصف طوبة بالمتر المسطح)',
        unit: 'm2',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'BRK-RED-CLAY', componentName: 'طوب أحمر طفلي 25×12×6 سم', unit: 'pcs', qtyPerUnit: 55, unitRate: 2.2, componentType: 'material' },
          { componentCode: 'SAND-MASON', componentName: 'رمل بناء حرش نظيف', unit: 'm3', qtyPerUnit: 0.02, unitRate: 180, componentType: 'material' },
          { componentCode: 'CEM-PORT', componentName: 'أسمنت بورتلاندي 42.5', unit: 'ton', qtyPerUnit: 0.01, unitRate: 2400, componentType: 'material' },
          { componentCode: 'LABOR-MASON', componentName: 'مصنعية بنا ومساعد ونقل داخلي', unit: 'm2', qtyPerUnit: 1.0, unitRate: 70, componentType: 'labor' },
        ]),
        notes: 'كود المباني القياسي: المتر المسطح سمك 12 سم يستهلك معيارياً 55 طوبة + 0.02 م3 رمل + 10 كجم أسمنت + مصنعية البنا.',
      },
      {
        item_code: 'BRK-SOL-25',
        item_name: 'مباني طوب أسمنتي مصمت 25 سم (طوبة كاملة بالمتر المكعب)',
        unit: 'm3',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'BRK-SOL-CONC', componentName: 'طوب أسمنتي مصمت 25×12×6 سم', unit: 'pcs', qtyPerUnit: 450, unitRate: 2.8, componentType: 'material' },
          { componentCode: 'SAND-MASON', componentName: 'رمل بناء حرش نظيف', unit: 'm3', qtyPerUnit: 0.2, unitRate: 180, componentType: 'material' },
          { componentCode: 'CEM-PORT', componentName: 'أسمنت بورتلاندي 42.5', unit: 'ton', qtyPerUnit: 0.065, unitRate: 2400, componentType: 'material' },
          { componentCode: 'LABOR-MASON-CUB', componentName: 'مصنعية بنا وطاقم عمالة للمكعب', unit: 'm3', qtyPerUnit: 1.0, unitRate: 320, componentType: 'labor' },
        ]),
        notes: 'كود المباني المكعبة: المتر المكعب سمك 25 سم يستهلك معيارياً 450 طوبة + 0.2 م3 رمل + 65 كجم أسمنت.',
      },
      {
        item_code: 'BRK-HLL-20',
        item_name: 'مباني طوب أسمنتي مفرغ 20×20×40 سم (بالمتر المسطح)',
        unit: 'm2',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'BRK-BLK-HLL', componentName: 'طوب أسمنتي مفرغ 20×20×40', unit: 'pcs', qtyPerUnit: 12.5, unitRate: 18, componentType: 'material' },
          { componentCode: 'SAND-MASON', componentName: 'رمل بناء حرش نظيف', unit: 'm3', qtyPerUnit: 0.04, unitRate: 180, componentType: 'material' },
          { componentCode: 'CEM-PORT', componentName: 'أسمنت بورتلاندي 42.5', unit: 'ton', qtyPerUnit: 0.015, unitRate: 2400, componentType: 'material' },
          { componentCode: 'LABOR-MASON', componentName: 'مصنعية بنا ومساعد', unit: 'm2', qtyPerUnit: 1.0, unitRate: 85, componentType: 'labor' },
        ]),
        notes: 'مباني بلك أسمنتي مفرغ 20 سم للمناور والحوائط الخارجية.',
      },
      {
        item_code: 'CONC-PLN-C20',
        item_name: 'خرسانة عادية للأساسات والفرشات C20 (بالمتر المكعب)',
        unit: 'm3',
        waste_percent: 4.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'GRAV-CRUSH', componentName: 'سن 1 و 2 / زلط متدرج', unit: 'm3', qtyPerUnit: 0.8, unitRate: 280, componentType: 'material' },
          { componentCode: 'SAND-CRS', componentName: 'رمل حرش نظيف', unit: 'm3', qtyPerUnit: 0.4, unitRate: 180, componentType: 'material' },
          { componentCode: 'CEM-PORT', componentName: 'أسمنت بورتلاندي 42.5 (5 شكاير)', unit: 'ton', qtyPerUnit: 0.25, unitRate: 2400, componentType: 'material' },
          { componentCode: 'LABOR-PLN-CONC', componentName: 'مصنعية نجارة وفرش ودك خرسانة عادية', unit: 'm3', qtyPerUnit: 1.0, unitRate: 220, componentType: 'labor' },
        ]),
        notes: 'متر مكعب خرسانة عادية C20 محتوى 250 كجم أسمنت / م3.',
      },
      {
        item_code: 'CONC-FTG-C30',
        item_name: 'خرسانة مسلحة للقواعد والأساسات C30 (بالمتر المكعب)',
        unit: 'm3',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'GRAV-CRUSH', componentName: 'سن 1 و 2 / زلط متدرج', unit: 'm3', qtyPerUnit: 0.8, unitRate: 280, componentType: 'material' },
          { componentCode: 'SAND-CRS', componentName: 'رمل حرش نظيف', unit: 'm3', qtyPerUnit: 0.4, unitRate: 180, componentType: 'material' },
          { componentCode: 'CEM-PORT', componentName: 'أسمنت بورتلاندي 42.5 (7 شكاير)', unit: 'ton', qtyPerUnit: 0.35, unitRate: 2400, componentType: 'material' },
          { componentCode: 'STEEL-REBAR', componentName: 'حديد تسليح عالي الإجهاد (85 كجم)', unit: 'ton', qtyPerUnit: 0.085, unitRate: 42000, componentType: 'material' },
          { componentCode: 'LABOR-FTG', componentName: 'مصنعية نجارة وحدادة وصب قواعد مسلحة', unit: 'm3', qtyPerUnit: 1.0, unitRate: 480, componentType: 'labor' },
        ]),
        notes: 'متر مكعب خرسانة مسلحة للقواعد والسميلات واللبشة بمعدل حديد 85 كجم/م3.',
      },
      {
        item_code: 'CONC-COL-C35',
        item_name: 'خرسانة مسلحة للأعمدة والحوائط C35 (بالمتر المكعب)',
        unit: 'm3',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'GRAV-FINO', componentName: 'سن فينو متدرج نظيف', unit: 'm3', qtyPerUnit: 0.8, unitRate: 310, componentType: 'material' },
          { componentCode: 'SAND-CRS', componentName: 'رمل حرش نظيف', unit: 'm3', qtyPerUnit: 0.4, unitRate: 180, componentType: 'material' },
          { componentCode: 'CEM-PORT', componentName: 'أسمنت بورتلاندي 42.5 (8 شكاير)', unit: 'ton', qtyPerUnit: 0.40, unitRate: 2400, componentType: 'material' },
          { componentCode: 'STEEL-REBAR', componentName: 'حديد تسليح عالي الإجهاد (140 كجم)', unit: 'ton', qtyPerUnit: 0.140, unitRate: 42000, componentType: 'material' },
          { componentCode: 'LABOR-COL', componentName: 'مصنعية نجارة وحدادة وصب أعمدة وحوائط', unit: 'm3', qtyPerUnit: 1.0, unitRate: 650, componentType: 'labor' },
        ]),
        notes: 'متر مكعب خرسانة أعمدة وحوائط خرسانية C35 بمعدل حديد 140 كجم/م3.',
      },
      {
        item_code: 'CONC-SLB-C30',
        item_name: 'خرسانة مسلحة للأسقف والكمرات C30 (بالمتر المكعب)',
        unit: 'm3',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'GRAV-CRUSH', componentName: 'سن 1 و 2 / زلط متدرج', unit: 'm3', qtyPerUnit: 0.8, unitRate: 280, componentType: 'material' },
          { componentCode: 'SAND-CRS', componentName: 'رمل حرش نظيف', unit: 'm3', qtyPerUnit: 0.4, unitRate: 180, componentType: 'material' },
          { componentCode: 'CEM-PORT', componentName: 'أسمنت بورتلاندي 42.5 (7 شكاير)', unit: 'ton', qtyPerUnit: 0.35, unitRate: 2400, componentType: 'material' },
          { componentCode: 'STEEL-REBAR', componentName: 'حديد تسليح عالي الإجهاد (110 كجم)', unit: 'ton', qtyPerUnit: 0.110, unitRate: 42000, componentType: 'material' },
          { componentCode: 'LABOR-SLB', componentName: 'مصنعية شدات خشبية وحدادة وصب أسقف', unit: 'm3', qtyPerUnit: 1.0, unitRate: 550, componentType: 'labor' },
        ]),
        notes: 'متر مكعب خرسانة أسقف وكمرات (سوليد / فلات سلاب) بمعدل حديد 110 كجم/م3.',
      },
      {
        item_code: 'PLAS-INT-01',
        item_name: 'أعمال بياض ومحارة داخلية للحوائط والأسقف (بالمتر المسطح)',
        unit: 'm2',
        waste_percent: 4.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'SAND-PLAS', componentName: 'رمل ناعم للمحارة والطرطشة', unit: 'm3', qtyPerUnit: 0.025, unitRate: 180, componentType: 'material' },
          { componentCode: 'CEM-PORT', componentName: 'أسمنت بورتلاندي للمحارة', unit: 'ton', qtyPerUnit: 0.009, unitRate: 2400, componentType: 'material' },
          { componentCode: 'MESH-FIBER', componentName: 'سلك شبك فواصل وزوايا معدنية', unit: 'm', qtyPerUnit: 0.4, unitRate: 15, componentType: 'material' },
          { componentCode: 'LABOR-PLAS', componentName: 'مصنعية مبيض محارة وطاقمه', unit: 'm2', qtyPerUnit: 1.0, unitRate: 75, componentType: 'labor' },
        ]),
        notes: 'بياض ومحارة داخلية طرطشة مسمارية + بؤج وأوتار + بطانة وضهارة ناعمة.',
      },
      {
        item_code: 'TILE-FLR-CER',
        item_name: 'سيراميك أرضيات فرز أول بالفرشة والمونة (بالمتر المسطح)',
        unit: 'm2',
        waste_percent: 7.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'TILE-CER-FLR', componentName: 'بلاط سيراميك أرضيات فرز أول', unit: 'm2', qtyPerUnit: 1.05, unitRate: 260, componentType: 'material' },
          { componentCode: 'SAND-FILL', componentName: 'رمل فرشة وتأسيس منسوب', unit: 'm3', qtyPerUnit: 0.05, unitRate: 180, componentType: 'material' },
          { componentCode: 'CEM-PORT', componentName: 'أسمنت أسود لمونة التركيب', unit: 'ton', qtyPerUnit: 0.012, unitRate: 2400, componentType: 'material' },
          { componentCode: 'GROUT-WHT', componentName: 'أسمنت أبيض وروبة سقية فواصل', unit: 'kg', qtyPerUnit: 0.5, unitRate: 35, componentType: 'material' },
          { componentCode: 'LABOR-TILE', componentName: 'مصنعية مبلط أرضيات ومساعد', unit: 'm2', qtyPerUnit: 1.0, unitRate: 95, componentType: 'labor' },
        ]),
        notes: 'سيراميك أرضيات فرز أول بالرمل والمونة الأسمنتية وسقية العراميس.',
      },
      {
        item_code: 'PAINT-INT-03',
        item_name: 'دهانات داخلية بلاستيك 3 أوجه وسيلر ومعجون (بالمتر المسطح)',
        unit: 'm2',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'PAINT-SEAL', componentName: 'سيلر مائي مقاوم للقلويات', unit: 'L', qtyPerUnit: 0.15, unitRate: 45, componentType: 'material' },
          { componentCode: 'PAINT-PUTTY', componentName: 'معجون بلاستيك جاهز 3 سكاكين', unit: 'kg', qtyPerUnit: 1.4, unitRate: 30, componentType: 'material' },
          { componentCode: 'PAINT-PLAS', componentName: 'دهان بلاستيك نصف لمعة قابل للغسيل', unit: 'L', qtyPerUnit: 0.25, unitRate: 120, componentType: 'material' },
          { componentCode: 'LABOR-PAINT', componentName: 'مصنعية نقاش وصنفرة وتشطيب', unit: 'm2', qtyPerUnit: 1.0, unitRate: 60, componentType: 'labor' },
        ]),
        notes: 'دهانات داخلية وجه سيلر + 3 سكاكين معجون + وجهين بلاستيك نصف لمعة ممتاز.',
      },
      {
        item_code: 'ISO-WTR-BIT',
        item_name: 'عزل رطوبة ممبرين بيتوميني 4 مم وحرارة فوم 5 سم للأسطح (بالمتر المسطح)',
        unit: 'm2',
        waste_percent: 6.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'BIT-MEMB-4MM', componentName: 'لفائف ممبرين بيتوميني 4 مم بوليستر', unit: 'm2', qtyPerUnit: 1.15, unitRate: 180, componentType: 'material' },
          { componentCode: 'BIT-PRIMER', componentName: 'برايمر بيتوميني دهان تأسيس', unit: 'kg', qtyPerUnit: 0.3, unitRate: 65, componentType: 'material' },
          { componentCode: 'XPS-FOAM-5CM', componentName: 'ألواح فوم عازل حراري XPS سمك 5 سم', unit: 'm2', qtyPerUnit: 1.05, unitRate: 160, componentType: 'material' },
          { componentCode: 'LABOR-INSUL', componentName: 'مصنعية فني عزل ولحام لهب', unit: 'm2', qtyPerUnit: 1.0, unitRate: 75, componentType: 'labor' },
        ]),
        notes: 'عزل أسطح مزدوج رطوبة ممبرين 4 مم مع ركوب 10 سم وعزل حراري فوم XPS كثافة 36 كجم.',
      },
      {
        item_code: 'EXCAV-SOIL',
        item_name: 'أعمال حفر في تربة رملية/طينية وتشوين ونقل للمقالب (بالمتر المكعب)',
        unit: 'm3',
        waste_percent: 0.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'EQP-EXCAV', componentName: 'ساعة تشغيل حفار كوماتسو', unit: 'hr', qtyPerUnit: 0.04, unitRate: 1200, componentType: 'equipment' },
          { componentCode: 'EQP-LOADER', componentName: 'ساعة تشغيل لودر وتشوين', unit: 'hr', qtyPerUnit: 0.03, unitRate: 900, componentType: 'equipment' },
          { componentCode: 'TRUCK-HAUL', componentName: 'نقل وتعتيق مخلفات بالمقطورة', unit: 'm3', qtyPerUnit: 1.0, unitRate: 65, componentType: 'subcontractor' },
        ]),
        notes: 'أعمال حفر الموقع حتى المنسوب التأسيسي المعتمد ونقل ناتج الحفر.',
      },
      {
        item_code: 'PLUMB-POINT',
        item_name: 'تأسيس شبكة تغذية وصرف صحي للحمام (بالنقطة / المخرج)',
        unit: 'point',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'PPR-PIPE', componentName: 'مواسير ولوازم تغذية بولي بروبلين PPR معتمدة', unit: 'm', qtyPerUnit: 4.0, unitRate: 95, componentType: 'material' },
          { componentCode: 'PVC-DRAIN', componentName: 'مواسير ولوازم صرف رمادي ثقيل', unit: 'm', qtyPerUnit: 3.5, unitRate: 85, componentType: 'material' },
          { componentCode: 'VALVES-ACC', componentName: 'محابس زاوية وجلب سن وفحص', unit: 'set', qtyPerUnit: 1.0, unitRate: 320, componentType: 'material' },
          { componentCode: 'LABOR-PLUMB', componentName: 'مصنعية سباك واختبار ضغط هيدروليكي', unit: 'point', qtyPerUnit: 1.0, unitRate: 350, componentType: 'labor' },
        ]),
        notes: 'تأسيس شبكة السباكة الداخلية من أجود أنواع البولي بروبلين واختبار بالبار بحضور الاستشاري.',
      },
      {
        item_code: 'ELEC-POINT',
        item_name: 'تأسيس نقطة كهرباء وإنارة ومخارج قوى (بالنقطة / المخرج)',
        unit: 'point',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'ELEC-WIRE', componentName: 'أسلاك نحاس معتمدة السويدي 2.5 و 3 مم', unit: 'm', qtyPerUnit: 15.0, unitRate: 22, componentType: 'material' },
          { componentCode: 'PVC-CONDUIT', componentName: 'خراطيم بيتفين وعُلب ماجيك وشاسيهات', unit: 'set', qtyPerUnit: 1.0, unitRate: 85, componentType: 'material' },
          { componentCode: 'LABOR-ELEC', componentName: 'مصنعية فني كهربائي وتكسير وتمديد', unit: 'point', qtyPerUnit: 1.0, unitRate: 180, componentType: 'labor' },
        ]),
        notes: 'تأسيس مخارج الكهرباء والإنارة شاملة سحب الأسلاك والخراطيم وتثبيت العلب والشاسيهات.',
      },
      {
        item_code: 'GYPS-CEIL-01',
        item_name: 'أسقف معلقة جبسوم بورد مقاوم للرطوبة أخضر (بالمتر المسطح)',
        unit: 'm2',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'GYPS-BOARD', componentName: 'ألواح جبسوم بورد خضراء مقاومة للرطوبة 12.5 مم', unit: 'm2', qtyPerUnit: 1.05, unitRate: 160, componentType: 'material' },
          { componentCode: 'STEEL-GRID', componentName: 'شاسيه صاج مجلفن أوميجا وزوايا وتيش تعليق', unit: 'm2', qtyPerUnit: 1.0, unitRate: 110, componentType: 'material' },
          { componentCode: 'PUTTY-FIBER', componentName: 'معجون فواصل وشريط فيبر ومسامير', unit: 'm2', qtyPerUnit: 1.0, unitRate: 35, componentType: 'material' },
          { componentCode: 'LABOR-GYPS', componentName: 'مصنعية فني تركيب جبسوم بورد ومساعد', unit: 'm2', qtyPerUnit: 1.0, unitRate: 95, componentType: 'labor' },
        ]),
        notes: 'أسقف جبسوم بورد مستوية ومستويات شاملة الشاسيه المقاوم للصدأ وشريط الفواصل والمعجون.',
      },
      {
        item_code: 'FF-PIP-STM-65',
        item_name: 'مواسير سيملس حديد أسود جدول 40 قطر 65 مم (2.5 بوصة) ASTM A53',
        unit: 'm',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'MAT-FF-PIP-65', componentName: 'مواسير سيملس جدول 40 قطر 65 مم معتمدة', unit: 'm', qtyPerUnit: 1.05, unitRate: 310, componentType: 'material' },
          { componentCode: 'MAT-FF-FIT-65', componentName: 'لوازم وهناجر ومسامير وفلكسبل 65 مم', unit: 'ls', qtyPerUnit: 1.0, unitRate: 45, componentType: 'material' },
          { componentCode: 'LAB-FF-PIP-FIT', componentName: 'مصنعية فني ولحام وتركيب مواسير حريق', unit: 'm', qtyPerUnit: 1.0, unitRate: 65, componentType: 'labor' },
        ]),
        notes: 'مواسير سيملس غير ملحومة ASTM A53 Gr. B لشبكات مكافحة الحريق مع الاختبار الهيدروستاتيكي.',
      },
      {
        item_code: 'FF-PIP-STM-40',
        item_name: 'مواسير سيملس حديد أسود جدول 40 قطر 40 مم (1.5 بوصة) ASTM A53',
        unit: 'm',
        waste_percent: 5.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'MAT-FF-PIP-40', componentName: 'مواسير سيملس جدول 40 قطر 40 مم معتمدة', unit: 'm', qtyPerUnit: 1.05, unitRate: 155, componentType: 'material' },
          { componentCode: 'MAT-FF-FIT-40', componentName: 'لوازم وهناجر ومسامير 40 مم', unit: 'ls', qtyPerUnit: 1.0, unitRate: 25, componentType: 'material' },
          { componentCode: 'LAB-FF-PIP-FIT', componentName: 'مصنعية فني وتركيب مواسير حريق', unit: 'm', qtyPerUnit: 1.0, unitRate: 45, componentType: 'labor' },
        ]),
        notes: 'مواسير سيملس 1.5 بوصة لتغذية الرشاشات وصناديق الحريق.',
      },
      {
        item_code: 'FF-PIP-HDP-90',
        item_name: 'مواسير بولي إيثيلين شبكة حريق HDPE SDR11 PN16 قطر 90 مم',
        unit: 'm',
        waste_percent: 4.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'MAT-HDP-PIP-90', componentName: 'مواسير HDPE SDR11 ضغط 16 بار قطر 90 مم', unit: 'm', qtyPerUnit: 1.03, unitRate: 175, componentType: 'material' },
          { componentCode: 'MAT-HDP-FIT-90', componentName: 'وصلات ولحام كهروحراري Electrofusion', unit: 'ls', qtyPerUnit: 1.0, unitRate: 35, componentType: 'material' },
          { componentCode: 'LAB-HDP-LAY', componentName: 'مصنعية حفر وفرشة رملية وتركيب واختبار', unit: 'm', qtyPerUnit: 1.0, unitRate: 55, componentType: 'labor' },
        ]),
        notes: 'مواسير شبكة حريق خارجية مدفونة HDPE ضغط 16 بار.',
      },
      {
        item_code: 'FF-PIP-HDP-65',
        item_name: 'مواسير بولي إيثيلين شبكة حريق HDPE SDR11 PN16 قطر 65 مم',
        unit: 'm',
        waste_percent: 4.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'MAT-HDP-PIP-65', componentName: 'مواسير HDPE SDR11 ضغط 16 بار قطر 65 مم', unit: 'm', qtyPerUnit: 1.03, unitRate: 130, componentType: 'material' },
          { componentCode: 'MAT-HDP-FIT-65', componentName: 'وصلات ولحام كهروحراري', unit: 'ls', qtyPerUnit: 1.0, unitRate: 25, componentType: 'material' },
          { componentCode: 'LAB-HDP-LAY', componentName: 'مصنعية حفر وفرشة وتركيب واختبار', unit: 'm', qtyPerUnit: 1.0, unitRate: 45, componentType: 'labor' },
        ]),
        notes: 'مواسير شبكة حريق مدفونة HDPE قطر 65 مم.',
      },
      {
        item_code: 'FF-VLV-NRS-80',
        item_name: 'محبس سكينة غير صاعد 80 مم NRS Gate Valve وصلة Tie-In',
        unit: 'item',
        waste_percent: 2.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'MAT-VLV-NRS-80', componentName: 'محبس سكينة NRS مقاس 80 مم معتمد UL/FM', unit: 'item', qtyPerUnit: 1.0, unitRate: 2800, componentType: 'material' },
          { componentCode: 'MAT-FLG-SET-80', componentName: 'طقم فلانشات وجوانات ومسامير صلب 80 مم', unit: 'set', qtyPerUnit: 1.0, unitRate: 400, componentType: 'material' },
          { componentCode: 'LAB-VLV-INST', componentName: 'مصنعية تركيب واختبار المحبس', unit: 'item', qtyPerUnit: 1.0, unitRate: 350, componentType: 'labor' },
        ]),
        notes: 'محبس سكينة غير صاعد لنقطة ربط شبكة الحريق الخارجية.',
      },
      {
        item_code: 'FF-VLV-AAV-25',
        item_name: 'محبس تنفيس وتصريف هواء أوتوماتيكي 25 مم (1 بوصة) Automatic Air Vent',
        unit: 'item',
        waste_percent: 2.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'MAT-VLV-AAV-25', componentName: 'هواية أوتوماتيكية سريعة AAV 1 بوصة برونز', unit: 'item', qtyPerUnit: 1.0, unitRate: 650, componentType: 'material' },
          { componentCode: 'MAT-VLV-BAL-25', componentName: 'محبس عزل كروي نحاس 1 بوصة', unit: 'item', qtyPerUnit: 1.0, unitRate: 150, componentType: 'material' },
          { componentCode: 'LAB-VLV-SML', componentName: 'مصنعية تركيب واختبار الهواية', unit: 'item', qtyPerUnit: 1.0, unitRate: 120, componentType: 'labor' },
        ]),
        notes: 'محبس تصريف هواء أوتوماتيكي عند أعلى نقاط الشبكة.',
      },
      {
        item_code: 'FF-FHC-COMB-02',
        item_name: 'صندوق حريق تركيبي مزدوج FHC-2 (بكرة 1 بوصة 30م + محبس 1.5 + محبس زاوية + كابينة)',
        unit: 'item',
        waste_percent: 2.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'MAT-FHC-CAB-02', componentName: 'كابينة حريق صاج 1.5 مم مدهونة إلكتروستاتيك', unit: 'item', qtyPerUnit: 1.0, unitRate: 3800, componentType: 'material' },
          { componentCode: 'MAT-FHC-REEL-30', componentName: 'بكرة خرطوم مطاطي 1 بوصة 30م بالقاذف', unit: 'item', qtyPerUnit: 1.0, unitRate: 2800, componentType: 'material' },
          { componentCode: 'MAT-FHC-VLV-SET', componentName: 'محبس كروي 1.5" + محبس زاوية Angle Valve 1.5"', unit: 'set', qtyPerUnit: 1.0, unitRate: 1600, componentType: 'material' },
          { componentCode: 'LAB-FHC-INST', componentName: 'مصنعية تثبيت الصندوق وتوصيل الخط واختباره', unit: 'item', qtyPerUnit: 1.0, unitRate: 600, componentType: 'labor' },
        ]),
        notes: 'صندوق حريق مجمع مجهز ومعتمد للدفاع المدني والمشاريع السكنية والتجارية.',
      },
      {
        item_code: 'FF-EXT-DRY-06',
        item_name: 'طفاية حريق يدوية بودرة كيميائية جافة ABC سعة 6 كجم مع الكابينة والحامل',
        unit: 'item',
        waste_percent: 2.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'MAT-EXT-DRY-6KG', componentName: 'طفاية بودرة ABC سعة 6 كجم معتمدة بالمانومتر', unit: 'item', qtyPerUnit: 1.0, unitRate: 520, componentType: 'material' },
          { componentCode: 'MAT-EXT-BRK', componentName: 'حامل تثبيت جداري ومسامير فيشر صلب', unit: 'item', qtyPerUnit: 1.0, unitRate: 40, componentType: 'material' },
          { componentCode: 'LAB-EXT-INST', componentName: 'مصنعية تركيب وتثبيت واستيكر فحص', unit: 'item', qtyPerUnit: 1.0, unitRate: 90, componentType: 'labor' },
        ]),
        notes: 'طفاية حريق يدوية بودرة جافة ABC للأماكن العامة والممرات.',
      },
      {
        item_code: 'FF-EXT-CO2-06',
        item_name: 'طفاية حريق غاز ثاني أكسيد الكربون CO2 سعة 6 كجم لغرف ولوحات الكهرباء',
        unit: 'item',
        waste_percent: 2.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'MAT-EXT-CO2-6KG', componentName: 'طفاية غاز CO2 سعة 6 كجم سيملس بالخرطوم والعدسة', unit: 'item', qtyPerUnit: 1.0, unitRate: 1150, componentType: 'material' },
          { componentCode: 'MAT-EXT-BRK', componentName: 'حامل تثبيت جداري ثقيل', unit: 'item', qtyPerUnit: 1.0, unitRate: 60, componentType: 'material' },
          { componentCode: 'LAB-EXT-INST', componentName: 'مصنعية تثبيت واستيكر معايرة', unit: 'item', qtyPerUnit: 1.0, unitRate: 110, componentType: 'labor' },
        ]),
        notes: 'طفاية CO2 سعة 6 كجم للمخاطر واللوحات الكهربائية.',
      },
      {
        item_code: 'FF-SYS-FSRCH-01',
        item_name: 'نظام إطفاء لوحات الكهرباء التلقائي الذاتي Fire Search بأنبوب الاستشعار وشحنة CO2',
        unit: 'ls',
        waste_percent: 2.0,
        overhead_percent: 7.0,
        profit_markup_percent: 15.0,
        components_json: JSON.stringify([
          { componentCode: 'MAT-FSRCH-CYL', componentName: 'أسطوانة غاز CO2/إطفاء مزودة برأس الصمام', unit: 'item', qtyPerUnit: 1.0, unitRate: 3500, componentType: 'material' },
          { componentCode: 'MAT-FSRCH-TUBE', componentName: 'خرطوم استشعار حراري Sensing Tube وكلبسات تثبيت', unit: 'ls', qtyPerUnit: 1.0, unitRate: 1800, componentType: 'material' },
          { componentCode: 'LAB-FSRCH-INST', componentName: 'مصنعية فني متخصص لتركيب وبرمجة واختبار النظام', unit: 'ls', qtyPerUnit: 1.0, unitRate: 1200, componentType: 'labor' },
        ]),
        notes: 'نظام إطفاء ذاتي للوحات الكهربائية بخرطوم استشعاري حراري.',
      },
    ];

    for (const c of defaultConstants) {
      await (this.db)
        .insertInto('contracting_engineering_constants')
        .values({
          tenant_id: tenantId,
          item_code: c.item_code,
          item_name: c.item_name,
          unit: c.unit,
          waste_percent: c.waste_percent,
          overhead_percent: c.overhead_percent,
          profit_markup_percent: c.profit_markup_percent,
          components_json: c.components_json,
          notes: c.notes,
        })
        .onConflict((oc: any) => oc.column('tenant_id').column('item_code').doNothing())
        .execute();
    }
  }

  async createEngineeringConstant(auth: AuthContext, dto: CreateEngineeringConstantDto) {
    const { tenantId } = requireTenantScope(auth);
    const [inserted] = await (this.db)
      .insertInto('contracting_engineering_constants')
      .values({
        tenant_id: tenantId,
        item_code: dto.itemCode.trim().toUpperCase(),
        item_name: dto.itemName.trim(),
        unit: dto.unit || 'm3',
        waste_percent: Number(dto.wastePercent ?? 5.0),
        overhead_percent: Number(dto.overheadPercent ?? 7.0),
        profit_markup_percent: Number(dto.profitMarkupPercent ?? 15.0),
        components_json: JSON.stringify(dto.components || []),
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  async autoPriceBoqItem(auth: AuthContext, dto: AutoPriceBoqItemDto) {
    const { tenantId } = requireTenantScope(auth);
    const constant = await (this.db)
      .selectFrom('contracting_engineering_constants')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('item_code', '=', dto.constantCode.trim().toUpperCase())
      .executeTakeFirst();

    if (!constant) {
      throw new NotFoundException(`المعادلة الهندسية للبند ${dto.constantCode} غير موجودة`);
    }

    const masterPrices = await this.getMasterPriceList(auth);
    const priceMap = new Map<string, number>(masterPrices.map((p: any) => [p.code, Number(p.unitRate || 0)]));

    const components = Array.isArray(constant.components_json) ? constant.components_json : [];
    let unitDirectCost = 0;
    const breakdown = components.map((c: any) => {
      const rate = priceMap.get(c.componentCode) ?? Number(c.unitRate || 0);
      const total = Number(c.qtyPerUnit || 0) * rate;
      unitDirectCost += total;
      return {
        name: c.componentName,
        code: c.componentCode,
        qtyPerUnit: c.qtyPerUnit,
        unit: c.unit,
        unitRate: rate,
        componentCost: total,
      };
    });

    const wastePct = Number(dto.customWastePercent ?? constant.waste_percent ?? 5.0) / 100;
    const overheadPct = Number(dto.customOverheadPercent ?? constant.overhead_percent ?? 7.0) / 100;
    const markupPct = Number(dto.customProfitMarkupPercent ?? constant.profit_markup_percent ?? 15.0) / 100;

    const unitCostWithWaste = unitDirectCost * (1 + wastePct);
    const unitCostWithOverhead = unitCostWithWaste * (1 + overheadPct);
    const suggestedUnitPrice = Math.round(unitCostWithOverhead * (1 + markupPct) * 100) / 100;
    const totalEstimatedCost = Math.round(unitDirectCost * dto.quantity * 100) / 100;
    const totalPrice = Math.round(suggestedUnitPrice * dto.quantity * 100) / 100;
    const projectedProfit = totalPrice - totalEstimatedCost;

    return {
      constantCode: constant.item_code,
      constantName: constant.item_name,
      unit: constant.unit,
      quantity: dto.quantity,
      unitDirectCost: Math.round(unitDirectCost * 100) / 100,
      suggestedUnitPrice,
      totalEstimatedCost,
      totalPrice,
      projectedProfit,
      breakdown,
    };
  }
}
