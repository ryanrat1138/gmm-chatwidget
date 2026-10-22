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

test('quiet: typing dots show while the details are sent, then make way', async (page) => {
  await page.addInitScript(() => { window.__mockWelcome = false; window.__mockNoAiReply = true; });
  await page.addInitScript(() => { window.__mockDelay = 600; });
  await page.goto(A('embed-inline.html?email=dots%40example.com&first_name=Dee'));
  await page.waitForSelector('.cb-form-text-item', { state: 'attached' });
  assert.ok(await visible(page, '.gmmcw-thinking'), 'typing dots should show while sending');
  const last = await page.evaluate(() => document.querySelector('.cb-messages').lastElementChild.className);
  assert.ok(/gmmcw-thinking/.test(last), 'dots should stay below everything else');
  await identity(page);
  await page.waitForSelector('.gmmcw-greeting', { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => !!document.querySelector('.gmmcw-thinking')), false);
});

test('quiet: if CloseBot rejects the details, the form shows with its error', async (page) => {
  await page.addInitScript(() => { window.__mockFail = true; });
  await page.goto(A('embed-inline.html?email=no%40example.com'));
  await identity(page);
  await page.waitForFunction(() => !document.documentElement.classList.contains('gmmcw-quiet'));
  assert.ok(await visible(page, '.cb-form-card'), 'form should be visible');
  assert.ok(await visible(page, '.cb-form-error'), 'error should be visible');
  assert.strictEqual(await page.evaluate(() => !!document.querySelector('.gmmcw-thinking')), false);
  assert.ok(await visible(page, '.cb-form-text-item'));
});

test('quiet: with no details found, the form shows as normal', async (page) => {
  await page.goto(A('embed-inline.html'));
  await page.waitForSelector('.cb-form-card');
  assert.ok(await visible(page, '.cb-form-card'));
  assert.ok(await visible(page, '.cb-form-text-item'));
});

const LIVE_WIDGET = () => { window.__mockWelcome = false; window.__mockNoAiReply = true; window.__mockRemember = true; };
const greeting = (page) => page.evaluate(() => {
  const g = document.querySelector('.cb-messages .gmmcw-greeting');
  return g && g.getClientRects().length ? g.textContent : null;
});

test('greeting: an empty chat after the hidden form opens with "Hey <first name>"', async (page) => {
  await page.addInitScript(LIVE_WIDGET);
  await page.goto(A('embed-inline.html?email=ann%40example.com&first_name=Ann'));
  await identity(page);
  await page.waitForSelector('.gmmcw-greeting', { timeout: 5000 });
  assert.strictEqual(await greeting(page), 'Hey Ann, what can I help you with today?');
  const last = await page.evaluate(() => document.querySelector('.cb-messages').lastElementChild.className);
  assert.ok(/gmmcw-greeting/.test(last), 'greeting should be the latest message');
});

test('greeting: a returning visitor with no conversation gets it again, name remembered', async (page) => {
  await page.addInitScript(LIVE_WIDGET);
  await page.goto(A('embed-inline.html?email=ret%40example.com&first_name=Rita'));
  await identity(page);
  await page.waitForSelector('.gmmcw-greeting', { timeout: 5000 });
  await page.goto(A('embed-inline.html'));
  await page.waitForSelector('.gmmcw-greeting', { timeout: 5000 });
  assert.strictEqual(await greeting(page), 'Hey Rita, what can I help you with today?');
  assert.strictEqual(await page.evaluate(() => !!document.querySelector('.cb-form-card')), false);
});

test('greeting: not added when CloseBot has its own Welcome Message', async (page) => {
  await page.addInitScript(() => { window.__mockNoAiReply = true; });
  await page.goto(A('embed-inline.html?email=wm%40example.com&first_name=Wes'));
  await identity(page);
  await page.waitForTimeout(2500);
  assert.strictEqual(await page.evaluate(() => !!document.querySelector('.gmmcw-greeting')), false);
});

test('greeting: not added while the visitor still has the form to fill', async (page) => {
  await page.addInitScript(LIVE_WIDGET);
  await page.goto(A('embed-inline.html'));
  await page.waitForSelector('.cb-form-card');
  await page.waitForTimeout(2500);
  assert.strictEqual(await page.evaluate(() => !!document.querySelector('.gmmcw-greeting')), false);
});

