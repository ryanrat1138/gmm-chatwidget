// POST /api/closebot
//
// For the setup page: checks a customer's CloseBot API key, lists their
// sources, and seals the key for their embed tag (see lib/seal.js), so the
// AI-only note works on their own CloseBot account.
//
// Sources: { "apiKey": "..." }
// Seal:    { "apiKey": "...", "action": "seal",
//            "sites": ["https://example.com"], "sourceIds": ["..."] }
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
    })),
  };
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
  if (body.action !== 'seal') return send(res, 200, { sources: listed.sources });

  const sites = origins(body.sites);
  if (!sites) return send(res, 400, { error: 'bad_sites' });
  const known = new Set(listed.sources.map((s) => s.id));
  const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.map(String).filter((id) => known.has(id)) : [];
  const sealed = seal({ k: apiKey, o: sites, s: sourceIds });
  if (!sealed) return send(res, 501, { error: 'not_configured' });
  return send(res, 200, { sealed, sites, sourceIds });
};

module.exports.origins = origins;
module.exports._reset = function () { hits.clear(); };
