import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNode } from '../public/assets/ui/node-lookup.js';
import { REAL_PAYMENT } from './fixtures.js';

const pubkey = REAL_PAYMENT.nodeId;

test('node API response fields are type-checked, bounded, and tied to the requested public key', () => {
  for (const data of [null, [], {}, { public_key: 'different' }, { public_key: { toString: () => pubkey } }]) {
    assert.equal(parseNode(data, pubkey), null);
  }
  const parsed = parseNode({ public_key: pubkey, alias: 'x'.repeat(5000), capacity: '9'.repeat(10000), active_channel_count: Infinity }, pubkey);
  assert.equal(parsed.alias.length, 128);
  assert.equal(parsed.capacity, null);
  assert.equal(parsed.active_channel_count, null);
  for (const capacity of ['$(id)', {}, [], -1, NaN, Infinity, '1e10000', '123\n', '']) {
    assert.equal(parseNode({ public_key: pubkey, capacity }, pubkey).capacity, null);
  }
  assert.equal(parseNode({ public_key: pubkey, capacity: 1234 }, pubkey).capacity, '1234');
});

test('lookups reject URL/path injection, cap parallelism and total requests, and deduplicate', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const { lookupNode, MAX_LOOKUPS, MAX_CONCURRENT_LOOKUPS } = await import('../public/assets/ui/node-lookup.js?budget-test');
  const requests = [];
  const pending = [];
  globalThis.fetch = (url, options) => {
    requests.push({ url, options });
    return new Promise((resolve) => pending.push(() => resolve(new Response('{}', { status: 404 }))));
  };
  for (const input of ['../secret?preimage=leak', 'https://evil.test', 'javascript:alert(1)', pubkey + '\n', null]) {
    assert.equal((await lookupNode(input)).status, 'unavailable');
  }
  assert.equal(requests.length, 0);
  const first = lookupNode(pubkey);
  assert.equal(lookupNode(pubkey), first);
  const results = [first];
  for (let i = 0; i < 100; i++) results.push(lookupNode('02' + i.toString(16).padStart(64, '0')));
  assert.equal(requests.length, MAX_CONCURRENT_LOOKUPS);
  for (let step = 0; step < MAX_LOOKUPS; step++) {
    for (const resolve of pending.splice(0)) resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(pending.length <= MAX_CONCURRENT_LOOKUPS);
  }
  await Promise.all(results);
  assert.equal(requests.length, MAX_LOOKUPS);
  for (const { url, options } of requests) {
    assert.match(url, /^https:\/\/mempool\.space\/api\/v1\/lightning\/nodes\/(02|03)[0-9a-f]{64}$/);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('oversized, malformed, or mismatched API responses fail closed; streams are cancelled', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const { lookupNode, MAX_RESPONSE_BYTES } = await import('../public/assets/ui/node-lookup.js?response-test');
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1)); },
    cancel() { cancelled = true; },
  }));
  assert.equal((await lookupNode(pubkey)).status, 'unavailable');
  assert.equal(cancelled, true);
  for (const [i, body] of ['not JSON\x1b', '{"public_key":"wrong"}'].entries()) {
    globalThis.fetch = async () => new Response(body);
    assert.equal((await lookupNode('02' + String(i).padStart(64, '0'))).status, 'unavailable');
  }
});
