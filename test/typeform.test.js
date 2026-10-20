// Tests for api/typeform.js with Typeform's API mocked.
// Run with: node test/typeform.test.js
const assert = require('assert');
const handler = require('../api/typeform');

let calls = [];
let reply = { status: 200, body: {} };
global.fetch = async (url, init = {}) => {
  calls.push({ url, init });
  return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
};

function call({ method = 'POST', origin = 'https://setup.example', host = 'setup.example', body, ip = '1.2.3.4' } = {}) {
  return new Promise((resolve) => {
    const res = {
      headers: {}, statusCode: 0,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(code) { this.statusCode = code; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); },
    };
    handler({ method, headers: { origin, host, 'x-forwarded-for': ip }, body: JSON.stringify(body || {}) }, res);
  });
}

const TOKEN = 'tfp_abcdefghijklmnopqrstuvwxyz0123';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('reads a form: questions flattened, groups and statements handled, token passed through', async () => {
  calls = [];
  reply = { status: 200, body: {
    title: 'Get a quote',
    fields: [
      { ref: 'intro', title: 'Welcome', type: 'statement' },
      { ref: 'ci', title: 'Your details', type: 'contact_info', properties: { fields: [
        { ref: 'fn', title: 'First name', type: 'short_text' },
        { ref: 'em', title: 'Email', type: 'email' }] } },
      { ref: 'biz', title: 'What does your\n business do?', type: 'long_text' }],
    thankyou_screens: [{ title: 'Bye', type: 'url_redirect', properties: { redirect_url: 'https://site.example/thanks?x={{field:em}}' } }],
  } };
  const r = await call({ body: { token: TOKEN, form: 'https://form.typeform.com/to/AbC123' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls[0].url, 'https://api.typeform.com/forms/AbC123');
  assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.deepStrictEqual(r.body.fields.map((f) => [f.ref, f.title, f.group]), [
    ['fn', 'First name', 'Your details'], ['em', 'Email', 'Your details'], ['biz', 'What does your business do?', '']]);
  assert.strictEqual(r.body.endings[0].redirect, 'https://site.example/thanks?x={{field:em}}');
  assert.ok(!JSON.stringify(r.body).includes(TOKEN), 'token must not be echoed');
});

test('rejects other sites, bad input and wrong methods without calling Typeform', async () => {
  calls = [];
  assert.strictEqual((await call({ origin: 'https://evil.example', body: { token: TOKEN, form: 'AbC123' } })).status, 403);
  assert.strictEqual((await call({ origin: null, body: { token: TOKEN, form: 'AbC123' } })).status, 403);
  assert.strictEqual((await call({ method: 'GET' })).status, 405);
  assert.strictEqual((await call({ body: { token: 'short', form: 'AbC123' } })).body.error, 'bad_token');
  assert.strictEqual((await call({ body: { token: TOKEN, form: 'https://example.com/x' } })).body.error, 'bad_form');
  assert.strictEqual(calls.length, 0);
});

test('Typeform errors come back as plain reasons', async () => {
  reply = { status: 401, body: {} };
  assert.strictEqual((await call({ ip: '5.5.5.5', body: { token: TOKEN, form: 'AbC123' } })).body.error, 'typeform_token_rejected');
  reply = { status: 404, body: {} };
  assert.strictEqual((await call({ ip: '5.5.5.5', body: { token: TOKEN, form: 'AbC123' } })).body.error, 'form_not_found');
});

function formWith(endings) {
  return {
    id: 'AbC123', title: 'Quote', _links: { display: 'x' },
    fields: [{ ref: 'em', title: 'Email', type: 'email' }, { ref: 'fn', title: 'First name', type: 'short_text' }, { ref: 'biz', title: 'Biz', type: 'long_text' }],
    logic: [{ type: 'field', ref: 'em', actions: [] }],
    settings: { language: 'en' },
    thankyou_screens: endings,
  };
}

test('write: sets the one redirect ending with recall tags, sends the whole form, reads it back', async () => {
  const form = formWith([{ ref: 'r1', title: 'Go', type: 'url_redirect', properties: { redirect_url: 'https://old.example' } }, { ref: 'default_tys', title: 'Thanks', type: 'thankyou_screen', properties: {} }]);
  let saved = null;
  calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (init.method === 'PUT') { saved = JSON.parse(init.body); return { ok: true, status: 200, json: async () => saved }; }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(saved || form)) };
  };
  const r = await call({ ip: '7.7.7.7', body: { token: TOKEN, form: 'AbC123', action: 'write', redirect: {
    base: 'https://site.example/thank-you/?old=1', params: [{ name: 'email', ref: 'em' }, { name: 'first_name', ref: 'fn' }, { name: 'business_info', ref: 'biz' }] } } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const url = 'https://site.example/thank-you/?email={{field:em}}&first_name={{field:fn}}&business_info={{field:biz}}';
  assert.deepStrictEqual(r.body, { written: true, url, verified: true, changed: [] });
  assert.strictEqual(saved.thankyou_screens[0].properties.redirect_url, url);
  assert.strictEqual(saved.fields.length, 3, 'whole form sent');
  assert.strictEqual(saved._links, undefined);
  assert.deepStrictEqual(calls.map((c) => c.init.method || 'GET'), ['GET', 'PUT', 'GET']);
});

test('write: reports anything else Typeform changed', async () => {
  const form = formWith([{ ref: 'r1', title: 'Go', type: 'url_redirect', properties: {} }]);
  global.fetch = async (url, init = {}) => {
    if (init.method === 'PUT') return { ok: true, status: 200, json: async () => ({}) };
    if (calls.length++ === 0) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(form)) };
    const after = JSON.parse(JSON.stringify(form));
    after.logic = [];
    after.thankyou_screens[0].properties.redirect_url = 'https://site.example/t?email={{field:em}}';
    return { ok: true, status: 200, json: async () => after };
  };
  calls = [];
  const r = await call({ ip: '8.8.8.8', body: { token: TOKEN, form: 'AbC123', action: 'write', redirect: { base: 'https://site.example/t', params: [{ name: 'email', ref: 'em' }] } } });
  assert.deepStrictEqual(r.body.changed, ['logic']);
  assert.strictEqual(r.body.verified, true);
});

