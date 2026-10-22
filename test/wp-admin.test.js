// End-to-end test of the WordPress plugin's built-in setup: Settings › JARchat
// (test/wp-admin-server.php, on one origin) frames the setup page (site/, on
// another) and "Save to WordPress" saves its code into the plugin.
// Run with: node test/wp-admin.test.js
// Needs PHP and Playwright with a Chromium build.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT_SITE = 8793; // the hosted setup page
const PORT_WP = 8794; // the WordPress site
const SITE = `http://127.0.0.1:${PORT_SITE}`;
const ADMIN = `http://127.0.0.1:${PORT_WP}/wp-admin/options-general.php?page=jarchat`;
const STATE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jarchat-')), 'options.json');

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

function startWordPress() {
  const php = spawn('php', ['-S', `127.0.0.1:${PORT_WP}`, path.join(__dirname, 'wp-admin-server.php')], {
    env: { ...process.env, JARCHAT_SETUP: `${SITE}/site/index.html`, JARCHAT_STATE: STATE },
    stdio: 'ignore',
  });
  return new Promise((resolve, reject) => {
    const tryIt = (n) => http.get(ADMIN, (res) => { res.resume(); resolve(php); })
      .on('error', () => (n ? setTimeout(() => tryIt(n - 1), 100) : reject(new Error('php -S did not start'))));
    tryIt(50);
  });
}

const saved = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')).jarchat_settings || null : null);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

async function wizard(page) {
  await page.goto(ADMIN);
  const el = await page.waitForSelector('#jarchat-wizard');
  const frame = await el.contentFrame();
  await frame.waitForSelector('#wpSaveBtn', { state: 'attached' });
  return frame;
}

async function setSource(frame, value) {
  await frame.evaluate((v) => {
    const s = document.getElementById('source');
    s.value = v;
    s.dispatchEvent(new Event('input'));
    location.hash = 'install';
  }, value);
  await frame.waitForSelector('#wpSaveBtn', { state: 'visible' });
}

