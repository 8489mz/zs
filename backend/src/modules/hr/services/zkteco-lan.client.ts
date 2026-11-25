import * as dgram from 'node:dgram';
import * as net from 'node:net';
import { AppError } from '../../../common/errors/app-error';
import {
  buildZkUdpPacket,
  decodeZkPackedTimestamp,
  makeZkCommKeyPayload,
  parseZkUserDatBuffer,
  type DecodedZkDeviceUser,
} from '../engines/biometric-log-parser.engine';

const ZK_TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);

function wrapZkTcpPacket(zkPacket: Buffer): Buffer {
  const header = Buffer.alloc(8);
  ZK_TCP_MAGIC.copy(header, 0);
  header.writeUInt32LE(zkPacket.length, 4);
  return Buffer.concat([header, zkPacket]);
}

function parseAttlogBuffer(attBuf: Buffer, uidToPinMap: Map<number, string>): string[] {
  const rawAttlogLines: string[] = [];
  if (attBuf.length <= 4) return rawAttlogLines;

  const totalSize = attBuf.readUInt32LE(0);
  const recordsData =
    totalSize > 0 && totalSize <= attBuf.length - 4 ? attBuf.subarray(4, 4 + totalSize) : attBuf.subarray(4);

  if (recordsData.length > 0 && recordsData.length % 40 === 0) {
    for (let offset = 0; offset + 40 <= recordsData.length; offset += 40) {
      const uid = recordsData.readUInt16LE(offset);
      const pinSlice = recordsData.subarray(offset + 2, offset + 26);
      const nullIdx = pinSlice.indexOf(0);
      const pinStr = pinSlice
        .subarray(0, nullIdx >= 0 ? nullIdx : pinSlice.length)
        .toString('utf8')
        .trim();
      const verifyCode = recordsData[offset + 26];
      const rawTime = recordsData.readUInt32LE(offset + 27);
      const punchStatus = recordsData[offset + 31];
      const dtStr = decodeZkPackedTimestamp(rawTime);
      const resolvedPin = pinStr || uidToPinMap.get(uid) || String(uid);
      rawAttlogLines.push(`${resolvedPin}\t${dtStr}\t${verifyCode}\t${punchStatus}\t0\t0`);
    }
  } else if (recordsData.length > 0 && recordsData.length % 16 === 0) {
    for (let offset = 0; offset + 16 <= recordsData.length; offset += 16) {
      const uidOrPin = recordsData.readUInt32LE(offset);
      const rawTime = recordsData.readUInt32LE(offset + 4);
      const verifyCode = recordsData[offset + 8];
      const punchStatus = recordsData[offset + 9];
      const dtStr = decodeZkPackedTimestamp(rawTime);
      const resolvedPin = uidToPinMap.get(uidOrPin) || String(uidOrPin);
      rawAttlogLines.push(`${resolvedPin}\t${dtStr}\t${verifyCode}\t${punchStatus}\t0\t0`);
    }
  } else if (recordsData.length > 0 && recordsData.length % 8 === 0) {
    for (let offset = 0; offset + 8 <= recordsData.length; offset += 8) {
      const uid = recordsData.readUInt16LE(offset);
      const verifyCode = recordsData[offset + 2];
      const rawTime = recordsData.readUInt32LE(offset + 3);
      const punchStatus = recordsData[offset + 7];
      const dtStr = decodeZkPackedTimestamp(rawTime);
      const resolvedPin = uidToPinMap.get(uid) || String(uid);
      rawAttlogLines.push(`${resolvedPin}\t${dtStr}\t${verifyCode}\t${punchStatus}\t0\t0`);
    }
  }

  return rawAttlogLines;
}

