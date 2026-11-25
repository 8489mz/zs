import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.development') });

async function main() {
  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
  });

  try {
    const { rows } = await pool.query('SELECT id, permissions_json FROM users');
    let updatedCount = 0;

    for (const row of rows) {
      let perms = [];
      try {
        perms = typeof row.permissions_json === 'string' ? JSON.parse(row.permissions_json) : row.permissions_json;
      } catch (e) {
        continue;
      }

      if (!Array.isArray(perms)) continue;

      let changed = false;
      if (perms.includes('hrEmployees') && !perms.includes('hrAttendance')) {
        perms.push('hrAttendance');
        changed = true;
      }
      if (perms.includes('hrAttendance') && !perms.includes('hr')) {
        perms.push('hr');
        changed = true;
      }
      if (row.role === 'cashier') {
        // for existing cashiers
        if (perms.includes('products')) {
          perms = perms.filter((p) => p !== 'products');
          changed = true;
        }
        if (!perms.includes('hrAttendance')) {
          perms.push('hrAttendance');
          changed = true;
        }
        if (!perms.includes('hr')) {
          perms.push('hr');
          changed = true;
        }
        if (!perms.includes('deliveryReps')) {
          perms.push('deliveryReps');
          changed = true;
        }
        if (!perms.includes('accounts')) {
          perms.push('accounts');
          changed = true;
        }
        if (!perms.includes('purchases')) {
          perms.push('purchases');
          changed = true;
        }
        if (!perms.includes('suppliers')) {
          perms.push('suppliers');
          changed = true;
        }
        if (!perms.includes('products')) {
          perms.push('products');
          changed = true;
        }
      }

      if (changed) {
        await pool.query('UPDATE users SET permissions_json = $1 WHERE id = $2', [JSON.stringify(perms), row.id]);
        updatedCount++;
      }
    }

    console.log(`Updated ${updatedCount} users to include hrAttendance/hr and fixed existing cashiers.`);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main();