test('the setup opens inside Settings › JARchat, without its own top bar', async (page) => {
  const frame = await wizard(page);
  assert.ok(frame.url().startsWith(`${SITE}/site/index.html?wp=${encodeURIComponent(`http://127.0.0.1:${PORT_WP}`)}`));
  const r = await frame.evaluate(() => ({
    topbar: getComputedStyle(document.querySelector('.topbar')).display,
    pick: [].map.call(document.querySelectorAll('.widget-pick a.choice'), (a) => a.getAttribute('href').includes('?wp=')),
  }));
  assert.deepStrictEqual(r, { topbar: 'none', pick: [true, true] });
  assert.strictEqual(await page.isVisible('#jarchat-manual[open]'), true, 'nothing saved yet: the paste boxes are open');
});

test('Save to WordPress stays off until the code has a source ID', async (page) => {
  const frame = await wizard(page);
  await frame.evaluate(() => { location.hash = 'install'; });
  await frame.waitForSelector('#wpSaveBtn', { state: 'visible' });
  assert.strictEqual(await frame.isDisabled('#wpSaveBtn'), true);
  await setSource(frame, 'src_wp');
  assert.strictEqual(await frame.isDisabled('#wpSaveBtn'), false);
});

test('Save to WordPress saves the code into the plugin and says what to do next', async (page) => {
  const frame = await wizard(page);
  await setSource(frame, 'src_wp');
  await frame.click('#wpSaveBtn');
  await frame.waitForFunction(() => /^Saved\./.test(document.getElementById('wpSaveStatus').textContent));
  assert.match(await frame.textContent('#wpSaveStatus'), /\[jarchat\] on the thank-you page/);
  const s = saved();
  assert.strictEqual(s.chat_tag.src, `${SITE}/embed.js`);
  assert.strictEqual(s.chat_tag.data.source, 'src_wp');
  assert.ok(s.form_tag, 'with no form picked, the form page code is saved too');
  assert.match(await page.inputValue('#jarchat-chat'), /data-source="src_wp"/);
  assert.match(await page.textContent('#jarchat-saved'), /^Saved\./);
  // Back later: the saved code shows, folded away.
  await page.reload();
  assert.match(await page.inputValue('#jarchat-chat'), /data-source="src_wp"/);
  assert.strictEqual(await page.isVisible('#jarchat-manual[open]'), false);
});

test('our own chat window saves the same way', async (page) => {
  await wizard(page);
  const el = await page.$('#jarchat-wizard');
  await page.evaluate(() => {
    const f = document.getElementById('jarchat-wizard');
    f.src = f.src.replace('/index.html', '/chat-setup.html');
  });
  const frame = await el.contentFrame();
  await frame.waitForURL(/chat-setup\.html\?wp=/);
  await frame.waitForSelector('#wpSaveBtn', { state: 'attached' });
  await setSource(frame, 'src_own');
  await frame.click('#wpSaveBtn');
  await frame.waitForFunction(() => /^Saved\./.test(document.getElementById('wpSaveStatus').textContent));
  assert.strictEqual(saved().chat_tag.src, `${SITE}/chat.js`);
  assert.strictEqual(saved().chat_tag.data.source, 'src_own');
});

test('a name and uploaded picture go in the code and save to WordPress', async (page) => {
  await wizard(page);
  const el = await page.$('#jarchat-wizard');
  await page.evaluate(() => {
    const f = document.getElementById('jarchat-wizard');
    f.src = f.src.replace('/index.html', '/chat-setup.html');
  });
  const frame = await el.contentFrame();
  await frame.waitForURL(/chat-setup\.html\?wp=/);
  await frame.waitForSelector('#wpSaveBtn', { state: 'attached' });
  // A 300x200 picture comes back as a small centered square.
  const png = await frame.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const g = c.getContext('2d'); g.fillStyle = '#e11d48'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#1d4ed8'; g.fillRect(50, 0, 200, 200);
    return c.toDataURL('image/png').split(',')[1];
  });
  await frame.evaluate(() => { location.hash = 'style'; });
  await frame.fill('#persona-name', 'Jamie "J" Lee');
  await frame.setInputFiles('#avatarFile', { name: 'jamie.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await frame.waitForFunction(() => /Picture added/.test(document.getElementById('avatarMsg').textContent));
  const pic = await frame.evaluate(() => {
    const m = /data-avatar="([^"]+)"/.exec(document.getElementById('out').textContent);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        resolve({ src: m[1], w: img.width, h: img.height, corner: Array.from(g.getImageData(2, 2, 1, 1).data.slice(0, 3)) });
      };
      img.src = m[1];
    });
  });
  assert.match(pic.src, /^data:image\/(webp|png|jpeg);base64,/);
  assert.ok(pic.src.length < 30000, `small enough for the tag (${pic.src.length} characters)`);
  assert.deepStrictEqual([pic.w, pic.h], [96, 96]);
  assert.ok(pic.corner[2] > 150 && pic.corner[0] < 100, 'cropped to the middle square');
  assert.strictEqual(await frame.textContent('#preview .cb-header-title'), 'Jamie "J" Lee');
  assert.strictEqual(await frame.getAttribute('#preview .cb-header-avatar', 'src'), pic.src);
  await setSource(frame, 'src_persona');
  await frame.click('#wpSaveBtn');
  await frame.waitForFunction(() => /^Saved\./.test(document.getElementById('wpSaveStatus').textContent));
  assert.strictEqual(saved().chat_tag.data.title, 'Jamie "J" Lee');
  assert.strictEqual(saved().chat_tag.data.avatar, pic.src);
  // Removing the picture takes it out of the code.
  await frame.evaluate(() => { location.hash = 'style'; });
  await frame.click('#avatarClear');
  assert.doesNotMatch(await frame.textContent('#out'), /data-avatar/);
});

