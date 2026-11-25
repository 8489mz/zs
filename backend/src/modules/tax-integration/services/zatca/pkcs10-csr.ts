import * as crypto from 'node:crypto';

function der(tag: number, payload: Buffer): Buffer {
  const length = payload.length;
  const lengthBytes =
    length < 128
      ? Buffer.from([length])
      : (() => {
          const bytes: number[] = [];
          for (let n = length; n > 0; n >>>= 8) bytes.unshift(n & 0xff);
          return Buffer.from([0x80 | bytes.length, ...bytes]);
        })();
  return Buffer.concat([Buffer.from([tag]), lengthBytes, payload]);
}

function sequence(...values: Buffer[]): Buffer {
  return der(0x30, Buffer.concat(values));
}
function oid(dotted: string): Buffer {
  const numbers = dotted.split('.').map(Number);
  const bytes = [numbers[0] * 40 + numbers[1]];
  for (const number of numbers.slice(2)) {
    const parts = [number & 0x7f];
    for (let n = Math.floor(number / 128); n > 0; n = Math.floor(n / 128)) parts.unshift((n & 0x7f) | 0x80);
    bytes.push(...parts);
  }
  return der(0x06, Buffer.from(bytes));
}

/** Signed PKCS#10 request. UTF8String is required for ZATCA's pipe-delimited serial number. */
export function createPkcs10Csr(privateKeyPem: string, subjectFields: Array<[string, string]>): string {
  const subject = sequence(
    ...subjectFields.map(([attributeOid, value]) =>
      der(0x31, sequence(oid(attributeOid), der(0x0c, Buffer.from(value, 'utf8')))),
    ),
  );
  const publicKeyDer = crypto.createPublicKey(privateKeyPem).export({ format: 'der', type: 'spki' }) as Buffer;
  const requestInfo = sequence(der(0x02, Buffer.from([0])), subject, publicKeyDer, der(0xa0, Buffer.alloc(0)));
  const signature = crypto.sign('sha256', requestInfo, privateKeyPem);
  const request = sequence(
    requestInfo,
    sequence(oid('1.2.840.10045.4.3.2')),
    der(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  const base64 =
    request
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n') || '';
  return `-----BEGIN CERTIFICATE REQUEST-----\n${base64}\n-----END CERTIFICATE REQUEST-----\n`;
}
