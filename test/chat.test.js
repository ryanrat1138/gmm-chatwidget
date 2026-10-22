// End-to-end tests for loader/chat.js, the widget that draws its own chat,
// against a mock of CloseBot's chat endpoints (test/fixtures/mock-closebot-api.js).
// Run with: NODE_PATH=$(npm root -g) node test/chat.test.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { createMock } = require('./fixtures/mock-closebot-api');

const ROOT = path.join(__dirname, '..');
const PORT = 8793; // site under test
const API_PORT = 8794; // mock CloseBot
const API = `http://127.0.0.1:${API_PORT}`;
const KEY = 'pk_test';

// Test pages, served at /p/<name>.
const pages = {};
const tag = (attrs = '') => `<script src="/loader/chat.js" data-source="${KEY}" data-closebot-api="${API}" ${attrs}></script>`;
const doc = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${title}</title></head><body style="font-family:Georgia,serif;margin:24px">${body}</body></html>`;

pages.inline = doc('Inline', `<h1>Thanks!</h1><div id="slot">${tag('data-height="480px"')}</div><p id="after">After the chat</p>` +
  '<script>window.__urlSeenByLaterScript = location.href;</script>');
pages.bubble = doc('Bubble', `<h1>Thanks!</h1>${tag('data-layout="bubble" data-cta="off"')}`);
pages['bubble-cta'] = doc('Bubble CTA', `<h1>Thanks!</h1><div id="cta-spot">${tag('data-layout="bubble"')}</div>`);
pages['greeting-custom'] = doc('Greeting', `<div id="slot">${tag('data-greeting="Hi {first_name}! Ask away."')}</div>`);
pages['greeting-off'] = doc('Greeting off', `<div id="slot">${tag('data-greeting="off"')}</div>`);
pages.look = doc('Look', `<div id="slot">${tag('data-color="#e11d48" data-font="site" data-font-size="17px" data-radius="8px" ' +
  'data-background="#fafafa" data-bot-bubble="#eeeeee" data-bot-text="#222222" data-visitor-text="#ffff00" data-header-text="#000000" ' +
  'data-shadow="none" data-border="off" data-cta="off"')}</div>`);
pages['look-noheader'] = doc('No header', `<div id="slot">${tag('data-header="hide" data-cta="off"')}</div>`);
pages['look-bubble'] = doc('Look bubble', tag('data-layout="bubble" data-position="left" data-width="420px" data-height="500px" data-cta="off"'));
pages.note = doc('Note', `<div id="slot">${tag('data-fields="business_info,team_size" data-api="http://api.test" data-note-key="v1.sealed-test"')}</div>`);
pages.attrs = doc('Attrs', `<div id="slot">${tag('data-email="pat@example.com" data-phone="(603) 555-0100" data-first-name="Pat" data-last-name="Lee"')}</div>`);
pages.unrendered = doc('Unrendered', `<div id="slot">${tag('data-email="{{contact.email}}" data-first-name="{{contact.first_name}}"')}</div>`);
pages['head-tag'] = `<!doctype html><html><head><meta charset="utf-8">${tag()}</head><body><h1>Head</h1></body></html>`;
pages['form-page'] = doc('Form page', '<form action="/p/thanks-session" method="get" onsubmit="event.preventDefault(); location.href=\'/p/thanks-session\'">' +
  '<input name="first_name"><input name="email" type="email"><input name="phone" type="tel"><input name="business_info">' +
  '<button type="submit">Send</button></form><script src="/loader/chat.js" data-fields="business_info"></script>');
const DOT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
pages.persona = doc('Persona', `<div id="slot">${tag('data-title="Jamie" data-avatar="https://pics.test/jamie.png" data-cta="off"')}</div>`);
pages['persona-data'] = doc('Persona data', `<div id="slot">${tag(`data-avatar="${DOT_PNG}" data-cta="off"`)}</div>`);
pages['persona-unsafe'] = doc('Persona unsafe', `<div id="slot">${tag('data-avatar="javascript:alert(1)" data-cta="off"')}</div>`);
pages['persona-broken'] = doc('Persona broken', `<div id="slot">${tag('data-avatar="https://pics.test/missing.png" data-cta="off"')}</div>`);
pages['thanks-session'] = doc('Thanks', `<div id="slot">${tag('data-fields="business_info" data-api="http://api.test"')}</div>`);

function serve(port) {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname.startsWith('/p/')) {
      const html = pages[pathname.slice(3)];
      if (!html) { res.writeHead(404); return res.end('no page'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    const file = path.join(ROOT, pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const P = (name) => `http://127.0.0.1:${PORT}/p/${name}`;
const mock = createMock();
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const state = (page) => page.evaluate(() => window.GMMChatWidget.state());
const until = (page, fn, arg, timeout = 5000) => page.waitForFunction(fn, arg, { timeout });
const untilState = (page, expr, timeout = 5000) =>
  page.waitForFunction(new Function('return (function (s) { return ' + expr + '; })(window.GMMChatWidget && window.GMMChatWidget.state())'), null, { timeout });
// Inside the widget's shadow root.
const inWidget = (page, fn, arg) => page.evaluate(([src, a]) => {
  const root = document.querySelector('gmmc-chat').shadowRoot;
  return new Function('root', 'arg', 'return (' + src + ')(root, arg)')(root, a);
}, [fn.toString(), arg]);
const bubbles = (page, sender) => inWidget(page, (root, s) =>
  Array.from(root.querySelectorAll('.gmmc-msg' + (s ? '.gmmc-' + s : ''))).map((m) => m._text), sender);
const identities = () => mock.requestsFor('identity').map((r) => r.body);
const messagesSent = () => mock.requestsFor('message').map((r) => r.body.message);