test('greeting: custom text, "there" when no name is known, and "off"', async (page) => {
  await page.addInitScript(LIVE_WIDGET);
  await page.goto(A('embed-greeting-custom.html?email=cu%40example.com'));
  await identity(page);
  await page.waitForSelector('.gmmcw-greeting', { timeout: 5000 });
  assert.strictEqual(await greeting(page), 'Welcome back there! Ask me anything.');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(A('embed-greeting-off.html?email=off%40example.com'));
  await identity(page);
  await page.waitForTimeout(2500);
  assert.strictEqual(await page.evaluate(() => !!document.querySelector('.gmmcw-greeting')), false);
});

test('return visit with details in the link: no stuck typing dots, greeting shows', async (page) => {
  await page.addInitScript(() => {
    window.__mockWelcome = false; window.__mockNoAiReply = true; window.__mockRemember = true;
    localStorage.setItem('cb_identity_mock', '1');
  });
  await page.goto(A('embed-inline.html?email=again%40example.com&first_name=Al'));
  await page.waitForSelector('.gmmcw-greeting', { timeout: 6000 });
  assert.strictEqual(await greeting(page), 'Hey Al, what can I help you with today?');
  const state = await page.evaluate(() => ({
    dots: !!document.querySelector('.gmmcw-thinking'),
    quiet: document.documentElement.className
  }));
  assert.deepStrictEqual(state, { dots: false, quiet: '' });
});

test('return visit: saved "Thanks, got it!" is hidden and the greeting shows', async (page) => {
  await page.addInitScript(() => {
    window.__mockWelcome = false; window.__mockNoAiReply = true; window.__mockRemember = true;
    window.__mockHistory = [['bot', 'Thanks, got it!']];
    localStorage.setItem('cb_identity_mock', '1');
  });
  await page.goto(A('embed-inline.html'));
  await page.waitForSelector('.gmmcw-greeting', { timeout: 5000 });
  assert.strictEqual(await visible(page, '.cb-msg-item.bot:not(.gmmcw-greeting)'), false, '"Thanks, got it!" shown');
  assert.strictEqual(await greeting(page), 'Hey there, what can I help you with today?');
});

test('return visit: past conversation shows without the "Thanks, got it!" and no greeting', async (page) => {
  await page.addInitScript(() => {
    window.__mockWelcome = false; window.__mockNoAiReply = true; window.__mockRemember = true;
    window.__mockHistory = [['bot', 'Thanks, got it!'], ['lead', 'Hello'], ['bot', 'Hi! What can I do for you?']];
    localStorage.setItem('cb_identity_mock', '1');
  });
  await page.goto(A('embed-inline.html'));
  await page.waitForSelector('.cb-msg-item.lead');
  await page.waitForTimeout(2000);
  const shown = await page.evaluate(() => [...document.querySelectorAll('.cb-messages .cb-msg-item')]
    .filter((e) => e.getClientRects().length).map((e) => e.textContent));
  assert.deepStrictEqual(shown, ['Hello', 'Hi! What can I do for you?']);
});

test('look: inline options restyle the chat', async (page) => {
  await page.goto(A('embed-look.html'));
  await page.waitForSelector('.cb-panel');
  const st = await page.evaluate(() => {
    const panel = document.querySelector('.cb-panel');
    const bot = panel.appendChild(Object.assign(document.createElement('div'), { className: 'cb-msg bot', textContent: 'hi' }));
    const lead = panel.appendChild(Object.assign(document.createElement('div'), { className: 'cb-msg lead', textContent: 'yo' }));
    const cs = (e) => getComputedStyle(e);
    return {
      color: cs(panel).getPropertyValue('--cb-color').trim(),
      font: cs(panel.querySelector('.cb-header')).fontFamily,
      radius: cs(panel).borderTopLeftRadius,
      header: cs(panel.querySelector('.cb-header')).display,
      shadow: cs(panel).boxShadow,
      border: cs(panel).borderTopWidth,
      botBg: cs(bot).backgroundColor,
      botRadius: cs(bot).borderTopLeftRadius,
      botTail: cs(bot).borderBottomLeftRadius,
      leadColor: cs(lead).color
    };
  });
  assert.deepStrictEqual(st, {
    color: '#123456', font: 'Georgia, serif', radius: '18px', header: 'none', shadow: 'none', border: '1px',
    botBg: 'rgb(1, 2, 3)', botRadius: '18px', botTail: '4px', leadColor: 'rgb(255, 255, 255)'
  });
});

