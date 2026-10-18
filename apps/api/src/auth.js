import { timingSafeEqual } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

/**
 * Verifikasi pengguna dashboard dengan Firebase Auth (token yang sama dengan web; Google maupun
 * email/password). Mode "dev" (hanya non-production) menerima "dev:<uid>" untuk uji otomatis;
 * uid berawalan "admin" diperlakukan sebagai platformAdmin.
 */
export function createAuthenticator(config) {
  let firebaseAuth = null;
  const firebase = () => {
    if (!firebaseAuth) {
      const app = getApps().find(item => item.name === 'tandurai-api')
        || initializeApp({ projectId: config.firebaseProjectId }, 'tandurai-api');
      firebaseAuth = getAuth(app);
    }
    return firebaseAuth;
  };

  return async function authenticate(token) {
    if (!token) return null;
    if (config.authMode === 'dev' && token.startsWith('dev:')) {
      const uid = token.slice(4);
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return null;
      return { uid, email: `${uid}@dev.local`, emailVerified: true, name: uid, platformAdmin: uid.startsWith('admin'), deviceAdmin: uid.startsWith('admin') };
    }
    try {
      const decoded = await firebase().verifyIdToken(token);
      const email = decoded.email ? decoded.email.toLowerCase() : null;
      const emailVerified = decoded.email_verified === true;
      // Admin Tandurai: custom claim platformAdmin, atau email terverifikasi di ADMIN_EMAILS. Admin
      // memantau sistem (konsol admin) dan boleh membuka semua farm klien (diperlakukan sebagai owner).
      const admin = decoded.platformAdmin === true || (emailVerified && (config.adminEmails || []).includes(email));
      return {
        uid: decoded.uid,
        email,
        emailVerified,
        name: typeof decoded.name === 'string' ? decoded.name : null,
        platformAdmin: admin,
        deviceAdmin: admin,
      };
    } catch {
      return null;
    }
  };
}

const bearer = header => (header?.startsWith('Bearer ') ? header.slice(7).trim() : null);

/**
 * Middleware Express: Authorization: Bearer <token>; SSE boleh ?token= (EventSource tidak bisa
 * set header). `onUser(user)` (opsional) mencatat/menyinkronkan user ke database.
 */
export function requireUser(authenticate, { allowQueryToken = false, onUser } = {}) {
  return async (req, res, next) => {
    try {
      const token = bearer(req.headers.authorization) || (allowQueryToken ? req.query.token : null);
      const user = await authenticate(token);
      if (!user) return res.status(401).json({ error: 'unauthorized', message: 'Login diperlukan.' });
      req.user = user;
      if (onUser) await onUser(user);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/** Middleware admin Tandurai (konsol admin, registrasi perangkat). Dipakai setelah requireUser. */
export function requireDeviceAdmin(req, res, next) {
  if (!req.user?.deviceAdmin) return res.status(403).json({ error: 'forbidden', message: 'Hanya admin Tandurai yang dapat membuka fitur ini.' });
  return next();
}

/** Middleware API worker lokal: Authorization: Bearer <WORKER_TOKEN> (perbandingan waktu-konstan). */
export function requireWorker(workerToken) {
  const expected = Buffer.from(workerToken || '');
  return (req, res, next) => {
    const given = Buffer.from(bearer(req.headers.authorization) || '');
    const ok = expected.length >= 16 && given.length === expected.length && timingSafeEqual(given, expected);
    if (!ok) return res.status(401).json({ error: 'unauthorized', message: 'Token worker tidak valid.' });
    return next();
  };
}