test('inline: renders after the tag at data-height with CloseBot\u2019s title, color and status', async (page) => {
  mock.state.configs[KEY] = { chatTitle: 'Acme Help', primaryColor: '#1d4ed8', showOnlineStatus: true, messagePlaceholder: 'Ask us anything' };
  await page.goto(P('inline') + '?email=ann%40example.com&first_name=Ann');
  await untilState(page, 's.started');
  const box = await page.evaluate(() => {
    const host = document.querySelector('gmmc-chat');
    return { parent: host.parentElement.id, prev: host.previousElementSibling && host.previousElementSibling.className,
      last: host.parentElement.lastElementChild === host, height: host.getBoundingClientRect().height, shadow: !!host.shadowRoot };
  });
  assert.strictEqual(box.parent, 'slot');
  assert.ok(/gmmc-cta/.test(box.prev), 'call to action sits above the chat');
  assert.strictEqual(box.last, true);
  assert.strictEqual(box.height, 480);
  assert.ok(box.shadow, 'drawn inside a shadow root');
  const look = await inWidget(page, (root) => ({
    title: root.querySelector('.gmmc-title').textContent,
    status: root.querySelector('.gmmc-status').textContent,
    dot: !!root.querySelector('.gmmc-avatar .gmmc-dot'),
    header: getComputedStyle(root.querySelector('.gmmc-header')).backgroundColor,
    placeholder: root.querySelector('.gmmc-input').placeholder,
    log: root.querySelector('.gmmc-log').getAttribute('role') + '/' + root.querySelector('.gmmc-log').getAttribute('aria-live'),
    label: root.querySelector('label[for="gmmc-input"]').textContent,
    send: root.querySelector('.gmmc-send').getAttribute('aria-label'),
    powered: root.querySelector('.gmmc-powered').hidden,
    launcher: !!root.querySelector('.gmmc-launcher'),
  }));
  assert.deepStrictEqual(look, { title: 'Acme Help', status: 'Online', dot: true, header: 'rgb(29, 78, 216)',
    placeholder: 'Ask us anything', log: 'log/polite', label: 'Message', send: 'Send message', powered: true, launcher: false });
  // The site's own styles don't reach in, and the widget's don't leak out.
  assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily), 'Georgia, serif');
});

test('bubble: launcher opens the window, Escape closes it and focus returns; no conversation until opened', async (page) => {
  mock.state.configs[KEY] = { chatTitle: 'Acme', primaryColor: '#0f766e', leadCaptureForm: { isEnabled: false } };
  await page.goto(P('bubble'));
  await untilState(page, 's.started');
  await page.waitForSelector('.gmmc-launcher');
  await page.waitForTimeout(400); // the launcher's entrance
  const closed = await inWidget(page, (root) => ({
    panel: getComputedStyle(root.querySelector('.gmmc-panel')).visibility,
    expanded: root.querySelector('.gmmc-launcher').getAttribute('aria-expanded'),
    bg: getComputedStyle(root.querySelector('.gmmc-launcher')).backgroundColor,
    rect: (({ right, bottom }) => ({ right, bottom }))(root.querySelector('.gmmc-launcher').getBoundingClientRect()),
  }));
  assert.strictEqual(closed.panel, 'hidden');
  assert.strictEqual(closed.expanded, 'false');
  assert.strictEqual(closed.bg, 'rgb(15, 118, 110)');
  assert.strictEqual(page.viewportSize().width - closed.rect.right, 20);
  assert.strictEqual(mock.requestsFor('session').length, 0, 'no conversation before the visitor opens the chat');
  await page.click('.gmmc-launcher');
  await untilState(page, 's.sessionId');
  await until(page, () => document.querySelector('gmmc-chat').shadowRoot.activeElement?.id === 'gmmc-input');
  await page.waitForTimeout(250); // the window's entrance
  const open = await inWidget(page, (root) => ({
    panel: getComputedStyle(root.querySelector('.gmmc-panel')).visibility,
    expanded: root.querySelector('.gmmc-launcher').getAttribute('aria-expanded'),
    role: root.querySelector('.gmmc-panel').getAttribute('role'),
    name: root.querySelector('.gmmc-panel').getAttribute('aria-label'),
    width: root.querySelector('.gmmc-panel').getBoundingClientRect().width,
  }));
  assert.deepStrictEqual(open, { panel: 'visible', expanded: 'true', role: 'dialog', name: 'Acme', width: 380 });
  await page.keyboard.press('Escape');
  await until(page, () => !window.GMMChatWidget.state().open);
  assert.strictEqual(await inWidget(page, (root) => root.activeElement && root.activeElement.className), 'gmmc-launcher');
  await page.evaluate(() => window.GMMChatWidget.open());
  assert.strictEqual((await state(page)).open, true);
  await page.evaluate(() => window.GMMChatWidget.close());
  assert.strictEqual((await state(page)).open, false);
});

test('bubble: unread badge counts bot messages while the window is closed', async (page) => {
  await page.goto(P('bubble') + '?email=un%40example.com');
  await untilState(page, 's.connected');
  mock.botSay((await state(page)).sessionId, 'Still there?');
  await until(page, () => !document.querySelector('gmmc-chat').shadowRoot.querySelector('.gmmc-badge').hidden);
  const badge = await inWidget(page, (root) => [root.querySelector('.gmmc-badge').textContent, root.querySelector('.gmmc-launcher').getAttribute('aria-label')]);
  assert.deepStrictEqual(badge, ['1', 'Open chat, 1 new message']);
  await page.click('.gmmc-launcher');
  assert.strictEqual(await inWidget(page, (root) => root.querySelector('.gmmc-badge').hidden), true);
});

test('identity: URL details go to CloseBot and leave the address bar before later scripts run', async (page) => {
  await page.goto(P('inline') + '?email=ann%40example.com&phone=6035550142&first_name=Ann&utm_source=fb');
  await until(page, () => window.GMMChatWidget.state().identified);
  assert.deepStrictEqual(identities(), [{ firstName: 'Ann', name: 'Ann', email: 'ann@example.com', phone: '+16035550142' }]);
  const seen = await page.evaluate(() => window.__urlSeenByLaterScript);
  assert.ok(!/email|phone|first_name/.test(seen), 'later script saw details: ' + seen);
  assert.ok(/utm_source=fb/.test(seen));
  assert.ok(!/email/.test(page.url()));
  const visit = mock.requestsFor('page-visit')[0];
  assert.ok(visit && !/email/.test(visit.body.url) && visit.body.title === 'Inline', 'page visit without the details');
  const s = await state(page);
  assert.strictEqual(s.contactSource, 'url');
  assert.strictEqual(s.formShown, false);
  assert.deepStrictEqual(s.messages, [{ sender: 'bot', text: 'Hey Ann, what can I help you with today?' }]);
  // The session goes to CloseBot with a visitor id, under this widget's own storage keys.
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  assert.ok(keys.includes('gmmchat_session_pk_test') && keys.includes('gmmchat_visitor'), keys.join());
  assert.ok(!keys.some((k) => /^cb_/.test(k)), 'never CloseBot\u2019s own keys');
  assert.ok(/^v_[0-9a-f]{32}$/.test(mock.requestsFor('session')[0].body.visitorId));
});