test('look: bubble options move the button, size the window, and reject unsafe values', async (page) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(A('embed-look-bubble.html'));
  await page.waitForSelector('.cb-panel');
  const st = await page.evaluate(() => {
    const panel = document.querySelector('.cb-panel'), btn = document.querySelector('.cb-btn');
    panel.style.position = 'fixed';
    return {
      css: document.getElementById('gmmcw-look').textContent,
      btnLeft: getComputedStyle(btn).left,
      btnBg: getComputedStyle(btn).backgroundColor,
      width: getComputedStyle(panel).width,
      height: getComputedStyle(panel).height,
      header: getComputedStyle(panel.querySelector('.cb-header')).display,
      bodyShown: getComputedStyle(document.body).display
    };
  });
  assert.ok(!/red|display:none!important;}body/.test(st.css), 'unsafe color should be dropped: ' + st.css);
  assert.strictEqual(st.btnLeft, '20px');
  assert.strictEqual(st.btnBg, 'rgb(59, 130, 246)', 'CloseBot color kept');
  assert.strictEqual(st.width, '420px');
  assert.strictEqual(st.height, '500px');
  assert.notStrictEqual(st.header, 'none', 'header stays in the bubble layout (it has the close button)');
  assert.strictEqual(st.bodyShown, 'block');
});

test('persona: CloseBot\u2019s agent name and picture don\u2019t show; the title does', async (page) => {
  await page.goto(A('embed-inline.html'));
  await page.waitForSelector('.cb-header-chatter', { state: 'attached' });
  assert.strictEqual(await page.isVisible('.cb-header-chatter'), false);
  assert.strictEqual(await page.isVisible('.cb-header'), true);
});

