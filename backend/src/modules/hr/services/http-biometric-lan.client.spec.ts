import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import {
  buildDigestAuthorizationHeader,
  fetchDahuaLanAttendance,
  fetchHikvisionLanAttendance,
  maskDeviceCommKey,
  normalizeGenericJsonPushToAttlogLines,
  parseDahuaAccessRecords,
  parseHikvisionAcsEventResponse,
  parseHikvisionDeviceInfoXml,
  parseHikvisionWebhookPayload,
  parseHttpDeviceCredentials,
  probeDahuaLanDevice,
  probeHikvisionLanDevice,
} from './http-biometric-lan.client';

function verifyDigestAuth(
  req: http.IncomingMessage,
  expectedUser: string,
  expectedPass: string,
  realm: string,
  nonce: string,
): boolean {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Digest ')) return false;
  const pick = (k: string) => {
    const m = auth.match(new RegExp(`${k}=(?:"([^"]*)"|([^,\\s]*))`));
    return m ? (m[1] !== undefined ? m[1] : m[2]) : '';
  };
  const user = pick('username');
  const uri = pick('uri');
  const nc = pick('nc');
  const cnonce = pick('cnonce');
  const qop = pick('qop');
  const resp = pick('response');
  if (user !== expectedUser) return false;
  const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');
  const ha1 = md5(`${expectedUser}:${realm}:${expectedPass}`);
  const ha2 = md5(`${req.method}:${uri}`);
  const expectedResp = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  return resp === expectedResp;
}