test('identity: HighLevel merge-field attributes are used; unrendered ones are not', async (page) => {
  await page.goto(P('attrs'));
  await until(page, () => window.GMMChatWidget.state().identified);
  assert.deepStrictEqual(identities(), [{ firstName: 'Pat', lastName: 'Lee', name: 'Pat Lee', email: 'pat@example.com', phone: '+16035550100' }]);
  mock.state.requests = [];
  await page.evaluate(() => localStorage.clear());
  await page.goto(P('unrendered'));
  await untilState(page, 's.formShown');
  assert.strictEqual(identities().length, 0);
});

test('identity: details saved by the form page tag (embed.js format) are used once', async (page) => {
  await page.goto(P('form-page'));
  assert.strictEqual(await page.evaluate(() => document.querySelector('gmmc-chat')), null, 'no chat without data-source');
  await page.fill('input[name=first_name]', 'Sam');
  await page.fill('input[name=email]', 'sam@example.com');
  await page.fill('input[name=business_info]', 'Roofing');
  await Promise.all([page.waitForURL(/thanks-session/), page.click('button[type=submit]')]);
  await until(page, () => window.GMMChatWidget.state().identified);
  assert.deepStrictEqual(identities(), [{ firstName: 'Sam', name: 'Sam', email: 'sam@example.com' }]);
  assert.strictEqual((await state(page)).contactSource, 'session');
  assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('gmmcw_contact')), null, 'saved details cleared');
  // The form answer from the form page is ready for the first message.
  assert.ok(/Business info: Roofing/.test(await page.evaluate(() => sessionStorage.getItem('gmmcw_note'))));
});

test('form: shown when no contact is known, composer waits, and the details go to CloseBot', async (page) => {
  mock.state.configs[KEY] = {
    chatTitle: 'Acme', welcomeMessage: '',
    leadCaptureForm: { isEnabled: true, formText: 'Who are we chatting with?', submitButtonText: 'Let\u2019s chat',
      fields: [{ key: 'firstName', label: 'First Name' }, { key: 'email', label: 'Email', required: true }, { key: 'phone', label: 'Phone' }] },
  };
  await page.goto(P('inline'));
  await untilState(page, 's.formShown');
  const form = await inWidget(page, (root) => ({
    intro: root.querySelector('.gmmc-form-intro').textContent,
    labels: Array.from(root.querySelectorAll('.gmmc-form label')).map((l) => l.textContent),
    button: root.querySelector('.gmmc-submit').textContent,
    input: root.querySelector('.gmmc-input').disabled,
    messages: root.querySelectorAll('.gmmc-msg').length,
  }));
  assert.deepStrictEqual(form, { intro: 'Who are we chatting with?', labels: ['First Name', 'Email *', 'Phone'], button: 'Let\u2019s chat', input: true, messages: 0 });
  await page.click('.gmmc-submit');
  const invalid = await inWidget(page, (root) => ({
    aria: root.querySelector('#gmmc-f-email').getAttribute('aria-invalid'),
    error: root.querySelector('#gmmc-f-email-error').textContent,
    focused: root.activeElement && root.activeElement.id,
  }));
  assert.deepStrictEqual(invalid, { aria: 'true', error: 'Please fill this in.', focused: 'gmmc-f-email' });
  await page.fill('#gmmc-f-firstName', 'Ann');
  await page.fill('#gmmc-f-email', 'ann@example.com');
  await page.fill('#gmmc-f-phone', '603-555-0142');
  await page.click('.gmmc-submit');
  await until(page, () => !window.GMMChatWidget.state().formShown);
  assert.deepStrictEqual(identities(), [{ firstName: 'Ann', name: 'Ann', email: 'ann@example.com', phone: '+16035550142' }]);
  const after = await inWidget(page, (root) => ({
    form: !!root.querySelector('.gmmc-form'),
    input: root.querySelector('.gmmc-input').disabled,
    focused: root.activeElement && root.activeElement.id,
  }));
  assert.deepStrictEqual(after, { form: false, input: false, focused: 'gmmc-input' });
  assert.deepStrictEqual((await state(page)).messages, [{ sender: 'bot', text: 'Hey Ann, what can I help you with today?' }]);
  assert.strictEqual(await page.evaluate(() => document.querySelector('.gmmc-cta-title').textContent), 'You\u2019re all set, Ann!');
  assert.strictEqual(await page.evaluate(() => document.querySelector('.gmmc-cta-icon svg').getAttribute('viewBox')), '10 4 44 58', 'the card shows the jar');
  // Back on the page later: CloseBot already knows them, so no form.
  mock.state.requests = [];
  await page.reload();
  await untilState(page, 's.started && s.sessionId');
  await page.waitForTimeout(300);
  const s = await state(page);
  assert.strictEqual(s.resumed, true);
  assert.strictEqual(s.formShown, false);
  assert.strictEqual(identities().length, 0);
});

test('form: CloseBot rejecting known details shows the form, filled in', async (page) => {
  mock.state.failIdentity = true;
  await page.goto(P('inline') + '?email=bad%40example.com&first_name=Bo');
  await untilState(page, 's.formShown');
  assert.strictEqual(await inWidget(page, (root) => root.querySelector('#gmmc-f-email').value), 'bad@example.com');
  mock.state.failIdentity = false;
  await page.click('.gmmc-submit');
  await until(page, () => window.GMMChatWidget.state().identified);
});

test('form: off when CloseBot\u2019s lead form is turned off', async (page) => {
  mock.state.configs[KEY] = { leadCaptureForm: { isEnabled: false } };
  await page.goto(P('inline'));
  await untilState(page, 's.started');
  const s = await state(page);
  assert.strictEqual(s.formShown, false);
  assert.deepStrictEqual(s.messages, [{ sender: 'bot', text: 'Hey there, what can I help you with today?' }]);
});

