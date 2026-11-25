const { Client } = require('pg');

if (process.env.APP_MODE !== 'LOCAL_PILOT') {
  console.error('This script is a Developer-only tool and cannot be run in this environment.');
  process.exit(1);
}

async function main() {
  const pg = new Client({ user: 'postgres', password: 'postgres', host: '127.0.0.1', port: 5433, database: 'zs_dev' });
  await pg.connect();

  const wo = await pg.query(
    'SELECT id, bom_id, quantity_to_produce, total_cost FROM manufacturing_work_orders ORDER BY id DESC LIMIT 1',
  );
  if (wo.rows.length === 0) {
    console.log('No work order found.');
    return pg.end();
  }

  const bom = await pg.query('SELECT product_id, expected_cost, overhead_cost FROM manufacturing_boms WHERE id = $1', [
    wo.rows[0].bom_id,
  ]);
  const fgId = bom.rows[0].product_id;

  const rm = await pg.query(
    'SELECT component_product_id, expected_cost, quantity FROM manufacturing_bom_lines WHERE bom_id = $1 LIMIT 1',
    [wo.rows[0].bom_id],
  );
  const rmId = rm.rows[0].component_product_id;

  const fgStock = await pg.query('SELECT stock_qty FROM products WHERE id = $1', [fgId]);
  const fgLocStock = await pg.query('SELECT sum(qty) as s FROM product_location_stock WHERE product_id = $1', [fgId]);

  const rmStock = await pg.query('SELECT stock_qty FROM products WHERE id = $1', [rmId]);
  const rmLocStock = await pg.query('SELECT sum(qty) as s FROM product_location_stock WHERE product_id = $1', [rmId]);

  const journal = await pg.query('SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2', [
    'manufacturing_work_order',
    String(wo.rows[0].id),
  ]);

  console.log(
    JSON.stringify(
      {
        wo: wo.rows[0],
        bom: bom.rows[0],
        rmLine: rm.rows[0],
        fgStock: fgStock.rows[0],
        fgLocStock: fgLocStock.rows[0],
        rmStock: rmStock.rows[0],
        rmLocStock: rmLocStock.rows[0],
        journalCount: journal.rows.length,
      },
      null,
      2,
    ),
  );

  pg.end();
}

main();
