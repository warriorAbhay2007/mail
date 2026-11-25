import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyAccessToken } from './auth';

function signHs256Jwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

test('verifyAccessToken accepts valid Supabase HS256 JWT when SUPABASE_JWT_SECRET is configured', () => {
  const prevSecret = process.env.SUPABASE_JWT_SECRET;
  const testSecret = 'test-supabase-jwt-secret-for-unit-test';
  process.env.SUPABASE_JWT_SECRET = testSecret;

  try {
    const token = signHs256Jwt(
      {
        sub: 'supa_user_123',
        email: 'tester@example.com',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      testSecret
    );

    const verified = verifyAccessToken(token);
    assert.ok(verified);
    assert.equal(verified.sub, 'supa_user_123');
    assert.equal(verified.email, 'tester@example.com');
  } finally {
    if (prevSecret === undefined) {
      delete process.env.SUPABASE_JWT_SECRET;
    } else {
      process.env.SUPABASE_JWT_SECRET = prevSecret;
    }
  }
});

test('verifyAccessToken rejects expired or tampered Supabase JWTs', () => {
  const prevSecret = process.env.SUPABASE_JWT_SECRET;
  const testSecret = 'test-supabase-jwt-secret-for-unit-test';
  process.env.SUPABASE_JWT_SECRET = testSecret;

  try {
    const expiredToken = signHs256Jwt(
      {
        sub: 'supa_user_123',
        email: 'tester@example.com',
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      testSecret
    );
    assert.equal(verifyAccessToken(expiredToken), null);

    const wrongSecretToken = signHs256Jwt(
      {
        sub: 'supa_user_123',
        email: 'tester@example.com',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      'wrong-secret'
    );
    assert.equal(verifyAccessToken(wrongSecretToken), null);

    const malformed = 'not.a.valid.jwt';
    assert.equal(verifyAccessToken(malformed), null);
  } finally {
    if (prevSecret === undefined) {
      delete process.env.SUPABASE_JWT_SECRET;
    } else {
      process.env.SUPABASE_JWT_SECRET = prevSecret;
    }
  }
});