test('send: Enter sends, Shift+Enter adds a line, and the bot reply streams in once', async (page) => {
  await page.goto(P('inline') + '?email=s%40example.com');
  await untilState(page, 's.connected');
  await page.click('.gmmc-input');
  await page.keyboard.type('Hello');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('there');
  assert.strictEqual(await inWidget(page, (root) => root.querySelector('.gmmc-input').value), 'Hello\nthere');
  await page.keyboard.press('Enter');
  await until(page, () => window.GMMChatWidget.state().messages.some((m) => m.sender === 'bot' && /You said/.test(m.text)));
  assert.deepStrictEqual(messagesSent(), ['Hello\nthere']);
  await page.waitForTimeout(200);
  assert.deepStrictEqual(await bubbles(page, 'lead'), ['Hello\nthere'], 'the echo from CloseBot does not double the bubble');
  assert.deepStrictEqual(await bubbles(page, 'bot'), ['Hey there, what can I help you with today?', 'You said: Hello\nthere']);
  const ui = await inWidget(page, (root) => ({
    input: root.querySelector('.gmmc-input').value,
    send: root.querySelector('.gmmc-send').disabled,
    pending: root.querySelectorAll('.gmmc-pending').length,
    who: Array.from(root.querySelectorAll('.gmmc-who')).map((w) => w.textContent),
  }));
  assert.deepStrictEqual(ui, { input: '', send: true, pending: 0, who: [] }, 'no name set in the setup: CloseBot\u2019s agent name doesn\u2019t show');
  // Links in bot replies become safe links.
  mock.state.reply = () => 'See **this** https://example.com/page. Or [the guide](https://example.com/guide)';
  await page.fill('.gmmc-input', 'link?');
  await page.click('.gmmc-send');
  await until(page, () => document.querySelector('gmmc-chat').shadowRoot.querySelectorAll('.gmmc-bot a').length === 2);
  const links = await inWidget(page, (root) => Array.from(root.querySelectorAll('.gmmc-bot a')).map((a) => [a.textContent, a.href, a.target, a.rel]));
  assert.deepStrictEqual(links, [['https://example.com/page', 'https://example.com/page', '_blank', 'noopener noreferrer nofollow'],
    ['the guide', 'https://example.com/guide', '_blank', 'noopener noreferrer nofollow']]);
  assert.strictEqual(await inWidget(page, (root) => root.querySelector('.gmmc-bot strong').textContent), 'this');
});

test('send: a failed message can be sent again', async (page) => {
  await page.goto(P('inline') + '?email=f%40example.com');
  await untilState(page, 's.connected');
  mock.state.failMessage = true;
  await page.fill('.gmmc-input', 'Are you there?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.gmmc-failed .gmmc-retry');
  mock.state.failMessage = false;
  await page.click('.gmmc-retry');
  await until(page, () => window.GMMChatWidget.state().messages.some((m) => m.text === 'You said: Are you there?'));
  assert.deepStrictEqual(await bubbles(page, 'lead'), ['Are you there?']);
});

test('typing: dots while the AI types, a name for a human, none for the visitor\u2019s own typing', async (page) => {
  mock.state.replyDelay = 1200;
  await page.goto(P('inline') + '?email=t%40example.com');
  await untilState(page, 's.connected');
  await page.fill('.gmmc-input', 'Hi');
  await page.keyboard.press('Enter');
  await untilState(page, 's.typing');
  assert.strictEqual(await inWidget(page, (root) => root.querySelector('.gmmc-typing').hidden), false);
  await until(page, () => window.GMMChatWidget.state().messages.some((m) => m.text === 'You said: Hi'));
  assert.strictEqual((await state(page)).typing, false);
  const sid = (await state(page)).sessionId;
  mock.send(sid, { type: 'human_typing', active: true, actorSubjectId: 'chat_widget_lead:abc', actorName: 'Lead' });
  await page.waitForTimeout(200);
  assert.strictEqual((await state(page)).typing, false, 'the visitor\u2019s own typing is ignored');
  mock.send(sid, { type: 'human_typing', active: true, actorSubjectId: 'user:7', actorName: 'Dana' });
  await untilState(page, 's.typing');
  assert.strictEqual(await inWidget(page, (root) => root.querySelector('.gmmc-typing-label').textContent), 'Dana is typing\u2026');
  mock.send(sid, { type: 'human_typing', active: false, actorSubjectId: 'user:7', actorName: 'Dana' });
  await untilState(page, '!s.typing');
  // The visitor typing tells CloseBot, at most every few seconds.
  await page.type('.gmmc-input', 'abc');
  await page.waitForTimeout(200);
  const typing = mock.requestsFor('typing').map((r) => r.body.active);
  assert.strictEqual(typing.filter((a) => a === true).length >= 1, true, JSON.stringify(typing));
  assert.ok(typing.filter((a) => a === true).length <= 2);
});

test('resume: a reload shows the conversation once, with no greeting or form', async (page) => {
  await page.goto(P('inline') + '?email=r%40example.com&first_name=Rae');
  await untilState(page, 's.connected');
  await page.fill('.gmmc-input', 'First question');
  await page.keyboard.press('Enter');
  await until(page, () => window.GMMChatWidget.state().messages.length === 3);
  const sid = (await state(page)).sessionId;
  mock.state.requests = [];
  await page.goto(P('inline'));
  await untilState(page, 's.resumed && s.connected');
  await page.waitForTimeout(400);
  const s = await state(page);
  assert.strictEqual(s.sessionId, sid);
  assert.strictEqual(mock.requestsFor('session')[0].body.sessionId, sid);
  assert.ok(mock.requestsFor('stream')[0].query.includes('backfill=true'));
  assert.deepStrictEqual(s.messages, [{ sender: 'lead', text: 'First question' }, { sender: 'bot', text: 'You said: First question' }]);
  assert.strictEqual(s.formShown, false);
  assert.strictEqual(identities().length, 0, 'already identified on this conversation');
});

test('resume: when the old conversation is gone, a fresh one starts', async (page) => {
  await page.goto(P('inline') + '?email=g%40example.com');
  await untilState(page, 's.connected');
  const first = (await state(page)).sessionId;
  mock.state.failResume = true;
  mock.state.requests = [];
  await page.goto(P('inline') + '?email=g%40example.com');
  await untilState(page, 's.connected');
  const s = await state(page);
  assert.notStrictEqual(s.sessionId, first);
  assert.strictEqual(s.resumed, false);
  assert.deepStrictEqual(mock.requestsFor('session').map((r) => !!r.body.sessionId), [true, false]);
  assert.strictEqual(identities().length, 1, 'the new conversation is identified again');
  assert.deepStrictEqual(s.messages, [{ sender: 'bot', text: 'Hey there, what can I help you with today?' }]);
});

