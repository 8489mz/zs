import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    // 1. Add partner classification, trade lanes, overseas fields to shipping_lines
    await sql`
      ALTER TABLE shipping_lines
      ADD COLUMN IF NOT EXISTS carrier_type TEXT NOT NULL DEFAULT 'shipping_line',
      ADD COLUMN IF NOT EXISTS trade_lanes TEXT NULL,
      ADD COLUMN IF NOT EXISTS country_name TEXT NULL,
      ADD COLUMN IF NOT EXISTS country_code TEXT NULL,
      ADD COLUMN IF NOT EXISTS city_name TEXT NULL,
      ADD COLUMN IF NOT EXISTS booking_email TEXT NULL,
      ADD COLUMN IF NOT EXISTS whatsapp TEXT NULL,
      ADD COLUMN IF NOT EXISTS wechat TEXT NULL,
      ADD COLUMN IF NOT EXISTS services_offered TEXT NULL,
      ADD COLUMN IF NOT EXISTS supported_ports TEXT NULL;
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_shipping_lines_type_tenant 
      ON shipping_lines (tenant_id, carrier_type, is_active);
    `.execute(db);

    // 2. Update default lines with standard trade lanes
    await sql`
      UPDATE shipping_lines
      SET trade_lanes = 'far_east,europe_med,americas,arabian_gulf',
          country_name = 'مصر',
          country_code = 'EG',
          services_offered = 'FCL, Reefers, Special Equipment'
      WHERE trade_lanes IS NULL AND carrier_type = 'shipping_line';
    `.execute(db);

    // 3. Seed professional overseas forwarding partners (e.g., China, Turkey, Germany) for default tenant
    await sql`
      INSERT INTO shipping_lines (
        tenant_id, code, name_ar, name_en, carrier_type, trade_lanes,
        country_name, country_code, city_name, contact_person, email, rfq_email, booking_email,
        phone, whatsapp, wechat, services_offered, notes
      )
      VALUES 
      (
        'default', 'AGT-CN-SHA', 'شنغهاي لوجستكس بارتنرز (وكيل الصين)', 'Shanghai Trans-Logistics Co., Ltd.', 'overseas_agent', 'far_east',
        'الصين', 'CN', 'شنغهاي', 'Mr. David Wang', 'rates@shanghaitrans.cn', 'rates@shanghaitrans.cn', 'booking@shanghaitrans.cn',
        '+86 21 6888 1234', '+86 139 1888 5678', 'shanghai_trans_rates', 'EXW, FOB, FCL, LCL, Customs Clearance, Factory Inspection', 'وكيل شحن وممثل معتمد بموانئ الصين (شنغهاي، نينغبو، شنتشن، تشينغداو)'
      ),
      (
        'default', 'AGT-TR-IST', 'الأناضول للشحن واللوجستيات (وكيل تركيا)', 'Anatolia Freight Forwarding Istanbul', 'overseas_agent', 'europe_med',
        'تركيا', 'TR', 'إسطنبول', 'Murat Yilmaz', 'pricing@anatoliafreight.com.tr', 'pricing@anatoliafreight.com.tr', 'operations@anatoliafreight.com.tr',
        '+90 212 450 8900', '+90 532 123 4567', null, 'EXW, FOB, Door Delivery, Customs, Trucking, FCL', 'وكيل معتمد للشحنات التركية وموانئ أمبارلي وإزمير ومرسين'
      ),
      (
        'default', 'AGT-DE-HAM', 'هانزا للشحن الدولي (وكيل ألمانيا وأوروبا)', 'Hansa Cargo Solutions Hamburg', 'overseas_agent', 'europe_med',
        'ألمانيا', 'DE', 'هامبورغ', 'Klaus Schneider', 'rates@hansacargo.de', 'rates@hansacargo.de', 'order@hansacargo.de',
        '+49 40 3344 5500', '+49 171 987 6543', null, 'FCL, LCL, Heavy Machinery, Intermodal, German Customs Export', 'تغطية موانئ شمال وغرب أوروبا (هامبورغ، روتردام، أنتويرب)'
      )
      ON CONFLICT (tenant_id, code) DO NOTHING;
    `.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE shipping_lines
      DROP COLUMN IF EXISTS carrier_type,
      DROP COLUMN IF EXISTS trade_lanes,
      DROP COLUMN IF EXISTS country_name,
      DROP COLUMN IF EXISTS country_code,
      DROP COLUMN IF EXISTS city_name,
      DROP COLUMN IF EXISTS booking_email,
      DROP COLUMN IF EXISTS whatsapp,
      DROP COLUMN IF EXISTS wechat,
      DROP COLUMN IF EXISTS services_offered,
      DROP COLUMN IF EXISTS supported_ports;
    `.execute(db);
  },
};
