type PgSslConfigInput = {
  enabled: boolean;
  rejectUnauthorized: boolean;
  caCert?: string | null;
};

type PgSslResult =
  | false
  | {
      rejectUnauthorized: boolean;
      ca?: string;
    };

export function toBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return defaultValue;
}

export function resolvePgSslConfig(input: PgSslConfigInput): PgSslResult {
  if (!input.enabled) return false;

  const ca = typeof input.caCert === 'string' ? input.caCert.trim() : '';
  if (ca) {
    return {
      rejectUnauthorized: input.rejectUnauthorized,
      ca,
    };
  }

  return {
    rejectUnauthorized: input.rejectUnauthorized,
  };
}
