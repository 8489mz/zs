import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import pino, { Logger, LoggerOptions } from 'pino';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: Logger;

  constructor() {
    const options: LoggerOptions = {
      level: process.env.LOG_LEVEL ?? 'info',
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    };
    const isElectron = process.env.APP_MODE === 'SELF_CONTAINED';
    let baseDir = process.cwd();
    // If running in development inside the backend folder, point to the parent root 'errors' folder
    if (baseDir.endsWith('backend') && !isElectron) {
      baseDir = path.join(baseDir, '..');
    }
    const logFilePath = path.join(baseDir, 'logs', 'system-errors.log');

    // Clear log file if it exceeds 10MB to prevent startup slowdowns
    try {
      if (fs.existsSync(logFilePath)) {
        const stats = fs.statSync(logFilePath);
        if (stats.size > 10 * 1024 * 1024) {
          fs.writeFileSync(logFilePath, '', 'utf8');
        }
      }
    } catch (err) {
      // Ignore errors silently
    }

    const transport = pino.transport({
      targets: [
        {
          target: 'pino/file',
          options: { destination: 1 }, // stdout
          level: process.env.LOG_LEVEL || 'info',
        },
        {
          target: 'pino/file',
          options: { destination: logFilePath, mkdir: true },
          level: 'warn', // Only log warnings and errors to the file
        },
      ],
    });

    this.logger = pino(options, transport);
  }

  log(message: string, ...optionalParams: unknown[]): void {
    this.logger.info({ context: optionalParams }, message);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const errorParam =
      optionalParams.find((p) => p instanceof Error) || (message instanceof Error ? message : undefined);
    const stackTrace = !errorParam ? optionalParams.find((p) => typeof p === 'string' && p.includes('\n')) : undefined;

    let logMsg = typeof message === 'string' ? message : 'error';
    const payload: any = { context: optionalParams };

    if (errorParam) {
      payload.err = errorParam;
      if (typeof message === 'string') logMsg = message;
      else if (errorParam.message) logMsg = errorParam.message;
    } else if (stackTrace) {
      payload.err = { message: typeof message === 'string' ? message : 'error', stack: stackTrace };
    }

    if (typeof message === 'object' && message !== null && !(message instanceof Error)) {
      Object.assign(payload, message);
      const strParam = optionalParams.find((p) => typeof p === 'string');
      if (strParam) logMsg = strParam as string;
    }

    this.logger.error(payload, logMsg);
  }

  warn(message: string, ...optionalParams: unknown[]): void {
    this.logger.warn({ context: optionalParams }, message);
  }

  debug(message: string, ...optionalParams: unknown[]): void {
    this.logger.debug({ context: optionalParams }, message);
  }

  verbose(message: string, ...optionalParams: unknown[]): void {
    this.logger.trace({ context: optionalParams }, message);
  }

  getPino(): Logger {
    return this.logger;
  }
}
