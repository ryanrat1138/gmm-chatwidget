// Tests for api/note.js with CloseBot's and HighLevel's APIs mocked.
// Run with: node test/note.test.js
const assert = require('assert');
const handler = require('../api/note');

const ORIGIN = 'https://site.example';
const BASE_ENV = { CLOSEBOT_API_KEY: 'cb-test', ALLOWED_ORIGINS: ORIGIN };

let calls = [];
let searches = []; // one entry per search call: the leads to return
let noteStatus = 200;
let hlContact = null;
global.fetch = async (url, init = {}) => {
  calls.push({ url, init });
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  if (url.includes('leadconnectorhq.com/contacts/search/duplicate')) return json(200, { contact: hlContact });
  if (url.endsWith('/lead/search')) {
    const next = searches.length > 1 ? searches.shift() : searches[0];
    if (typeof next === 'number') return json(next, {});
    return json(200, { leads: next || [], total: (next || []).length });
  }
  if (/\/lead\/[^/]+\/note$/.test(url)) return json(noteStatus, { noteId: 'n1', aiVisible: true });
  return json(404, {});
};
handler._setSleep(async () => {});

function call({ method = 'POST', origin = ORIGIN, body, ip = '1.2.3.4' } = {}) {
  return new Promise((resolve) => {
    const res = {
      headers: {}, statusCode: 0,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(code) { this.statusCode = code; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
      end() { resolve({ status: this.statusCode, body: undefined, headers: this.headers }); },
    };
    handler({ method, headers: { origin, 'x-forwarded-for': ip }, body: JSON.stringify(body || {}) }, res);
  });
}

const lead = (id, fields, extra = {}) => ({ id, contactId: 'hl_' + id, fields: fields.map(([field, value]) => ({ field, name: field, value })), ...extra });
const notePosts = () => calls.filter((c) => /\/note$/.test(c.url));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('adds an AI-only note to the lead whose email matches', async () => {
  searches = [[lead('other', [['email', 'x@y.co']]), lead('L1', [['email', 'Ann@Example.com']])]];
  const r = await call({ body: { name: ' Ann  Lee ', email: 'ann@example.com', phone: '(603) 555-0100', answers: { business_info: 'HVAC', team_size: '6-20' } } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { added: true, matchedBy: 'email', aiVisible: true });
  assert.strictEqual(r.headers['access-control-allow-origin'], ORIGIN);
  const post = notePosts()[0];
  assert.ok(post.url.endsWith('/lead/L1/note'));
  assert.strictEqual(post.init.headers['X-CB-KEY'], 'cb-test');
  assert.deepStrictEqual(JSON.parse(post.init.body), {
    body: 'Form answers from the thank-you page (given by the visitor, for reference):\n- Name: Ann Lee\n- Email: ann@example.com\n' +
      '- Phone: (603) 555-0100\n- Business info: HVAC\n- Team size: 6-20',
    aiVisible: true,
  });
  const search = JSON.parse(calls.find((c) => c.url.endsWith('/lead/search')).init.body);
  assert.strictEqual(search.search, 'ann@example.com');
  assert.deepStrictEqual(search.sourceIds, []);
});

test('retries while CloseBot has no lead yet, then matches by phone', async () => {
  process.env.CLOSEBOT_SOURCE_IDS = 'srcA, srcB';
  searches = [[], [], [lead('L2', [['phone', '+1 (555) 010-2030']])]];
  const r = await call({ body: { phone: '555-010-2030', answers: { business_info: 'Roofing' } } });
  assert.deepStrictEqual(r.body, { added: true, matchedBy: 'phone', aiVisible: true });
  assert.strictEqual(calls.filter((c) => c.url.endsWith('/lead/search')).length, 3);
  assert.deepStrictEqual(JSON.parse(calls[0].init.body).sourceIds, ['srcA', 'srcB']);
});

test('matches by HighLevel contact id when HighLevel is set up', async () => {
  process.env.HIGHLEVEL_PRIVATE_TOKEN = 'pit'; process.env.HIGHLEVEL_LOCATION_ID = 'loc1';
  hlContact = { id: 'hl_L3' };
  searches = [[lead('L9', []), lead('L3', [])]];
  const r = await call({ body: { email: 'c@d.co', answers: { business_info: 'HVAC' } } });
  assert.deepStrictEqual(r.body, { added: true, matchedBy: 'contact', aiVisible: true });
  assert.ok(notePosts()[0].url.endsWith('/lead/L3/note'));
});

test('a single result for an email search is taken; several unmatched ones are not', async () => {
  searches = [[lead('L4', [])]];
  let r = await call({ body: { email: 'e@f.co', answers: { business_info: 'HVAC' } } });
  assert.deepStrictEqual(r.body, { added: true, matchedBy: 'search', aiVisible: true });
  calls = []; handler._reset();
  searches = [[lead('L5', []), lead('L6', [])]];
  r = await call({ body: { email: 'e@f.co', answers: { business_info: 'HVAC' } } });
  assert.deepStrictEqual(r.body, { added: false, reason: 'lead_not_found' });
  assert.strictEqual(notePosts().length, 0);
});

test('leaves alone a lead that has been quiet for over an hour', async () => {
  searches = [[lead('L7', [['email', 'g@h.co']], { lastMessageTime: new Date(Date.now() - 2 * 3600e3).toISOString() })]];
  const r = await call({ body: { email: 'g@h.co', answers: { business_info: 'HVAC' } } });
  assert.deepStrictEqual(r.body, { added: false, reason: 'lead_not_recent' });
  assert.strictEqual(notePosts().length, 0);
});

test('refusals: origin, no key, no contact, no answers, bad key, rate limit', async () => {
  assert.strictEqual((await call({ origin: 'https://evil.example', body: {} })).status, 403);
  delete process.env.CLOSEBOT_API_KEY;
  let r = await call({ body: { email: 'a@b.co', answers: { x: 'y' } } });
  assert.deepStrictEqual([r.status, r.body], [501, { added: false, reason: 'not_configured' }]);
  process.env.CLOSEBOT_API_KEY = 'cb-test';
  r = await call({ body: { answers: { x: 'y' } } });
  assert.strictEqual(r.body.reason, 'email_or_phone_required');
  r = await call({ body: { email: 'a@b.co', answers: { 'bad key!': 'y', empty: '  ' } } });
  assert.strictEqual(r.body.reason, 'no_answers');
  searches = [401];
  r = await call({ body: { email: 'a@b.co', answers: { x: 'y' } } });
  assert.deepStrictEqual([r.status, r.body], [502, { added: false, reason: 'closebot_key_rejected' }]);
  handler._reset();
  for (let i = 0; i < 20; i++) await call({ ip: '9.9.9.9', body: {} });
  r = await call({ ip: '9.9.9.9', body: {} });
  assert.strictEqual(r.status, 429);
});

test('a sealed customer key is used for its own sites and sources only', async () => {
  delete process.env.CLOSEBOT_API_KEY; delete process.env.ALLOWED_ORIGINS;
  process.env.SEAL_SECRET = 's'.repeat(40);
  process.env.HIGHLEVEL_PRIVATE_TOKEN = 'pit'; process.env.HIGHLEVEL_LOCATION_ID = 'loc1';
  const { seal } = require('../lib/seal');
  const key = seal({ k: 'customer-key', o: ['https://customer.example'], s: ['srcC'] });
  searches = [[lead('C1', [['email', 'v@w.co']])]];
  let r = await call({ origin: 'https://customer.example', body: { email: 'v@w.co', answers: { business_info: 'HVAC' }, key } });
  assert.deepStrictEqual(r.body, { added: true, matchedBy: 'email', aiVisible: true });
  assert.strictEqual(r.headers['access-control-allow-origin'], 'https://customer.example');
  assert.strictEqual(notePosts()[0].init.headers['X-CB-KEY'], 'customer-key');
  assert.deepStrictEqual(JSON.parse(calls.find((c) => c.url.endsWith('/lead/search')).init.body).sourceIds, ['srcC']);
  assert.ok(!calls.some((c) => c.url.includes('leadconnectorhq')), 'the service\'s HighLevel is not used for a customer');
  r = await call({ origin: ORIGIN, body: { email: 'v@w.co', answers: { business_info: 'HVAC' }, key } });
  assert.strictEqual(r.status, 403);
  r = await call({ origin: 'https://customer.example', body: { email: 'v@w.co', answers: { business_info: 'HVAC' }, key: key.slice(0, -3) + 'AAA' } });
  assert.deepStrictEqual([r.status, r.body.reason], [400, 'bad_key']);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    calls = []; searches = []; noteStatus = 200; hlContact = null; handler._reset();
    for (const k of Object.keys(process.env)) if (/^(CLOSEBOT|HIGHLEVEL|ALLOWED|SEAL)_/.test(k)) delete process.env[k];
    Object.assign(process.env, BASE_ENV);
    try { await t.fn(); console.log('ok   - ' + t.name); } catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + e.stack); }
  }
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
