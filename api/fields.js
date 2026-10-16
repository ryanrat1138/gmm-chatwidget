// POST /api/fields
//
// Writes extra details from the thank-you page (for example business_info=HVAC
// from a Typeform redirect) to the visitor's HighLevel contact as custom
// fields. CloseBot gives the AI every field on the contact, so the chat knows
// them without asking.
//
// Body (JSON, sent as text/plain so browsers skip the CORS preflight):
//   { "email": "...", "phone": "...", "fields": { "business_info": "HVAC" } }
//
// Environment:
//   HIGHLEVEL_PRIVATE_TOKEN  sub-account Private Integration Token with
//                            contacts.write and locations/customFields.readonly
//   HIGHLEVEL_LOCATION_ID    the sub-account (location) id
//   ALLOWED_FIELDS           custom field keys pages may set, comma separated
//                            (the key without "contact.", e.g. business_info)
//   ALLOWED_ORIGINS          sites allowed to call this, comma separated
//                            (e.g. https://greatmountainmarketing.com)
//
// The contact is matched by HighLevel's upsert (email, then phone, per the
// sub-account's duplicate settings) and created if it doesn't exist yet,
// which covers a Typeform submission that hasn't synced to HighLevel yet.

const HL_BASE = 'https://services.leadconnectorhq.com';
const HL_VERSION = '2021-07-28';
const MAX_FIELDS = 20;
const MAX_VALUE_LENGTH = 500;
const FIELD_CACHE_MS = 5 * 60 * 1000;
const RATE_LIMIT = { windowMs: 60 * 1000, max: 20 };

let fieldCache = null;
const hits = new Map();

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
  v = typeof v === 'string' ? v.trim() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '';
}

function cleanPhone(v) {
  v = typeof v === 'string' ? v.trim() : '';
  const digits = v.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? v : '';
}

async function hl(path, token, init = {}) {
  const res = await fetch(HL_BASE + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + token,
      Version: HL_VERSION,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error('HighLevel ' + res.status + ' on ' + path.split('?')[0]);
  return res.json();
}

// Map of custom field key (without "contact.") to field id.
async function customFieldIds(token, locationId) {
  if (fieldCache && Date.now() - fieldCache.at < FIELD_CACHE_MS) return fieldCache.byKey;
  const data = await hl('/locations/' + encodeURIComponent(locationId) + '/customFields?model=contact', token);
  const byKey = {};
  for (const f of data.customFields || []) {
    const key = String(f.fieldKey || '').replace(/^contact\./, '');
    if (key && f.id) byKey[key] = f.id;
  }
  fieldCache = { at: Date.now(), byKey };
  return byKey;
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

  const token = process.env.HIGHLEVEL_PRIVATE_TOKEN;
  const locationId = process.env.HIGHLEVEL_LOCATION_ID;
  const allowedFields = list(process.env.ALLOWED_FIELDS);
  if (!token || !locationId || !allowedFields.length) {
    return send(res, 500, { error: 'service not configured' }, allowedOrigin);
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return send(res, 429, { error: 'too many requests' }, allowedOrigin);

  const body = parseBody(req);
  if (!body) return send(res, 400, { error: 'invalid JSON' }, allowedOrigin);
  const email = cleanEmail(body.email);
  const phone = cleanPhone(body.phone);
  if (!email && !phone) return send(res, 400, { error: 'email or phone required' }, allowedOrigin);

  const wanted = {};
  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
  for (const key of Object.keys(fields).slice(0, MAX_FIELDS)) {
    const value = typeof fields[key] === 'string' ? fields[key].trim().slice(0, MAX_VALUE_LENGTH) : '';
    if (value && allowedFields.includes(key)) wanted[key] = value;
  }
  if (!Object.keys(wanted).length) return send(res, 400, { error: 'no allowed fields' }, allowedOrigin);

  try {
    const ids = await customFieldIds(token, locationId);
    const customFields = [];
    const missing = [];
    for (const key of Object.keys(wanted)) {
      if (ids[key]) customFields.push({ id: ids[key], field_value: wanted[key] });
      else missing.push(key);
    }
    if (!customFields.length) {
      return send(res, 422, { error: 'no matching HighLevel custom fields', missing }, allowedOrigin);
    }
    const payload = { locationId, customFields };
    if (email) payload.email = email;
    if (phone) payload.phone = phone;
    const result = await hl('/contacts/upsert', token, { method: 'POST', body: JSON.stringify(payload) });
    return send(res, 200, {
      ok: true,
      updated: customFields.length,
      missing,
      newContact: !!(result && result.new),
    }, allowedOrigin);
  } catch (err) {
    console.error('[api/fields]', err.message);
    return send(res, 502, { error: 'HighLevel request failed' }, allowedOrigin);
  }
};

// For tests.
module.exports._reset = function () { fieldCache = null; hits.clear(); };
