// End-to-end tests for loader/gmm-chat-prefill.js against a mock CloseBot
// lead form. Run with: node test/prefill.test.js
// Needs Playwright with a Chromium build (PLAYWRIGHT_BROWSERS_PATH or the
// default install).
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT_A = 8791; // site under test
const PORT_B = 8792; // second origin, stands in for a HighLevel embed

function serve(port) {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    const type = file.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const A = (p) => `http://127.0.0.1:${PORT_A}/test/fixtures/${p}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

async function identity(page, timeout = 5000) {
  await page.waitForFunction(() => window.__identity !== null && window.__identity !== undefined, null, { timeout });
  return page.evaluate(() => window.__identity);
}

test('session storage: form page details fill the thank-you chat form', async (page) => {
  await page.goto(A('form.html'));
  await page.fill('input[name=first_name]', 'Sam');
  await page.fill('input[name=email]', 'sam@example.com');
  await page.fill('input[name=phone]', '603-555-0199');
  await Promise.all([page.waitForURL(/thanks\.html/), page.click('button[type=submit]')]);
  const id = await identity(page);
  assert.strictEqual(id.email, 'sam@example.com');
  assert.strictEqual(id.phone, '+16035550199');
  assert.strictEqual(id.firstName, 'Sam');
  const left = await page.evaluate(() => sessionStorage.getItem('gmmcw_contact'));
  assert.strictEqual(left, null, 'saved contact should be cleared after submit');
  assert.strictEqual(await page.evaluate(() => GMMChatPrefill.source), 'session');
});

test('URL parameters: details are used and removed before later scripts run', async (page) => {
  await page.goto(A('thanks.html?email=pat%40example.com&phone=%2B16035550100&first_name=Pat&utm_source=fb'));
  const id = await identity(page);
  assert.strictEqual(id.email, 'pat@example.com');
  assert.strictEqual(id.phone, '+16035550100');
  assert.strictEqual(id.firstName, 'Pat');
  const seen = await page.evaluate(() => window.__urlSeenByLaterScript);
  assert.ok(!/email|phone|first_name/.test(seen), 'later script saw details in URL: ' + seen);
  assert.ok(/utm_source=fb/.test(seen), 'unrelated params should survive');
  assert.ok(!/email/.test(page.url()));
});

test('HighLevel page fields: rendered data attributes are used', async (page) => {
  await page.goto(A('thanks-attrs.html'));
  const id = await identity(page);
  assert.deepStrictEqual(id, { firstName: 'Pat', lastName: 'Lee', email: 'pat@example.com', phone: '+16035550100' });
});

test('HighLevel page fields: unrendered {{merge}} tags are ignored', async (page) => {
  await page.goto(A('thanks-unrendered.html'));
  await page.waitForSelector('.cb-form-card');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => window.__identity), null);
  assert.strictEqual(await page.inputValue('input[placeholder="Email *"]'), '');
});

test('fill only: data-autosubmit="false" fills but does not submit', async (page) => {
  await page.goto(A('thanks-nosubmit.html'));
  await page.waitForSelector('.cb-form-card');
  await page.waitForFunction(() => document.querySelector('input[placeholder="Email *"]').value !== '');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => window.__identity), null);
  assert.strictEqual(await page.inputValue('input[placeholder="Email *"]'), 'pat@example.com');
});

test('phone field receives real input events (widget formatting runs)', async (page) => {
  await page.goto(A('thanks-attrs.html'));
  await identity(page);
  assert.ok((await page.evaluate(() => window.__phoneInputEvents)) >= 1);
});

test('backend: code from the URL is looked up, retrying while the webhook is pending', async (page) => {
  let calls = 0;
  await page.route('http://backend.test/api/context**', (route) => {
    calls++;
    const code = new URL(route.request().url()).searchParams.get('code');
    if (code !== 'abc123') return route.fulfill({ status: 400, body: '' });
    if (calls < 2) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ contact: { email: 'web@example.com', phone: '+16035550111', firstName: 'Web' } }) });
  });
  await page.goto(A('thanks-backend.html?cb_ref=abc123'));
  const id = await identity(page, 8000);
  assert.strictEqual(id.email, 'web@example.com');
  assert.ok(calls >= 2, 'expected a retry after 404');
  assert.ok(!/cb_ref/.test(page.url()), 'code should be removed from the URL');
});

test('HighLevel embed message from an allowed origin is captured', async (page) => {
  await page.goto(A('embed-parent.html'));
  await page.waitForFunction(() => !!sessionStorage.getItem('gmmcw_contact'), null, { timeout: 5000 });
  const saved = JSON.parse(await page.evaluate(() => sessionStorage.getItem('gmmcw_contact')));
  assert.strictEqual(saved.email, 'embed@example.com');
  assert.strictEqual(saved.firstName, 'Em');
  assert.strictEqual(saved.source, 'highlevel-embed');
});

test('embed message from an origin that is not allowed is ignored', async (page) => {
  await page.goto(A('embed-evil.html'));
  await page.waitForTimeout(1000);
  assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('gmmcw_contact')), null);
});

test('stale saved details (over 30 minutes) are not used', async (page) => {
  await page.goto(A('form.html'));
  await page.evaluate(() => sessionStorage.setItem('gmmcw_contact',
    JSON.stringify({ email: 'old@example.com', savedAt: Date.now() - 31 * 60 * 1000 })));
  await page.goto(A('thanks.html'));
  await page.waitForSelector('.cb-form-card');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => window.__identity), null);
});

(async () => {
  const servers = [await serve(PORT_A), await serve(PORT_B)];
  const browser = await chromium.launch();
  let failed = 0;
  for (const t of tests) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await t.fn(page);
      console.log('ok   -', t.name);
    } catch (err) {
      failed++;
      console.log('FAIL -', t.name, '\n      ', err.message.split('\n')[0]);
    }
    await context.close();
  }
  await browser.close();
  servers.forEach((s) => s.close());
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
