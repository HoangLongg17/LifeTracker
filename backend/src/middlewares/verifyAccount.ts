
import type { RequestHandler } from 'express';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';

export type AccountHandler = RequestHandler<
  Record<string, never>,
  unknown,
  unknown,
  unknown,
  { identity: DecodedIdToken }
>;

export function verifyAccount(
  auth: Pick<Auth, 'verifyIdToken'>
): AccountHandler {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');

    const bearer = /^Bearer (\S+)$/i.exec(
      req.headers.authorization ?? ''
    );

    if (!bearer) {
      res.status(401).json({ code: 'TOKEN_INVALID' });
      return;
    }

    let identity: DecodedIdToken;

    try {
      identity = await auth.verifyIdToken(bearer[1], true);
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error
          ? error.code
          : undefined;

      if (code === 'auth/user-disabled') {
        res.status(403).json({ code: 'ACCOUNT_DISABLED' });
      } else if (code === 'auth/id-token-expired') {
        res.status(401).json({ code: 'TOKEN_EXPIRED' });
      } else if (code === 'auth/id-token-revoked') {
        res.status(401).json({ code: 'TOKEN_REVOKED' });
      } else if (
        code === 'auth/argument-error' ||
        code === 'auth/invalid-id-token' ||
        code === 'auth/user-not-found'
      ) {
        res.status(401).json({ code: 'TOKEN_INVALID' });
      } else {
        res.status(503).json({ code: 'AUTH_UNAVAILABLE' });
      }

      return;
    }

    if (
      !identity.email ||
      identity.firebase.sign_in_provider !== 'password'
    ) {
      res.status(403).json({
        code: 'EMAIL_ACCOUNT_REQUIRED'
      });
      return;
    }

    res.locals.identity = identity;
    next();
  };
}