test('look: no look options adds no styles, and lookCss is available for the setup page', async (page) => {
  await page.goto(A('embed-inline.html'));
  await page.waitForSelector('.cb-panel');
  const r = await page.evaluate(() => ({
    style: !!document.getElementById('gmmcw-look'),
    css: window.GMMChat.lookCss({ color: '#000', radius: '8' })
  }));
  assert.strictEqual(r.style, false);
  assert.ok(/--cb-color:#000!important/.test(r.css) && /border-radius:8px!important/.test(r.css), r.css);
});

function captureFieldPosts(page) {
  const posts = [];
  return page.route('http://api.test/api/fields', (route) => {
    posts.push({ body: JSON.parse(route.request().postData()), type: route.request().headers()['content-type'] });
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  }).then(() => posts);
}

test('extra fields: values in the URL go to the service and leave the address bar; Typeform blanks are left out', async (page) => {
  const posts = await captureFieldPosts(page);
  await page.goto(A('thanks-fields.html?email=ed%40example.com&phone=_____&business_info=HVAC&team_size=_____&utm_source=fb&other=keep'));
  await identity(page);
  await page.waitForFunction(() => window.GMMChat.fieldsSent === true);
  assert.strictEqual(posts.length, 1);
  assert.deepStrictEqual(posts[0].body, { email: 'ed@example.com', phone: '', fields: { business_info: 'HVAC' } });
  assert.ok(/^text\/plain/.test(posts[0].type), 'should be a simple request');
  const seen = await page.evaluate(() => window.__urlSeenByCloseBot);
  assert.ok(!/business_info|team_size|email|phone/.test(seen), 'CloseBot saw extra details: ' + seen);
  assert.ok(/other=keep/.test(seen) && /utm_source=fb/.test(seen), 'unrelated params should stay');
});

test('extra fields: answers in a same-site form are carried to the thank-you page', async (page) => {
  const posts = await captureFieldPosts(page);
  await page.goto(A('form-fields.html'));
  await page.fill('input[name=email]', 'fo@example.com');
  await page.selectOption('select[name=business_info]', 'Plumbing');
  await page.check('input[name=team_size][value="6-20"]');
  await Promise.all([page.waitForURL(/thanks-fields/), page.click('button[type=submit]')]);
  await identity(page);
  await page.waitForFunction(() => window.GMMChat.fieldsSent === true);
  assert.deepStrictEqual(posts[0].body.fields, { business_info: 'Plumbing', team_size: '6-20' });
  assert.strictEqual(posts[0].body.email, 'fo@example.com');
});

test('extra fields: nothing is sent without data-fields or without a contact', async (page) => {
  const posts = await captureFieldPosts(page);
  await page.goto(A('embed-inline.html?email=nf%40example.com&business_info=HVAC'));
  await identity(page);
  await page.goto(A('thanks-fields.html?business_info=HVAC'));
  await page.waitForSelector('.cb-form-card');
  await page.waitForTimeout(300);
  assert.strictEqual(posts.length, 0);
});


function captureMessages(page, statuses = []) {
  const sent = [];
  return page.route('**/chat-widget/**', (route) => {
    sent.push(JSON.parse(route.request().postData()).message);
    route.fulfill({ status: statuses.shift() || 200, contentType: 'application/json', body: '{}' });
  }).then(() => sent);
}

async function say(page, text) {
  await page.fill('.cb-input', text);
  await page.click('.cb-send');
}

test('note: form answers go to the AI with the first message only, unseen by the visitor', async (page) => {
  const posts = await captureFieldPosts(page);
  const sent = await captureMessages(page);
  await page.goto(A('thanks-note.html?email=nn%40example.com&business_info=HVAC&team_size=6-20'));
  await identity(page);
  await page.waitForSelector('.cb-input');
  await say(page, 'How much does it cost?');
  await page.waitForFunction(() => window.__sendStatus === 200);
  await say(page, 'Thanks');
  await page.waitForFunction(() => document.querySelectorAll('.cb-msg-item.lead').length === 2);
  await page.waitForTimeout(200);
  assert.deepStrictEqual(sent, [
    'How much does it cost?\n\n[Form answers, for reference: Business info: HVAC; Team size: 6-20]',
    'Thanks'
  ]);
  const shown = await page.evaluate(() => [...document.querySelectorAll('.cb-msg-item.lead')].map((e) => e.textContent));
  assert.deepStrictEqual(shown, ['How much does it cost?', 'Thanks']);
  assert.strictEqual(posts.length, 0, 'answers should not go to the service without data-save-fields');
});

test('note: kept through a reload and a failed send until a message goes through', async (page) => {
  const sent = await captureMessages(page, [500]);
  await page.goto(A('thanks-note.html?business_info=Roofing'));
  await page.waitForSelector('.cb-form-card');
  await page.reload();
  await page.waitForSelector('.cb-input');
  await say(page, 'Hi');
  await page.waitForFunction(() => window.__sendStatus === 500);
  await say(page, 'Hello?');
  await page.waitForFunction(() => window.__sendStatus === 200);
  await say(page, 'Ok');
  await page.waitForFunction(() => document.querySelectorAll('.cb-msg-item.lead').length === 3);
  await page.waitForTimeout(200);
  const note = '\n\n[Form answers, for reference: Business info: Roofing]';
  assert.deepStrictEqual(sent, ['Hi' + note, 'Hello?' + note, 'Ok']);
});

test('note: cut from the visitor message when the conversation comes back', async (page) => {
  await page.addInitScript(() => {
    window.__mockWelcome = false; window.__mockRemember = true;
    window.__mockHistory = [['lead', 'Is it expensive?\n\n[Form answers, for reference: Business info: HVAC]'], ['bot', 'Not at all.']];
    localStorage.setItem('cb_identity_mock', '1');
  });
  await page.goto(A('thanks-note.html'));
  await page.waitForSelector('.cb-msg-item.lead');
  await page.waitForTimeout(100);
  const shown = await page.evaluate(() => [...document.querySelectorAll('.cb-msg-item')].map((e) => e.textContent));
  assert.deepStrictEqual(shown, ['Is it expensive?', 'Not at all.']);
});

function captureNotePosts(page, reply) {
  const posts = [];
  return page.route('http://api.test/api/note', (route) => {
    posts.push(JSON.parse(route.request().postData()));
    route.fulfill({ status: reply.status || 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply.body) });
  }).then(() => posts);
}

