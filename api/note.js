// POST /api/note
//
// Adds the visitor's form answers to their CloseBot conversation as an
// internal note that only the AI sees. Notes are never sent to the contact;
// CloseBot includes them in the AI's context.
//
// Body (JSON, sent as text/plain so browsers skip the CORS preflight):
//   { "email": "...", "phone": "...", "answers": { "business_info": "HVAC" } }
//
// Environment:
//   CLOSEBOT_API_KEY         CloseBot API key (Settings > API Keys)
//   CLOSEBOT_SOURCE_IDS      optional: CloseBot source ids to search in,
//                            comma separated (all sources when unset)
//   ALLOWED_ORIGINS          sites allowed to call this, comma separated
//   HIGHLEVEL_PRIVATE_TOKEN  optional, with HIGHLEVEL_LOCATION_ID: also match
//                            the CloseBot lead by its HighLevel contact id
//
// The visitor's lead may not exist yet when the thank-you page loads (CloseBot
// creates it once the widget identifies them), so the search is retried for a
// few seconds. A lead is only used when it clearly belongs to this visitor and
// has been active recently. When no lead is found the page falls back to
// sending the answers with the first chat message.

const CB_BASE = 'https://api.closebot.com';
const HL_BASE = 'https://services.leadconnectorhq.com';
const HL_VERSION = '2021-07-28';
const MAX_ANSWERS = 20;
const MAX_VALUE_LENGTH = 500;
const RECENT_MS = 60 * 60 * 1000;
const RETRY_DELAYS = [0, 1200, 2000, 3000];
const RATE_LIMIT = { windowMs: 60 * 1000, max: 20 };
const NOTE_HEAD = 'Form answers from the thank-you page (given by the visitor, for reference):';

