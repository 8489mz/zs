const { Client } = require('pg');

async function seed() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5433,
    database: 'zs_dev',
    user: 'postgres',
    password: 'postgres',
  });

  await client.connect();

  try {
    const res = await client.query('SELECT tenant_id, account_id, id as user_id FROM users LIMIT 1');
    if (!res.rows.length) throw new Error('No user found');
    const tenantId = res.rows[0].tenant_id;
    const accountId = res.rows[0].account_id;
    const userId = res.rows[0].user_id;

    const empRes = await client.query(
      'SELECT id, employee_no FROM hr_employees WHERE tenant_id = $1 ORDER BY id LIMIT 4',
      [tenantId],
    );
    const employees = empRes.rows;

    if (employees.length < 4) {
      throw new Error('Not enough employees, please run previous script first.');
    }

    // Delete existing records for these days so we can re-run
    await client.query(
      `DELETE FROM hr_attendance_records WHERE tenant_id = $1 AND work_date IN ('2026-07-01', '2026-07-02')`,
      [tenantId],
    );

    const records = [
      // Day 1: 2026-07-01
      // Emp 0 (Monthly): Late Check-in, Normal Checkout
      { emp: employees[0], date: '2026-07-01', in: '09:45:00', out: '17:00:00' },
      // Emp 1 (Monthly): Normal Check-in, Overtime Checkout
      { emp: employees[1], date: '2026-07-01', in: '08:50:00', out: '19:00:00' },
      // Emp 2 (Hourly): Early Check-in, Early Checkout
      { emp: employees[2], date: '2026-07-01', in: '08:00:00', out: '15:00:00' },
      // Emp 3 (Hourly): Normal Check-in, Normal Checkout
      { emp: employees[3], date: '2026-07-01', in: '09:00:00', out: '17:00:00' },

      // Day 2: 2026-07-02
      // Emp 0 (Monthly): Absent (no record)
      // Emp 1 (Monthly): Late Check-in, Overtime Checkout
      { emp: employees[1], date: '2026-07-02', in: '09:30:00', out: '19:30:00' },
      // Emp 2 (Hourly): Late Check-in, Early Checkout
      { emp: employees[2], date: '2026-07-02', in: '10:00:00', out: '14:00:00' },
      // Emp 3 (Hourly): Early Check-in, Overtime Checkout
      { emp: employees[3], date: '2026-07-02', in: '07:30:00', out: '18:30:00' },
    ];

    for (const rec of records) {
      await client.query(
        `
        INSERT INTO hr_attendance_records (
          tenant_id, account_id, employee_id, work_date, status, check_in_at, check_out_at, source, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, 'present', $5, $6, 'import', $7, $8)
      `,
        [
          tenantId,
          accountId,
          rec.emp.id,
          rec.date,
          `${rec.date}T${rec.in}Z`,
          `${rec.date}T${rec.out}Z`,
          userId,
          userId,
        ],
      );
    }

    console.log('Successfully inserted attendance records directly to DB.');
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

seed();