export function probeZktecoLanDevice(ip: string, port: number): Promise<Record<string, unknown>> {
  const startMs = Date.now();

  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let settled = false;

    const finish = (result: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      try {
        sock.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        reachable: false,
        ip,
        port,
        message: 'انتهت مهلة الاتصال؛ تأكد أن الجهاز متصل على نفس الشبكة المحلية',
      });
    }, 2200);

    sock.on('error', (err) => {
      clearTimeout(timer);
      finish({
        reachable: false,
        ip,
        port,
        message: `تعذر الاتصال عبر الشبكة: ${err.message}`,
      });
    });

    sock.on('message', (msg) => {
      clearTimeout(timer);
      if (msg.length >= 8) {
        const respCode = msg.readUInt16LE(0);
        const sessionId = msg.readUInt16LE(4);
        const latencyMs = Date.now() - startMs;
        finish({
          reachable: true,
          ip,
          port,
          responseCode: respCode,
          requiresCommKey: respCode === 2005,
          sessionId,
          latencyMs,
          message:
            respCode === 2000
              ? `متصل بنجاح (${latencyMs}ms) — الجهاز مفتوح وجاهز`
              : respCode === 2005
                ? `الجهاز متصل (${latencyMs}ms) ولكنه يطلب مفتاح اتصال (Comm Key)`
                : `الجهاز مستجيب (${latencyMs}ms) بكود ${respCode}`,
        });
      } else {
        finish({
          reachable: true,
          ip,
          port,
          latencyMs: Date.now() - startMs,
          message: 'الجهاز مستجيب عبر الشبكة',
        });
      }
    });

    const pkt = buildZkUdpPacket(1000, 0, 65534);
    sock.send(pkt, port, ip);
  });
}

/**
 * Reliable ZKTeco TCP port 4370 pull (handles large 15k-100k attendance logs with zero packet loss).
 */