test('AI note: added through the service, so the first message goes as typed, and only once', async (page) => {
  const notes = await captureNotePosts(page, { body: { added: true, matchedBy: 'email' } });
  const sent = await captureMessages(page);
  await page.goto(A('thanks-note.html?email=ai%40example.com&business_info=HVAC&team_size=6-20'));
  await page.waitForFunction(() => window.GMMChat.noteAdded === true);
  assert.deepStrictEqual(notes, [{ email: 'ai@example.com', phone: '', answers: { business_info: 'HVAC', team_size: '6-20' } }]);
  await identity(page);
  await page.waitForSelector('.cb-input');
  await say(page, 'How much does it cost?');
  await page.waitForFunction(() => window.__sendStatus === 200);
  assert.deepStrictEqual(sent, ['How much does it cost?']);
  await page.goto(A('thanks-note.html?email=ai%40example.com&business_info=HVAC'));
  await page.waitForSelector('.cb-input');
  await page.waitForTimeout(300);
  assert.strictEqual(notes.length, 1, 'the note is added once per visit');
});

test('AI note: a sealed key from the setup page goes with the request', async (page) => {
  const notes = await captureNotePosts(page, { body: { added: true } });
  await page.goto(A('thanks-note-key.html?email=k%40example.com&business_info=HVAC'));
  await page.waitForFunction(() => window.GMMChat.noteAdded === true);
  assert.deepStrictEqual(notes, [{ email: 'k@example.com', phone: '', answers: { business_info: 'HVAC' }, key: 'v1.sealed-test' }]);
});

test('AI note: when the service has no CloseBot key, the answers go with the first message', async (page) => {
  const notes = await captureNotePosts(page, { status: 501, body: { added: false, reason: 'not_configured' } });
  const sent = await captureMessages(page);
  await page.goto(A('thanks-note.html?email=nk%40example.com&business_info=HVAC'));
  await page.waitForFunction(() => window.GMMChat.noteAdded === false);
  await identity(page);
  await page.waitForSelector('.cb-input');
  await say(page, 'Hi');
  await page.waitForFunction(() => window.__sendStatus === 200);
  assert.strictEqual(notes.length, 1);
  assert.deepStrictEqual(sent, ['Hi\n\n[Form answers, for reference: Business info: HVAC]']);
});

test('AI note: not asked for without an email or phone', async (page) => {
  const notes = await captureNotePosts(page, { body: { added: true } });
  await page.goto(A('thanks-note.html?business_info=HVAC'));
  await page.waitForSelector('.cb-form-card');
  await page.waitForTimeout(300);
  assert.strictEqual(notes.length, 0);
});

test('call to action: inline card above the chat greets by name and starts the chat', async (page) => {
  await page.goto(A('embed-inline.html?email=cta%40example.com&first_name=Pat'));
  await page.waitForSelector('#gmmcw-cta:not(.gmmcw-cta-loading)');
  await identity(page);
  const r = await page.evaluate(() => {
    const cta = document.getElementById('gmmcw-cta');
    return {
      next: cta.nextElementSibling && cta.nextElementSibling.id,
      title: cta.querySelector('.gmmcw-cta-title').textContent,
      button: cta.querySelector('.gmmcw-cta-btn').textContent,
      inline: cta.classList.contains('gmmcw-cta-inline'),
      icon: cta.querySelector('.gmmcw-cta-icon svg').getAttribute('viewBox')
    };
  });
  assert.deepStrictEqual(r, { next: 'cb-widget-container', title: 'You’re all set, Pat!', button: 'Start chatting↓', inline: true, icon: '10 4 44 58' });
  await page.waitForFunction(() => document.getElementById('gmmcw-cta').style.getPropertyValue('--gmmcw-accent') === '#3b82f6');
  await page.click('.gmmcw-cta-btn');
  await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('cb-input'));
});

