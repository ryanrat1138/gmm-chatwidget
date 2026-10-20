// POST /api/closebot
//
// For the setup page: checks a customer's CloseBot API key, lists their
// sources, and seals the key for their embed tag (see lib/seal.js), so the
// AI-only note works on their own CloseBot account.
//
// Sources: { "apiKey": "..." }
// Seal:    { "apiKey": "...", "action": "seal",
//            "sites": ["https://example.com"], "sourceIds": ["..."] }
// Agents:  { "apiKey", "action": "agents", "sourceId" }
//          -> the source's channels and every agent (bot), with the channels
//             each one answers on that source
// Assign:  { "apiKey", "action": "assign", "sourceId", "botId", "channel" }
//          -> lets that agent answer the channel on the source, keeping the
//             channels and filters it already has there
//
// The key is sent on to CloseBot for this request and returned only inside
// the sealed text; it is never stored or logged. Only the setup page (this
// site) may call it.
//
// Environment:
//   SEAL_SECRET  32+ random characters; changing it breaks every sealed key

const { seal } = require('../lib/seal');

const CB_BASE = 'https://api.closebot.com';
const RATE_LIMIT = { windowMs: 60 * 1000, max: 20 };
const MAX_SITES = 5;
const hits = new Map();

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.reset) {
    hits.set(ip, { count: 1, reset: now + RATE_LIMIT.windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT.max;
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return null; }
}

function isSameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch (_) { return false; }
}

// The site addresses the sealed key may be used from, as origins.
function origins(sites) {
  if (!Array.isArray(sites) || !sites.length || sites.length > MAX_SITES) return null;
  const out = [];
  for (const s of sites) {
    let u;
    try { u = new URL(String(s).trim()); } catch (_) { return null; }
    if (u.protocol !== 'https:') return null;
    if (!out.includes(u.origin)) out.push(u.origin);
  }
  return out;
}

async function listSources(apiKey) {
  const res = await fetch(CB_BASE + '/agency/source?pageSize=100', {
    headers: { 'X-CB-KEY': apiKey, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) return { error: 'closebot_key_rejected', status: 401 };
  if (!res.ok) return { error: 'closebot_error', status: 502 };
  const data = await res.json();
  return {
    sources: ((data && data.results) || []).filter((s) => s && s.sourceId).map((s) => ({
      id: String(s.sourceId),
      name: String(s.name || '').slice(0, 200),
      category: String(s.category || ''),
      scriptInstalled: !!s.scriptInstalled,
      // The key in the source's script tag (cb.js?source=...), which the
      // setup page uses as the source ID. Not the access token.
      key: /^[A-Za-z0-9_-]{6,64}$/.test(String(s.key || '')) ? String(s.key) : '',
    })),
  };
}

function cb(path, apiKey, init = {}) {
  return fetch(CB_BASE + path, {
    ...init,
    headers: { 'X-CB-KEY': apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
  });
}

function strings(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

async function readAgents(apiKey, sourceId) {
  const [chRes, botRes] = await Promise.all([
    cb('/agency/source/' + encodeURIComponent(sourceId) + '/channels', apiKey),
    cb('/bot', apiKey),
  ]);
  if (!chRes.ok || !botRes.ok) return { error: 'closebot_error', status: 502 };
  const channels = ((await chRes.json()) || []).filter((c) => c && c.id).map((c) => ({ id: String(c.id), name: String(c.name || '') }));
  const bots = (await botRes.json()) || [];
  return {
    channels,
    bots,
    agents: bots.filter((b) => b && b.id).map((b) => {
      const here = (b.sources || []).find((x) => x && x.id === sourceId);
      return {
        id: String(b.id),
        name: String(b.name || '').slice(0, 200),
        published: (b.versions || []).some((v) => v && v.published),
        onSource: !!here,
        enabled: here ? here.enabled !== false : false,
        channels: here ? strings(here.channelList) : [],
      };
    }),
  };
}

async function assign(res, apiKey, body) {
  const sourceId = String(body.sourceId || ''), botId = String(body.botId || ''), channel = String(body.channel || '');
  if (!sourceId || !botId || !channel) return send(res, 400, { error: 'bad_assign' });
  const read = await readAgents(apiKey, sourceId);
  if (read.error) return send(res, read.status, { error: read.error });
  if (!read.channels.some((c) => c.id === channel)) return send(res, 400, { error: 'unknown_channel' });
  const bot = read.bots.find((b) => b && String(b.id) === botId);
  if (!bot) return send(res, 400, { error: 'unknown_agent' });
  const here = (bot.sources || []).find((x) => x && x.id === sourceId) || {};
  const channels = strings(here.channelList);
  if (!channels.includes(channel)) channels.push(channel);
  // Sent back as it is, so the agent's other settings on this source stay put.
  const input = { channels, enabled: true };
  for (const k of ['tags', 'tagFilterConfig', 'channelRules', 'personaNameOverride']) {
    if (here[k] !== undefined && here[k] !== null) input[k] = here[k];
  }
  const put = await cb('/bot/' + encodeURIComponent(botId) + '/source/' + encodeURIComponent(sourceId), apiKey, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!put.ok) {
    let detail = '';
    try { const b = await put.json(); detail = String(b.detail || b.title || '').slice(0, 300); } catch (_) { /* no body */ }
    return send(res, 502, { error: 'closebot_error', status: put.status, detail });
  }
  const others = read.agents.filter((a) => a.id !== botId && a.channels.includes(channel)).map((a) => a.name);
  return send(res, 200, { assigned: true, channels, othersOnChannel: others });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isSameSite(req)) return send(res, 403, { error: 'origin_not_allowed' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return send(res, 429, { error: 'rate_limited' });

  const body = parseBody(req);
  if (!body) return send(res, 400, { error: 'bad_json' });
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!/^[\x21-\x7e]{16,300}$/.test(apiKey)) return send(res, 400, { error: 'bad_key' });

  let listed;
  try {
    listed = await listSources(apiKey);
  } catch (_) {
    return send(res, 502, { error: 'closebot_unreachable' });
  }
  if (listed.error) return send(res, listed.status, { error: listed.error });
  const known = new Set(listed.sources.map((s) => s.id));
  if (body.action === 'agents' || body.action === 'assign') {
    if (!known.has(String(body.sourceId || ''))) return send(res, 400, { error: 'unknown_source' });
    try {
      if (body.action === 'assign') return await assign(res, apiKey, body);
      const read = await readAgents(apiKey, String(body.sourceId));
      if (read.error) return send(res, read.status, { error: read.error });
      return send(res, 200, { channels: read.channels, agents: read.agents });
    } catch (_) {
      return send(res, 502, { error: 'closebot_unreachable' });
    }
  }
  if (body.action !== 'seal') return send(res, 200, { sources: listed.sources });

  const sites = origins(body.sites);
  if (!sites) return send(res, 400, { error: 'bad_sites' });
  const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.map(String).filter((id) => known.has(id)) : [];
  const sealed = seal({ k: apiKey, o: sites, s: sourceIds });
  if (!sealed) return send(res, 501, { error: 'not_configured' });
  return send(res, 200, { sealed, sites, sourceIds });
};

module.exports.origins = origins;
module.exports._reset = function () { hits.clear(); };