test('messages from anything but the setup frame are ignored', async (page) => {
  await wizard(page);
  const before = JSON.stringify(saved());
  const evil = '<script src="https://gmm-chatwidget.vercel.app/chat.js" data-source="evil"></script>';
  await page.evaluate((chat) => window.postMessage({ type: 'jarchat:save', chat }, '*'), evil);
  // A frame at the setup page's address that isn't the setup frame.
  await page.evaluate((src) => {
    const f = document.createElement('iframe');
    f.src = src;
    f.id = 'other';
    document.body.appendChild(f);
  }, `${SITE}/test/fixtures/form.html`);
  const other = await (await page.waitForSelector('#other')).contentFrame();
  await other.waitForLoadState();
  await other.evaluate((chat) => parent.postMessage({ type: 'jarchat:save', chat }, '*'), evil);
  await page.waitForTimeout(600);
  assert.strictEqual(JSON.stringify(saved()), before);
});

async function fitted(page, frame) {
  await page.waitForFunction(() => document.getElementById('jarchat-wizard').getAttribute('scrolling') === 'no');
  // Let the frame settle at its new height.
  await page.waitForFunction(async () => {
    const f = document.getElementById('jarchat-wizard');
    const h = parseInt(f.style.height, 10);
    await new Promise((r) => setTimeout(r, 150));
    return h === parseInt(f.style.height, 10);
  });
  return frame.evaluate(() => ({
    inner: document.documentElement.scrollHeight - innerHeight,
    body: Math.ceil(document.body.getBoundingClientRect().height),
    frame: innerHeight,
  }));
}

test('the setup grows to fit, so only the WordPress page scrolls', async (page) => {
  const frame = await wizard(page);
  let r = await fitted(page, frame);
  assert.ok(r.inner <= 1, `nothing to scroll inside the frame (${r.inner}px over)`);
  assert.strictEqual(r.frame, r.body);
  assert.strictEqual(await frame.isVisible('.intro h1'), false, 'WordPress already shows the heading');
  const first = r.frame;
  await frame.evaluate(() => { location.hash = 'install'; });
  await frame.waitForSelector('#wpSaveBtn', { state: 'visible' });
  r = await fitted(page, frame);
  assert.ok(r.inner <= 1);
  assert.notStrictEqual(r.frame, first, 'the frame follows the step\'s height');
});

test('Next scrolls WordPress back to the top of the new step', async (page) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  const frame = await wizard(page);
  await fitted(page, frame);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await frame.click('#nextBtn'); // the source ID nudge
  await frame.click('#nextBtn');
  await frame.waitForFunction(() => location.hash === '#form');
  await page.waitForTimeout(300);
  const top = await page.evaluate(async () => {
    const f = document.getElementById('jarchat-wizard');
    return f.getBoundingClientRect().top;
  }) + await frame.evaluate(() => document.getElementById('stepper').getBoundingClientRect().top);
  assert.ok(top >= 0 && top < 700, `step buttons in view (at ${top}px)`);
});

test('inside WordPress, guide links open the guide in a new tab', async (page) => {
  const frame = await wizard(page);
  await fitted(page, frame);
  const [tab] = await Promise.all([page.context().waitForEvent('page'), frame.click('a.guide >> nth=0')]);
  assert.match(tab.url(), /guide\.html#source-id$/);
  assert.strictEqual(await frame.evaluate(() => document.getElementById('guideBox').open), false);
});

test('opened on its own, the setup page has no Save to WordPress', async (page) => {
  await page.goto(`${SITE}/site/index.html?wp=${encodeURIComponent(`http://127.0.0.1:${PORT_WP}`)}`);
  await page.waitForLoadState();
  assert.strictEqual(await page.$('#wpSaveBtn'), null);
  assert.strictEqual(await page.isVisible('.topbar'), true);
});

(async () => {
  const server = await serve(PORT_SITE);
  const php = await startWordPress();
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
  php.kill();
  server.close();
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
