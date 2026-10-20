// POST /api/typeform
//
// For the setup page: reads a Typeform's questions, so the page can name the
// answers and build the redirect link, and, when asked, writes that redirect
// into the form's "Redirect to URL" ending.
//
// Read:  { "token": "tfp_...", "form": "<form link or id>" }
// Write: { "token", "form", "action": "write",
//          "redirect": { "base": "https://site/thank-you",
//                        "params": [{ "name": "email", "ref": "<question ref>" }] } }
//
// The token is the visitor's own Typeform personal access token (Forms: Read,
// plus Forms: Write to write). It is sent on to Typeform for this request
// and never stored or logged.
//
// Typeform's API saves a form only as a whole (PUT), so a write reads the
// form, changes only the redirect, sends it all back, then reads it again and
// reports anything else that differs. It only updates a form with exactly one
// "Redirect to URL" ending, so it never has to guess which ending to change.
//
// Typeform's API doesn't allow calls from browsers, hence this pass-through.
// Only the setup page (this site) may call it.

const TF_BASE = 'https://api.typeform.com';
const RATE_LIMIT = { windowMs: 60 * 1000, max: 20 };
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

// Accepts a share link (form.typeform.com/to/ID, x.typeform.com/to/ID), an
// editor link (admin.typeform.com/form/ID/...) or the bare id.
function formId(v) {
  v = typeof v === 'string' ? v.trim() : '';
  const m = v.match(/typeform\.com\/(?:to|form)\/([A-Za-z0-9]+)/) || v.match(/^([A-Za-z0-9]{4,32})$/);
  return m ? m[1] : '';
}

// Questions inside groups (and contact blocks) come out as their own entries.
function flatten(fields, parent) {
  const out = [];
  (fields || []).forEach((f) => {
    const sub = f.properties && Array.isArray(f.properties.fields) ? f.properties.fields : null;
    if (sub && sub.length) {
      out.push(...flatten(sub, f));
      return;
    }
    if (f.type === 'statement' || !f.ref) return;
    out.push({
      ref: String(f.ref),
      title: String(f.title || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      type: String(f.type || ''),
      group: parent ? String(parent.title || '').replace(/\s+/g, ' ').trim().slice(0, 200) : '',
    });
  });
  return out;
}

const MAX_PARAMS = 30;

// Answers go into the link as Typeform recall tags, the form the @ picker
// stores them in.
function buildRedirect(redirect, refs) {
  if (!redirect || typeof redirect.base !== 'string' || !Array.isArray(redirect.params)) return { error: 'bad_redirect' };
  let base;
  try { base = new URL(redirect.base.trim()); } catch (_) { return { error: 'bad_redirect_url' }; }
  if (base.protocol !== 'https:') return { error: 'redirect_not_https' };
  if (!redirect.params.length || redirect.params.length > MAX_PARAMS) return { error: 'bad_redirect' };
  const parts = [];
  for (const p of redirect.params) {
    const name = p && typeof p.name === 'string' ? p.name : '';
    const ref = p && typeof p.ref === 'string' ? p.ref : '';
    if (!/^[a-z0-9_]{1,40}$/.test(name)) return { error: 'bad_redirect' };
    if (!refs.has(ref)) return { error: 'unknown_question' };
    parts.push(name + '={{field:' + ref + '}}');
  }
  return { url: base.origin + base.pathname + '?' + parts.join('&') };
}

// What a write must leave alone, in a comparable form.
function shape(form) {
  return {
    fields: flatten(form.fields).map((f) => f.ref + ':' + f.type),
    hidden: JSON.stringify(form.hidden || []),
    logic: JSON.stringify(form.logic || []),
    variables: JSON.stringify(form.variables || {}),
    welcome: (form.welcome_screens || []).length,
    endings: (form.thankyou_screens || []).map((s) => (s.ref || '') + ':' + s.type),
    settings: JSON.stringify(Object.assign({}, form.settings || {}, { redirect_after_submit_url: null })),
  };
}

function differences(before, after) {
  const a = shape(before), b = shape(after), out = [];
  if (a.fields.join() !== b.fields.join()) out.push('questions');
  if (a.hidden !== b.hidden) out.push('hidden fields');
  if (a.logic !== b.logic) out.push('logic');
  if (a.variables !== b.variables) out.push('variables');
  if (a.welcome !== b.welcome) out.push('welcome screen');
  if (a.endings.join() !== b.endings.join()) out.push('endings');
  if (a.settings !== b.settings) out.push('settings');
  return out;
}

async function tfGet(id, token) {
  return fetch(TF_BASE + '/forms/' + encodeURIComponent(id), {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
  });
}

async function write(res, id, token, form, redirect) {
  const refs = new Set(flatten(form.fields).map((f) => f.ref));
  const built = buildRedirect(redirect, refs);
  if (built.error) return send(res, 400, { error: built.error });
  const endings = (form.thankyou_screens || []).filter((s) => s.type === 'url_redirect');
  if (endings.length !== 1) return send(res, 409, { error: endings.length ? 'several_redirect_endings' : 'no_redirect_ending' });

  const updated = JSON.parse(JSON.stringify(form));
  delete updated._links;
  const ending = updated.thankyou_screens.find((s) => s.type === 'url_redirect');
  ending.properties = Object.assign({}, ending.properties, { redirect_url: built.url });

  let put;
  try {
    put = await fetch(TF_BASE + '/forms/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(updated),
    });
  } catch (_) {
    return send(res, 502, { error: 'typeform_unreachable' });
  }
  if (put.status === 401 || put.status === 403) return send(res, 401, { error: 'typeform_write_rejected' });
  if (!put.ok) {
    let detail = '';
    try { const b = await put.json(); detail = String(b.description || b.code || '').slice(0, 300); } catch (_) { /* no body */ }
    return send(res, 502, { error: 'typeform_write_failed', status: put.status, detail });
  }

  // Read it back: the redirect should be set and nothing else changed.
  let check = null;
  try { const again = await tfGet(id, token); if (again.ok) check = await again.json(); } catch (_) { /* reported below */ }
  if (!check) return send(res, 200, { written: true, url: built.url, verified: false, changed: [] });
  const now = (check.thankyou_screens || []).find((s) => s.type === 'url_redirect');
  return send(res, 200, {
    written: true,
    url: built.url,
    verified: !!(now && now.properties && now.properties.redirect_url === built.url),
    changed: differences(form, check),
  });
}

function isSameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch (_) { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isSameSite(req)) return send(res, 403, { error: 'origin_not_allowed' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return send(res, 429, { error: 'rate_limited' });

  const body = parseBody(req);
  if (!body) return send(res, 400, { error: 'bad_json' });
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!/^[A-Za-z0-9_\-.]{20,200}$/.test(token)) return send(res, 400, { error: 'bad_token' });
  const id = formId(body.form);
  if (!id) return send(res, 400, { error: 'bad_form' });

  let tf;
  try {
    tf = await tfGet(id, token);
  } catch (_) {
    return send(res, 502, { error: 'typeform_unreachable' });
  }
  if (tf.status === 401 || tf.status === 403) return send(res, 401, { error: 'typeform_token_rejected' });
  if (tf.status === 404) return send(res, 404, { error: 'form_not_found' });
  if (!tf.ok) return send(res, 502, { error: 'typeform_error', status: tf.status });

  const form = await tf.json();
  if (body.action === 'write') return write(res, id, token, form, body.redirect);
  const endings = (form.thankyou_screens || []).map((s) => ({
    title: String(s.title || '').slice(0, 200),
    type: String(s.type || ''),
    redirect: s.properties && s.properties.redirect_url ? String(s.properties.redirect_url) : '',
  }));
  return send(res, 200, {
    id,
    title: String(form.title || ''),
    fields: flatten(form.fields),
    hidden: Array.isArray(form.hidden) ? form.hidden.map(String) : [],
    endings,
    redirectAfterSubmit: form.settings && form.settings.redirect_after_submit_url ? String(form.settings.redirect_after_submit_url) : '',
  });
};

module.exports.formId = formId;
module.exports.flatten = flatten;
module.exports.buildRedirect = buildRedirect;
