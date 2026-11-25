const { Client } = require('pg');
const c = new Client('postgres://postgres:postgres@127.0.0.1:5433/zs_dev');
c.connect().then(() => {
  c.query(
    `
    UPDATE hr_employees 
    SET scheduled_check_in_time = '09:00', 
        scheduled_check_out_time = '17:00',
        grace_minutes = 15
    WHERE tenant_id = 'default'
  `,
  ).then((r) => {
    console.log(`Updated ${r.rowCount} employees`);
    c.end();
  });
});