function fetchZktecoTcpData(
  ip: string,
  port: number,
  commKey: number,
): Promise<{ rawAttlogLines: string[]; deviceUsers: DecodedZkDeviceUser[] }> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: ip, port });
    let sessionId = 0;
    let replyId = 65534;
    let closed = false;
    let rxBuffer = Buffer.alloc(0);
    const frameQueue: Buffer[] = [];
    const frameWaiters: Array<{
      resolve: (frame: Buffer) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }> = [];

    const closeSock = () => {
      if (closed) return;
      closed = true;
      while (frameWaiters.length) {
        const w = frameWaiters.shift()!;
        clearTimeout(w.timer);
        w.reject(new AppError('انقطع اتصال الشبكة بجهاز البصمة', 'HR_BIOMETRIC_TCP_CLOSED', 502));
      }
      try {
        sock.destroy();
      } catch {
        // ignore
      }
    };

    const pushFrame = (zkFrame: Buffer) => {
      const waiter = frameWaiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(zkFrame);
      } else {
        frameQueue.push(zkFrame);
      }
    };

    const nextFrame = (timeoutMs = 4000): Promise<Buffer> => {
      if (frameQueue.length > 0) {
        return Promise.resolve(frameQueue.shift()!);
      }
      if (closed) {
        return Promise.reject(new AppError('انقطع اتصال الشبكة بجهاز البصمة', 'HR_BIOMETRIC_TCP_CLOSED', 502));
      }
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          const idx = frameWaiters.findIndex((w) => w.resolve === res);
          if (idx >= 0) frameWaiters.splice(idx, 1);
          rej(new AppError('انتهت مهلة الاتصال بجهاز البصمة عبر TCP', 'HR_BIOMETRIC_LAN_TIMEOUT', 504));
        }, timeoutMs);
        frameWaiters.push({ resolve: res, reject: rej, timer });
      });
    };

    sock.on('data', (chunk: Buffer) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      while (rxBuffer.length >= 8) {
        if (rxBuffer[0] !== 0x50 || rxBuffer[1] !== 0x50 || rxBuffer[2] !== 0x82 || rxBuffer[3] !== 0x7d) {
          const magicIdx = rxBuffer.indexOf(ZK_TCP_MAGIC, 1);
          if (magicIdx < 0) {
            rxBuffer = Buffer.alloc(0);
            break;
          }
          rxBuffer = rxBuffer.subarray(magicIdx);
          if (rxBuffer.length < 8) break;
        }
        const frameLen = rxBuffer.readUInt32LE(4);
        if (rxBuffer.length < 8 + frameLen) break;
        const zkFrame = rxBuffer.subarray(8, 8 + frameLen);
        rxBuffer = rxBuffer.subarray(8 + frameLen);
        pushFrame(zkFrame);
      }
    });

    sock.on('error', (err) => {
      closeSock();
      reject(err);
    });

    const sendCmd = async (cmd: number, payload: Buffer = Buffer.alloc(0), timeoutMs = 4000): Promise<Buffer> => {
      replyId = (replyId + 1) % 65535;
      const pkt = buildZkUdpPacket(cmd, sessionId, replyId, payload);
      sock.write(wrapZkTcpPacket(pkt));
      return nextFrame(timeoutMs);
    };

    const readBufferedTcp = async (zkCommand: number, fct = 0): Promise<Buffer> => {
      const reqPayload = Buffer.alloc(11);
      reqPayload.writeInt8(1, 0);
      reqPayload.writeInt16LE(zkCommand, 1);
      reqPayload.writeInt32LE(fct, 3);
      reqPayload.writeInt32LE(0, 7);

      const prepMsg = await sendCmd(1503, reqPayload);
      if (prepMsg.length < 8) return Buffer.alloc(0);
      const code = prepMsg.readUInt16LE(0);

      if (code === 1501) {
        return prepMsg.subarray(8);
      }
      if (code !== 2000 || prepMsg.length < 13) {
        return Buffer.alloc(0);
      }

      const totalBytes = prepMsg.readUInt32LE(9);
      if (totalBytes === 0) return Buffer.alloc(0);

      const MAX_CHUNK = 16384;
      const chunks: Buffer[] = [];
      let start = 0;

      while (start < totalBytes) {
        const chunkSize = Math.min(MAX_CHUNK, totalBytes - start);
        const chunkReq = Buffer.alloc(8);
        chunkReq.writeInt32LE(start, 0);
        chunkReq.writeInt32LE(chunkSize, 4);

        replyId = (replyId + 1) % 65535;
        sock.write(wrapZkTcpPacket(buildZkUdpPacket(1504, sessionId, replyId, chunkReq)));

        const parts: Buffer[] = [];
        let received = 0;

        while (received < chunkSize) {
          const msg = await nextFrame(5000);
          if (msg.length < 8) continue;
          const cCode = msg.readUInt16LE(0);
          if (cCode === 1500) {
            continue;
          }
          if (cCode === 1501) {
            const payloadPart = msg.subarray(8);
            parts.push(payloadPart);
            received += payloadPart.length;
          } else if (cCode === 2000 && received >= chunkSize) {
            break;
          }
        }

        // Drain the trailing CMD_ACK_OK (2000) packet that ZKTeco sends after each chunk
        const tailAck = await nextFrame(800).catch(() => null);
        if (tailAck && tailAck.length >= 8 && tailAck.readUInt16LE(0) !== 2000) {
          frameQueue.unshift(tailAck);
        }

        chunks.push(Buffer.concat(parts).subarray(0, chunkSize));
        start += chunkSize;
      }

      await sendCmd(1502).catch(() => undefined);
      return Buffer.concat(chunks, totalBytes);
    };

    const connectTimer = setTimeout(() => {
      closeSock();
      reject(new AppError('انتهت مهلة فتح اتصال TCP بجهاز البصمة', 'HR_BIOMETRIC_TCP_TIMEOUT', 504));
    }, 3000);

    sock.once('connect', () => {
      clearTimeout(connectTimer);
      (async () => {
        try {
          const connMsg = await sendCmd(1000);
          if (connMsg.length < 8) {
            throw new AppError('استجابة غير صالحة من جهاز البصمة', 'HR_BIOMETRIC_INVALID_RESP', 502);
          }
          let respCode = connMsg.readUInt16LE(0);
          sessionId = connMsg.readUInt16LE(4);

          if (respCode === 2005) {
            const authPayload = makeZkCommKeyPayload(commKey, sessionId);
            const authMsg = await sendCmd(1102, authPayload);
            respCode = authMsg.readUInt16LE(0);
            if (respCode !== 2000) {
              throw new AppError('رفض جهاز البصمة مفتاح الاتصال (Comm Key غير صحيح)', 'HR_BIOMETRIC_AUTH_FAILED', 401);
            }
          }

          let deviceUsers: DecodedZkDeviceUser[] = [];
          const uidToPinMap = new Map<number, string>();
          const uBuf = await readBufferedTcp(9, 5).catch(() => Buffer.alloc(0));
          if (uBuf.length > 4) {
            const rawUsers = uBuf.subarray(4);
            deviceUsers = parseZkUserDatBuffer(new Uint8Array(rawUsers)).map((u) => ({
              ...u,
              password: '',
            }));
            for (const u of deviceUsers) {
              uidToPinMap.set(u.uid, u.userId);
            }
          }

          const attBuf = await readBufferedTcp(13, 0).catch(() => Buffer.alloc(0));
          const rawAttlogLines = parseAttlogBuffer(attBuf, uidToPinMap);

          await sendCmd(1001, Buffer.alloc(0), 1000).catch(() => undefined);
          closeSock();
          resolve({ rawAttlogLines, deviceUsers });
        } catch (err) {
          closeSock();
          reject(err);
        }
      })();
    });
  });
}