test('write: refuses without exactly one redirect ending, unknown questions or a non-https address, and saves nothing', async () => {
  let puts = 0;
  let current = formWith([]);
  global.fetch = async (url, init = {}) => {
    if (init.method === 'PUT') puts++;
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(current)) };
  };
  const w = (redirect, ip) => call({ ip, body: { token: TOKEN, form: 'AbC123', action: 'write', redirect } });
  const ok = { base: 'https://site.example/t', params: [{ name: 'email', ref: 'em' }] };
  assert.strictEqual((await w(ok, '9.0.0.1')).body.error, 'no_redirect_ending');
  current = formWith([{ type: 'url_redirect', title: 'a', properties: {} }, { type: 'url_redirect', title: 'b', properties: {} }]);
  assert.strictEqual((await w(ok, '9.0.0.2')).body.error, 'several_redirect_endings');
  current = formWith([{ type: 'url_redirect', title: 'a', properties: {} }]);
  assert.strictEqual((await w({ base: 'https://site.example/t', params: [{ name: 'email', ref: 'nope' }] }, '9.0.0.3')).body.error, 'unknown_question');
  assert.strictEqual((await w({ base: 'http://site.example/t', params: [{ name: 'email', ref: 'em' }] }, '9.0.0.4')).body.error, 'redirect_not_https');
  assert.strictEqual((await w({ base: 'https://site.example/t', params: [{ name: 'Bad Name', ref: 'em' }] }, '9.0.0.5')).body.error, 'bad_redirect');
  assert.strictEqual(puts, 0);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   -', t.name); } catch (e) { failed++; console.log('FAIL -', t.name, '\n      ', e.message); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
