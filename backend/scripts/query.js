const { Client } = require('pg');
const c = new Client('postgres://postgres:postgres@127.0.0.1:5433/zs_dev');
c.connect().then(() => {
  c.query(
    `
    SELECT
      indexname,
      indexdef
    FROM pg_indexes
    WHERE tablename = 'hr_attendance_records';
  `,
  ).then((r) => {
    console.table(r.rows);
    c.end();
  });
});
