// Tests for api/fields.js with HighLevel's API mocked.
// Run with: node test/api.test.js
const assert = require('assert');
const handler = require('../api/fields');

const ORIGIN = 'https://site.example';
const ENV = {
  HIGHLEVEL_PRIVATE_TOKEN: 'pit-test',
  HIGHLEVEL_LOCATION_ID: 'loc1',
  ALLOWED_FIELDS: 'business_info,team_size',
  ALLOWED_ORIGINS: ORIGIN + ',https://other.example',
};

let hlCalls = [];
let hlFail = false;
global.fetch = async (url, init = {}) => {
  hlCalls.push({ url, init });
  if (hlFail) return { ok: false, status: 401, json: async () => ({}) };
  if (url.includes('/customFields')) {
    return { ok: true, status: 200, json: async () => ({ customFields: [
      { id: 'cf_biz', fieldKey: 'contact.business_info' },
      { id: 'cf_notes', fieldKey: 'contact.private_notes' },
    ] }) };
  }
  if (url.endsWith('/contacts/upsert')) return { ok: true, status: 200, json: async () => ({ new: false, contact: { id: 'c1' } }) };
  return { ok: false, status: 404, json: async () => ({}) };
};

function call({ method = 'POST', origin = ORIGIN, body, ip = '1.2.3.4' } = {}) {
  return new Promise((resolve) => {
    const res = {
      headers: {}, statusCode: 0,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(code) { this.statusCode = code; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
      end() { resolve({ status: this.statusCode, body: undefined, headers: this.headers }); },
    };
    const req = { method, headers: { origin, 'x-forwarded-for': ip }, body: typeof body === 'string' ? body : JSON.stringify(body || {}) };
    handler(req, res);
  });
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('writes allowed fields to the contact by custom field id', async () => {
  const r = await call({ body: { email: 'a@b.co', phone: '', fields: { business_info: 'HVAC', private_notes: 'x', team_size: '5' } } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['access-control-allow-origin'], ORIGIN);
  assert.deepStrictEqual(r.body, { ok: true, updated: 1, missing: ['team_size'], newContact: false });
  const upsert = hlCalls.find((c) => c.url.endsWith('/contacts/upsert'));
  assert.deepStrictEqual(JSON.parse(upsert.init.body), { locationId: 'loc1', customFields: [{ id: 'cf_biz', field_value: 'HVAC' }], email: 'a@b.co' });
  assert.strictEqual(upsert.init.headers.Authorization, 'Bearer pit-test');
  assert.strictEqual(upsert.init.headers.Version, '2021-07-28');
});

test('rejects other origins', async () => {
  const r = await call({ origin: 'https://evil.example', body: { email: 'a@b.co', fields: { business_info: 'HVAC' } } });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.headers['access-control-allow-origin'], undefined);
  assert.strictEqual(hlCalls.length, 0);
});

test('needs an email or phone', async () => {
  const r = await call({ body: { email: 'not-an-email', fields: { business_info: 'HVAC' } } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(hlCalls.length, 0);
});

test('ignores fields that are not allowed', async () => {
  const r = await call({ body: { phone: '+16035550100', fields: { private_notes: 'x' } } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(hlCalls.length, 0);
});

test('says which fields are missing in HighLevel', async () => {
  const r = await call({ body: { email: 'a@b.co', fields: { team_size: '5' } } });
  assert.strictEqual(r.status, 422);
  assert.deepStrictEqual(r.body.missing, ['team_size']);
});

test('trims long values', async () => {
  await call({ body: { email: 'a@b.co', fields: { business_info: 'x'.repeat(900) } } });
  const upsert = hlCalls.find((c) => c.url.endsWith('/contacts/upsert'));
  assert.strictEqual(JSON.parse(upsert.init.body).customFields[0].field_value.length, 500);
});

test('reports a HighLevel failure as 502', async () => {
  hlFail = true;
  const r = await call({ body: { email: 'a@b.co', fields: { business_info: 'HVAC' } } });
  assert.strictEqual(r.status, 502);
});

test('reports missing configuration', async () => {
  delete process.env.HIGHLEVEL_PRIVATE_TOKEN;
  const r = await call({ body: { email: 'a@b.co', fields: { business_info: 'HVAC' } } });
  assert.strictEqual(r.status, 500);
});

test('rate limits one address', async () => {
  let last;
  for (let i = 0; i < 21; i++) last = await call({ ip: '9.9.9.9', body: { email: 'a@b.co', fields: { business_info: 'HVAC' } } });
  assert.strictEqual(last.status, 429);
});

test('answers the CORS preflight for allowed origins only', async () => {
  const ok = await call({ method: 'OPTIONS' });
  assert.strictEqual(ok.status, 204);
  assert.strictEqual(ok.headers['access-control-allow-origin'], ORIGIN);
  const bad = await call({ method: 'OPTIONS', origin: 'https://evil.example' });
  assert.strictEqual(bad.headers['access-control-allow-origin'], undefined);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    Object.assign(process.env, ENV);
    hlCalls = []; hlFail = false; handler._reset();
    try { await t.fn(); console.log('ok   -', t.name); }
    catch (err) { failed++; console.log('FAIL -', t.name, '\n      ', err.message.split('\n')[0]); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
