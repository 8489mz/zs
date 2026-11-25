const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

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
    // We will just fetch the default admin user to get tenant and account context
    const res = await client.query('SELECT tenant_id, account_id FROM users LIMIT 1');
    if (!res.rows.length) throw new Error('No user found');
    const tenantId = res.rows[0].tenant_id;
    const accountId = res.rows[0].account_id;

    const empRes = await client.query(
      'SELECT id, employee_no, first_name FROM hr_employees WHERE tenant_id = $1 ORDER BY id',
      [tenantId],
    );
    let employees = empRes.rows;

    for (let i = employees.length; i < 4; i++) {
      const code = `EMP00${i + 1}`;
      await client.query(
        `
        INSERT INTO hr_employees (tenant_id, account_id, employee_no, first_name, last_name, compensation_type, status, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, 'active', 1, 1)
      `,
        [tenantId, accountId, code, `MockEmp${i + 1}`, 'Test', i < 2 ? 'monthly' : 'hourly'],
      );
    }

    const updatedEmpRes = await client.query(
      'SELECT id, employee_no, first_name FROM hr_employees WHERE tenant_id = $1 ORDER BY id LIMIT 4',
      [tenantId],
    );
    employees = updatedEmpRes.rows;

    await client.query(`UPDATE hr_employees SET compensation_type = 'monthly' WHERE id = $1 OR id = $2`, [
      employees[0].id,
      employees[1].id,
    ]);
    await client.query(`UPDATE hr_employees SET compensation_type = 'hourly' WHERE id = $1 OR id = $2`, [
      employees[2].id,
      employees[3].id,
    ]);

    for (let i = 0; i < 4; i++) {
      const emp = employees[i];
      const hasContract = await client.query(`SELECT id FROM hr_employment_contracts WHERE employee_id = $1`, [emp.id]);
      if (hasContract.rows.length === 0) {
        await client.query(
          `
          INSERT INTO hr_employment_contracts (tenant_id, account_id, employee_id, contract_no, contract_type, status, start_date, base_salary, currency, created_by, updated_by)
          VALUES ($1, $2, $3, $4, 'standard', 'active', '2025-01-01', $5, 'EGP', 1, 1)
        `,
          [tenantId, accountId, emp.id, `C-${emp.employee_no}`, i < 2 ? 10000 : 50],
        );
      } else {
        await client.query(
          `UPDATE hr_employment_contracts SET status = 'active', base_salary = $1 WHERE employee_id = $2`,
          [i < 2 ? 10000 : 50, emp.id],
        );
      }
    }

    try {
      const hasShift = await client.query(`SELECT id FROM hr_shifts LIMIT 1`);
      let shiftId;
      if (hasShift.rows.length === 0) {
        const newShift = await client.query(
          `
             INSERT INTO hr_shifts (tenant_id, account_id, name, shift_type, start_time, end_time, created_by, updated_by)
             VALUES ($1, $2, 'Standard Shift', 'fixed', '09:00', '17:00', 1, 1) RETURNING id
           `,
          [tenantId, accountId],
        );
        shiftId = newShift.rows[0].id;
      } else {
        shiftId = hasShift.rows[0].id;
        await client.query(`UPDATE hr_shifts SET start_time = '09:00', end_time = '17:00' WHERE id = $1`, [shiftId]);
      }

      await client.query(`DELETE FROM hr_employee_shifts WHERE tenant_id = $1`, [tenantId]);

      for (let i = 0; i < 4; i++) {
        await client.query(
          `
                INSERT INTO hr_employee_shifts (tenant_id, account_id, employee_id, shift_id, effective_from, created_by, updated_by)
                VALUES ($1, $2, $3, $4, '2025-01-01', 1, 1)
            `,
          [tenantId, accountId, employees[i].id, shiftId],
        );
      }
    } catch (e) {
      console.log('Skipping shift setup:', e.message);
    }

    const csvLines = [
      'كود الموظف,التاريخ,وقت الحضور,وقت الانصراف',
      `${employees[0].employee_no},2026-07-01,09:45,17:00`,
      `${employees[1].employee_no},2026-07-01,08:50,19:00`,
      `${employees[2].employee_no},2026-07-01,08:00,15:00`,
      `${employees[3].employee_no},2026-07-01,09:00,17:00`,
      `${employees[1].employee_no},2026-07-02,09:30,19:30`,
      `${employees[2].employee_no},2026-07-02,10:00,14:00`,
      `${employees[3].employee_no},2026-07-02,07:30,18:30`,
    ];

    const csvPath = path.join(__dirname, '..', '..', 'attendance_test_full.csv');
    fs.writeFileSync(csvPath, csvLines.join('\\n'), 'utf8');
    console.log('Success! File written to', csvPath);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
seed();
