/**
 * Z-Systems Hardware Bridge - Silent ESC/POS Thermal Printer Driver
 * Supports Raw Network TCP (Port 9100), Cash Drawer kick, and Auto Paper Cut.
 */

const net = require('net');

const CMD_INIT = Buffer.from([0x1B, 0x40]); // ESC @
const CMD_CUT = Buffer.from([0x1D, 0x56, 0x42, 0x00]); // GS V B 0 (Full Cut)
const CMD_DRAWER = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]); // ESC p 0 25 250 (Kick drawer)
const CMD_ALIGN_CENTER = Buffer.from([0x1B, 0x61, 0x01]);
const CMD_ALIGN_LEFT = Buffer.from([0x1B, 0x61, 0x00]);
const CMD_ALIGN_RIGHT = Buffer.from([0x1B, 0x61, 0x02]);
const CMD_BOLD_ON = Buffer.from([0x1B, 0x45, 0x01]);
const CMD_BOLD_OFF = Buffer.from([0x1B, 0x45, 0x00]);

function sendRawToTcpPrinter(ip, port = 9100, dataBuffer, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let isFinished = false;

    const finish = (err) => {
      if (isFinished) return;
      isFinished = true;
      try { socket.destroy(); } catch {}
      if (err) reject(err);
      else resolve({ success: true, bytesWritten: dataBuffer.length });
    };

    socket.setTimeout(timeoutMs);
    socket.setNoDelay(true);

    socket.on('connect', () => {
      socket.write(dataBuffer, () => {
        socket.end(() => finish(null));
      });
    });

    socket.on('timeout', () => finish(new Error(`انتهت مهلة الطباعة على ${ip}:${port}`)));
    socket.on('error', (err) => finish(new Error(`خطأ اتصال بالطابعة ${ip}:${port}: ${err.message}`)));

    socket.connect(port, ip);
  });
}

async function kickCashDrawer(options = {}) {
  const { ip, port = 9100 } = options;
  if (!ip) {
    throw new Error('يرجى تحديد عنوان IP الطابعة المرتبطة بدرج النقدية');
  }
  const payload = Buffer.concat([CMD_INIT, CMD_DRAWER]);
  return sendRawToTcpPrinter(ip, port, payload);
}

function buildTestReceiptBuffer(storeName = 'Z-Systems Store') {
  const lines = [
    CMD_INIT,
    CMD_ALIGN_CENTER,
    CMD_BOLD_ON,
    Buffer.from(`\n=== ${storeName} ===\n`, 'utf8'),
    CMD_BOLD_OFF,
    Buffer.from('Z-Systems Hardware Bridge\n', 'utf8'),
    Buffer.from('Thermal ESC/POS Silent Print OK\n', 'utf8'),
    Buffer.from('--------------------------------\n', 'utf8'),
    CMD_ALIGN_LEFT,
    Buffer.from(`Date: ${new Date().toLocaleString('ar-EG')}\n`, 'utf8'),
    Buffer.from('Status: Online & Ready\n', 'utf8'),
    Buffer.from('Cash Drawer: Tested\n', 'utf8'),
    Buffer.from('Port: 9100 Raw Stream\n', 'utf8'),
    Buffer.from('--------------------------------\n', 'utf8'),
    CMD_ALIGN_CENTER,
    Buffer.from('شكرا لتعاملكم معنا\n\n\n\n', 'utf8'),
    CMD_CUT,
  ];

  return Buffer.concat(lines);
}

async function printTestReceipt(options = {}) {
  const { ip, port = 9100, storeName } = options;
  if (!ip) throw new Error('يرجى تحديد عنوان IP الطابعة');
  const buffer = buildTestReceiptBuffer(storeName);
  return sendRawToTcpPrinter(ip, port, buffer);
}

async function printRawReceipt(options = {}) {
  const { ip, port = 9100, rawBase64, rawText, cut = true, kickDrawer = false } = options;
  if (!ip) throw new Error('يرجى تحديد عنوان IP الطابعة');

  const chunks = [CMD_INIT];
  if (kickDrawer) chunks.push(CMD_DRAWER);

  if (rawBase64) {
    chunks.push(Buffer.from(rawBase64, 'base64'));
  } else if (rawText) {
    chunks.push(Buffer.from(rawText, 'utf8'));
  }

  if (cut) {
    chunks.push(Buffer.from('\n\n\n\n'));
    chunks.push(CMD_CUT);
  }

  const payload = Buffer.concat(chunks);
  return sendRawToTcpPrinter(ip, port, payload);
}

module.exports = {
  sendRawToTcpPrinter,
  kickCashDrawer,
  printTestReceipt,
  printRawReceipt,
};
