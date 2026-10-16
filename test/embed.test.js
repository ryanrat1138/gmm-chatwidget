// End-to-end tests for loader/embed.js against a mock CloseBot
// lead form. Run with: node test/embed.test.js
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
  assert.strictEqual(await page.evaluate(() => GMMChat.source), 'session');
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

test('embed: one tag loads CloseBot inline, after the URL is cleaned, and fills the form', async (page) => {
  await page.goto(A('embed-inline.html?email=ann%40example.com&phone=6035550142&first_name=Ann'));
  const id = await identity(page);
  assert.strictEqual(id.email, 'ann@example.com');
  assert.strictEqual(id.phone, '+16035550142');
  assert.strictEqual(await page.evaluate(() => window.__cbSource), 'src_123');
  const seen = await page.evaluate(() => window.__urlSeenByCloseBot);
  assert.ok(!/email|phone|first_name/.test(seen), 'CloseBot saw details in URL: ' + seen);
  const box = await page.evaluate(() => {
    const c = document.getElementById('cb-widget-container');
    return { parent: c.parentElement.id, next: c.nextElementSibling && c.nextElementSibling.tagName,
      hasPanel: !!c.querySelector('.cb-panel'), height: c.style.height };
  });
  assert.strictEqual(box.parent, 'slot');
  assert.ok(box.hasPanel, 'chat should mount inside the container');
  assert.strictEqual(box.height, '480px');
});

test('embed: inline box takes no space when no chat is targeted to the page', async (page) => {
  await page.goto(A('embed-notarget.html'));
  await page.waitForFunction(() => window.__cbLoads === 1);
  await page.waitForTimeout(600);
  const h = await page.evaluate(() => document.getElementById('cb-widget-container').getBoundingClientRect().height);
  assert.strictEqual(h, 0);
});

test('embed: bubble layout adds no container, and a second pasted tag is ignored', async (page) => {
  await page.goto(A('embed-bubble.html?email=bo%40example.com'));
  const id = await identity(page);
  assert.strictEqual(id.email, 'bo@example.com');
  assert.strictEqual(await page.evaluate(() => document.getElementById('cb-widget-container')), null);
  assert.strictEqual(await page.evaluate(() => window.__cbLoads), 1);
});

test('embed: tag in the page head falls back to the bubble', async (page) => {
  await page.goto(A('embed-head.html'));
  await page.waitForSelector('.cb-panel');
  assert.strictEqual(await page.evaluate(() => document.getElementById('cb-widget-container')), null);
});

test('embed: CloseBot already installed on the page is not loaded twice', async (page) => {
  await page.goto(A('embed-existing.html?email=cy%40example.com'));
  const id = await identity(page);
  assert.strictEqual(id.email, 'cy@example.com');
  assert.strictEqual(await page.evaluate(() => window.__cbLoads), 1);
});

test('embed: a CloseBot tag further down the page is not doubled', async (page) => {
  await page.goto(A('embed-existing-after.html?email=di%40example.com'));
  const id = await identity(page);
  assert.strictEqual(id.email, 'di@example.com');
  assert.strictEqual(await page.evaluate(() => window.__cbLoads), 1);
  assert.ok(!/email/.test(await page.evaluate(() => window.__urlSeenByCloseBot)));
});

test('form page tag (no data-source) adds no chat and no chat box', async (page) => {
  await page.goto(A('form.html'));
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => window.__cbLoads), undefined);
  assert.strictEqual(await page.evaluate(() => document.getElementById('cb-widget-container')), null);
});

const visible = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !!e && e.getClientRects().length > 0;
}, sel);

test('quiet: the visitor never sees the form intro, the fields or "Thanks, got it!"', async (page) => {
  await page.goto(A('embed-inline.html?email=qu%40example.com'));
  await identity(page);
  await page.waitForFunction(() => window.__seen.some((x) => x.name === 'ai-typing'));
  const seen = await page.evaluate(() => Object.fromEntries(window.__seen.map((x) => [x.name, x.shown])));
  assert.deepStrictEqual(seen, { intro: false, 'form-typing': false, fields: false, thanks: false, 'ai-typing': false });
  // The AI's own typing dots and later messages show again once the form is done.
  await page.waitForFunction(() => !document.documentElement.classList.contains('gmmcw-quiet-typing'));
  assert.ok(await visible(page, '.cb-ai-typing'), 'AI typing dots should show after the submit');
  assert.strictEqual(await visible(page, '.cb-form-submitted'), false, '"Thanks, got it!" shown');
  assert.ok(await visible(page, '.cb-msg-item:not(.cb-form-text-item)'), 'welcome message should stay');
});

test('quiet: if CloseBot rejects the details, the form shows with its error', async (page) => {
  await page.addInitScript(() => { window.__mockFail = true; });
  await page.goto(A('embed-inline.html?email=no%40example.com'));
  await identity(page);
  await page.waitForFunction(() => !document.documentElement.classList.contains('gmmcw-quiet'));
  assert.ok(await visible(page, '.cb-form-card'), 'form should be visible');
  assert.ok(await visible(page, '.cb-form-error'), 'error should be visible');
  assert.ok(await visible(page, '.cb-form-text-item'));
});

test('quiet: with no details found, the form shows as normal', async (page) => {
  await page.goto(A('embed-inline.html'));
  await page.waitForSelector('.cb-form-card');
  assert.ok(await visible(page, '.cb-form-card'));
  assert.ok(await visible(page, '.cb-form-text-item'));
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
