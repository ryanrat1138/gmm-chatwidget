// A small stand-in for CloseBot's chat widget endpoints, the ones its own
// widget script (cb.js) calls and loader/chat.js talks to:
//
//   GET  /chat-widget/source/{sourceKey}/widget-for-page?pageUrl=  -> {publicKey} or 204
//   GET  /chat-widget/{key}/config
//   POST /chat-widget/{key}/session                 {visitorId, sessionId?}
//   GET  /chat-widget/{key}/session/{id}/stream     server-sent events, ?backfill=true for history
//   POST /chat-widget/{key}/session/{id}/message    {message}
//   POST /chat-widget/{key}/session/{id}/identity   {firstName, lastName, name, email, phone}
//   POST /chat-widget/{key}/session/{id}/typing     {active}
//   POST /chat-widget/{key}/session/{id}/page-visit {url, title}
//
// After each visitor message it echoes the message on the stream, sends
// ai_typing on, then the bot's reply and ai_typing off, like the live one.
// The payload shapes follow what cb.js reads; they are not documented by
// CloseBot.
//
// In tests: const mock = createMock(); await mock.listen(port); then change
// mock.state (configs, reply, delays, failure switches) and read
// mock.state.requests. Run on its own for manual testing:
//   node test/fixtures/mock-closebot-api.js [port]
const http = require('http');

function createMock() {
  const state = {
    configs: {}, // publicKey -> widget settings; unknown keys get defaultConfig
    defaultConfig: { chatTitle: 'Support', primaryColor: '#3b82f6', welcomeMessage: '', showOnlineStatus: true },
    sessions: new Map(), // id -> { key, visitorId, messages: [], streams: Set, identity }
    requests: [], // { method, path, query, body, at }
    reply: (text) => 'You said: ' + text,
    typingDelay: 80,
    replyDelay: 250,
    failConfig: false,
    failSession: false,
    failResume: false, // true: resuming a session answers 404
    failIdentity: false,
    failMessage: false,
  };
  let seq = 0;
  const newId = (prefix) => `${prefix}_${++seq}`;

  function sseWrite(res, payload) {
    res.write('data: ' + JSON.stringify(payload) + '\n\n');
  }

  function broadcast(session, payload) {
    session.streams.forEach((res) => sseWrite(res, payload));
  }

  // Stored in the history and sent live.
  function post(session, msg) {
    const full = { messageId: newId('m'), createdAt: new Date().toISOString(), attachments: [], ...msg };
    session.messages.push(full);
    broadcast(session, { type: 'message-sent', ...full, isHistory: false });
    return full;
  }

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({ _raw: raw }); }
      });
    });
  }

  async function handle(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://mock');
    const w = url.pathname.match(/^\/chat-widget\/source\/([^/]+)\/widget-for-page$/);
    if (w) {
      const src = decodeURIComponent(w[1]);
      state.requests.push({ method: req.method, path: url.pathname, query: url.search, key: src, action: 'widget-for-page', pageUrl: url.searchParams.get('pageUrl'), at: Date.now() });
      if (state.noWidget || src === 'src_none') { res.writeHead(204); return res.end(); }
      // The chat's own key is the source key here, so tests can keep using it.
      return json(res, 200, { publicKey: src });
    }
    const m = url.pathname.match(/^\/chat-widget\/([^/]+)\/(config|session)(?:\/([^/]+)\/([a-z-]+))?$/);
    if (!m) return json(res, 404, { error: 'not found' });
    const key = decodeURIComponent(m[1]);
    const body = req.method === 'POST' ? await readBody(req) : null;
    const entry = { method: req.method, path: url.pathname, query: url.search, body, key, at: Date.now() };
    if (m[3]) { entry.sessionId = decodeURIComponent(m[3]); entry.action = m[4]; } else entry.action = m[2];
    state.requests.push(entry);

    if (m[2] === 'config' && !m[3]) {
      if (req.method !== 'GET') return json(res, 405, {});
      if (state.failConfig) return json(res, 500, { error: 'boom' });
      return json(res, 200, state.configs[key] || state.defaultConfig);
    }

    if (m[2] === 'session' && !m[3]) {
      if (req.method !== 'POST') return json(res, 405, {});
      if (state.failSession) return json(res, 503, { error: 'unavailable' });
      const asked = body && body.sessionId;
      if (asked) {
        const known = state.sessions.get(asked);
        if (!known || known.key !== key || state.failResume) return json(res, 404, { error: 'session not found' });
        return json(res, 200, { sessionId: asked, resumedSession: true });
      }
      const id = newId('sess');
      state.sessions.set(id, { key, visitorId: body && body.visitorId, messages: [], streams: new Set(), identity: null });
      return json(res, 200, { sessionId: id, resumedSession: false });
    }

    const session = state.sessions.get(entry.sessionId);
    if (!session || session.key !== key) return json(res, 404, { error: 'session not found' });

    switch (entry.action) {
      case 'stream': {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(': stream open\n\n');
        sseWrite(res, { type: 'connected', sessionId: entry.sessionId });
        if (url.searchParams.get('backfill') === 'true') {
          session.messages.forEach((msg) => sseWrite(res, { type: 'message-sent', ...msg, isHistory: true }));
          sseWrite(res, { type: 'backfill-done', count: session.messages.length });
        }
        session.streams.add(res);
        req.on('close', () => session.streams.delete(res));
        return undefined;
      }
      case 'message': {
        if (state.failMessage) return json(res, 500, { error: 'boom' });
        const text = String((body && body.message) || '');
        post(session, { sender: 'lead', message: text });
        json(res, 200, { success: true });
        setTimeout(() => {
          broadcast(session, { type: 'thinking_start' });
          broadcast(session, { type: 'ai_typing', typing: true });
        }, state.typingDelay);
        setTimeout(() => {
          broadcast(session, { type: 'ai_typing', typing: false });
          post(session, { sender: 'bot', message: state.reply(text, session), responderName: 'Assistant', responderType: 'ai' });
        }, state.typingDelay + state.replyDelay);
        return undefined;
      }
      case 'identity':
        if (state.failIdentity) return json(res, 400, { error: 'invalid' });
        session.identity = body;
        // CloseBot notes the lead form in the conversation, as its widget shows it.
        post(session, { sender: 'bot', message: 'Thanks, got it!' });
        return json(res, 200, { success: true });
      case 'typing':
      case 'page-visit':
        return json(res, 200, { success: true });
      default:
        return json(res, 404, { error: 'not found' });
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => { try { json(res, 500, { error: String(err) }); } catch (_) { /* gone */ } });
  });

  return {
    state,
    server,
    listen: (port) => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)),
    close: () => {
      state.sessions.forEach((s) => s.streams.forEach((res) => res.end()));
      return new Promise((resolve) => server.close(resolve));
    },
    // Test helpers
    session: (id) => state.sessions.get(id),
    requestsFor: (action) => state.requests.filter((r) => r.action === action),
    botSay: (id, message, extra = {}) => post(state.sessions.get(id), { sender: 'bot', message, ...extra }),
    send: (id, payload) => broadcast(state.sessions.get(id), payload),
    dropStreams: (id) => {
      const s = state.sessions.get(id);
      s.streams.forEach((res) => res.destroy());
      s.streams.clear();
    },
    openStreams: (id) => state.sessions.get(id).streams.size,
  };
}

module.exports = { createMock };

if (require.main === module) {
  const port = Number(process.argv[2] || 8796);
  createMock().listen(port).then(() => console.log(`mock CloseBot chat API on http://127.0.0.1:${port}`));
}