test('call to action: bubble button opens the chat and follows the look options', async (page) => {
  await page.addInitScript(() => { window.__mockClosed = true; });
  await page.goto(A('embed-cta-bubble.html'));
  await page.waitForSelector('#gmmcw-cta:not(.gmmcw-cta-loading)');
  const r = await page.evaluate(() => {
    const cta = document.getElementById('gmmcw-cta');
    const btn = cta.querySelector('.gmmcw-cta-btn');
    return {
      after: cta.nextElementSibling && cta.nextElementSibling.id,
      title: cta.querySelector('.gmmcw-cta-title').textContent,
      label: cta.querySelector('.gmmcw-cta-label').textContent,
      bg: getComputedStyle(btn).backgroundColor,
      radius: getComputedStyle(cta).borderTopLeftRadius,
      font: getComputedStyle(cta).fontFamily,
      open: !document.querySelector('.cb-panel').classList.contains('hidden')
    };
  });
  assert.deepStrictEqual(r, { after: 'after', title: 'You’re all set!', label: 'Ask our assistant',
    bg: 'rgb(15, 118, 110)', radius: '6px', font: 'Georgia', open: false });
  await page.click('.gmmcw-cta-btn');
  assert.strictEqual(await page.evaluate(() => !document.querySelector('.cb-panel').classList.contains('hidden')), true);
});

test('call to action: shows before the chat, loading, then turns on with CloseBot\'s color', async (page) => {
  await page.addInitScript(() => { window.__mockDelay = 1200; });
  await page.goto(A('embed-inline.html?email=early%40example.com&first_name=Eve'));
  await page.waitForSelector('#gmmcw-cta');
  const early = await page.evaluate(() => {
    const cta = document.getElementById('gmmcw-cta');
    return {
      chat: !!document.querySelector('.cb-panel'),
      loading: cta.classList.contains('gmmcw-cta-loading'),
      busy: cta.querySelector('.gmmcw-cta-btn').getAttribute('aria-busy'),
      dots: getComputedStyle(cta.querySelector('.gmmcw-cta-dots')).display,
      label: getComputedStyle(cta.querySelector('.gmmcw-cta-label')).visibility,
      title: cta.querySelector('.gmmcw-cta-title').textContent,
      accent: cta.style.getPropertyValue('--gmmcw-accent')
    };
  });
  assert.deepStrictEqual(early, { chat: false, loading: true, busy: 'true', dots: 'flex', label: 'hidden',
    title: 'You\u2019re all set, Eve!', accent: '#9ca3af' });
  await page.click('.gmmcw-cta-btn');
  await page.waitForSelector('.cb-panel');
  await page.waitForFunction(() => !document.getElementById('gmmcw-cta').classList.contains('gmmcw-cta-loading'));
  await page.waitForFunction(() => document.getElementById('gmmcw-cta').style.getPropertyValue('--gmmcw-accent') === '#3b82f6');
  assert.strictEqual(await page.evaluate(() => document.querySelector('.gmmcw-cta-btn').hasAttribute('aria-busy')), false);
  // Next visit: CloseBot's color from the start.
  await page.goto(A('embed-inline.html'));
  await page.waitForSelector('#gmmcw-cta');
  assert.strictEqual(await page.evaluate(() => document.getElementById('gmmcw-cta').style.getPropertyValue('--gmmcw-accent')), '#3b82f6');
});

test('call to action: none with data-cta="off", and it goes away when no chat shows', async (page) => {
  await page.goto(A('embed-cta-off.html'));
  await page.waitForSelector('.cb-panel');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => !!document.querySelector('.gmmcw-cta')), false);
  await page.addInitScript(() => { window.__mockNoMount = true; });
  await page.goto(A('embed-cta-nochat.html'));
  await page.waitForSelector('#gmmcw-cta');
  await page.waitForSelector('#gmmcw-cta', { state: 'detached', timeout: 3000 });
});

