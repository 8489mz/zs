import * as net from 'node:net';
import type { Logger } from '@nestjs/common';
import {
  translateBankResponseCode,
  isPrivateSubnetIp,
  type TerminalPaymentSession,
  type PosTerminalInfo,
  type TerminalPaymentRequestDto,
} from './pos-terminal-shared';

export class PosTerminalCharges {
  constructor(private readonly logger: Logger) {}

  /**
   * Execute real-device protocol communication (Geidea, Fawry/PAX, Paymob, NI)
   */
  async executeTerminalCharge(
    session: TerminalPaymentSession,
    ip: string,
    port: number,
    provider: string,
    terminal: PosTerminalInfo,
    request: TerminalPaymentRequestDto,
  ): Promise<void> {
    if (provider.includes('geidea')) {
      await this.executeGeideaCharge(session, ip, port, terminal, request);
    } else if (provider.includes('fawry') || provider.includes('pax')) {
      await this.executePaxFawryCharge(session, ip, port, terminal, request);
    } else if (provider.includes('paymob')) {
      await this.executePaymobCharge(session, ip, port, terminal, request);
    } else {
      // Default standard ECR REST
      await this.executeGeideaCharge(session, ip, port, terminal, request);
    }
  }

  /**
   * Geidea ECR Local REST Protocol Driver (Standard for Geidea Smart POS in KSA & Egypt)
   */
  private async executeGeideaCharge(
    session: TerminalPaymentSession,
    ip: string,
    port: number,
    terminal: PosTerminalInfo,
    request: TerminalPaymentRequestDto,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 95000);

    try {
      session.status = 'processing';
      session.message = 'جاري التخاطب مع ماكينة جيديا... يرجى إدخال أو تمرير البطاقة';
      session.updatedAt = Date.now();

      const curr = String(session.currency || 'EGP').toUpperCase();
      const isThreeDecimals = ['KWD', 'BHD', 'OMR'].includes(curr);
      const minorMultiplier = isThreeDecimals ? 1000 : 100;
      const amountDec = Number(request.amount.toFixed(isThreeDecimals ? 3 : 2));
      const amountMinor = Math.round(request.amount * minorMultiplier);

      const payload: Record<string, any> = {
        transactionType: 'PURCHASE',
        amount: amountDec,
        amountInCents: amountMinor,
        amountInHalalas: amountMinor,
        currency: curr,
        referenceId: session.transactionId,
        ecrReference: session.transactionId,
        printReceipt: true,
      };

      if (terminal?.terminalTid) {
        payload.terminalId = terminal.terminalTid;
        payload.terminalTid = terminal.terminalTid;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      if (terminal?.pairingKey) {
        headers['x-pairing-key'] = terminal.pairingKey;
        headers['Authorization'] = `Bearer ${terminal.pairingKey}`;
      }

      let res: Response | null = null;
      let targetUrl = `http://${ip}:${port}/api/v1/transaction`;

      try {
        res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (err: any) {
        if (err.name === 'AbortError') throw err;
        targetUrl = `http://${ip}:${port}/ecr/sale`;
        res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      }

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`الماكينة أعادت خطأ كود ${res.status}: ${res.statusText}`);
      }

      const data: any = await res.json();
      const statusRaw = String(data.status || data.responseCode || '').toUpperCase();
      const isApproved =
        statusRaw === 'APPROVED' ||
        statusRaw === 'SUCCESS' ||
        data.responseCode === '00' ||
        data.responseCode === '000' ||
        data.isSuccess === true;

      if (isApproved) {
        session.status = 'approved';
        session.approvalCode = String(
          data.authCode ||
            data.approvalCode ||
            data.authorizationCode ||
            `AUTH-${Math.floor(100000 + Math.random() * 900000)}`,
        );
        session.rrn = String(data.rrn || data.retrievalReferenceNumber || data.referenceNo || session.transactionId);

        const rawScheme = String(data.cardScheme || data.scheme || data.cardType || 'mada').toLowerCase();
        let mappedScheme = 'mada';
        if (rawScheme.includes('knet')) mappedScheme = 'knet';
        else if (rawScheme.includes('meeza')) mappedScheme = 'meeza';
        else if (rawScheme.includes('master')) mappedScheme = 'mastercard';
        else if (rawScheme.includes('visa')) mappedScheme = 'visa';
        else if (rawScheme.includes('mada')) mappedScheme = 'mada';
        else mappedScheme = rawScheme;
        session.cardScheme = mappedScheme;

        session.cardLastFour = String(
          data.cardLastFour || data.last4 || (data.maskedPan ? data.maskedPan.slice(-4) : ''),
        );
        session.message = 'تمت الموافقة من بنك التاجر بنجاح!';
        session.updatedAt = Date.now();
        this.logger.log(`Geidea ECR approved: Auth=${session.approvalCode}, RRN=${session.rrn}`);
      } else {
        const isUserCancel = statusRaw === 'CANCELLED' || statusRaw === 'CANCELED' || data.responseCode === '99';
        session.status = isUserCancel ? 'cancelled' : 'declined';
        const rawCode = String(data.responseCode || data.resultCode || statusRaw || '');
        session.message = translateBankResponseCode(
          rawCode,
          data.message || data.responseMessage || data.responseDescription,
        );
        session.updatedAt = Date.now();
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      session.status = 'declined';
      const isAbort = err.name === 'AbortError';
      const isPrivateSub = isPrivateSubnetIp(ip);
      const isCloudEnv = process.env.APP_MODE === 'CLOUD_SAAS' || process.env.NODE_ENV === 'production';
      let errMsg = isAbort
        ? 'انتهت مهلة الانتظار (95 ثانية) دون تمرير البطاقة على الماكينة'
        : `تعذر الاتصال بماكينة جيديا على ${ip}:${port} (${err.code || err.message}).`;

      if (isCloudEnv && isPrivateSub && !isAbort) {
        errMsg +=
          ' (ملاحظة السحابة: السيرفر السحابي لا يستطيع الدخول لشبكة الراوتر المحلي؛ استخدم تطبيق ديسكتوب Z-Systems أو فعّل Geidea Cloud ECR).';
      } else if (!isAbort) {
        errMsg += ' تأكد من تشغيل الماكينة وتفعيل خدمة ECR.';
      }

      session.message = errMsg;
      session.updatedAt = Date.now();
      this.logger.warn(`Geidea ECR error: ${errMsg}`);
    }
  }

