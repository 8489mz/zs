/**
 * Silent Windows HTML print endpoints (bridge-server.js).
 * Headless Node has no rendering engine, so print-windows must answer 501
 * naming the missing Electron capability. Pins the routing + error contract,
 * NOT actual Windows printing (that needs the C# exe / Electron tray on a PC).
 * Run with the bridge stopped (the test binds 127.0.0.1:18181 itself):
 *   node --test test/windows-print.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { server } = require('../src/server/bridge-server');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: 18181,
      method,
      path,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {},
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test.before(async () => {
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
});

test.after((done) => server.close(done));

test('print-windows rejects an empty document with 400', async () => {
  const res = await request('POST', '/api/printer/print-windows', { html: '   ' });
  assert.equal(res.status, 400);
  assert.equal(res.json.success, false);
  assert.match(res.json.error, /HTML/);
});

test('print-windows in headless Node answers 501 naming the Electron capability', async () => {
  const res = await request('POST', '/api/printer/print-windows', {
    html: '<html><body>receipt</body></html>',
    deviceName: 'EPSON WF-C5290BA',
    pageSize: 'A4',
  });
  assert.equal(res.status, 501);
  assert.equal(res.json.success, false);
  assert.match(res.json.error, /Electron/);
});

test('printer list answers with either a printers array or a clear capability error', async () => {
  const res = await request('GET', '/api/printer/list');
  assert.equal(typeof res.json.success, 'boolean');
  if (res.json.success) {
    assert.ok(Array.isArray(res.json.printers));
  } else {
    // Non-Windows headless host: the error must name the missing capability.
    assert.equal(typeof res.json.error, 'string');
    assert.ok(res.json.error.length > 0);
    if (process.platform !== 'win32') {
      assert.match(res.json.error, /Electron/);
    }
  }
});

test('health still answers ONLINE', async () => {
  const res = await request('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'ONLINE');
});
