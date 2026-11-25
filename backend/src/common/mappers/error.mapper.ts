import { HttpException, HttpStatus } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { translateErrorMessageFromCode } from '../errors/error-translations';
import { mapPostgresErrorToAppError } from '../errors/postgres-error.mapper';

function normalizeHttpExceptionBody(response: string | object, status: number): HttpException {
  if (typeof response === 'string') {
    return new HttpException(
      {
        message: translateErrorMessageFromCode(undefined, response, status),
        code:
          status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
        details: null,
      },
      status,
    );
  }

  const payload = response as {
    message?: unknown;
    error?: unknown;
    code?: unknown;
    details?: unknown;
    statusCode?: unknown;
  };

  const code = typeof payload.code === 'string' ? payload.code : undefined;
  const rawMessage = payload.message ?? payload.error;
  const message = translateErrorMessageFromCode(code, rawMessage, status);

  return new HttpException(
    {
      ...payload,
      message,
      code:
        code ??
        (status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR'),
    },
    status,
  );
}

export function mapToHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return normalizeHttpExceptionBody(error.getResponse(), error.getStatus());
  }

  const mappedPgError = mapPostgresErrorToAppError(error);
  if (mappedPgError) {
    return new HttpException(
      {
        message: translateErrorMessageFromCode(mappedPgError.code, mappedPgError.message, mappedPgError.statusCode),
        code: mappedPgError.code,
        details: mappedPgError.details ?? null,
      },
      mappedPgError.statusCode,
    );
  }

  if (error instanceof AppError) {
    return new HttpException(
      {
        message: translateErrorMessageFromCode(error.code, error.message, error.statusCode),
        code: error.code,
        details: error.details ?? null,
      },
      error.statusCode,
    );
  }

  return new HttpException(
    {
      message: translateErrorMessageFromCode(
        'INTERNAL_ERROR',
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      ),
      code: 'INTERNAL_ERROR',
    },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