  /**
   * PAX POSLink Raw TCP Socket Driver
   * Standard framing for PAX A920 / A960 / S900 / D210 on ports 10009 / 20008:
   * [STX (0x02)] + [Data] + [ETX (0x03)] + [LRC (XOR Checksum)]
   */
  private checkOrSendPaxRawTcpSocket(ip: string, port: number, payloadObj: any, timeoutMs = 60000): Promise<any> {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let buffer = Buffer.alloc(0);
      let settled = false;

      const finish = (err?: Error, result?: any) => {
        if (settled) return;
        settled = true;
        client.destroy();
        if (err) reject(err);
        else resolve(result);
      };

      client.setTimeout(timeoutMs);

      client.on('connect', () => {
        const jsonStr = JSON.stringify(payloadObj);
        const dataBuf = Buffer.from(jsonStr, 'utf8');

        // Calculate LRC: XOR of all bytes from after STX up to and including ETX
        let lrc = 0x03; // ETX is 0x03
        for (let i = 0; i < dataBuf.length; i++) {
          lrc ^= dataBuf[i];
        }

        const packet = Buffer.concat([
          Buffer.from([0x02]), // STX
          dataBuf,
          Buffer.from([0x03, lrc]), // ETX + LRC
        ]);

        client.write(packet);
      });

      client.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        const etxIdx = buffer.indexOf(0x03);
        if (etxIdx !== -1 && buffer.length > etxIdx) {
          let stxIdx = buffer.indexOf(0x02);
          if (stxIdx === -1) stxIdx = 0;
          else stxIdx += 1;

          const msgBuf = buffer.subarray(stxIdx, etxIdx);
          const rawMsg = msgBuf.toString('utf8');

          // Send ACK (0x06) to terminal to acknowledge clean frame receipt
          try {
            client.write(Buffer.from([0x06]));
          } catch {
            // Ignore write error if socket closing
          }

          try {
            const parsed = JSON.parse(rawMsg);
            finish(undefined, parsed);
          } catch {
            const parts = rawMsg.split('^');
            finish(undefined, {
              responseCode: parts[0] || '000000',
              authCode: parts[1] || '',
              refNum: parts[2] || '',
              raw: rawMsg,
            });
          }
        }
      });

      client.on('timeout', () => {
        finish(new Error('انتهت مهلة انتظار الماكينة (Socket Timeout)'));
      });

      client.on('error', (err) => {
        finish(err);
      });

      client.connect(port, ip);
    });
  }

  /**
   * PAX POSLink / Fawry ECR Protocol Driver
   * Supports both Raw TCP Socket (ports 10009 / 20008) and HTTP POSLink (port 8080)
   */
  private async executePaxFawryCharge(
    session: TerminalPaymentSession,
    ip: string,
    port: number,
    terminal: PosTerminalInfo,
    request: TerminalPaymentRequestDto,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 95000);

    try {
      session.status = 'processing';
      session.message = 'جاري التخاطب مع ماكينة فوري / باكس... يرجى إدخال أو تمرير البطاقة';
      session.updatedAt = Date.now();

      const curr = String(session.currency || 'EGP').toUpperCase();
      const isThreeDecimals = ['KWD', 'BHD', 'OMR'].includes(curr);
      const minorMultiplier = isThreeDecimals ? 1000 : 100;
      const amountDec = Number(request.amount.toFixed(isThreeDecimals ? 3 : 2));
      const amountMinorStr = Math.round(request.amount * minorMultiplier).toString();
      const amountMinorNum = Math.round(request.amount * minorMultiplier);
      const payload: Record<string, any> = {
        command: 'DO_TRANSACTION',
        transType: '01', // SALE
        amount: amountMinorStr,
        transAmount: amountMinorStr,
        amountInCents: amountMinorNum,
        amountDecimal: amountDec,
        ecrRefNum: session.transactionId,
        referenceNum: session.transactionId,
        currencyCode: curr,
        currency: curr,
        printReceipt: '1',
        printCustomerReceipt: '1',
      };

      if (terminal?.terminalTid) {
        payload.tid = terminal.terminalTid;
      }

      const isRawTcpPort = port === 10009 || port === 20008;
      let data: any = null;

      if (isRawTcpPort) {
        try {
          data = await this.checkOrSendPaxRawTcpSocket(ip, port, payload, 90000);
        } catch (rawErr: any) {
          this.logger.warn(`PAX Raw TCP failed on ${ip}:${port}, trying HTTP fallback: ${rawErr.message}`);
        }
      }

      if (!data) {
        let res: Response | null = null;
        let targetUrl = `http://${ip}:${port}/poslink`;

        try {
          res = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } catch (err: any) {
          if (err.name === 'AbortError') throw err;
          targetUrl = `http://${ip}:${port}/`;
          res = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        }

        if (res && res.ok) {
          data = await res.json();
        } else if (!isRawTcpPort) {
          try {
            data = await this.checkOrSendPaxRawTcpSocket(ip, port, payload, 90000);
          } catch {
            // Keep error
          }
        }
      }

      clearTimeout(timeoutId);

      if (!data) {
        throw new Error(`تعذر التخاطب مع ماكينة باكس عبر HTTP أو Raw TCP Socket على ${ip}:${port}`);
      }

      const code = String(data.responseCode || data.resultCode || data.status || '').trim();
      const isApproved =
        code === '000000' ||
        code === '00' ||
        code === '0' ||
        code === 'OK' ||
        code === 'APPROVED' ||
        data.status === 'APPROVED' ||
        data.transResult === 'APPROVED';

      if (isApproved) {
        session.status = 'approved';
        session.approvalCode = String(
          data.authCode ||
            data.approvalCode ||
            data.authNum ||
            data.extData?.AuthCode ||
            `AUTH-${Math.floor(100000 + Math.random() * 900000)}`,
        );
        session.rrn = String(data.refNum || data.rrn || data.extData?.RRN || session.transactionId);

        const rawScheme = String(data.cardType || data.cardScheme || data.extData?.CardType || 'Visa').toLowerCase();
        let mappedScheme = 'visa';
        if (rawScheme.includes('mada')) mappedScheme = 'mada';
        else if (rawScheme.includes('knet')) mappedScheme = 'knet';
        else if (rawScheme.includes('meeza') || rawScheme === '07') mappedScheme = 'meeza';
        else if (rawScheme.includes('master') || rawScheme === '02') mappedScheme = 'mastercard';
        else if (rawScheme.includes('visa') || rawScheme === '01') mappedScheme = 'visa';
        else mappedScheme = rawScheme;
        session.cardScheme = mappedScheme;

        session.cardLastFour = String(
          data.cardLastFour ||
            data.last4 ||
            (data.bogusPan ? data.bogusPan.slice(-4) : data.extData?.Pan ? data.extData.Pan.slice(-4) : ''),
        );
        session.message = 'تمت الموافقة بنجاح!';
        session.updatedAt = Date.now();
        this.logger.log(`PAX/Fawry ECR approved: Auth=${session.approvalCode}, RRN=${session.rrn}`);
      } else {
        const isUserCancel = code === 'CANCELLED' || code === 'CANCELED' || code === '99' || data.responseCode === '99';
        session.status = isUserCancel ? 'cancelled' : 'declined';
        const rawCode = String(data.responseCode || data.resultCode || code || '');
        session.message = translateBankResponseCode(rawCode, data.responseMessage || data.message);
        session.updatedAt = Date.now();
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      session.status = 'declined';
      const isAbort = err.name === 'AbortError';
      const isPrivateSub = isPrivateSubnetIp(ip);
      const isCloudEnv = process.env.APP_MODE === 'CLOUD_SAAS' || process.env.NODE_ENV === 'production';
      let errMsg = isAbort
        ? 'انتهت مهلة الانتظار (95 ثانية) دون تمرير البطاقة على جهاز باكس'
        : `تعذر الاتصال بماكينة فوري / باكس على ${ip}:${port} (${err.code || err.message}).`;

      if (isCloudEnv && isPrivateSub && !isAbort) {
        errMsg +=
          ' (ملاحظة السحابة: السيرفر السحابي لا يستطيع الدخول لشبكة الراوتر المحلي؛ استخدم تطبيق ديسكتوب Z-Systems للربط المباشر).';
      } else if (!isAbort) {
        errMsg += ' تأكد من تشغيل تطبيق ECR على الماكينة.';
      }

      session.message = errMsg;
      session.updatedAt = Date.now();
      this.logger.warn(`PAX/Fawry ECR error: ${errMsg}`);
    }
  }

  /**
   * Paymob Smart POS Protocol Driver
   */
  private async executePaymobCharge(
    session: TerminalPaymentSession,
    ip: string,
    port: number,
    terminal: PosTerminalInfo,
    request: TerminalPaymentRequestDto,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 95000);

    try {
      session.status = 'processing';
      session.message = 'جاري التخاطب مع ماكينة Paymob Smart POS...';
      session.updatedAt = Date.now();

      const payload = {
        amount_cents: Math.round(request.amount * 100),
        transaction_id: session.transactionId,
        currency: session.currency || 'EGP',
      };

      const res = await fetch(`http://${ip}:${port}/paymob/ecr/sale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data: any = await res.json();
      if (data.success || data.status === 'APPROVED') {
        session.status = 'approved';
        session.approvalCode = String(
          data.auth_code || data.approvalCode || `AUTH-${Math.floor(100000 + Math.random() * 900000)}`,
        );
        session.rrn = String(data.rrn || session.transactionId);
        session.cardScheme = String(data.card_type || 'Visa').toLowerCase();
        session.cardLastFour = String(data.last_four || '');
        session.message = 'تمت الموافقة بنجاح!';
        session.updatedAt = Date.now();
      } else {
        session.status = 'declined';
        session.message = data.message || 'تم رفض العملية من جهاز Paymob';
        session.updatedAt = Date.now();
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      session.status = 'declined';
      const isAbort = err.name === 'AbortError';
      const isPrivateSub = isPrivateSubnetIp(ip);
      const isCloudEnv = process.env.APP_MODE === 'CLOUD_SAAS' || process.env.NODE_ENV === 'production';
      let errMsg = isAbort
        ? 'انتهت مهلة الانتظار (95 ثانية) دون تمرير البطاقة على ماكينة Paymob'
        : `تعذر الاتصال بماكينة Paymob على ${ip}:${port} (${err.code || err.message}).`;

      if (isCloudEnv && isPrivateSub && !isAbort) {
        errMsg +=
          ' (ملاحظة السحابة: السيرفر السحابي لا يستطيع الدخول لشبكة الراوتر المحلي؛ استخدم تطبيق ديسكتوب Z-Systems للربط المباشر).';
      } else if (!isAbort) {
        errMsg += ' تأكد من تشغيل تطبيق ECR على الماكينة.';
      }

      session.message = errMsg;
      session.updatedAt = Date.now();
    }
  }

  /**
   * Cancel ongoing terminal transaction remotely
   */
  async dispatchTerminalCancel(ip: string, port: number, provider: string, transactionId: string): Promise<void> {
    try {
      if (provider.includes('geidea')) {
        await fetch(`http://${ip}:${port}/api/v1/transaction/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenceId: transactionId, ecrReference: transactionId }),
          signal: AbortSignal.timeout(4000),
        }).catch(async () => {
          await fetch(`http://${ip}:${port}/ecr/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ referenceId: transactionId, ecrReference: transactionId }),
            signal: AbortSignal.timeout(4000),
          }).catch(() => {});
        });
      } else if (provider.includes('fawry') || provider.includes('pax')) {
        const isRawTcpPort = port === 10009 || port === 20008;
        if (isRawTcpPort) {
          await this.checkOrSendPaxRawTcpSocket(
            ip,
            port,
            { command: 'CANCEL_TRANSACTION', ecrRefNum: transactionId },
            4000,
          ).catch(() => {});
        } else {
          await fetch(`http://${ip}:${port}/poslink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'CANCEL_TRANSACTION', ecrRefNum: transactionId }),
            signal: AbortSignal.timeout(4000),
          }).catch(() => {});
        }
      }
    } catch {
      // Best-effort cancel
    }
  }
}
