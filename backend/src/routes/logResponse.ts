import type { Response } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { isRecord } from '../services/logCommon';

export function respondWithResult(
  res: Response,
  result: { status: string }
): void {
  const statusCodes: Record<string, number> = {
    created: 201,
    existing: 200,
    updated: 200,
    deleted: 200,
    ENTRY_ID_CONFLICT: 409,
    ENTRY_ALREADY_DELETED: 409,
    VERSION_CONFLICT: 409,
    ENTRY_NOT_FOUND: 404,
    ACCOUNT_NOT_INITIALIZED: 404,
    ACCOUNT_DELETING: 403,
    ACCOUNT_DISABLED: 403,
  };

  const status = statusCodes[result.status] ?? 500;
  res.status(status).json(status >= 400 ? { ...result, code: result.status } : result);
}

export function storageError(
  res: Response,
  operation: string,
  error: unknown
): void {
  console.error(`[logs] ${operation} failed`, {
    code:
      isRecord(error) && 'code' in error
        ? String(error.code)
        : 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  res.status(503).json({
    code: 'LOG_UNAVAILABLE',
  });
}

export function serialize(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serialize);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'requestFingerprint')
        .map(([key, item]) => [key, serialize(item)])
    );
  }

  return value;
}