const hits = new Map();
let sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function list(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function send(res, status, body, origin) {
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined) return res.status(status).end();
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

function cleanEmail(v) {
  v = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '';
}

function phoneDigits(v) {
  const d = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  return d.length >= 7 && d.length <= 15 ? d : '';
}

function label(key) {
  const s = key.replace(/_+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function noteBody(answers) {
  const lines = Object.keys(answers).map((k) => '- ' + label(k) + ': ' + answers[k]);
  return NOTE_HEAD + '\n' + lines.join('\n');
}

function cb(path, key, init = {}) {
  return fetch(CB_BASE + path, {
    ...init,
    headers: { 'X-CB-KEY': key, Accept: 'application/json', 'Content-Type': 'application/json' },
  });
}

// The visitor's HighLevel contact id, when HighLevel is configured.
async function highLevelContactId(email, phone) {
  const token = process.env.HIGHLEVEL_PRIVATE_TOKEN;
  const locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!token || !locationId) return '';
  const q = new URLSearchParams({ locationId });
  if (email) q.set('email', email); else q.set('number', '+' + phone);
  try {
    const res = await fetch(HL_BASE + '/contacts/search/duplicate?' + q, {
      headers: { Authorization: 'Bearer ' + token, Version: HL_VERSION, Accept: 'application/json' },
    });
    if (!res.ok) return '';
    const data = await res.json();
    return (data && data.contact && data.contact.id) || '';
  } catch (_) {
    return '';
  }
}

// Does this lead belong to the visitor? By HighLevel contact id, or by an
// email or phone among the lead's fields.
function matchLead(lead, who) {
  if (who.contactId && lead.contactId === who.contactId) return 'contact';
  for (const f of lead.fields || []) {
    const v = typeof f.value === 'string' ? f.value.trim() : '';
    if (!v) continue;
    if (who.email && v.toLowerCase() === who.email) return 'email';
    const d = v.replace(/\D/g, '');
    if (who.phone && d.length >= 7 && d.slice(-10) === who.phone.slice(-10)) return 'phone';
  }
  return '';
}

function recent(lead) {
  if (!lead.lastMessageTime) return true; // a new lead with no messages yet
  const t = Date.parse(lead.lastMessageTime);
  return !isNaN(t) && Date.now() - t < RECENT_MS;
}

async function findLead(key, who) {
  const sourceIds = list(process.env.CLOSEBOT_SOURCE_IDS);
  const terms = [who.email, who.phone].filter(Boolean);
  for (const term of terms) {
    const res = await cb('/lead/search', key, {
      method: 'POST',
      body: JSON.stringify({ botIds: [], channels: [], personaIds: [], sourceIds, search: term, offset: 0, count: 10 }),
    });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('key'), { code: 'closebot_key_rejected' });
    if (!res.ok) throw Object.assign(new Error('search ' + res.status), { code: 'closebot_error' });
    const data = await res.json();
    const leads = (data && data.leads) || [];
    for (const lead of leads) {
      const how = lead && lead.id ? matchLead(lead, who) : '';
      if (how) return { lead, how };
    }
    // An email search that returns a single lead is taken as that visitor's.
    if (term === who.email && leads.length === 1 && leads[0] && leads[0].id) return { lead: leads[0], how: 'search' };
  }
  return null;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigin = list(process.env.ALLOWED_ORIGINS).includes(origin) ? origin : '';

  if (req.method === 'OPTIONS') {
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    return send(res, 204, undefined, allowedOrigin);
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!allowedOrigin) return send(res, 403, { error: 'origin not allowed' });

  const key = process.env.CLOSEBOT_API_KEY;
  if (!key) return send(res, 501, { added: false, reason: 'not_configured' }, allowedOrigin);

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return send(res, 429, { added: false, reason: 'rate_limited' }, allowedOrigin);

  const body = parseBody(req);
  if (!body) return send(res, 400, { added: false, reason: 'bad_json' }, allowedOrigin);
  const email = cleanEmail(body.email);
  const phone = phoneDigits(body.phone);
  if (!email && !phone) return send(res, 400, { added: false, reason: 'email_or_phone_required' }, allowedOrigin);

  const answers = {};
  const given = body.answers && typeof body.answers === 'object' ? body.answers : {};
  for (const k of Object.keys(given).slice(0, MAX_ANSWERS)) {
    const v = typeof given[k] === 'string' ? given[k].replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE_LENGTH) : '';
    if (v && /^[A-Za-z0-9_]{1,40}$/.test(k)) answers[k] = v;
  }
  if (!Object.keys(answers).length) return send(res, 400, { added: false, reason: 'no_answers' }, allowedOrigin);

  try {
    const who = { email, phone, contactId: await highLevelContactId(email, phone) };
    let found = null;
    for (const delay of RETRY_DELAYS) {
      if (delay) await sleep(delay);
      found = await findLead(key, who);
      if (found) break;
    }
    if (!found) return send(res, 200, { added: false, reason: 'lead_not_found' }, allowedOrigin);
    if (!recent(found.lead)) return send(res, 200, { added: false, reason: 'lead_not_recent' }, allowedOrigin);

    const post = await cb('/lead/' + encodeURIComponent(found.lead.id) + '/note', key, {
      method: 'POST',
      body: JSON.stringify({ body: noteBody(answers), aiVisible: true }),
    });
    if (post.status === 401 || post.status === 403) return send(res, 502, { added: false, reason: 'closebot_key_rejected' }, allowedOrigin);
    if (!post.ok) return send(res, 502, { added: false, reason: 'closebot_error', status: post.status }, allowedOrigin);
    const result = await post.json().catch(() => ({}));
    return send(res, 200, { added: true, matchedBy: found.how, aiVisible: result.aiVisible !== false }, allowedOrigin);
  } catch (err) {
    console.error('[api/note]', err.message);
    return send(res, 502, { added: false, reason: err.code || 'closebot_error' }, allowedOrigin);
  }
};

// For tests.
module.exports._reset = function () { hits.clear(); };
module.exports._setSleep = function (fn) { sleep = fn; };
module.exports.noteBody = noteBody;
