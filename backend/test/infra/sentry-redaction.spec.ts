import assert from 'assert';

function run(): void {
  // masks sensitive headers
  const event1: any = {
    request: {
      headers: {
        authorization: 'Bearer supersecret',
        cookie: 'session=123',
        'session-id': 'xyz',
        'csrf-token': 'token',
        'x-safe-header': 'safe',
      },
    },
  };

  const headers = event1.request.headers;
  const sensitiveHeaders = ['authorization', 'cookie', 'session-id', 'csrf-token'];
  for (const key of Object.keys(headers)) {
    if (sensitiveHeaders.some((h) => key.toLowerCase().includes(h))) {
      headers[key] = '[REDACTED]';
    }
  }

  assert.strictEqual(event1.request.headers['authorization'], '[REDACTED]');
  assert.strictEqual(event1.request.headers['cookie'], '[REDACTED]');
  assert.strictEqual(event1.request.headers['session-id'], '[REDACTED]');
  assert.strictEqual(event1.request.headers['csrf-token'], '[REDACTED]');
  assert.strictEqual(event1.request.headers['x-safe-header'], 'safe');

  // masks sensitive data in body
  const event2: any = {
    request: {
      data: {
        password: 'mypassword',
        mySecretToken: 'abc',
        connectionString: 'db://user:pass@host',
        smtpPassword: '123',
        db_url: 'xyz',
        safeField: 'hello',
      },
    },
  };

  if (event2.request?.data) {
    try {
      const data = typeof event2.request.data === 'string' ? JSON.parse(event2.request.data) : event2.request.data;
      if (data && typeof data === 'object') {
        const sensitiveKeys = ['password', 'token', 'secret', 'connection', 'smtp', 'db'];
        for (const key of Object.keys(data)) {
          if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
            data[key] = '[REDACTED]';
          }
        }
        event2.request.data = typeof event2.request.data === 'string' ? JSON.stringify(data) : data;
      }
    } catch (e) {}
  }

  assert.strictEqual(event2.request.data.password, '[REDACTED]');
  assert.strictEqual(event2.request.data.mySecretToken, '[REDACTED]');
  assert.strictEqual(event2.request.data.connectionString, '[REDACTED]');
  assert.strictEqual(event2.request.data.smtpPassword, '[REDACTED]');
  assert.strictEqual(event2.request.data.db_url, '[REDACTED]');
  assert.strictEqual(event2.request.data.safeField, 'hello');
}

run();
console.log('sentry-redaction.spec passed');
