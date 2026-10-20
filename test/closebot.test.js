// Tests for api/closebot.js with CloseBot's API mocked.
// Run with: node test/closebot.test.js
const assert = require('assert');
process.env.SEAL_SECRET = 'q'.repeat(40);
const handler = require('../api/closebot');
const { unseal } = require('../lib/seal');

let calls = [];
let sourcesStatus = 200;
global.fetch = async (url, init = {}) => {
  calls.push({ url, init });
  return {
    ok: sourcesStatus < 300, status: sourcesStatus,
    json: async () => ({ total: 2, results: [
      { sourceId: 'src1', name: 'Main HighLevel', category: 'GHL', scriptInstalled: true, accessToken: 'secret' },
      { sourceId: 'src2', name: 'Second', category: 'GHL' },
    ] }),
  };
};

function call({ origin = 'https://setup.example', body, ip = '1.2.3.4' } = {}) {
  return new Promise((resolve) => {
    const res = {
      headers: {}, statusCode: 0,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(code) { this.statusCode = code; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); },
    };
    handler({ method: 'POST', headers: { origin, host: 'setup.example', 'x-forwarded-for': ip }, body: JSON.stringify(body || {}) }, res);
  });
}

const KEY = 'cbk_abcdefghijklmnop1234';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('lists the account\'s sources, without their tokens', async () => {
  const r = await call({ body: { apiKey: KEY } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.sources, [
    { id: 'src1', name: 'Main HighLevel', category: 'GHL', scriptInstalled: true },
    { id: 'src2', name: 'Second', category: 'GHL', scriptInstalled: false },
  ]);
  assert.strictEqual(calls[0].init.headers['X-CB-KEY'], KEY);
  assert.ok(calls[0].url.startsWith('https://api.closebot.com/agency/source'));
});

test('seals the key with its sites and known sources', async () => {
  const r = await call({ body: { apiKey: KEY, action: 'seal', sites: ['https://acme.example/thank-you', 'https://acme.example/other'], sourceIds: ['src2', 'nope'] } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.sites, ['https://acme.example']);
  assert.deepStrictEqual(r.body.sourceIds, ['src2']);
  assert.ok(!r.body.sealed.includes(KEY));
  assert.deepStrictEqual(unseal(r.body.sealed), { k: KEY, o: ['https://acme.example'], s: ['src2'] });
});

test('refusals: other sites, bad key, rejected key, bad sites, no secret', async () => {
  assert.strictEqual((await call({ origin: 'https://evil.example', body: { apiKey: KEY } })).status, 403);
  assert.strictEqual((await call({ body: { apiKey: 'x' } })).body.error, 'bad_key');
  sourcesStatus = 401;
  assert.deepStrictEqual(await call({ body: { apiKey: KEY } }), { status: 401, body: { error: 'closebot_key_rejected' } });
  sourcesStatus = 200;
  assert.strictEqual((await call({ body: { apiKey: KEY, action: 'seal', sites: ['http://acme.example'] } })).body.error, 'bad_sites');
  const secret = process.env.SEAL_SECRET;
  delete process.env.SEAL_SECRET;
  assert.deepStrictEqual(await call({ body: { apiKey: KEY, action: 'seal', sites: ['https://acme.example'] } }), { status: 501, body: { error: 'not_configured' } });
  process.env.SEAL_SECRET = secret;
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    calls = []; sourcesStatus = 200; handler._reset();
    try { await t.fn(); console.log('ok   - ' + t.name); } catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + e.stack); }
  }
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
