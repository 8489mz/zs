const { Client } = require('pg');
const jwt = require('jsonwebtoken');

(async () => {
  const c = new Client('postgres://postgres:postgres@127.0.0.1:5433/zs_dev');
  await c.connect();
  const user = (await c.query('SELECT * FROM users LIMIT 1')).rows[0];

  const token = jwt.sign(
    { userId: user.id, accountId: user.account_id, tenantId: user.tenant_id, role: user.role, type: user.user_type },
    process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
    { expiresIn: '1d' },
  );

  const http = require('http');
  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: 3000,
      path: '/hr/attendance?date=2026-07-01',
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
      },
    },
    (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const parsed = JSON.parse(data);
        const row = parsed.rows.find((r) => r.employeeNo === '154542');
        console.log('Employee 154542 in API response:', row);
        c.end();
      });
    },
  );
  req.end();
})();