test('resume: a different visitor on the same browser gets a new conversation', async (page) => {
  await page.goto(P('inline') + '?email=one%40example.com');
  await untilState(page, 's.identified');
  const first = (await state(page)).sessionId;
  mock.state.requests = [];
  await page.goto(P('inline') + '?email=two%40example.com');
  await untilState(page, 's.identified && s.sessionId');
  assert.notStrictEqual((await state(page)).sessionId, first);
  assert.strictEqual(mock.requestsFor('session')[0].body.sessionId, undefined);
  assert.deepStrictEqual(identities(), [{ email: 'two@example.com' }]);
});

test('opening: CloseBot\u2019s Welcome Message wins over the greeting; custom and off greetings', async (page) => {
  mock.state.configs[KEY] = { welcomeMessage: 'Welcome to Acme! How can we help?' };
  await page.goto(P('inline') + '?email=w%40example.com&first_name=Wes');
  await untilState(page, 's.started');
  assert.deepStrictEqual((await state(page)).messages, [{ sender: 'bot', text: 'Welcome to Acme! How can we help?' }]);
  mock.state.configs[KEY] = {};
  await page.goto(P('greeting-custom') + '?email=w2%40example.com&first_name=Wes');
  await untilState(page, 's.connected');
  assert.deepStrictEqual((await state(page)).messages, [{ sender: 'bot', text: 'Hi Wes! Ask away.' }]);
  await page.goto(P('greeting-off') + '?email=w3%40example.com');
  await untilState(page, 's.connected');
  assert.deepStrictEqual((await state(page)).messages, []);
  assert.strictEqual(messagesSent().length, 0, 'the opening message is shown in the page only');
});

test('look: data-* options style the widget, over CloseBot\u2019s color', async (page) => {
  mock.state.configs[KEY] = { primaryColor: '#3b82f6' };
  await page.goto(P('look') + '?email=l%40example.com');
  await untilState(page, 's.connected');
  await page.fill('.gmmc-input', 'Style?');
  await page.keyboard.press('Enter');
  await until(page, () => window.GMMChatWidget.state().messages.length === 3);
  const look = await inWidget(page, (root) => {
    const cs = (sel) => getComputedStyle(root.querySelector(sel));
    return {
      header: cs('.gmmc-header').backgroundColor,
      headerText: cs('.gmmc-header').color,
      panelRadius: cs('.gmmc-panel').borderTopLeftRadius,
      panelShadow: cs('.gmmc-panel').boxShadow,
      panelBorder: cs('.gmmc-panel').borderTopWidth,
      font: cs('.gmmc-root').fontFamily,
      size: cs('.gmmc-root').fontSize,
      area: cs('.gmmc-scroll').backgroundColor,
      bot: [cs('.gmmc-bot .gmmc-text').backgroundColor, cs('.gmmc-bot .gmmc-text').color],
      visitorText: cs('.gmmc-lead .gmmc-text').color,
      bubbleRadius: cs('.gmmc-lead .gmmc-text').borderTopLeftRadius,
      launcherNone: !root.querySelector('.gmmc-launcher'),
    };
  });
  assert.deepStrictEqual(look, {
    header: 'rgb(225, 29, 72)', headerText: 'rgb(0, 0, 0)', panelRadius: '8px', panelShadow: 'none', panelBorder: '0px',
    font: 'Georgia, serif', size: '17px', area: 'rgb(250, 250, 250)', bot: ['rgb(238, 238, 238)', 'rgb(34, 34, 34)'],
    visitorText: 'rgb(255, 255, 0)', bubbleRadius: '8px', launcherNone: true,
  });
  await page.goto(P('look-noheader') + '?email=l%40example.com');
  await untilState(page, 's.started');
  assert.strictEqual(await inWidget(page, (root) => getComputedStyle(root.querySelector('.gmmc-header')).display), 'none');
  await page.goto(P('look-bubble') + '?email=lb%40example.com');
  await page.click('.gmmc-launcher');
  await page.waitForTimeout(300);
  const win = await inWidget(page, (root) => {
    const r = root.querySelector('.gmmc-panel').getBoundingClientRect();
    const l = root.querySelector('.gmmc-launcher').getBoundingClientRect();
    return { left: r.left, width: r.width, height: r.height, launcherLeft: l.left };
  });
  assert.deepStrictEqual(win, { left: 20, width: 420, height: 500, launcherLeft: 20 });
});

test('look: the default color and a light brand color keep text readable', async (page) => {
  mock.state.configs[KEY] = {};
  await page.goto(P('look-noheader') + '?email=c%40example.com');
  await untilState(page, 's.started');
  const def = await inWidget(page, (root) => [getComputedStyle(root.querySelector('.gmmc-send')).backgroundColor,
    getComputedStyle(root.querySelector('.gmmc-root')).getPropertyValue('--gmmc-accent')]);
  assert.strictEqual(def[1].trim(), '#40916C');
  assert.notStrictEqual(def[0], 'rgb(64, 145, 108)', 'text surfaces use a deepened green');
  mock.state.configs[KEY] = { primaryColor: '#facc15' };
  await page.goto(P('inline') + '?email=c%40example.com');
  await untilState(page, 's.started');
  const light = await inWidget(page, (root) => [getComputedStyle(root.querySelector('.gmmc-header')).backgroundColor,
    getComputedStyle(root.querySelector('.gmmc-header')).color]);
  assert.deepStrictEqual(light, ['rgb(250, 204, 21)', 'rgb(17, 24, 39)']);
});

