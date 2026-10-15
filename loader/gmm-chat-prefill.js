/*!
 * GMM Chat Prefill v0.1.0
 *
 * Fills CloseBot's chat-widget lead form on a thank-you page with the name,
 * email and phone the visitor just submitted, so the chat lands on their
 * existing HighLevel contact without asking them to type it again.
 *
 * Use one script tag on both the form page and the thank-you page. Load it
 * BEFORE the CloseBot pixel and any analytics, so contact details in the URL
 * are removed before anything else can read or log them.
 *
 *   <script src="gmm-chat-prefill.js"
 *     data-email="{{contact.email}}"          (optional, HighLevel-hosted pages)
 *     data-phone="{{contact.phone}}"
 *     data-first-name="{{contact.first_name}}"
 *     data-last-name="{{contact.last_name}}"
 *     data-backend="https://example.vercel.app" (optional, webhook + code)
 *     data-autosubmit="true"                    (false = fill only)
 *     data-debug="false"></script>
 *
 * Where the details come from, first match wins:
 *   1. sessionStorage, saved on the form page at submit (same site only)
 *   2. data-* attributes rendered by HighLevel merge fields
 *   3. URL parameters (Typeform redirect recall), stripped on load
 *   4. backend lookup by a one-time code (webhook path)
 *   5. nothing found: the visitor fills the form themselves
 *
 * The CloseBot form selectors below come from inspecting cb.js on 2026-10-15.
 * They are not a public API and may change with a CloseBot release.
 */
