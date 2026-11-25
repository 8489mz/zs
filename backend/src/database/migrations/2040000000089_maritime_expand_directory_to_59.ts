import { sql, type Kysely } from 'kysely';
import { DEFAULT_SHIPPING_LINES, DEFAULT_OVERSEAS_AGENTS } from '../../modules/maritime-freight/maritime-defaults.data';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    // 1. Seed all 20 lines for 'default'
    for (const line of DEFAULT_SHIPPING_LINES) {
      await sql`
        INSERT INTO shipping_lines (
          tenant_id, code, name_ar, name_en, carrier_type, country_name, country_code,
          city_name, contact_person, email, rfq_email, booking_email, phone, whatsapp,
          wechat, trade_lanes, services_offered, supported_ports, tracking_url_template, notes, is_active
        )
        VALUES (
          'default', ${line.code}, ${line.name_ar}, ${line.name_en}, 'shipping_line',
          ${line.country_name || null}, ${line.country_code || null}, ${line.city_name || null},
          ${line.contact_person || null}, ${line.email || null}, ${line.rfq_email || null},
          ${line.booking_email || null}, ${line.phone || null}, ${line.whatsapp || null},
          ${line.wechat || null}, ${line.trade_lanes || null}, ${line.services_offered || null},
          ${line.supported_ports || null}, ${line.tracking_url_template || null}, ${line.notes || null}, true
        )
        ON CONFLICT (tenant_id, code) DO NOTHING;
      `.execute(db);
    }

    // 2. Seed all 39 agents for 'default'
    for (const agent of DEFAULT_OVERSEAS_AGENTS) {
      await sql`
        INSERT INTO shipping_lines (
          tenant_id, code, name_ar, name_en, carrier_type, country_name, country_code,
          city_name, contact_person, email, rfq_email, booking_email, phone, whatsapp,
          wechat, trade_lanes, services_offered, supported_ports, tracking_url_template, notes, is_active
        )
        VALUES (
          'default', ${agent.code}, ${agent.name_ar}, ${agent.name_en}, 'overseas_agent',
          ${agent.country_name || null}, ${agent.country_code || null}, ${agent.city_name || null},
          ${agent.contact_person || null}, ${agent.email || null}, ${agent.rfq_email || null},
          ${agent.booking_email || null}, ${agent.phone || null}, ${agent.whatsapp || null},
          ${agent.wechat || null}, ${agent.trade_lanes || null}, ${agent.services_offered || null},
          ${agent.supported_ports || null}, ${agent.tracking_url_template || null}, ${agent.notes || null}, true
        )
        ON CONFLICT (tenant_id, code) DO NOTHING;
      `.execute(db);
    }
  },

  async down(_db: Kysely<unknown>): Promise<void> {
    // Non-destructive down migration
  },
};