test('call to action: greets by name; its button opens the bubble or focuses the inline chat', async (page) => {
  await page.goto(P('bubble-cta') + '?email=c%40example.com&first_name=Cy');
  await page.waitForSelector('#gmmc-cta:not(.gmmc-cta-loading)');
  const card = await page.evaluate(() => {
    const c = document.getElementById('gmmc-cta');
    return { parent: c.parentElement.id, title: c.querySelector('.gmmc-cta-title').textContent,
      label: c.querySelector('.gmmc-cta-label').textContent, bubble: c.classList.contains('gmmc-cta-bubble') };
  });
  assert.deepStrictEqual(card, { parent: 'cta-spot', title: 'You\u2019re all set, Cy!', label: 'Chat with us', bubble: true });
  await page.click('.gmmc-cta-btn');
  await untilState(page, 's.open');
  // A new tab, so the remembered first name is gone.
  page = await page.context().newPage();
  await page.goto(P('inline') + '?email=c2%40example.com');
  await page.waitForSelector('#gmmc-cta:not(.gmmc-cta-loading)');
  assert.strictEqual(await page.evaluate(() => document.querySelector('.gmmc-cta-title').textContent), 'You\u2019re all set!');
  await page.click('.gmmc-cta-btn');
  await until(page, () => document.querySelector('gmmc-chat').shadowRoot.activeElement?.id === 'gmmc-input');
});

test('call to action: formatted text with the visitor’s name, and a video at the top', async (page) => {
  pages['cta-rich'] = doc('CTA rich', tag('data-layout="bubble" data-cta-text="&lt;strong&gt;Hi {first_name}&lt;/strong&gt; &lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;&lt;a href=&quot;https://example.com&quot;&gt;Read more&lt;/a&gt;" ' +
    'data-cta-video="https://vimeo.com/76979871"'));
  await page.goto(P('cta-rich') + '?email=r%40example.com&first_name=Rae');
  await page.waitForSelector('#gmmc-cta:not(.gmmc-cta-loading)');
  const r = await page.evaluate(() => {
    const c = document.getElementById('gmmc-cta');
    return { html: c.querySelector('.gmmc-cta-text').innerHTML, video: c.querySelector('.gmmc-cta-video iframe').src,
      xss: window.__xss || 0, wide: c.querySelector('.gmmc-cta-video').getBoundingClientRect().width > c.querySelector('.gmmc-cta-body').getBoundingClientRect().width,
      top: c.querySelector('.gmmc-cta-video').getBoundingClientRect().bottom <= c.querySelector('.gmmc-cta-title').getBoundingClientRect().top };
  });
  assert.deepStrictEqual(r, { html: '<strong>Hi Rae</strong> <a href="https://example.com" target="_blank" rel="noopener noreferrer">Read more</a>',
    video: 'https://player.vimeo.com/video/76979871', xss: 0, wide: true, top: true });
});

test('corner button: shows the JARchat jar, or CloseBot’s icon with data-launcher-icon="closebot"', async (page) => {
  mock.state.configs[KEY] = { chatTitle: 'Acme', iconName: 'headset', leadCaptureForm: { isEnabled: false } };
  await page.goto(P('bubble'));
  await untilState(page, 's.started');
  const jar = await inWidget(page, (root) => root.querySelector('.gmmc-ico-open svg').getAttribute('viewBox'));
  assert.strictEqual(jar, '10 4 44 58');
  pages['bubble-cbicon'] = doc('Bubble CloseBot icon', tag('data-layout="bubble" data-cta="off" data-launcher-icon="closebot"'));
  await page.goto(P('bubble-cbicon'));
  await untilState(page, 's.started');
  const icon = await inWidget(page, (root) => root.querySelector('.gmmc-ico-open svg path').getAttribute('d'));
  assert.ok(/^M4 14v-2/.test(icon), 'headset icon: ' + icon);
});

test('call to action: goes away when the chat can\u2019t load', async (page) => {
  mock.state.failConfig = true;
  mock.state.failSession = true;
  pages['cta-wait'] = doc('CTA wait', tag('data-layout="bubble" data-cta-wait="600"'));
  await page.goto(P('cta-wait'));
  await page.waitForSelector('#gmmc-cta');
  await page.waitForSelector('#gmmc-cta', { state: 'detached', timeout: 4000 });
});

test('widget: the source key finds the page’s chat; with none targeting the page, nothing shows', async (page) => {
  await page.goto(P('inline') + '#top');
  await untilState(page, 's.started');
  const looked = mock.requestsFor('widget-for-page');
  assert.strictEqual(looked.length, 1);
  assert.strictEqual(looked[0].key, KEY);
  assert.ok(/\/p\/inline$/.test(looked[0].pageUrl), 'asks about this page, without the hash or contact details');
  pages['no-widget'] = doc('No widget', `<div id="slot"><script src="/loader/chat.js" data-source="src_none" data-closebot-api="${API}"></script></div>`);
  mock.state.requests = [];
  await page.goto(P('no-widget'));
  await untilState(page, 's.error === "no-widget"');
  await page.waitForSelector('gmmc-chat', { state: 'detached' });
  assert.strictEqual(await page.$('#gmmc-cta'), null);
  assert.strictEqual(mock.requestsFor('config').length, 0);
});

test('widget: data-widget-key connects straight to that chat', async (page) => {
  pages['widget-key'] = doc('Widget key', `<div id="slot">${tag('data-widget-key="pk_direct"')}</div>`);
  await page.goto(P('widget-key') + '?email=w%40example.com');
  await untilState(page, 's.identified');
  assert.strictEqual(mock.requestsFor('widget-for-page').length, 0);
  assert.ok(mock.requestsFor('config').every((r) => r.key === 'pk_direct'));
  assert.ok(mock.requestsFor('session').every((r) => r.key === 'pk_direct'));
});

test('unavailable: the inline chat says so, and Try again recovers', async (page) => {
  mock.state.failConfig = true;
  await page.goto(P('inline') + '?email=u%40example.com');
  await page.waitForSelector('.gmmc-notice button', { timeout: 6000 });
  assert.ok(/can\u2019t reach the chat/.test(await inWidget(page, (root) => root.querySelector('.gmmc-notice').textContent)));
  mock.state.failConfig = false;
  await page.click('.gmmc-notice button');
  await untilState(page, 's.identified');
  assert.strictEqual(await inWidget(page, (root) => root.querySelector('.gmmc-notice').hidden), true);
});

test('note: with data-note-key the answers go to /api/note after identity, and the first message goes as typed', async (page) => {
  const notes = [];
  await page.route('http://api.test/api/note', (route) => {
    notes.push({ body: JSON.parse(route.request().postData()), at: Date.now() });
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ added: true }) });
  });
  await page.goto(P('note') + '?email=n%40example.com&business_info=HVAC&team_size=6-20');
  await until(page, () => window.GMMChatWidget.state().noteAdded === true);
  assert.deepStrictEqual(notes.map((n) => n.body), [{ name: '', email: 'n@example.com', phone: '', answers: { business_info: 'HVAC', team_size: '6-20' }, key: 'v1.sealed-test' }]);
  assert.ok(notes[0].at >= mock.requestsFor('identity')[0].at, 'the note waits until CloseBot knows the visitor');
  assert.ok(!/business_info/.test(page.url()), 'answers removed from the address bar');
  await page.fill('.gmmc-input', 'Hi');
  await page.keyboard.press('Enter');
  await until(page, () => window.GMMChatWidget.state().messages.length === 3);
  assert.deepStrictEqual(messagesSent(), ['Hi']);
});