async function runTests() {
  // 1. Credential parsing & masking
  assert.deepEqual(parseHttpDeviceCredentials('admin:Hik@2026'), { username: 'admin', password: 'Hik@2026' });
  assert.deepEqual(parseHttpDeviceCredentials('Secret99'), { username: 'admin', password: 'Secret99' });
  assert.deepEqual(parseHttpDeviceCredentials('0'), { username: 'admin', password: '' });
  assert.equal(maskDeviceCommKey('hikvision', 'admin:Hik@2026'), 'admin:••••••••');
  assert.equal(maskDeviceCommKey('dahua', 'Secret99'), 'admin:••••••••');
  assert.equal(maskDeviceCommKey('zkteco', '0'), '0');

  // 2. Digest Auth header builder (deterministic check)
  const digestHdr = buildDigestAuthorizationHeader({
    method: 'GET',
    uri: '/ISAPI/System/deviceInfo',
    username: 'admin',
    password: 'Pass123',
    challengeHeader: 'Digest realm="DS-K1T341", nonce="abc123", qop="auth", algorithm=MD5',
    nc: '00000001',
    cnonce: 'deadbeef',
  });
  assert.ok(digestHdr.startsWith('Digest username="admin"'));
  assert.ok(digestHdr.includes('realm="DS-K1T341"'));
  assert.ok(digestHdr.includes('qop=auth'));

  // 3. Hikvision XML & AcsEvent JSON & Multipart Webhook parsers
  const hikInfo = parseHikvisionDeviceInfoXml(
    '<DeviceInfo><deviceName>FrontGate</deviceName><model>DS-K1T342MWX</model><serialNumber>DS-K1T34220260001</serialNumber></DeviceInfo>',
  );
  assert.equal(hikInfo.model, 'DS-K1T342MWX');
  assert.equal(hikInfo.serialNumber, 'DS-K1T34220260001');

  const hikEvents = parseHikvisionAcsEventResponse(
    JSON.stringify({
      AcsEvent: {
        totalMatches: 2,
        numOfMatches: 2,
        responseStatusStrg: 'OK',
        InfoList: [
          { employeeNoString: '101', time: '2026-11-22T08:15:00+02:00', minor: 75, attendanceStatus: 'checkIn' },
          { employeeNoString: '101', time: '2026-11-22T16:45:10+02:00', minor: 38, attendanceStatus: 'checkOut' },
        ],
      },
    }),
  );
  assert.equal(hikEvents.lines.length, 2);
  assert.equal(hikEvents.lines[0], '101\t2026-11-22 08:15:00\t15\t0\t0\t0');
  assert.equal(hikEvents.lines[1], '101\t2026-11-22 16:45:10\t1\t1\t0\t0');

  const multipartPush = [
    '--boundary',
    'Content-Disposition: form-data; name="AccessControllerEvent"',
    'Content-Type: application/json',
    '',
    JSON.stringify({
      dateTime: '2026-11-22T09:05:11+02:00',
      serialNumber: 'DS-K1T34220260001',
      AccessControllerEvent: { employeeNoString: '205', subEventType: 75, attendanceStatus: 'checkIn' },
    }),
    '--boundary--',
  ].join('\r\n');
  const parsedPush = parseHikvisionWebhookPayload(multipartPush);
  assert.equal(parsedPush.serialNumber, 'DS-K1T34220260001');
  assert.deepEqual(parsedPush.lines, ['205\t2026-11-22 09:05:11\t15\t0\t0\t0']);

  // 4. Dahua recordFinder parser (filters Status=0 failed scans, formats Unix timestamp in Africa/Cairo UTC+2)
  const dahuaLines = parseDahuaAccessRecords(
    [
      'found=3',
      'records[0].UserID=301',
      'records[0].CreateTime=1795327200', // 2026-11-22T06:00:00Z -> 08:00:00 Africa/Cairo
      'records[0].Method=15',
      'records[0].Status=1',
      'records[0].Type=Entry',
      'records[1].UserID=301',
      'records[1].CreateTime=1795356000', // 2026-11-22T14:00:00Z -> 16:00:00 Africa/Cairo
      'records[1].Method=6',
      'records[1].Status=1',
      'records[1].Type=Exit',
      'records[2].UserID=999',
      'records[2].CreateTime=1795356100',
      'records[2].Status=0',
    ].join('\n'),
    'Africa/Cairo',
  );
  assert.equal(dahuaLines.length, 2);
  assert.equal(dahuaLines[0], '301\t2026-11-22 08:00:00\t15\t0\t0\t0');
  assert.equal(dahuaLines[1], '301\t2026-11-22 16:00:00\t1\t1\t0\t0');

  // 5. Generic JSON Push normalizer (Anviz / Suprema / Bridges)
  const genericPush = normalizeGenericJsonPushToAttlogLines({
    serialNumber: 'ANVIZ-EG-01',
    punches: [
      { pin: '401', timestamp: '2026-11-22T08:30:00', status: 'in' },
      { pin: '401', timestamp: '2026-11-22 17:10:00', status: 'out' },
    ],
  });
  assert.equal(genericPush.serialNumber, 'ANVIZ-EG-01');
  assert.equal(genericPush.lines.length, 2);
  assert.equal(genericPush.lines[0], '401\t2026-11-22 08:30:00\t1\t0\t0\t0');
  assert.equal(genericPush.lines[1], '401\t2026-11-22 17:10:00\t1\t1\t0\t0');

  // 6. Live HTTP Digest Server end-to-end test for BOTH Hikvision (paginated!) & Dahua (factory.create -> doFind!)
  const realm = 'ZSYSTEMS-BIOMETRIC';
  const nonce = 'nonce20261122';
  let dahuaFindCalls = 0;

  const server = http.createServer((req, res) => {
    if (!verifyDigestAuth(req, 'admin', 'Egypt@2026', realm, nonce)) {
      res.writeHead(401, {
        'WWW-Authenticate': `Digest realm="${realm}", nonce="${nonce}", qop="auth", algorithm=MD5`,
      });
      res.end('Unauthorized');
      return;
    }

    const url = req.url || '/';
    if (url === '/ISAPI/System/deviceInfo') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end('<DeviceInfo><model>DS-K1T671M</model><serialNumber>HIK-EG-999</serialNumber></DeviceInfo>');
      return;
    }
    if (url === '/ISAPI/AccessControl/AcsEvent?format=json') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const pos = body.AcsEventCond.searchResultPosition;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (pos === 0) {
          res.end(
            JSON.stringify({
              AcsEvent: {
                totalMatches: 2,
                numOfMatches: 1,
                responseStatusStrg: 'MORE',
                InfoList: [{ employeeNoString: '501', time: '2026-11-22T08:00:00+02:00', minor: 75, attendanceStatus: 'checkIn' }],
              },
            }),
          );
        } else {
          res.end(
            JSON.stringify({
              AcsEvent: {
                totalMatches: 2,
                numOfMatches: 1,
                responseStatusStrg: 'OK',
                InfoList: [{ employeeNoString: '501', time: '2026-11-22T16:30:00+02:00', minor: 75, attendanceStatus: 'checkOut' }],
              },
            }),
          );
        }
      });
      return;
    }
    if (url === '/cgi-bin/magicBox.cgi?action=getSystemInfo') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('deviceType=DHI-ASI7213X\r\nserialNumber=DAHUA-EG-777\r\n');
      return;
    }
    if (url.startsWith('/cgi-bin/recordFinder.cgi?action=factory.create')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('result=42\r\n');
      return;
    }
    if (url.startsWith('/cgi-bin/recordFinder.cgi?action=startFind')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('result=true\r\n');
      return;
    }
    if (url.startsWith('/cgi-bin/recordFinder.cgi?action=doFind')) {
      dahuaFindCalls++;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      if (dahuaFindCalls === 1) {
        res.end('found=1\r\nrecords[0].UserID=601\r\nrecords[0].CreateTime=1795327200\r\nrecords[0].Method=15\r\nrecords[0].Status=1\r\nrecords[0].Type=Entry\r\n');
      } else {
        res.end('found=0\r\n');
      }
      return;
    }
    if (url.startsWith('/cgi-bin/recordFinder.cgi?action=destroy')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK\r\n');
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };

  try {
    // Hikvision live Digest probe + paginated 2-page pull
    const hikProbe = await probeHikvisionLanDevice('127.0.0.1', addr.port, 'admin', 'Egypt@2026');
    assert.equal(hikProbe.reachable, true);
    assert.equal(hikProbe.model, 'DS-K1T671M');
    assert.equal(hikProbe.serialNumber, 'HIK-EG-999');

    const hikBadAuth = await probeHikvisionLanDevice('127.0.0.1', addr.port, 'admin', 'WrongPass');
    assert.equal(hikBadAuth.requiresCommKey, true);

    const hikPulled = await fetchHikvisionLanAttendance('127.0.0.1', addr.port, 'admin', 'Egypt@2026', '2026-11-01', '2026-11-22');
    assert.equal(hikPulled.rawAttlogLines.length, 2);
    assert.equal(hikPulled.rawAttlogLines[0], '501\t2026-11-22 08:00:00\t15\t0\t0\t0');
    assert.equal(hikPulled.rawAttlogLines[1], '501\t2026-11-22 16:30:00\t15\t1\t0\t0');

    // Dahua live Digest probe + factory.create/doFind pull
    const dahuaProbe = await probeDahuaLanDevice('127.0.0.1', addr.port, 'admin', 'Egypt@2026');
    assert.equal(dahuaProbe.reachable, true);
    assert.equal(dahuaProbe.model, 'DHI-ASI7213X');
    assert.equal(dahuaProbe.serialNumber, 'DAHUA-EG-777');

    const dahuaPulled = await fetchDahuaLanAttendance('127.0.0.1', addr.port, 'admin', 'Egypt@2026', '2026-11-01', '2026-11-22', 'Africa/Cairo');
    assert.equal(dahuaPulled.rawAttlogLines.length, 1);
    assert.equal(dahuaPulled.rawAttlogLines[0], '601\t2026-11-22 08:00:00\t15\t0\t0\t0');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('http-biometric-lan.client.spec: all cases passed (Digest Auth, Hikvision ISAPI, Dahua CGI, Generic JSON)');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