(function (window, document) {
  'use strict';

  var VERSION = '0.1.0';
  var STORE_KEY = 'gmmcw_contact';
  var CODE_KEY = 'gmmcw_code';
  var MAX_AGE_MS = 30 * 60 * 1000;
  var CODE_PARAM = 'cb_ref';
  var URL_PARAMS = {
    email: ['email', 'cb_email'],
    phone: ['phone', 'cb_phone'],
    firstName: ['first_name', 'firstname', 'cb_first_name'],
    lastName: ['last_name', 'lastname', 'cb_last_name'],
    name: ['name', 'full_name', 'cb_name']
  };
  var HL_ORIGIN_RE = /(^|\.)(leadconnectorhq\.com|msgsndr\.com|gohighlevel\.com)$/i;

  var script = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    return all[all.length - 1];
  })();

  function attr(name) {
    return script ? script.getAttribute('data-' + name) : null;
  }

  var config = {
    backend: (attr('backend') || '').replace(/\/+$/, ''),
    autosubmit: attr('autosubmit') !== 'false',
    debug: attr('debug') === 'true',
    formTimeoutMs: parseInt(attr('form-timeout') || '600000', 10),
    hlOrigins: (attr('hl-origins') || '').split(',').map(trim).filter(Boolean)
  };

  function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }

  function log() {
    if (!config.debug || !window.console) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[gmm-chat-prefill]');
    window.console.log.apply(window.console, args);
  }

  // ---------- storage ----------

  function store() {
    try { return window.sessionStorage; } catch (_) { return null; }
  }

  function saveContact(contact, source) {
    var s = store();
    if (!s || !hasIdentity(contact)) return;
    var record = clean(contact);
    record.savedAt = Date.now();
    record.source = source;
    try { s.setItem(STORE_KEY, JSON.stringify(record)); } catch (_) { /* quota or privacy mode */ }
    log('saved contact from', source);
  }

  function readSavedContact() {
    var s = store();
    if (!s) return null;
    try {
      var record = JSON.parse(s.getItem(STORE_KEY) || 'null');
      if (!record || Date.now() - record.savedAt > MAX_AGE_MS) {
        s.removeItem(STORE_KEY);
        return null;
      }
      return hasIdentity(record) ? record : null;
    } catch (_) {
      return null;
    }
  }

  function clearSavedContact() {
    var s = store();
    if (s) { try { s.removeItem(STORE_KEY); } catch (_) { /* ignore */ } }
  }

  function getCode() {
    var s = store();
    var code = s && s.getItem(CODE_KEY);
    if (!code) {
      code = randomCode();
      if (s) { try { s.setItem(CODE_KEY, code); } catch (_) { /* ignore */ } }
    }
    return code;
  }

  function randomCode() {
    var bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
    return out;
  }

  // ---------- contact helpers ----------

  function isUnrendered(v) { return !v || /\{\{.*\}\}/.test(v); }

  function clean(c) {
    var out = {};
    ['email', 'phone', 'firstName', 'lastName', 'name'].forEach(function (k) {
      var v = c && c[k] != null ? trim(String(c[k])) : '';
      if (v && !isUnrendered(v)) out[k] = v;
    });
    if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) delete out.email;
    if (!out.firstName && !out.lastName && out.name) {
      var parts = out.name.split(/\s+/);
      out.firstName = parts.shift();
      if (parts.length) out.lastName = parts.join(' ');
    }
    return out;
  }

  function hasIdentity(c) { return !!(c && (c.email || c.phone)); }

  // ---------- form page: capture at submit ----------

  function fieldKind(input) {
    var type = (input.type || '').toLowerCase();
    var hint = [input.name, input.id, input.placeholder, input.getAttribute('autocomplete'),
      input.getAttribute('data-q'), input.getAttribute('aria-label')].join(' ').toLowerCase();
    if (type === 'email' || /e-?mail/.test(hint)) return 'email';
    if (type === 'tel' || /phone|tel\b|mobile/.test(hint)) return 'phone';
    if (/first[\s_-]?name|given-name|fname/.test(hint)) return 'firstName';
    if (/last[\s_-]?name|family-name|lname|surname/.test(hint)) return 'lastName';
    if (/full[\s_-]?name|^name\b|\bname\b/.test(hint) && type !== 'hidden') return 'name';
    return null;
  }

  function readForm(form) {
    var contact = {};
    var inputs = form.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var kind = fieldKind(inputs[i]);
      if (kind && !contact[kind] && inputs[i].value) contact[kind] = inputs[i].value;
    }
    return contact;
  }

  function isWidgetElement(el) {
    return !!(el && el.closest && el.closest('.cb-panel, .cb-form-card'));
  }

  function captureFromPageForms() {
    document.addEventListener('submit', function (e) {
      if (isWidgetElement(e.target)) return;
      saveContact(readForm(e.target), 'page-form');
    }, true);
    // Many builders (HighLevel funnels included) submit with a button click
    // and no native submit event, so also read the enclosing form on click.
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('button, input[type="submit"]');
      if (!btn || isWidgetElement(btn)) return;
      var form = btn.closest('form');
      if (form) saveContact(readForm(form), 'page-form-click');
    }, true);
  }

  // Undocumented: an embedded HighLevel form posts the submitted contact to
  // the parent page as ['set-sticky-contacts', key, '<contact JSON>', ...].
  function captureFromHighLevelEmbeds() {
    window.addEventListener('message', function (e) {
      if (!isHighLevelOrigin(e.origin)) return;
      var data = e.data;
      if (!Array.isArray(data) || data[0] !== 'set-sticky-contacts') return;
      for (var i = 1; i < data.length; i++) {
        if (typeof data[i] !== 'string' || data[i].charAt(0) !== '{') continue;
        try {
          var raw = JSON.parse(data[i]);
          saveContact({
            email: raw.email,
            phone: raw.phone,
            firstName: raw.first_name || raw.firstName,
            lastName: raw.last_name || raw.lastName,
            name: raw.full_name || raw.name
          }, 'highlevel-embed');
          return;
        } catch (_) { /* not JSON */ }
      }
    });
  }

  function isHighLevelOrigin(origin) {
    try {
      var host = new URL(origin).hostname;
      if (HL_ORIGIN_RE.test(host)) return true;
      return config.hlOrigins.some(function (o) { return o === origin || o === host; });
    } catch (_) {
      return false;
    }
  }

  // Put the one-time code into hidden fields and HighLevel embed URLs so the
  // webhook path can match the submission back to this browser.
  function tagFormsWithCode() {
    if (!config.backend) return;
    var code = getCode();
    var apply = function () {
      var hidden = document.querySelectorAll('input[name="' + CODE_PARAM + '"]');
      for (var i = 0; i < hidden.length; i++) if (!hidden[i].value) hidden[i].value = code;
      var frames = document.querySelectorAll('iframe[src*="leadconnectorhq.com"], iframe[src*="msgsndr.com"]');
      for (var j = 0; j < frames.length; j++) {
        var src = frames[j].getAttribute('src');
        if (src && src.indexOf(CODE_PARAM + '=') === -1) {
          frames[j].setAttribute('src', src + (src.indexOf('?') === -1 ? '?' : '&') + CODE_PARAM + '=' + code);
        }
      }
    };
    apply();
    onReady(apply);
  }

  // ---------- thank-you page: resolve the contact ----------

  // Runs synchronously at load, before the pixel or analytics read the URL.
  function takeUrlContact() {
    var url;
    try { url = new URL(window.location.href); } catch (_) { return { contact: null, code: null }; }
    var params = url.searchParams;
    var contact = {};
    var removed = false;
    Object.keys(URL_PARAMS).forEach(function (key) {
      URL_PARAMS[key].forEach(function (p) {
        if (params.has(p)) {
          if (!contact[key]) contact[key] = params.get(p);
          params['delete'](p);
          removed = true;
        }
      });
    });
    var code = params.get(CODE_PARAM);
    if (code) { params['delete'](CODE_PARAM); removed = true; }
    if (removed && window.history && window.history.replaceState) {
      window.history.replaceState(window.history.state, '', url.pathname + (params.toString() ? '?' + params.toString() : '') + url.hash);
      log('removed contact details from the URL');
    }
    contact = clean(contact);
    return { contact: hasIdentity(contact) ? contact : null, code: code };
  }

  function attrContact() {
    var c = clean({
      email: attr('email'),
      phone: attr('phone'),
      firstName: attr('first-name'),
      lastName: attr('last-name'),
      name: attr('name')
    });
    return hasIdentity(c) ? c : null;
  }

  function fetchBackendContact(code, done) {
    if (!config.backend || !code || !window.fetch) return done(null);
    var deadline = Date.now() + 10000;
    var attempt = function () {
      window.fetch(config.backend + '/api/context?code=' + encodeURIComponent(code), { credentials: 'omit' })
        .then(function (res) {
          if (res.status === 404 && Date.now() < deadline) return setTimeout(attempt, 1000);
          if (!res.ok) return done(null);
          return res.json().then(function (body) {
            var c = clean(body && body.contact);
            done(hasIdentity(c) ? c : null);
          });
        })
        ['catch'](function () {
          if (Date.now() < deadline) setTimeout(attempt, 1000); else done(null);
        });
    };
    attempt();
  }

  function resolveContact(urlResult, done) {
    var saved = readSavedContact();
    if (saved) return done(saved, 'session');
    var fromAttrs = attrContact();
    if (fromAttrs) return done(fromAttrs, 'page-fields');
    if (urlResult.contact) return done(urlResult.contact, 'url');
    var code = urlResult.code || (store() && store().getItem(CODE_KEY));
    fetchBackendContact(code, function (c) { done(c, c ? 'backend' : 'none'); });
  }

  // ---------- CloseBot widget: fill the lead form ----------

  function inputKind(input) {
    if (input.autocomplete === 'tel' || input.type === 'tel') return 'phone';
    var ph = (input.placeholder || '').toLowerCase();
    if (/e-?mail/.test(ph) || input.type === 'email') return 'email';
    if (/phone|\(\d{3}\)/.test(ph)) return 'phone';
    if (/first/.test(ph)) return 'firstName';
    if (/last/.test(ph)) return 'lastName';
    if (/name/.test(ph)) return 'name';
    return null;
  }

  function setValue(input, value) {
    var proto = Object.getPrototypeOf(input);
    var desc = Object.getOwnPropertyDescriptor(proto, 'value') ||
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillLeadForm(card, contact) {
    var inputs = card.querySelectorAll('input.cb-form-input, input');
    var filled = {};
    for (var i = 0; i < inputs.length; i++) {
      var kind = inputKind(inputs[i]);
      if (!kind || filled[kind]) continue;
      var value = kind === 'name'
        ? (contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' '))
        : contact[kind];
      if (!value) continue;
      setValue(inputs[i], value);
      filled[kind] = true;
    }
    return filled;
  }

  function watchForLeadForm(contact) {
    var handled = false;
    var tryCard = function () {
      if (handled) return;
      var card = document.querySelector('.cb-form-card');
      if (!card || card.classList.contains('hidden')) return;
      var submit = card.querySelector('.cb-form-submit');
      if (!submit) return;
      handled = true;
      observer.disconnect();
      var filled = fillLeadForm(card, contact);
      log('filled', Object.keys(filled).join(', ') || 'nothing');
      if (config.autosubmit && (filled.email || filled.phone)) {
        setTimeout(function () {
          submit.click();
          clearSavedContact();
          log('submitted the lead form');
        }, 50);
      }
    };
    var observer = new MutationObserver(tryCard);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    tryCard();
    setTimeout(function () { observer.disconnect(); }, config.formTimeoutMs);
  }

  // ---------- boot ----------

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  var urlResult = takeUrlContact();
  captureFromPageForms();
  captureFromHighLevelEmbeds();
  tagFormsWithCode();

  var api = {
    version: VERSION,
    contact: null,
    source: null,
    fill: function (contact) { watchForLeadForm(clean(contact)); },
    clear: clearSavedContact
  };
  window.GMMChatPrefill = api;

  onReady(function () {
    resolveContact(urlResult, function (contact, source) {
      api.source = source;
      if (!contact) { log('no contact found; visitor fills the form'); return; }
      api.contact = { hasEmail: !!contact.email, hasPhone: !!contact.phone };
      log('contact found via', source);
      watchForLeadForm(contact);
    });
  });
})(window, document);