test('note: without an AI note, the answers go with the first message only, unseen by the visitor; Typeform blanks are left out', async (page) => {
  await page.route('http://api.test/api/note', (route) => route.fulfill({ status: 501, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ added: false, reason: 'not_configured' }) }));
  mock.state.reply = () => 'Got it';
  await page.goto(P('note') + '?email=n2%40example.com&phone=_____&business_info=HVAC&team_size=_____');
  await until(page, () => window.GMMChatWidget.state().noteAdded === false);
  assert.ok(!identities().some((i) => JSON.stringify(i).includes('___')), 'no blank phone sent to CloseBot');
  assert.ok(!/team_size|phone/.test(page.url()), 'blanks leave the address bar too');
  await page.fill('.gmmc-input', 'Hi');
  await page.keyboard.press('Enter');
  await until(page, () => window.GMMChatWidget.state().messages.length === 3);
  await page.fill('.gmmc-input', 'Again');
  await page.keyboard.press('Enter');
  await until(page, () => window.GMMChatWidget.state().messages.length === 5);
  assert.deepStrictEqual(messagesSent(), ['Hi\n\n[Form answers, for reference: Email: n2@example.com; Business info: HVAC]', 'Again']);
  assert.deepStrictEqual(await bubbles(page, 'lead'), ['Hi', 'Again']);
  // And it stays hidden when the conversation comes back.
  await page.goto(P('note'));
  await untilState(page, 's.resumed && s.connected');
  await page.waitForTimeout(300);
  assert.deepStrictEqual(await bubbles(page, 'lead'), ['Hi', 'Again']);
  const shown = await inWidget(page, (root) => root.querySelector('.gmmc-log').textContent);
  assert.ok(!/Form answers/.test(shown), shown);
});

test('form echo: CloseBot\u2019s "Thanks, got it!" for the sent details never shows, now or on reload; the AI saying it later does', async (page) => {
  mock.state.reply = () => 'Thanks, got it!';
  await page.goto(P('inline') + '?email=echo%40example.com');
  await untilState(page, 's.identified && s.connected');
  await page.waitForTimeout(300);
  const sid = (await state(page)).sessionId;
  assert.ok(mock.state.sessions.get(sid).messages.some((m) => m.message === 'Thanks, got it!'), 'CloseBot keeps it in the conversation');
  assert.deepStrictEqual(await bubbles(page, 'bot'), ['Hey there, what can I help you with today?']);
  await page.fill('.gmmc-input', 'Can you note my email?');
  await page.keyboard.press('Enter');
  await until(page, () => window.GMMChatWidget.state().messages.length === 3);
  await page.goto(P('inline'));
  await untilState(page, 's.resumed && s.connected');
  await page.waitForTimeout(300);
  assert.deepStrictEqual((await state(page)).messages.map((m) => m.text), ['Can you note my email?', 'Thanks, got it!']);
});

test('reconnect: after the stream drops, missed messages arrive once', async (page) => {
  await page.goto(P('inline') + '?email=rc%40example.com');
  await untilState(page, 's.connected');
  await page.fill('.gmmc-input', 'Before');
  await page.keyboard.press('Enter');
  await until(page, () => window.GMMChatWidget.state().messages.length === 3);
  const sid = (await state(page)).sessionId;
  const streamsBefore = mock.requestsFor('stream').length;
  mock.dropStreams(sid);
  await untilState(page, '!s.connected');
  mock.botSay(sid, 'Sorry, we got cut off');
  await untilState(page, 's.connected && s.reconnects >= 1', 8000);
  await until(page, () => window.GMMChatWidget.state().messages.some((m) => m.text === 'Sorry, we got cut off'));
  const again = mock.requestsFor('stream').slice(streamsBefore);
  assert.ok(again.length >= 1 && again.every((r) => r.query.includes('backfill=true')));
  await page.waitForTimeout(200);
  assert.deepStrictEqual((await state(page)).messages.map((m) => m.text), [
    'Hey there, what can I help you with today?', 'Before', 'You said: Before', 'Sorry, we got cut off']);
  assert.strictEqual(await inWidget(page, (root) => root.querySelector('.gmmc-banner').hidden), true);
});

async function pictures(page) {
  await page.route('https://pics.test/**', (route) => (/missing/.test(route.request().url())
    ? route.fulfill({ status: 404, body: 'gone' })
    : route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(DOT_PNG.split(',')[1], 'base64') })));
}
const header = (page) => inWidget(page, (root) => {
  const img = root.querySelector('.gmmc-avatar img');
  return { title: root.querySelector('.gmmc-title').textContent, img: img && img.getAttribute('src'),
    loaded: !!(img && img.complete && img.naturalWidth), icon: !!root.querySelector('.gmmc-avatar svg'), dot: !!root.querySelector('.gmmc-avatar .gmmc-dot') };
});

test('persona: data-title and data-avatar replace CloseBot\u2019s name and picture', async (page) => {
  mock.state.configs[KEY] = { chatTitle: 'Acme Help', avatarUrl: 'https://pics.test/closebot.png', showOnlineStatus: true };
  await pictures(page);
  await page.goto(P('persona') + '?email=a%40example.com');
  await untilState(page, 's.started');
  await until(page, () => { const i = document.querySelector('gmmc-chat').shadowRoot.querySelector('.gmmc-avatar img'); return i && i.complete; });
  assert.deepStrictEqual(await header(page), { title: 'Jamie', img: 'https://pics.test/jamie.png', loaded: true, icon: false, dot: true });
  // Replies carry the same name and picture, not CloseBot's agent persona.
  await page.fill('.gmmc-input', 'Hi');
  await page.keyboard.press('Enter');
  await until(page, () => window.GMMChatWidget.state().messages.length === 3);
  const who = await inWidget(page, (root) => Array.from(root.querySelectorAll('.gmmc-who')).map((w) => [w.textContent, w.querySelector('img') && w.querySelector('img').getAttribute('src')]));
  assert.deepStrictEqual(who, [['Jamie', 'https://pics.test/jamie.png']]);
});

