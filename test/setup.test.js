// Tests for the setup pages' Typeform redirect link (site/index.html and
// site/chat-setup.html), with the setup API mocked.
// Run with: NODE_PATH=$(npm root -g) node test/setup.test.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 8795;

function serve(port) {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const FORM = {
  title: 'Implant consult',
  fields: [
    { ref: 'fn', title: 'First name', type: 'short_text', group: 'Your details' },
    { ref: 'ln', title: 'Last name', type: 'short_text', group: 'Your details' },
    { ref: 'full', title: 'Full name', type: 'short_text', group: '' },
    { ref: 'em', title: 'Email', type: 'email', group: 'Your details' },
    { ref: 'zip', title: 'What is your zip code?', type: 'short_text', group: '' },
    { ref: 'yr', title: 'Year', type: 'short_text', group: '' },
    { ref: 'pg', title: 'Page', type: 'short_text', group: '' },
  ],
  endings: [{ ref: 'r1', type: 'url_redirect', redirect: '' }],
};

// Reads the form, then asks for every question to go to the AI that isn't a contact detail.
async function readForm(page, file) {
  const writes = [];
  await page.route('**/api/typeform', (route) => {
    const body = JSON.parse(route.request().postData());
    if (body.action === 'write') writes.push(body.redirect);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.action === 'write' ? { saved: true, verified: true } : FORM) });
  });
  await page.goto(`http://127.0.0.1:${PORT}/site/${file}#form`);
  await page.evaluate(() => {
    document.getElementById('ty-url').value = 'https://example.com/thank-you';
    document.getElementById('tf-form').value = 'https://form.typeform.com/to/AbC123';
    document.getElementById('tf-token').value = 'tfp_test';
    document.getElementById('tf-read').click();
  });
  await page.waitForFunction(() => /^Read/.test(document.getElementById('tf-status').textContent));
  return writes;
}

const roles = (page, set) => page.evaluate((set) => {
  document.querySelectorAll('#tf-questions tbody tr').forEach((tr) => {
    const title = tr.querySelector('td').firstChild.textContent;
    if (title in set) { const s = tr.querySelector('select'); s.value = set[title]; s.dispatchEvent(new Event('change')); }
  });
}, set);
const link = (page) => page.evaluate(() => document.getElementById('tfUrl').textContent);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

for (const file of ['index.html', 'chat-setup.html']) {
  test(`${file}: the full name goes as full_name, never WordPress's name=`, async (page) => {
    await readForm(page, file);
    await roles(page, { 'First name': '', 'Last name': '' });
    const url = await link(page);
    assert.match(url, /[?&]full_name=@Full name(&|$)/);
    assert.doesNotMatch(url, /[?&]name=/);
  });

  test(`${file}: with a first and last name, the link leaves the full name out`, async (page) => {
    const writes = await readForm(page, file);
    const url = await link(page);
    assert.match(url, /\?email=@Email&first_name=@First name&last_name=@Last name/);
    assert.doesNotMatch(url, /name=@Full name/);
    await page.evaluate(() => {
      const c = document.getElementById('tf-confirm');
      c.checked = true; c.dispatchEvent(new Event('change'));
      document.getElementById('tf-write-btn').click();
    });
    await page.waitForFunction(() => document.getElementById('tf-write-status').textContent);
    assert.deepStrictEqual(writes[0].params.map((p) => p.name), ['email', 'first_name', 'last_name']);
  });

  test(`${file}: answers for the AI never take a word WordPress reads from the address`, async (page) => {
    await readForm(page, file);
    await roles(page, { 'What is your zip code?': 'ai', Year: 'ai', Page: 'ai' });
    const url = await link(page);
    assert.match(url, /&what_is_your_zip_code=@What is your zip code\?/);
    assert.match(url, /&year_answer=@Year&page_answer=@Page/);
    assert.strictEqual(await page.inputValue('#fields'), 'what_is_your_zip_code, year_answer, page_answer');
    // Typed by hand too.
    await page.evaluate(() => {
      const key = [...document.querySelectorAll('#tf-questions tbody tr')].find((tr) => /Year/.test(tr.textContent)).querySelector('input');
      key.value = 'name'; key.dispatchEvent(new Event('input')); key.dispatchEvent(new Event('blur'));
    });
    assert.match(await link(page), /&name_answer=@Year/);
  });
}

(async () => {
  const server = await serve(PORT);
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
  server.close();
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
