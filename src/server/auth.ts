import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { loadDb, newId, saveDb, seedUserWorkspace } from './store';
import { PublicUser, UserDoc } from '../shared/types';

// Runtime-only signing secret if SESSION_SECRET is unset (never hardcoded)
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'meridian_session';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export function hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash: derived, salt };
}

export function verifyPassword(password: string, expectedHash: string, salt: string): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface TokenPayload {
  sub: string;
  email: string;
  exp: number;
}

export function signSessionToken(user: Pick<UserDoc, 'id' | 'email'>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyHmacJwt(token: string, secret: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as TokenPayload;
    if (!parsed.sub || (parsed.exp && parsed.exp < Math.floor(Date.now() / 1000))) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function verifyAccessToken(token: string): TokenPayload | null {
  const local = verifyHmacJwt(token, SESSION_SECRET);
  if (local) return local;
  if (process.env.SUPABASE_JWT_SECRET) {
    return verifyHmacJwt(token, process.env.SUPABASE_JWT_SECRET);
  }
  return null;
}

export function toPublicUser(u: UserDoc): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    authProvider: u.authProvider,
  };
}

function parseCookieToken(req: Request): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

export function setSessionCookie(res: Response, req: Request, token: string): void {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${60 * 60 * 24 * 7}`,
  ];
  if (isSecure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response, req: Request): void {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isSecure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export async function ensureDemoUser(): Promise<UserDoc> {
  const db = loadDb();
  const demoEmail = 'abhaytailor6@velomail.app';
  let user = db.users.find((u) => u.id === 'user_demo_primary' || u.email.toLowerCase() === demoEmail);
  if (!user) {
    const { hash, salt } = hashPassword(crypto.randomBytes(16).toString('hex'));
    user = {
      id: 'user_demo_primary',
      email: demoEmail,
      name: 'Abhay Tailor',
      passwordHash: hash,
      passwordSalt: salt,
      authProvider: 'demo',
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    await saveDb();
  } else if (user.email !== demoEmail) {
    user.email = demoEmail;
    await saveDb();
  }
  seedUserWorkspace(user.id, user.email, user.name);
  return user;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    token = parseCookieToken(req);
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session token.' });
    return;
  }

  const db = loadDb();
  let user = db.users.find((u) => u.id === payload.sub);
  if (!user && process.env.SUPABASE_JWT_SECRET && payload.email) {
    // Auto-provision user record on first valid Supabase JWT login
    const { hash, salt } = hashPassword(crypto.randomBytes(16).toString('hex'));
    user = {
      id: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.email.split('@')[0],
      passwordHash: hash,
      passwordSalt: salt,
      authProvider: 'supabase',
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    seedUserWorkspace(user.id, user.email, user.name);
    void saveDb();
  }

  if (!user) {
    res.status(401).json({ error: 'User account not found.' });
    return;
  }

  req.userId = user.id;
  req.userEmail = user.email;
  next();
}

export function createLocalUser(email: string, password: string, name: string): UserDoc {
  const db = loadDb();
  const normalized = email.trim().toLowerCase();
  const { hash, salt } = hashPassword(password);
  const user: UserDoc = {
    id: newId('user'),
    email: normalized,
    name: name.trim() || normalized.split('@')[0],
    passwordHash: hash,
    passwordSalt: salt,
    authProvider: 'local',
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  seedUserWorkspace(user.id, user.email, user.name);
  void saveDb();
  return user;
}