test('persona: an uploaded picture in the tag shows; an unsafe one is ignored; a broken one falls back to the icon', async (page) => {
  mock.state.configs[KEY] = { chatTitle: 'Acme Help', avatarUrl: 'https://pics.test/closebot.png', showOnlineStatus: true };
  await pictures(page);
  await page.goto(P('persona-data') + '?email=a%40example.com');
  await untilState(page, 's.started');
  let h = await header(page);
  assert.strictEqual(h.img, DOT_PNG);
  assert.strictEqual(h.title, 'Acme Help');
  await page.goto(P('persona-unsafe') + '?email=a%40example.com');
  await untilState(page, 's.started');
  assert.strictEqual((await header(page)).img, 'https://pics.test/closebot.png', 'CloseBot\u2019s picture instead');
  await page.goto(P('persona-broken') + '?email=a%40example.com');
  await untilState(page, 's.started');
  await until(page, () => !document.querySelector('gmmc-chat').shadowRoot.querySelector('.gmmc-avatar img'));
  h = await header(page);
  assert.deepStrictEqual([h.img, h.icon, h.dot], [null, true, true]);
});

test('attachments: images and files show; unsafe links are dropped', async (page) => {
  await page.goto(P('inline') + '?email=a%40example.com');
  await untilState(page, 's.connected');
  mock.botSay((await state(page)).sessionId, 'Here you go', { attachments: [
    { url: 'https://example.com/photo.png', type: 'image/png', name: 'Photo' },
    { url: 'https://example.com/brochure.pdf', name: 'Brochure.pdf' },
    { url: 'javascript:alert(1)', name: 'bad' },
  ] });
  await until(page, () => document.querySelector('gmmc-chat').shadowRoot.querySelector('.gmmc-files'));
  const files = await inWidget(page, (root) => ({
    img: Array.from(root.querySelectorAll('.gmmc-files img')).map((i) => [i.alt, i.getAttribute('src')]),
    links: Array.from(root.querySelectorAll('.gmmc-filelink')).map((a) => [a.textContent, a.href]),
    all: Array.from(root.querySelectorAll('.gmmc-files a')).map((a) => a.href),
  }));
  assert.deepStrictEqual(files.img, [['Photo', 'https://example.com/photo.png']]);
  assert.deepStrictEqual(files.links, [['Brochure.pdf', 'https://example.com/brochure.pdf']]);
  assert.ok(!files.all.some((h) => /^javascript/.test(h)));
});

test('layouts: a tag in the head uses the bubble; a phone gets a full-screen window', async (page) => {
  await page.goto(P('head-tag'));
  await untilState(page, 's.started');
  assert.strictEqual((await state(page)).layout, 'bubble');
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(P('bubble') + '?email=ph%40example.com');
  await page.click('.gmmc-launcher');
  await untilState(page, 's.open');
  await page.waitForTimeout(250);
  const r = await inWidget(page, (root) => {
    const b = root.querySelector('.gmmc-panel').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, launcher: getComputedStyle(root.querySelector('.gmmc-launcher')).display,
      close: !!root.querySelector('.gmmc-close') };
  });
  assert.deepStrictEqual(r, { x: 0, y: 0, w: 375, h: 700, launcher: 'none', close: true });
  await page.click('.gmmc-close');
  await untilState(page, '!s.open');
});

test('reduced motion: no animations', async (page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(P('inline') + '?email=m%40example.com');
  await untilState(page, 's.started');
  const anim = await inWidget(page, (root) => getComputedStyle(root.querySelector('.gmmc-msg')).animationName);
  assert.strictEqual(anim, 'none');
});

test('note: details typed into the chat\u2019s own form join the answers sent with the first message', async (page) => {
  mock.state.configs[KEY] = {
    chatTitle: 'Acme', welcomeMessage: '',
    leadCaptureForm: { isEnabled: true, fields: [{ key: 'firstName', label: 'First Name' }, { key: 'email', label: 'Email', required: true }] },
  };
  await page.route('http://api.test/api/note', (route) => route.fulfill({ status: 501, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ added: false, reason: 'not_configured' }) }));
  await page.goto(P('note') + '?business_info=Dental');
  await untilState(page, 's.formShown');
  await page.fill('#gmmc-f-firstName', 'Ann');
  await page.fill('#gmmc-f-email', 'ann.form@example.com');
  await page.click('.gmmc-submit');
  await until(page, () => !window.GMMChatWidget.state().formShown);
  await until(page, () => window.GMMChatWidget.state().noteAdded === false);
  await page.fill('.gmmc-input', 'Hi');
  await page.keyboard.press('Enter');
  await until(page, () => window.GMMChatWidget.state().messages.length >= 2);
  assert.deepStrictEqual(messagesSent(), ['Hi\n\n[Form answers, for reference: Name: Ann; Email: ann.form@example.com; Business info: Dental]']);
});

const DEFAULTS = JSON.parse(JSON.stringify({ ...mock.state, configs: {}, sessions: undefined, requests: undefined, reply: undefined }));
const defaultReply = mock.state.reply;

(async () => {
  const server = await serve(PORT);
  await mock.listen(API_PORT);
  const browser = await chromium.launch();
  let failed = 0;
  const only = process.argv[2];
  const run = only ? tests.filter((t) => t.name.includes(only)) : tests;
  for (const t of run) {
    Object.keys(DEFAULTS).forEach((k) => { if (DEFAULTS[k] !== undefined) mock.state[k] = JSON.parse(JSON.stringify(DEFAULTS[k])); });
    mock.state.configs = {};
    mock.state.requests = [];
    mock.state.reply = defaultReply;
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await t.fn(page);
      assert.deepStrictEqual(errors, [], 'page errors');
      console.log('ok   -', t.name);
    } catch (err) {
      failed++;
      console.log('FAIL -', t.name, '\n      ', err.message.split('\n').slice(0, 6).join('\n       '));
    }
    await context.close();
  }
  await browser.close();
  await mock.close();
  server.close();
  console.log(`\n${run.length - failed}/${run.length} passed`);
  process.exit(failed ? 1 : 0);
})();