function fetchZktecoUdpOnlyData(
  ip: string,
  port: number,
  commKey: number,
): Promise<{ rawAttlogLines: string[]; deviceUsers: DecodedZkDeviceUser[] }> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    let sessionId = 0;
    let replyId = 65534;
    let closed = false;

    const closeSock = () => {
      if (closed) return;
      closed = true;
      try {
        sock.close();
      } catch {
        // ignore
      }
    };

    const sendCmd = (cmd: number, payload: Buffer = Buffer.alloc(0), timeoutMs = 2500): Promise<Buffer> => {
      return new Promise((resCmd, rejCmd) => {
        replyId = (replyId + 1) % 65535;
        const pkt = buildZkUdpPacket(cmd, sessionId, replyId, payload);
        const timer = setTimeout(() => {
          sock.removeListener('message', onMsg);
          rejCmd(new AppError('انتهت مهلة الاتصال بجهاز البصمة عبر الشبكة المحلية', 'HR_BIOMETRIC_LAN_TIMEOUT', 504));
        }, timeoutMs);

        const onMsg = (msg: Buffer) => {
          clearTimeout(timer);
          sock.removeListener('message', onMsg);
          resCmd(msg);
        };

        sock.on('message', onMsg);
        sock.send(pkt, port, ip);
      });
    };

    const readBufferedData = async (zkCommand: number, fct = 0): Promise<Buffer> => {
      const reqPayload = Buffer.alloc(11);
      reqPayload.writeInt8(1, 0);
      reqPayload.writeInt16LE(zkCommand, 1);
      reqPayload.writeInt32LE(fct, 3);
      reqPayload.writeInt32LE(0, 7);

      const prepMsg = await sendCmd(1503, reqPayload);
      if (prepMsg.length < 8) return Buffer.alloc(0);
      const code = prepMsg.readUInt16LE(0);

      if (code === 1501) {
        return prepMsg.subarray(8);
      }
      if (code !== 2000 || prepMsg.length < 13) {
        return Buffer.alloc(0);
      }

      const totalBytes = prepMsg.readUInt32LE(9);
      if (totalBytes === 0) return Buffer.alloc(0);

      const MAX_CHUNK = 4096;
      const chunks: Buffer[] = [];
      let start = 0;

      while (start < totalBytes) {
        const chunkSize = Math.min(MAX_CHUNK, totalBytes - start);
        const chunkReq = Buffer.alloc(8);
        chunkReq.writeInt32LE(start, 0);
        chunkReq.writeInt32LE(chunkSize, 4);

        const chunkData = await new Promise<Buffer>((resChunk, rejChunk) => {
          replyId = (replyId + 1) % 65535;
          const pkt = buildZkUdpPacket(1504, sessionId, replyId, chunkReq);
          const parts: Buffer[] = [];
          let received = 0;

          const timer = setTimeout(() => {
            sock.removeListener('message', onChunkMsg);
            rejChunk(
              new AppError('انقطع الاتصال أثناء سحب البيانات من جهاز البصمة', 'HR_BIOMETRIC_CHUNK_TIMEOUT', 504),
            );
          }, 3000);

          const onChunkMsg = (msg: Buffer) => {
            if (msg.length < 8) return;
            const cCode = msg.readUInt16LE(0);
            if (cCode === 1500) return;
            if (cCode === 1501) {
              const payloadPart = msg.subarray(8);
              parts.push(payloadPart);
              received += payloadPart.length;
              if (received >= chunkSize) {
                clearTimeout(timer);
                sock.removeListener('message', onChunkMsg);
                resChunk(Buffer.concat(parts).subarray(0, chunkSize));
              }
            } else if (cCode === 2000 && received >= chunkSize) {
              clearTimeout(timer);
              sock.removeListener('message', onChunkMsg);
              resChunk(Buffer.concat(parts).subarray(0, chunkSize));
            }
          };

          sock.on('message', onChunkMsg);
          sock.send(pkt, port, ip);
        });

        chunks.push(chunkData);
        start += chunkSize;
      }

      await sendCmd(1502).catch(() => undefined);
      return Buffer.concat(chunks, totalBytes);
    };

    (async () => {
      try {
        const connMsg = await sendCmd(1000);
        if (connMsg.length < 8) {
          throw new AppError('استجابة غير صالحة من جهاز البصمة', 'HR_BIOMETRIC_INVALID_RESP', 502);
        }
        let respCode = connMsg.readUInt16LE(0);
        sessionId = connMsg.readUInt16LE(4);

        if (respCode === 2005) {
          const authPayload = makeZkCommKeyPayload(commKey, sessionId);
          const authMsg = await sendCmd(1102, authPayload);
          respCode = authMsg.readUInt16LE(0);
          if (respCode !== 2000) {
            throw new AppError('رفض جهاز البصمة مفتاح الاتصال (Comm Key غير صحيح)', 'HR_BIOMETRIC_AUTH_FAILED', 401);
          }
        }

        let deviceUsers: DecodedZkDeviceUser[] = [];
        const uidToPinMap = new Map<number, string>();
        const uBuf = await readBufferedData(9, 5).catch(() => Buffer.alloc(0));
        if (uBuf.length > 4) {
          const rawUsers = uBuf.subarray(4);
          deviceUsers = parseZkUserDatBuffer(new Uint8Array(rawUsers)).map((u) => ({
            ...u,
            password: '',
          }));
          for (const u of deviceUsers) {
            uidToPinMap.set(u.uid, u.userId);
          }
        }

        const attBuf = await readBufferedData(13, 0).catch(() => Buffer.alloc(0));
        const rawAttlogLines = parseAttlogBuffer(attBuf, uidToPinMap);

        await sendCmd(1001).catch(() => undefined);
        closeSock();
        resolve({ rawAttlogLines, deviceUsers });
      } catch (err) {
        closeSock();
        reject(err);
      }
    })();
  });
}

/**
 * Pulls users and attendance logs from a ZKTeco LAN device.
 * Prefers reliable TCP (port 4370) for large datasets and falls back to UDP for legacy terminals.
 */
export async function fetchZktecoUdpData(
  ip: string,
  port: number,
  commKey: number,
): Promise<{ rawAttlogLines: string[]; deviceUsers: DecodedZkDeviceUser[] }> {
  try {
    return await fetchZktecoTcpData(ip, port, commKey);
  } catch (tcpErr: any) {
    if (tcpErr instanceof AppError && tcpErr.code === 'HR_BIOMETRIC_AUTH_FAILED') {
      throw tcpErr;
    }
    return fetchZktecoUdpOnlyData(ip, port, commKey);
  }
}