test('call to action: formatted text keeps only safe tags, and a video link becomes a player', async (page) => {
  await page.goto(A('embed-inline.html'));
  await page.waitForFunction(() => window.GMMChat && GMMChat.ctaPreview);
  const r = await page.evaluate(() => {
    window.__xss = 0;
    const card = GMMChat.ctaPreview({
      'cta-text': '<p>Hi <b>{first_name}</b>, <i>see</i> <u>this</u>:</p><ul><li>One</li></ul>' +
        '<a href="https://example.com/a">site</a> <a href="javascript:window.__xss=1">bad</a>' +
        '<img src="x" onerror="window.__xss=1"><script>window.__xss=1</script><span style="color:red" onclick="1">plain</span>',
      'cta-video': 'https://youtu.be/dQw4w9WgXcQ?t=3'
    }, 'Ann');
    document.body.appendChild(card);
    const text = card.querySelector('.gmmcw-cta-text');
    const frame = card.querySelector('.gmmcw-cta-video iframe');
    const src = (u) => { const v = GMMChat.ctaPreview({ 'cta-video': u }).querySelector('.gmmcw-cta-video iframe, .gmmcw-cta-video video'); return v ? v.src : null; };
    return {
      html: text.innerHTML,
      link: [text.querySelector('a').target, text.querySelector('a').rel],
      video: frame && frame.src,
      wraps: card.classList.contains('gmmcw-cta-has-video'),
      first: card.firstElementChild.className,
      sources: [
        src('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x'),
        src('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
        src('https://vimeo.com/76979871'),
        src('https://vimeo.com/76979871/abc123def0'),
        src('https://www.loom.com/share/0123456789abcdef0123456789abcdef'),
        src('https://acme.wistia.com/medias/a1b2c3d4e5'),
        src('https://cdn.example.com/clip.mp4'),
        src('http://youtu.be/dQw4w9WgXcQ'),
        src('https://example.com/page'),
        src('javascript:alert(1)')
      ],
      noName: GMMChat.ctaPreview({ 'cta-text': 'Hey {first_name}!' }).querySelector('.gmmcw-cta-text').textContent
    };
  });
  await page.waitForTimeout(100);
  assert.strictEqual(r.html, '<p>Hi <strong>Ann</strong>, <em>see</em> <u>this</u>:</p><ul><li>One</li></ul>' +
    '<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">site</a> badplain');
  assert.deepStrictEqual(r.link, ['_blank', 'noopener noreferrer']);
  assert.strictEqual(r.video, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
  assert.strictEqual(r.wraps, true);
  assert.strictEqual(r.first, 'gmmcw-cta-video');
  assert.deepStrictEqual(r.sources, [
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0',
    'https://player.vimeo.com/video/76979871',
    'https://player.vimeo.com/video/76979871?h=abc123def0',
    'https://www.loom.com/embed/0123456789abcdef0123456789abcdef',
    'https://fast.wistia.net/embed/iframe/a1b2c3d4e5',
    'https://cdn.example.com/clip.mp4',
    null, null, null
  ]);
  assert.strictEqual(r.noName, 'Hey there!');
  assert.strictEqual(await page.evaluate(() => window.__xss), 0);
});

test('corner button: CloseBot\'s icon gives way to the JARchat jar; data-launcher-icon="closebot" keeps it', async (page) => {
  await page.goto(A('embed-bubble.html'));
  await page.waitForSelector('.cb-btn');
  await page.evaluate(() => { document.querySelector('.cb-btn').innerHTML = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'; });
  const r = await page.evaluate(() => {
    const btn = document.querySelector('.cb-btn');
    const after = getComputedStyle(btn, '::before');
    return { svg: getComputedStyle(btn.querySelector('svg')).display, jar: after.content, w: after.width, mask: /svg/.test(after.webkitMaskImage || after.maskImage) };
  });
  assert.deepStrictEqual(r, { svg: 'none', jar: '""', w: '28px', mask: true });
  await page.goto(A('embed-bubble.html').replace('embed-bubble.html', 'embed-look-bubble.html'));
  await page.waitForSelector('.cb-btn');
  assert.strictEqual(await page.evaluate(() => !!document.getElementById('gmmcw-launcher')), true);
  await page.setContent('<!doctype html><body><script src="' + A('../../loader/embed.js').replace('/test/fixtures/../../', '/') + '" data-source="src_123" data-layout="bubble" data-launcher-icon="closebot" data-closebot-src="/test/fixtures/mock-closebot.js"></script>');
  await page.waitForFunction(() => !!window.GMMChat);
  assert.strictEqual(await page.evaluate(() => !!document.getElementById('gmmcw-launcher')), false);
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
