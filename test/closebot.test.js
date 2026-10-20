// Tests for api/closebot.js with CloseBot's API mocked.
// Run with: node test/closebot.test.js
const assert = require('assert');
process.env.SEAL_SECRET = 'q'.repeat(40);
const handler = require('../api/closebot');
const { unseal } = require('../lib/seal');

let calls = [];
let sourcesStatus = 200;
const BOTS = [
  { id: 'b1', name: 'Sales agent', versions: [{ published: true }], sources: [
    { id: 'src1', enabled: true, channelList: ['sms'], tags: [{ name: 'lead', approveDeny: true }], personaNameOverride: 'Sam' }] },
  { id: 'b2', name: 'Support agent', versions: [{ published: false }], sources: [{ id: 'src1', channelList: ['chat_w1'] }] },
  { id: 'b3', name: 'Other', versions: [], sources: [] },
];
let attachStatus = 200;
global.fetch = async (url, init = {}) => {
  calls.push({ url, init });
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  if (url.endsWith('/agency/source/src1/channels')) return json(200, [{ id: 'sms', name: 'SMS' }, { id: 'chat_w1', name: 'Chat widget' }]);
  if (url.endsWith('/bot')) return json(200, BOTS);
  if (/\/bot\/[^/]+\/source\//.test(url)) return json(attachStatus, {});
  return {
    ok: sourcesStatus < 300, status: sourcesStatus,
    json: async () => ({ total: 2, results: [
      { sourceId: 'src1', name: 'Main HighLevel', category: 'GHL', scriptInstalled: true, key: '4ts0AHLEWQsK5N84', accessToken: 'secret' },
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
    { id: 'src1', name: 'Main HighLevel', category: 'GHL', scriptInstalled: true, key: '4ts0AHLEWQsK5N84' },
    { id: 'src2', name: 'Second', category: 'GHL', scriptInstalled: false, key: '' },
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

test('lists the agents and which channels each answers on the source', async () => {
  const r = await call({ body: { apiKey: KEY, action: 'agents', sourceId: 'src1' } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.channels, [{ id: 'sms', name: 'SMS' }, { id: 'chat_w1', name: 'Chat widget' }]);
  assert.deepStrictEqual(r.body.agents, [
    { id: 'b1', name: 'Sales agent', published: true, onSource: true, enabled: true, channels: ['sms'] },
    { id: 'b2', name: 'Support agent', published: false, onSource: true, enabled: true, channels: ['chat_w1'] },
    { id: 'b3', name: 'Other', published: false, onSource: false, enabled: false, channels: [] },
  ]);
  assert.strictEqual((await call({ body: { apiKey: KEY, action: 'agents', sourceId: 'nope' } })).body.error, 'unknown_source');
});

test('assigning adds the channel and keeps the agent\'s other settings on the source', async () => {
  const r = await call({ body: { apiKey: KEY, action: 'assign', sourceId: 'src1', botId: 'b1', channel: 'chat_w1' } });
  assert.deepStrictEqual(r.body, { assigned: true, channels: ['sms', 'chat_w1'], othersOnChannel: ['Support agent'] });
  const post = calls.find((c) => c.url.endsWith('/bot/b1/source/src1'));
  assert.strictEqual(post.init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(post.init.body), {
    channels: ['sms', 'chat_w1'], enabled: true, tags: [{ name: 'lead', approveDeny: true }], personaNameOverride: 'Sam',
  });
  calls = [];
  const fresh = await call({ body: { apiKey: KEY, action: 'assign', sourceId: 'src1', botId: 'b3', channel: 'chat_w1' } });
  assert.deepStrictEqual(fresh.body.channels, ['chat_w1']);
  assert.strictEqual((await call({ body: { apiKey: KEY, action: 'assign', sourceId: 'src1', botId: 'b3', channel: 'whatsapp' } })).body.error, 'unknown_channel');
  assert.strictEqual((await call({ body: { apiKey: KEY, action: 'assign', sourceId: 'src1', botId: 'zz', channel: 'sms' } })).body.error, 'unknown_agent');
  attachStatus = 500;
  assert.strictEqual((await call({ body: { apiKey: KEY, action: 'assign', sourceId: 'src1', botId: 'b1', channel: 'sms' } })).status, 502);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    calls = []; sourcesStatus = 200; attachStatus = 200; handler._reset();
    try { await t.fn(); console.log('ok   - ' + t.name); } catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + e.stack); }
  }
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
