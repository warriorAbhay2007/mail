import test from 'node:test';
import assert from 'node:assert/strict';
import { api, resetBackendAvailability } from './client';
import { resetLocalFallbackState } from './localFallbackStore';

function mockFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

test('falls back cleanly to local workspace data when backend returns 404 HTML', async () => {
  resetBackendAvailability();
  resetLocalFallbackState();

  const restore = mockFetch(async () =>
    new Response('<!doctype html><html><body>Not Found</body></html>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    })
  );

  try {
    const sess = await api.session();
    assert.equal(sess.authenticated, true);
    assert.ok(sess.user?.email);

    const mailsRes = await api.listMails();
    assert.ok(mailsRes.mails.length >= 3);

    const quickReply = await api.generateQuickReply(mailsRes.mails[0].id, 'Concise');
    assert.equal(quickReply.tone, 'Concise');
    assert.ok(quickReply.draft.length > 20);
  } finally {
    restore();
    resetBackendAvailability();
    resetLocalFallbackState();
  }
});

test('falls back cleanly when fetch rejects with a network error', async () => {
  resetBackendAvailability();
  resetLocalFallbackState();

  const restore = mockFetch(async () => {
    throw new TypeError('Failed to fetch');
  });

  try {
    const digestRes = await api.generateDigest({ scope: 'all' });
    assert.ok(digestRes.digest.totalAnalyzed >= 1);

    const ingested = await api.ingestMail({
      fromName: 'Sam Patel',
      fromEmail: 'sam@northstar.io',
      subject: 'Roadmap Checkpoint',
      textBody: 'Can we meet Friday at 15:00 UTC?',
    });
    assert.equal(ingested.ingested.length, 1);
    assert.equal(ingested.ingested[0].subject, 'Roadmap Checkpoint');
  } finally {
    restore();
    resetBackendAvailability();
    resetLocalFallbackState();
  }
});

test('falls back cleanly when static host serves 200 index.html for API routes', async () => {
  resetBackendAvailability();
  resetLocalFallbackState();

  const restore = mockFetch(async () =>
    new Response('<!doctype html><div id="root"></div>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  );

  try {
    const agentRes = await api.executeAgent('/digest', null);
    assert.equal(agentRes.assistantMessage.actionPreview?.type, 'digest_briefing');

    const catsRes = await api.listCategories();
    assert.ok(catsRes.categories.some((c) => c.name === 'OTP'));
  } finally {
    restore();
    resetBackendAvailability();
    resetLocalFallbackState();
  }
});

test('preserves structured JSON error responses from a live backend', async () => {
  resetBackendAvailability();

  const restore = mockFetch(async () =>
    new Response(JSON.stringify({ error: 'Invalid Quick Reply tone.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  );

  try {
    await assert.rejects(
      () => api.generateQuickReply('mail_1', 'Professional'),
      (err: Error) => err.message === 'Invalid Quick Reply tone.'
    );
  } finally {
    restore();
    resetBackendAvailability();
  }
});
