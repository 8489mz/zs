import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { sql, Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import {
  DEFAULT_SHIPPING_LINES,
  DEFAULT_OVERSEAS_AGENTS,
  DEFAULT_SHIPPING_PORTS,
  DEFAULT_AIRLINES,
  DEFAULT_CARGO_AIRPORTS,
  DEFAULT_TRUCKING_COMPANIES,
  DEFAULT_DRY_PORTS_DEPOTS,
  DEFAULT_CONTAINER_TYPES,
  DEFAULT_INCOTERMS,
  DEFAULT_PORT_TERMINALS,
} from './maritime-defaults.data';

/**
 * MaritimeFreightMasterDataService — slice S1 of the maritime-freight split.
 * Pure move of 11 methods from MaritimeFreightService (master data:
 * default seeding, counts, ports, shipping lines, reference data,
 * bulk carrier import). No behavior change: the bodies are byte-identical
 * (ensureDefaultMasterData keeps its JSDoc; the two section banners travel
 * with their methods); the facade keeps thin delegates with the same names
 * and signatures. Deps are db only — no cross-slice deps, no posting, no
 * mail, no WhatsApp. The slice declares its own Logger (the facade's
 * logger field does not transfer; the facade logger becomes unused only
 * after ALL slices land — merge-owned prune decision). No clock sites in
 * the moved text (no new Date / toISOString / Date.now at all) and no
 * guard sites (toFixed / inlineRound / roundMoney / currencyMoneyDigits
 * all 0). ensureDefaultMasterData (222L) is the biggest method in the
 * file, unpinned + in-class-only — pure move, recorded, not a blocker.
 * No spec repoint travels in this patch — merge-owned.
 */

export interface MaritimeFreightMasterDataDeps {
  db: Kysely<Database>;
}

@Injectable()
export class MaritimeFreightMasterDataService {
  private readonly logger = new Logger(MaritimeFreightMasterDataService.name);
  private readonly db: Kysely<Database>;

  constructor(deps: MaritimeFreightMasterDataDeps) {
    this.db = deps.db;
  }

  /**
   * Ensures hardcoded master catalog (14 shipping lines, 27 overseas agents, 18 ports)
   * is seeded for the specified tenant. If records are missing, it safely seeds them
   * without overwriting existing client modifications.
   */
  async ensureDefaultMasterData(tenantId: string): Promise<{
    portsAdded: number;
    linesAdded: number;
    agentsAdded: number;
    airlinesAdded: number;
    airportsAdded: number;
    truckingAdded: number;
    dryPortsAdded: number;
  }> {
    if (!tenantId)
      return {
        portsAdded: 0,
        linesAdded: 0,
        agentsAdded: 0,
        airlinesAdded: 0,
        airportsAdded: 0,
        truckingAdded: 0,
        dryPortsAdded: 0,
      };

    let portsAdded = 0;
    let linesAdded = 0;
    let agentsAdded = 0;
    let airlinesAdded = 0;
    let airportsAdded = 0;
    let truckingAdded = 0;
    let dryPortsAdded = 0;

    try {
      // 1. Check & Seed Ports for this tenant
      const existingPorts = await this.db
        .selectFrom('shipping_ports')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .execute();

      const existingPortCodes = new Set(existingPorts.map((p) => p.code));
      const missingPorts = DEFAULT_SHIPPING_PORTS.filter((p) => !existingPortCodes.has(p.code));

      for (const port of missingPorts) {
        await sql`
          INSERT INTO shipping_ports (tenant_id, code, name_ar, name_en, country_code, country_name, port_type, is_active)
          VALUES (${tenantId}, ${port.code}, ${port.name_ar}, ${port.name_en}, ${port.country_code}, ${port.country_name}, 'sea', true)
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        portsAdded++;
      }

      // 2. Check & Seed Shipping Lines for this tenant
      const existingLines = await this.db
        .selectFrom('shipping_lines')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where('carrier_type', '=', 'shipping_line')
        .execute();

      const existingLineCodes = new Set(existingLines.map((l) => l.code));
      const missingLines = DEFAULT_SHIPPING_LINES.filter((l) => !existingLineCodes.has(l.code));

      for (const line of missingLines) {
        await sql`
          INSERT INTO shipping_lines (
            tenant_id, code, name_ar, name_en, carrier_type, country_name, country_code,
            city_name, contact_person, email, rfq_email, booking_email, phone, whatsapp,
            wechat, trade_lanes, services_offered, supported_ports, notes, is_active
          )
          VALUES (
            ${tenantId}, ${line.code}, ${line.name_ar}, ${line.name_en}, 'shipping_line',
            ${line.country_name || null}, ${line.country_code || null}, ${line.city_name || null},
            ${line.contact_person || null}, ${line.email || null}, ${line.rfq_email || null},
            ${line.booking_email || null}, ${line.phone || null}, ${line.whatsapp || null},
            ${line.wechat || null}, ${line.trade_lanes || null}, ${line.services_offered || null},
            ${line.supported_ports || null}, ${line.notes || null}, true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        linesAdded++;
      }

      // 3. Check & Seed Overseas Agents for this tenant
      const existingAgents = await this.db
        .selectFrom('shipping_lines')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where('carrier_type', '=', 'overseas_agent')
        .execute();

      const existingAgentCodes = new Set(existingAgents.map((a) => a.code));
      const missingAgents = DEFAULT_OVERSEAS_AGENTS.filter((a) => !existingAgentCodes.has(a.code));

      for (const agent of missingAgents) {
        await sql`
          INSERT INTO shipping_lines (
            tenant_id, code, name_ar, name_en, carrier_type, country_name, country_code,
            city_name, contact_person, email, rfq_email, booking_email, phone, whatsapp,
            wechat, trade_lanes, services_offered, supported_ports, notes, is_active
          )
          VALUES (
            ${tenantId}, ${agent.code}, ${agent.name_ar}, ${agent.name_en}, 'overseas_agent',
            ${agent.country_name || null}, ${agent.country_code || null}, ${agent.city_name || null},
            ${agent.contact_person || null}, ${agent.email || null}, ${agent.rfq_email || null},
            ${agent.booking_email || null}, ${agent.phone || null}, ${agent.whatsapp || null},
            ${agent.wechat || null}, ${agent.trade_lanes || null}, ${agent.services_offered || null},
            ${agent.supported_ports || null}, ${agent.notes || null}, true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        agentsAdded++;
      }

      // 4. Check & Seed Airlines for this tenant
      const existingAirlines = await this.db
        .selectFrom('shipping_lines')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where('carrier_type', '=', 'airline')
        .execute();

      const existingAirlineCodes = new Set(existingAirlines.map((l) => l.code));
      const missingAirlines = DEFAULT_AIRLINES.filter((l) => !existingAirlineCodes.has(l.code));

      for (const airline of missingAirlines) {
        await sql`
          INSERT INTO shipping_lines (
            tenant_id, code, name_ar, name_en, carrier_type, airline_prefix, country_name, country_code,
            city_name, contact_person, email, rfq_email, booking_email, phone,
            trade_lanes, services_offered, notes, is_active
          )
          VALUES (
            ${tenantId}, ${airline.code}, ${airline.name_ar}, ${airline.name_en}, 'airline',
            ${airline.airline_prefix || null}, ${airline.country_name || null}, ${airline.country_code || null},
            ${airline.city_name || null}, ${airline.contact_person || null}, ${airline.email || null},
            ${airline.rfq_email || null}, ${airline.booking_email || null}, ${airline.phone || null},
            ${airline.trade_lanes || null}, ${airline.services_offered || null},
            ${airline.notes || null}, true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        airlinesAdded++;
      }

      // 5. Check & Seed Cargo Airports for this tenant
      const existingAirports = await this.db
        .selectFrom('shipping_ports')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where((eb) => eb.or([eb('port_type', '=', 'air'), eb('iata_code', 'is not', null)]))
        .execute();

      const existingAirportCodes = new Set(existingAirports.map((p) => p.code));
      const missingAirports = DEFAULT_CARGO_AIRPORTS.filter((p) => !existingAirportCodes.has(p.code));

      for (const airport of missingAirports) {
        await sql`
          INSERT INTO shipping_ports (
            tenant_id, code, name_ar, name_en, country_code, country_name, port_type, iata_code, is_active
          )
          VALUES (
            ${tenantId}, ${airport.code}, ${airport.name_ar}, ${airport.name_en}, ${airport.country_code},
            ${airport.country_name}, 'air', ${airport.iata_code || airport.code}, true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        airportsAdded++;
      }

      // 6. Check & Seed Trucking Companies for this tenant
      const existingTrucking = await this.db
        .selectFrom('shipping_lines')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where('carrier_type', '=', 'trucking')
        .execute();

      const existingTruckingCodes = new Set(existingTrucking.map((t) => t.code));
      const missingTrucking = DEFAULT_TRUCKING_COMPANIES.filter((t) => !existingTruckingCodes.has(t.code));

      for (const trucking of missingTrucking) {
        await sql`
          INSERT INTO shipping_lines (
            tenant_id, code, name_ar, name_en, carrier_type, country_name, country_code,
            city_name, contact_person, email, rfq_email, booking_email, phone, whatsapp,
            trade_lanes, services_offered, notes, is_active
          )
          VALUES (
            ${tenantId}, ${trucking.code}, ${trucking.name_ar}, ${trucking.name_en}, 'trucking',
            ${trucking.country_name || null}, ${trucking.country_code || null},
            ${trucking.city_name || null}, ${trucking.contact_person || null}, ${trucking.email || null},
            ${trucking.rfq_email || null}, ${trucking.booking_email || null}, ${trucking.phone || null}, ${trucking.whatsapp || null},
            ${trucking.trade_lanes || null}, ${trucking.services_offered || null},
            ${trucking.notes || null}, true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        truckingAdded++;
      }

      // 7. Check & Seed Dry Ports & Inland Depots for this tenant
      const existingDryPorts = await this.db
        .selectFrom('shipping_ports')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where('port_type', '=', 'land')
        .execute();

      const existingDryPortCodes = new Set(existingDryPorts.map((p) => p.code));
      const missingDryPorts = DEFAULT_DRY_PORTS_DEPOTS.filter((p) => !existingDryPortCodes.has(p.code));

      for (const dryPort of missingDryPorts) {
        await sql`
          INSERT INTO shipping_ports (
            tenant_id, code, name_ar, name_en, country_code, country_name, port_type, is_active
          )
          VALUES (
            ${tenantId}, ${dryPort.code}, ${dryPort.name_ar}, ${dryPort.name_en}, ${dryPort.country_code},
            ${dryPort.country_name}, 'land', true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        dryPortsAdded++;
      }

      if (
        portsAdded > 0 ||
        linesAdded > 0 ||
        agentsAdded > 0 ||
        airlinesAdded > 0 ||
        airportsAdded > 0 ||
        truckingAdded > 0 ||
        dryPortsAdded > 0
      ) {
        this.logger.log(
          `Seeded maritime defaults for tenant ${tenantId}: ports=${portsAdded}, lines=${linesAdded}, agents=${agentsAdded}, airlines=${airlinesAdded}, airports=${airportsAdded}, trucking=${truckingAdded}, dryPorts=${dryPortsAdded}`,
        );
      }
    } catch (err) {
      this.logger.error(`Error ensuring maritime defaults for tenant ${tenantId}:`, err);
    }

    return { portsAdded, linesAdded, agentsAdded, airlinesAdded, airportsAdded, truckingAdded, dryPortsAdded };
  }

  async seedDefaultMasterData(auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    return await this.ensureDefaultMasterData(tenantId);
  }

  async getCounts(auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);

    const [inquiries, rfqs, bids, quotes, jobs, containers, ports, lines] = await Promise.all([
      this.db
        .selectFrom('maritime_inquiries')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('maritime_rfqs')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('maritime_rfq_bids')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('maritime_quotations')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('maritime_jobs')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('maritime_containers')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('shipping_ports')
        .where((eb) => eb.or([eb('tenant_id', '=', tenantId), eb('tenant_id', '=', 'default')]))
        .where('is_active', '=', true)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('shipping_lines')
        .where((eb) => eb.or([eb('tenant_id', '=', tenantId), eb('tenant_id', '=', 'default')]))
        .where('is_active', '=', true)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
    ]);

    return {
      inquiries: Number(inquiries?.count || 0),
      rfqs: Number(rfqs?.count || 0),
      matrixBids: Number(bids?.count || 0),
      quotations: Number(quotes?.count || 0),
      jobs: Number(jobs?.count || 0),
      containers: Number(containers?.count || 0),
      master: Number(ports?.count || 0) + Number(lines?.count || 0),
      settings: 0,
    };
  }

  // --------------------------------------------------------------------------
  // 1. Ports Master Data
  // --------------------------------------------------------------------------
  async getPorts(auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    await this.ensureDefaultMasterData(tenantId);
    const tenantPorts = await this.db
      .selectFrom('shipping_ports')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .orderBy('name_ar', 'asc')
      .execute();

    if (tenantPorts.length > 0) {
      return tenantPorts;
    }

    return await this.db
      .selectFrom('shipping_ports')
      .selectAll()
      .where('tenant_id', '=', 'default')
      .where('is_active', '=', true)
      .orderBy('name_ar', 'asc')
      .execute();
  }

  async createPort(
    auth: AuthContext,
    data: { code: string; nameAr: string; nameEn: string; countryCode: string; countryName: string },
  ) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('shipping_ports')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', data.code.toUpperCase())
      .executeTakeFirst();

    if (existing) {
      throw new BadRequestException(`Port with UN/LOCODE ${data.code} already exists`);
    }

    const [inserted] = await this.db
      .insertInto('shipping_ports')
      .values({
        tenant_id: tenantId,
        code: data.code.toUpperCase(),
        name_ar: data.nameAr,
        name_en: data.nameEn,
        country_code: data.countryCode.toUpperCase(),
        country_name: data.countryName,
        is_active: true,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  // --------------------------------------------------------------------------
  // 2. Shipping Lines Master Data
  // --------------------------------------------------------------------------
  async getShippingLines(
    auth: AuthContext,
    filters?: { carrierType?: string; tradeLane?: string; countryCode?: string; search?: string },
  ) {
    const { tenantId } = requireTenantScope(auth);
    await this.ensureDefaultMasterData(tenantId);

    const buildQuery = (scopedTenantId: string) => {
      let q = this.db
        .selectFrom('shipping_lines')
        .selectAll()
        .where('tenant_id', '=', scopedTenantId)
        .where('is_active', '=', true);

      if (filters?.carrierType && filters.carrierType !== 'all') {
        q = q.where('carrier_type', '=', filters.carrierType as any);
      }

      if (filters?.tradeLane && filters.tradeLane !== 'all') {
        q = q.where('trade_lanes', 'like', `%${filters.tradeLane}%`);
      }

      if (filters?.countryCode && filters.countryCode !== 'all') {
        q = q.where('country_code', '=', filters.countryCode.toUpperCase());
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        q = q.where((eb) =>
          eb.or([
            eb('code', 'ilike', term),
            eb('name_ar', 'ilike', term),
            eb('name_en', 'ilike', term),
            eb('contact_person', 'ilike', term),
            eb('country_name', 'ilike', term),
            eb('city_name', 'ilike', term),
            eb('rfq_email', 'ilike', term),
          ]),
        );
      }

      return q.orderBy('carrier_type', 'asc').orderBy('name_ar', 'asc');
    };

    const tenantLines = await buildQuery(tenantId).execute();
    if (tenantLines.length > 0) {
      return tenantLines;
    }

    // Fallback to default tenant catalog if tenant has not yet seeded
    return await buildQuery('default').execute();
  }

  async createShippingLine(
    auth: AuthContext,
    data: {
      code: string;
      nameAr: string;
      nameEn?: string;
      // Widened in D4 (INV-DTO-MARITIME-FREIGHT-28): the form sends
      // 'airline' and 'trucking' too, and the body maps anything that
      // is not 'overseas_agent' to 'shipping_line' — the declared
      // union lied by omitting them.
      carrierType?: 'shipping_line' | 'overseas_agent' | 'airline' | 'trucking';
      tradeLanes?: string;
      countryName?: string;
      countryCode?: string;
      cityName?: string;
      contactPerson?: string;
      email?: string;
      rfqEmail?: string;
      bookingEmail?: string;
      phone?: string;
      whatsapp?: string;
      wechat?: string;
      servicesOffered?: string;
      supportedPorts?: string;
      notes?: string;
    },
  ) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('shipping_lines')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', data.code.toUpperCase())
      .executeTakeFirst();

    if (existing) {
      throw new BadRequestException(`Carrier/Agent with code ${data.code} already exists`);
    }

    const [inserted] = await this.db
      .insertInto('shipping_lines')
      .values({
        tenant_id: tenantId,
        code: data.code.toUpperCase(),
        name_ar: data.nameAr,
        name_en: data.nameEn || data.nameAr,
        carrier_type: data.carrierType || 'shipping_line',
        trade_lanes: data.tradeLanes || null,
        country_name: data.countryName || null,
        country_code: data.countryCode ? data.countryCode.toUpperCase() : null,
        city_name: data.cityName || null,
        contact_person: data.contactPerson || null,
        email: data.email || null,
        rfq_email: data.rfqEmail || null,
        booking_email: data.bookingEmail || null,
        phone: data.phone || null,
        whatsapp: data.whatsapp || null,
        wechat: data.wechat || null,
        services_offered: data.servicesOffered || null,
        supported_ports: data.supportedPorts || null,
        notes: data.notes || null,
        is_active: true,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  getReferenceData() {
    return {
      containerTypes: DEFAULT_CONTAINER_TYPES,
      incoterms: DEFAULT_INCOTERMS,
      portTerminals: DEFAULT_PORT_TERMINALS,
    };
  }

  async importCarriersBulk(auth: AuthContext, items: any[]) {
    const { tenantId } = requireTenantScope(auth);
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('قائمة البيانات المستوردة فارغة');
    }

    let insertedCount = 0;
    let updatedCount = 0;

    for (const item of items) {
      const code = String(item.code || '')
        .trim()
        .toUpperCase();
      const nameAr = String(item.nameAr || item.name_ar || '').trim();
      if (!code || !nameAr) continue;

      const carrierType =
        item.carrierType === 'overseas_agent' || item.carrier_type === 'overseas_agent'
          ? 'overseas_agent'
          : 'shipping_line';

      const existing = await this.db
        .selectFrom('shipping_lines')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('code', '=', code)
        .executeTakeFirst();

      if (existing) {
        await this.db
          .updateTable('shipping_lines')
          .set({
            name_ar: nameAr,
            name_en: item.nameEn || item.name_en || nameAr,
            carrier_type: carrierType,
            country_name: item.countryName || item.country_name || null,
            country_code:
              item.countryCode || item.country_code
                ? String(item.countryCode || item.country_code).toUpperCase()
                : null,
            city_name: item.cityName || item.city_name || null,
            contact_person: item.contactPerson || item.contact_person || null,
            email: item.email || null,
            rfq_email: item.rfqEmail || item.rfq_email || item.email || null,
            booking_email: item.bookingEmail || item.booking_email || null,
            phone: item.phone || null,
            whatsapp: item.whatsapp || null,
            wechat: item.wechat || null,
            trade_lanes: item.tradeLanes || item.trade_lanes || null,
            services_offered: item.servicesOffered || item.services_offered || null,
            supported_ports: item.supportedPorts || item.supported_ports || null,
            notes: item.notes || null,
            is_active: true,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', existing.id)
          .where('tenant_id', '=', tenantId)
          .execute();
        updatedCount++;
      } else {
        await this.db
          .insertInto('shipping_lines')
          .values({
            tenant_id: tenantId,
            code,
            name_ar: nameAr,
            name_en: item.nameEn || item.name_en || nameAr,
            carrier_type: carrierType,
            country_name: item.countryName || item.country_name || null,
            country_code:
              item.countryCode || item.country_code
                ? String(item.countryCode || item.country_code).toUpperCase()
                : null,
            city_name: item.cityName || item.city_name || null,
            contact_person: item.contactPerson || item.contact_person || null,
            email: item.email || null,
            rfq_email: item.rfqEmail || item.rfq_email || item.email || null,
            booking_email: item.bookingEmail || item.booking_email || null,
            phone: item.phone || null,
            whatsapp: item.whatsapp || null,
            wechat: item.wechat || null,
            trade_lanes: item.tradeLanes || item.trade_lanes || null,
            services_offered: item.servicesOffered || item.services_offered || null,
            supported_ports: item.supportedPorts || item.supported_ports || null,
            notes: item.notes || null,
            is_active: true,
          })
          .execute();
        insertedCount++;
      }
    }

    return { insertedCount, updatedCount, totalProcessed: insertedCount + updatedCount };
  }

  async updateShippingLine(auth: AuthContext, id: string, data: any) {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await this.db
      .updateTable('shipping_lines')
      .set({
        name_ar: data.nameAr,
        name_en: data.nameEn,
        carrier_type: data.carrierType,
        trade_lanes: data.tradeLanes,
        country_name: data.countryName,
        country_code: data.countryCode ? data.countryCode.toUpperCase() : undefined,
        city_name: data.cityName,
        contact_person: data.contactPerson,
        email: data.email,
        rfq_email: data.rfqEmail,
        booking_email: data.bookingEmail,
        phone: data.phone,
        whatsapp: data.whatsapp,
        wechat: data.wechat,
        services_offered: data.servicesOffered,
        supported_ports: data.supportedPorts,
        notes: data.notes,
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    return updated;
  }

  async deleteShippingLine(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await this.db
      .updateTable('shipping_lines')
      .set({ is_active: false, updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .execute();

    return { success: true };
  }
}
