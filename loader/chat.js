/*!
 * JARchat v0.1.0 (chat.js)
 *
 * Our own chat window for CloseBot. Where embed.js loads CloseBot's widget
 * script and works around it, this file draws the whole chat itself and talks
 * to CloseBot's chat endpoints directly: it opens a conversation, tells
 * CloseBot who the visitor is (so the chat lands on their HighLevel contact),
 * sends their messages and streams the bot's replies.
 *
 *   <script src="https://gmm-chatwidget.vercel.app/chat.js"
 *     data-source="CLOSEBOT_SOURCE_ID"     (or CloseBot's whole script tag)
 *     data-layout="inline"                  (inline = chat where the tag is;
 *                                            bubble = button bottom-right)
 *     data-height="600px"
 *     data-greeting="Hey {first_name}, what can I help you with today?"
 *     data-fields="business_info"           (form answers for the AI)
 *     data-email="{{contact.email}}" ...    (HighLevel merge fields)></script>
 *
 * It takes the same data-* attributes as embed.js (look options, call to
 * action, data-note-key, data-api, data-backend...) and ignores the ones that
 * only make sense for CloseBot's own widget (data-autosubmit,
 * data-form-timeout, data-closebot-src). See loader/CHAT.md.
 *
 * Without data-source it shows no chat and, like embed.js, only remembers
 * what the visitor submits on a form page. It reads and writes the same
 * browser storage as embed.js, so either tag can sit on the form page.
 *
 * The CloseBot endpoints used here are the public ones CloseBot's own widget
 * (cb.js) calls, seen on 2026-10-20. They are not in CloseBot's published API
 * docs and may change; they are kept together in the "transport" section.
 */
(function (window, document) {
  'use strict';

  if (window.GMMChatWidget) return; // tag pasted twice

  var VERSION = '0.1.0';
  var CLOSEBOT_API = 'https://api.closebot.com';
  var DEFAULT_COLOR = '#40916C';
  var DEFAULT_TITLE = 'Chat with us';
  var DEFAULT_PLACEHOLDER = 'Type your message\u2026';
  var DEFAULT_GREETING = 'Hey {first_name}, what can I help you with today?';
  var DEFAULT_FORM_TEXT = 'Before we chat, can I get your name and the best way to reach you?';
  var DEFAULT_SUBMIT = 'Start chat';

  // Shared with embed.js: same keys, same format.
  var STORE_KEY = 'gmmcw_contact';
  var NAME_KEY = 'gmmcw_first_name';
  var CODE_KEY = 'gmmcw_code';
  var NOTE_KEY = 'gmmcw_note';
  var NOTE_SENT_KEY = 'gmmcw_note_sent';
  var COLOR_KEY = 'gmmcw_cb_color';
  // This widget's own: never the cb_* keys CloseBot's widget uses.
  var VISITOR_KEY = 'gmmchat_visitor';
  var AUTO_OPEN_KEY = 'gmmchat_auto_opened';

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
  var SHADOWS = {
    none: 'none',
    soft: '0 4px 16px rgba(0,0,0,.10)',
    strong: '0 12px 40px rgba(0,0,0,.28)'
  };

  var script = document.currentScript || (function () {
    // Loaded late (a WordPress or Cloudflare script optimizer): find our own tag.
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) if (/\/chat\.js([?#]|$)/.test(all[i].src)) return all[i];
    return all[all.length - 1];
  })();

  function scriptOrigin() {
    try { return new URL(script.src).origin; } catch (_) { return ''; }
  }

  function attr(name) {
    return script ? script.getAttribute('data-' + name) : null;
  }

  function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }

  // The source ID on its own, or CloseBot's whole script tag (the part after
  // source=), as the setup page accepts it.
  function sourceId(v) {
    v = trim(v);
    var m = v.match(/[?&]source=([^"'&\s>]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch (_) { return ''; } }
    return /^[A-Za-z0-9_-]+$/.test(v) ? v : '';
  }

  // The header picture: an https address, or a small image the setup page
  // put in the tag itself.
  function avatarUrl(v) {
    v = trim(v);
    if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v;
    if (v.length <= 200000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/]+=*$/i.test(v)) return v;
    return '';
  }

  function inBody() {
    var parent = script && script.parentNode;
    return !!(parent && parent !== document.head && document.body && document.body.contains(script));
  }

  var config = {
    source: sourceId(attr('source')),
    closebotApi: (attr('closebot-api') || CLOSEBOT_API).replace(/\/+$/, ''),
    widgetKey: trim(attr('widget-key')),
    fields: (attr('fields') || '').split(',').map(trim).filter(function (k) { return /^[A-Za-z0-9_]+$/.test(k); }),
    api: (attr('api') || scriptOrigin()).replace(/\/+$/, ''),
    // A tag in the page head can't hold an inline chat: it uses the bubble.
    layout: attr('layout') === 'bubble' || !inBody() ? 'bubble' : 'inline',
    height: lookSize(attr('height') || '') || '600px',
    look: parseLook(attr),
    title: trim(attr('title')),
    avatar: avatarUrl(attr('avatar')),
    greeting: greetingSetting(attr('greeting')),
    timestamps: attr('timestamps') === 'on',
    note: attr('note') !== 'off',
    noteKey: trim(attr('note-key')),
    saveFields: attr('save-fields') === 'true',
    cta: attr('cta') !== 'off',
    ctaTitle: attr('cta-title'),
    ctaText: attr('cta-text'),
    ctaVideo: attr('cta-video'),
    launcherIcon: (attr('launcher-icon') || '').toLowerCase(),
    ctaButton: attr('cta-button'),
    ctaTarget: attr('cta-target'),
    ctaWaitMs: parseInt(attr('cta-wait') || '20000', 10),
    backend: (attr('backend') || '').replace(/\/+$/, ''),
    debug: attr('debug') === 'true',
    hlOrigins: (attr('hl-origins') || '').split(',').map(trim).filter(Boolean)
  };

  function log() {
    if (!config.debug || !window.console) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[jarchat]');
    window.console.log.apply(window.console, args);
  }

  function noop() {}

  // ---------- look ----------

  // Values go into a style sheet, so each is checked against what that kind
  // of value can contain; anything else is dropped.
  function lookColor(v) {
    v = trim(v);
    return /^[#a-zA-Z0-9(),.%\s-]{1,40}$/.test(v) ? v : '';
  }

  function lookSize(v) {
    v = trim(v);
    if (/^\d{1,4}$/.test(v)) v += 'px';
    return /^\d{1,4}(\.\d+)?(px|rem|em|%|vh|vw)$/.test(v) ? v : '';
  }

  function lookFont(v) {
    v = trim(v);
    if (/^(site|inherit|page)$/i.test(v)) return 'inherit';
    return /^[A-Za-z0-9 ,'"-]{1,80}$/.test(v) ? v : '';
  }

  function parseLook(get) {
    var pick = function (name) { var v = get(name); return v === null || v === undefined ? '' : String(v); };
    var word = function (name, allowed) {
      var v = trim(pick(name)).toLowerCase();
      return allowed.indexOf(v) === -1 ? '' : v;
    };
    return {
      color: lookColor(pick('color')),
      font: lookFont(pick('font')),
      fontSize: lookSize(pick('font-size')),
      radius: lookSize(pick('radius')),
      background: lookColor(pick('background')),
      textColor: lookColor(pick('text-color')),
      botBubble: lookColor(pick('bot-bubble')),
      botText: lookColor(pick('bot-text')),
      visitorBubble: lookColor(pick('visitor-bubble')),
      visitorText: lookColor(pick('visitor-text')),
      headerText: lookColor(pick('header-text')),
      header: word('header', ['hide']),
      shadow: word('shadow', ['none', 'soft', 'strong']),
      border: word('border', ['on', 'off']),
      position: word('position', ['left', 'right']),
      width: lookSize(pick('width')),
      // data-height is the inline chat's height; on the bubble layout it sizes
      // the chat window instead.
      windowHeight: get('layout') === 'bubble' ? lookSize(pick('height')) : ''
    };
  }

  function hexRgb(c) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trim(c));
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function luminance(rgb) {
    var a = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function contrast(a, b) { return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }

  function rgbHex(rgb) {
    return '#' + rgb.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
  }

  var DARK_TEXT = '#111827';

  // Text color that reads on a background (hex colors only; white otherwise).
  function textOn(bg) {
    var rgb = hexRgb(bg);
    if (!rgb) return '#ffffff';
    var l = luminance(rgb);
    return contrast(1, l) >= contrast(luminance(hexRgb(DARK_TEXT)), l) ? '#ffffff' : DARK_TEXT;
  }

  // A surface in the brand color that text can sit on at 4.5:1: the color
  // itself when white (or, for light colors, dark) text reads on it, or else
  // the color darkened a little until white text does.
  function inkOn(color) {
    var rgb = hexRgb(color);
    if (!rgb) return { bg: color, fg: '#ffffff' };
    var l = luminance(rgb);
    if (contrast(1, l) >= 4.5) return { bg: color, fg: '#ffffff' };
    if (contrast(luminance(hexRgb(DARK_TEXT)), l) >= 7) return { bg: color, fg: DARK_TEXT };
    for (var f = 0.95; f > 0.3; f -= 0.05) {
      var d = rgb.map(function (v) { return v * f; });
      if (contrast(1, luminance(d)) >= 4.5) return { bg: rgbHex(d), fg: '#ffffff' };
    }
    return { bg: color, fg: '#ffffff' };
  }

  function siteFont() {
    var from = (host && host.parentElement) || document.body || document.documentElement;
    try { return getComputedStyle(from).fontFamily.replace(/[;{}<>]/g, ''); } catch (_) { return 'inherit'; }
  }

  // The look options as CSS custom properties on the widget's root.
  function themeCss(l, accent) {
    var ink = inkOn(accent);
    var v = {};
    v['--gmmc-accent'] = accent;
    v['--gmmc-accent-ink'] = ink.bg;
    v['--gmmc-on-accent'] = ink.fg;
    v['--gmmc-header-bg'] = ink.bg;
    v['--gmmc-header-text'] = l.headerText || ink.fg;
    v['--gmmc-visitor-bg'] = l.visitorBubble || ink.bg;
    v['--gmmc-visitor-text'] = l.visitorText || (l.visitorBubble ? textOn(l.visitorBubble) : ink.fg);
    if (l.background) { v['--gmmc-bg'] = l.background; v['--gmmc-surface'] = l.background; }
    if (l.textColor) { v['--gmmc-text'] = l.textColor; v['--gmmc-bot-text'] = l.textColor; }
    if (l.botBubble) { v['--gmmc-bot-bg'] = l.botBubble; v['--gmmc-bot-line'] = l.botBubble; }
    if (l.botText) v['--gmmc-bot-text'] = l.botText;
    if (l.font) v['--gmmc-font'] = l.font === 'inherit' ? siteFont() : l.font;
    if (l.fontSize) v['--gmmc-font-size'] = l.fontSize;
    if (l.radius) {
      var n = parseFloat(l.radius);
      var px = /px$/.test(l.radius);
      v['--gmmc-radius'] = l.radius;
      v['--gmmc-bubble-radius'] = px ? Math.min(n, 20) + 'px' : l.radius;
      v['--gmmc-tail'] = px ? Math.min(n, 6) + 'px' : '6px';
      v['--gmmc-field-radius'] = px ? Math.min(n, 12) + 'px' : l.radius;
    }
    if (l.shadow) v['--gmmc-shadow'] = SHADOWS[l.shadow];
    if (l.border === 'on') v['--gmmc-border'] = '1px solid var(--gmmc-line)';
    if (l.border === 'off') v['--gmmc-border'] = '0 solid transparent';
    if (l.width) v['--gmmc-width'] = l.width;
    if (l.windowHeight) v['--gmmc-height'] = l.windowHeight;
    var out = [];
    for (var k in v) if (v[k]) out.push(k + ':' + v[k]);
    return '.gmmc-root.gmmc-root.gmmc-root{' + out.join(';') + '}';
  }

  function greetingSetting(v) {
    if (v === null) return DEFAULT_GREETING;
    v = trim(v);
    return v.toLowerCase() === 'off' ? '' : v;
  }

  // ---------- storage ----------

  function store() { try { return window.sessionStorage; } catch (_) { return null; } }
  function local() { try { return window.localStorage; } catch (_) { return null; } }
  function getItem(s, k) { try { return s ? s.getItem(k) : null; } catch (_) { return null; } }
  function setItem(s, k, v) { try { if (s) s.setItem(k, v); } catch (_) { /* quota or privacy mode */ } }
  function removeItem(s, k) { try { if (s) s.removeItem(k); } catch (_) { /* ignore */ } }

  function saveContact(contact, source, extra) {
    var s = store();
    if (!s || !hasIdentity(contact)) return;
    var record = clean(contact);
    if (extra && Object.keys(extra).length) record.extra = extra;
    record.savedAt = Date.now();
    record.source = source;
    setItem(s, STORE_KEY, JSON.stringify(record));
    log('saved contact from', source);
  }

  function readSavedContact() {
    var s = store();
    try {
      var record = JSON.parse(getItem(s, STORE_KEY) || 'null');
      if (!record || Date.now() - record.savedAt > MAX_AGE_MS) {
        removeItem(s, STORE_KEY);
        return null;
      }
      return hasIdentity(record) ? record : null;
    } catch (_) {
      return null;
    }
  }

  function clearSavedContact() { removeItem(store(), STORE_KEY); }

  function randomCode() {
    var bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
    return out;
  }

  function getCode() {
    var s = store();
    var code = getItem(s, CODE_KEY);
    if (!code) { code = randomCode(); setItem(s, CODE_KEY, code); }
    return code;
  }

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
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

  function contactSig(c) {
    return hash(((c && c.email) || '').toLowerCase() + '|' + ((c && c.phone) || '').replace(/\D/g, ''));
  }

  function dialCode(cc) {
    cc = trim(String(cc || ''));
    if (/^\+?\d{1,4}$/.test(cc)) return '+' + cc.replace('+', '');
    return { US: '+1', CA: '+1', GB: '+44', UK: '+44', AU: '+61', NZ: '+64', IE: '+353' }[cc.toUpperCase()] || '+1';
  }

  // E.164 where it can tell (+1 for ten-digit numbers unless CloseBot's form
  // names another default country); '' when it isn't a phone number.
  function normalPhone(v, cc) {
    v = trim(v);
    var digits = v.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return '';
    if (v.charAt(0) === '+') return '+' + digits;
    if (v.slice(0, 2) === '00') return '+' + digits.slice(2);
    var code = dialCode(cc);
    if (code === '+1') {
      if (digits.length === 10) return '+1' + digits;
      if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
      return digits;
    }
    return code + digits.replace(/^0/, '');
  }

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

  // Values of the extra fields named in data-fields, from inputs, selects and
  // text areas whose name matches.
  function readExtraFields(form) {
    var extra = {};
    config.fields.forEach(function (key) {
      var els = form.querySelectorAll('[name="' + key + '"]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) continue;
        if (trim(el.value)) { extra[key] = trim(el.value); break; }
      }
    });
    return extra;
  }

  // Events from inside the widget reach the page retargeted to its host.
  function isWidgetElement(el) {
    return !!(el && el.closest && el.closest('gmmc-chat, .gmmc-cta'));
  }

  function captureFromPageForms() {
    document.addEventListener('submit', function (e) {
      if (isWidgetElement(e.target)) return;
      saveContact(readForm(e.target), 'page-form', readExtraFields(e.target));
    }, true);
    // Many builders (HighLevel funnels included) submit with a button click
    // and no native submit event, so also read the enclosing form on click.
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('button, input[type="submit"]');
      if (!btn || isWidgetElement(btn)) return;
      var form = btn.closest('form');
      if (form) saveContact(readForm(form), 'page-form-click', readExtraFields(form));
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
      var hostname = new URL(origin).hostname;
      if (HL_ORIGIN_RE.test(hostname)) return true;
      return config.hlOrigins.some(function (o) { return o === origin || o === hostname; });
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
    try { url = new URL(window.location.href); } catch (_) { return { contact: null, code: null, extra: {} }; }
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
    var extra = {};
    config.fields.forEach(function (key) {
      if (params.has(key)) {
        if (trim(params.get(key))) extra[key] = trim(params.get(key));
        params['delete'](key);
        removed = true;
      }
    });
    var code = params.get(CODE_PARAM);
    if (code) { params['delete'](CODE_PARAM); removed = true; }
    if (removed && window.history && window.history.replaceState) {
      window.history.replaceState(window.history.state, '', url.pathname + (params.toString() ? '?' + params.toString() : '') + url.hash);
      log('removed contact details from the URL');
    }
    contact = clean(contact);
    return { contact: hasIdentity(contact) ? contact : null, code: code, extra: extra };
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
    var code = urlResult.code || getItem(store(), CODE_KEY);
    fetchBackendContact(code, function (c) { done(c, c ? 'backend' : 'none'); });
  }

  // With data-save-fields="true", extra details (data-fields) also go to the
  // service next to this script, which writes them to the HighLevel contact.
  function sendExtraFields(contact, extra) {
    if (!config.saveFields || !config.fields.length || !config.api || !window.fetch) return;
    if (!Object.keys(extra).length) return;
    window.fetch(config.api + '/api/fields', {
      method: 'POST',
      // text/plain keeps this a simple request, so there is no CORS preflight.
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ email: contact.email || '', phone: contact.phone || '', fields: extra }),
      credentials: 'omit',
      keepalive: true
    }).then(function (res) {
      state.fieldsSent = res.ok;
    })['catch'](function () { state.fieldsSent = false; });
  }

  // ---------- form answers note for the AI ----------

  // The data-fields answers go on the visitor's CloseBot conversation as a
  // note only the AI sees, through /api/note, once CloseBot knows who they
  // are. When that isn't possible, they ride along with the visitor's first
  // message after a marker instead; the visitor's bubble shows only what they
  // typed, and the marker is cut again when the conversation comes back.
  var NOTE_MARK = '[Form answers, for reference:';
  var noteText = '';

  function fieldLabel(key) {
    var s = key.replace(/_+/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function setNote(extra) {
    var parts = Object.keys(extra).map(function (k) {
      return fieldLabel(k) + ': ' + String(extra[k]).replace(/\s+/g, ' ').slice(0, 500);
    });
    if (!parts.length) return;
    noteText = '\n\n' + NOTE_MARK + ' ' + parts.join('; ') + ']';
    setItem(store(), NOTE_KEY, noteText);
  }

  function forgetNote() {
    noteText = '';
    removeItem(store(), NOTE_KEY);
  }

  function stripNote(text) {
    var at = text.indexOf(NOTE_MARK);
    return at === -1 ? text : text.slice(0, at).replace(/\s+$/, '');
  }

  function noteRequest(contact, extra) {
    var r = { email: contact.email || '', phone: contact.phone || '', answers: extra };
    if (config.noteKey) r.key = config.noteKey; // the customer's own sealed CloseBot key
    return r;
  }

  function sendAiNote(contact, extra) {
    if (!config.note || !config.api || !window.fetch || !hasIdentity(contact)) return;
    if (!Object.keys(extra || {}).length) return;
    var s = store();
    if (getItem(s, NOTE_SENT_KEY)) { forgetNote(); state.noteAdded = true; return; }
    window.fetch(config.api + '/api/note', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(noteRequest(contact, extra)),
      credentials: 'omit'
    }).then(function (res) {
      return res.json()['catch'](function () { return {}; });
    }).then(function (r) {
      state.noteAdded = !!(r && r.added);
      if (state.noteAdded) {
        forgetNote();
        setItem(s, NOTE_SENT_KEY, '1');
        log('form answers added to the conversation as an AI note');
      } else {
        log('AI note not added (' + ((r && r.reason) || 'error') + '); answers go with the first message');
      }
    })['catch'](function () { state.noteAdded = false; });
  }

  // ---------- transport: CloseBot's chat widget endpoints ----------

  // Everything that talks to CloseBot is here. These are the endpoints
  // CloseBot's own widget script calls with the source's public key; no API
  // key is involved. They are not part of CloseBot's published API, so if a
  // CloseBot release changes them, this is the one place to update.
  // The source key in CloseBot's script tag isn't the chat's own key: CloseBot
  // looks up which of the source's chat widgets targets this page, as its
  // script does. Null when none does (204 or an empty answer).
  function widgetFor(base, sourceKey, pageUrl) {
    var url = base + '/chat-widget/source/' + encodeURIComponent(sourceKey) +
      '/widget-for-page?pageUrl=' + encodeURIComponent(pageUrl);
    return window.fetch(url, { credentials: 'omit' }).then(function (res) {
      if (res.status === 204 || res.status === 404) return null;
      if (!res.ok) { var err = new Error('CloseBot widget-for-page: ' + res.status); err.status = res.status; throw err; }
      return res.text().then(function (text) {
        var w = null;
        try { w = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }
        return w && w.publicKey ? String(w.publicKey) : null;
      });
    });
  }

  function closebot(base, publicKey) {
    var root = base + '/chat-widget/' + encodeURIComponent(publicKey);
    var sessionPath = function (id) { return '/session/' + encodeURIComponent(id); };

    function request(method, path, body) {
      var init = { method: method, credentials: 'omit', headers: {} };
      if (body) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      return window.fetch(root + path, init).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }
          if (!res.ok) {
            var err = new Error('CloseBot ' + method + ' ' + path.split('/').pop() + ': ' + res.status);
            err.status = res.status;
            throw err;
          }
          return data || {};
        });
      });
    }

    return {
      // Widget settings: title, colors, welcome message, lead form...
      config: function () { return request('GET', '/config'); },
      // A new conversation, or the stored one resumed: {sessionId, resumedSession}.
      session: function (visitorId, sessionId) {
        var body = { visitorId: visitorId };
        if (sessionId) body.sessionId = sessionId;
        return request('POST', '/session', body);
      },
      message: function (id, text) { return request('POST', sessionPath(id) + '/message', { message: text }); },
      // Ties the conversation to the HighLevel contact.
      identity: function (id, who) { return request('POST', sessionPath(id) + '/identity', who); },
      typing: function (id, active) { return request('POST', sessionPath(id) + '/typing', { active: !!active }); },
      pageVisit: function (id, url, title) { return request('POST', sessionPath(id) + '/page-visit', { url: url, title: title }); },
      // Server-sent events, one JSON object with a "type" per message.
      stream: function (id, backfill, onEvent, onError) {
        var es = new window.EventSource(root + sessionPath(id) + '/stream' + (backfill ? '?backfill=true' : ''));
        es.onmessage = function (e) {
          var d = null;
          try { d = JSON.parse(e.data); } catch (_) { return; }
          if (d && typeof d === 'object') onEvent(d);
        };
        es.onerror = function () { onError(es); };
        return es;
      }
    };
  }

  // Response shapes, read loosely: settings may come wrapped in an object.
  function settingsOf(r) {
    if (!r || typeof r !== 'object') return {};
    if (!('primaryColor' in r) && !('welcomeMessage' in r) && !('chatTitle' in r) && !('headerTitle' in r)) {
      var inner = r.config || r.settings || r.widget || r.data;
      if (inner && typeof inner === 'object') return inner;
    }
    return r;
  }

  function sessionOf(r) {
    r = r && typeof r === 'object' ? r : {};
    if (!r.sessionId && r.data && typeof r.data === 'object') r = r.data;
    return { id: r.sessionId ? String(r.sessionId) : '', resumed: !!r.resumedSession };
  }

  // ---------- chat state ----------

  var cb = null;
  var settings = {};
  var host = null;
  var ui = null;
  var state = {
    layout: config.layout,
    configLoaded: false,
    resolved: false,
    started: false,
    settled: false,
    sessionId: '',
    resumed: false,
    connected: false,
    reconnects: 0,
    historyDone: false,
    history: 0,
    identified: false,
    formShown: false,
    open: false,
    error: '',
    contact: null,
    contactSource: null,
    extra: {},
    noteAdded: null,
    fieldsSent: null
  };
  var seen = {};
  var sessionPromise = null;
  var historyTimer = null;
  var greetingName = '';

  function sessionKey() { return 'gmmchat_session_' + config.source; }
  function identKey() { return 'gmmchat_identity_' + config.source; }

  function visitorId() {
    var ls = local();
    var id = getItem(ls, VISITOR_KEY);
    if (!id) { id = 'v_' + randomCode(); setItem(ls, VISITOR_KEY, id); }
    return id;
  }

  function readIdent() {
    try { return JSON.parse(getItem(local(), identKey()) || 'null'); } catch (_) { return null; }
  }

  function isIdentified() {
    if (state.identified) return true;
    var ident = readIdent();
    var sid = state.sessionId || getItem(local(), sessionKey());
    return !!(ident && sid && ident.s === sid);
  }

  // A known visitor who isn't the one the stored conversation belongs to
  // (a shared computer, say) starts a new conversation.
  function storedSessionFor(contact) {
    var stored = getItem(local(), sessionKey()) || '';
    var ident = readIdent();
    if (stored && contact && ident && ident.s === stored && ident.sig !== contactSig(contact)) return '';
    return stored;
  }

  function rememberName(contact) {
    var first = contact && (contact.firstName || trim((contact.name || '').split(' ')[0]));
    if (first) {
      greetingName = first;
      setItem(store(), NAME_KEY, first);
    } else if (!greetingName) {
      greetingName = getItem(store(), NAME_KEY) || '';
    }
    updateCtaName();
  }

  function greetingText(template) {
    return (template || '').replace(/\{\s*first_?name\s*\}/gi, greetingName || 'there');
  }

  // ---------- session and stream ----------

  function ensureSession() {
    if (sessionPromise) return sessionPromise;
    var stored = storedSessionFor(state.contact);
    var vid = visitorId();
    sessionPromise = cb.session(vid, stored).then(null, function (err) {
      if (!stored) throw err;
      log('could not resume the conversation; starting a new one');
      stored = '';
      return cb.session(vid, '');
    }).then(function (r) {
      var s = sessionOf(r);
      if (!s.id) throw new Error('CloseBot sent no session id');
      state.sessionId = s.id;
      state.resumed = s.resumed && s.id === stored;
      setItem(local(), sessionKey(), s.id);
      state.error = '';
      log(state.resumed ? 'resumed the conversation' : 'started a conversation');
      onSessionReady();
      return s.id;
    });
    sessionPromise['catch'](function () {
      sessionPromise = null;
      state.error = 'session';
      showProblem();
      if (!state.settled) { state.historyDone = true; settleOpening(); }
    });
    return sessionPromise;
  }

  var pageVisitSent = false;

  function onSessionReady() {
    hideProblem();
    if (state.resumed) {
      ui.log.setAttribute('aria-busy', 'true');
      historyTimer = setTimeout(historyDone, 6000); // backfill-done never came
    }
    openStream(state.resumed);
    if (!state.resumed) historyDone();
    if (state.contact && !isIdentified()) sendIdentity(state.contact, 'auto')['catch'](noop);
    else if (isIdentified()) {
      state.identified = true;
      if (state.contact) sendAiNote(state.contact, state.extra);
    }
    if (!pageVisitSent) {
      pageVisitSent = true;
      cb.pageVisit(state.sessionId, window.location.href, document.title)['catch'](noop);
    }
  }

  function historyDone() {
    clearTimeout(historyTimer);
    if (ui) ui.log.removeAttribute('aria-busy');
    if (state.historyDone && state.settled) return;
    state.historyDone = true;
    settleOpening();
  }

  var stream = { es: null, attempts: 0, timer: null, expectBy: 0 };

  function openStream(backfill) {
    closeStream();
    if (!state.sessionId) return;
    stream.es = cb.stream(state.sessionId, backfill, handleEvent, streamFailed);
  }

  function closeStream() {
    if (!stream.es) return;
    stream.es.onmessage = stream.es.onerror = null;
    try { stream.es.close(); } catch (_) { /* ignore */ }
    stream.es = null;
  }

  // Closed or dropped: reconnect with growing pauses (1s, 2s, 4s... up to
  // 30s), asking for the history again so nothing said meanwhile is missed.
  function streamFailed() {
    closeStream();
    state.connected = false;
    if (stream.timer) return;
    var n = stream.attempts++;
    if (n >= 1) showBanner('Reconnecting\u2026');
    var delay = Math.min(30000, 1000 * Math.pow(2, n)) + Math.floor(Math.random() * 300);
    log('stream closed; reconnecting in', delay, 'ms');
    stream.timer = setTimeout(reconnect, delay);
  }

  function reconnect() {
    clearTimeout(stream.timer);
    stream.timer = null;
    if (!state.sessionId) return;
    state.reconnects++;
    var go = function () { openStream(true); };
    // Every third try, check the conversation is still there.
    if (stream.attempts && stream.attempts % 3 === 0) {
      cb.session(visitorId(), state.sessionId).then(function (r) {
        var s = sessionOf(r);
        if (s.id && s.id !== state.sessionId) {
          log('CloseBot started a new conversation');
          state.sessionId = s.id;
          state.identified = false;
          setItem(local(), sessionKey(), s.id);
          if (state.contact) sendIdentity(state.contact, 'auto')['catch'](noop);
        }
      })['catch'](noop).then(go);
    } else {
      go();
    }
  }

  // Watchdog: a stream that closed without telling us, or that has gone
  // quiet after the visitor sent something, is opened again.
  function watchStream() {
    var check = function (now) {
      if (!state.sessionId || stream.timer) return;
      var closed = !stream.es || stream.es.readyState === 2;
      var stalled = stream.expectBy && Date.now() > stream.expectBy;
      if (closed || stalled || now === true) {
        stream.expectBy = 0;
        if (!state.connected || stalled || closed) reconnect();
      }
    };
    setInterval(check, 5000);
    window.addEventListener('online', function () { if (!state.connected) check(true); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !state.connected) check(true);
    });
  }

  function handleEvent(d) {
    if (d.data && typeof d.data === 'object' && !('message' in d) && !('sender' in d)) {
      var type = d.type;
      d = d.data;
      d.type = d.type || type;
    }
    stream.expectBy = 0;
    switch (d.type) {
      case 'connected':
        state.connected = true;
        stream.attempts = 0;
        hideBanner();
        break;
      case 'backfill-done':
        historyDone();
        break;
      case 'message-sent':
        state.connected = true;
        stream.attempts = 0;
        hideBanner();
        addIncoming(d);
        break;
      case 'ai_typing':
        setTyping('ai', !!d.typing);
        break;
      case 'human_typing':
        // The visitor's own typing comes back too.
        if (/^chat_widget_lead:/.test(String(d.actorSubjectId || '')) || d.actorName === 'Lead') break;
        setTyping('human', !!d.active, trim(String(d.actorName || '')));
        break;
      default:
        // thinking_*, tool_use, bot_stopped, activity: nothing to show.
        break;
    }
  }

  function messageTime(d) {
    var t = d.createdAt || d.timestamp || d.sentAt || d.dateAdded || d.time;
    var date = t ? new Date(typeof t === 'number' && t < 1e12 ? t * 1000 : t) : null;
    return date && !isNaN(date.getTime()) ? date : null;
  }

  function addIncoming(d) {
    var sender = d.sender === 'lead' ? 'lead' : 'bot';
    var text = typeof d.message === 'string' ? d.message : String(d.text || '');
    if (sender === 'lead') text = stripNote(text);
    var files = filesOf(d.attachments);
    var time = messageTime(d);
    var id = d.messageId || d.id ? String(d.messageId || d.id) : 'k:' + sender + '|' + text + '|' + (time ? time.getTime() : '');
    if (seen[id]) return;
    if (d.isHistory) state.history++;
    // The visitor's own message comes back from CloseBot: it is already shown.
    if (sender === 'lead') {
      var mine = ui.log.querySelectorAll('.gmmc-lead:not([data-id])');
      for (var i = 0; i < mine.length; i++) {
        if (mine[i]._text === text) {
          seen[id] = true;
          mine[i].setAttribute('data-id', id);
          return;
        }
      }
    }
    if (!text && !files.length) return;
    seen[id] = true;
    if (sender === 'bot' && !d.isHistory) { typing.ai = false; typing.human = ''; renderTyping(); }
    var who = sender === 'bot' ? trim(String(d.responderName || '')) : '';
    addMessage(sender, text, {
      id: id,
      files: files,
      time: time || (d.isHistory ? null : new Date()),
      who: who,
      icon: d.responderIconUrl,
      history: !!d.isHistory
    });
    if (sender === 'bot' && !d.isHistory) {
      ding();
      if (state.layout === 'bubble' && !state.open) setUnread(unread + 1);
    }
  }

  // ---------- sending ----------

  function sendMessage(text) {
    text = trim(text);
    if (!text) return;
    var item = addMessage('lead', text, { pending: true, time: new Date() });
    deliver({ text: text, item: item });
    typingSignal(false);
  }

  function deliver(job) {
    var item = job.item;
    item.classList.remove('gmmc-failed');
    item.classList.add('gmmc-pending');
    setMeta(item, null);
    ensureSession().then(function (sid) {
      var note = config.note && !state.noteAdded ? noteText : '';
      return cb.message(sid, job.text + note).then(function (r) {
        if (note) forgetNote();
        item.classList.remove('gmmc-pending');
        var mid = r && (r.messageId || r.id);
        if (mid && !item.getAttribute('data-id') && !seen[mid]) {
          seen[mid] = true;
          item.setAttribute('data-id', String(mid));
        }
        stream.expectBy = Date.now() + 20000;
      });
    }).then(null, function () {
      item.classList.remove('gmmc-pending');
      item.classList.add('gmmc-failed');
      var retry = el('button', 'gmmc-retry', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', function () { deliver(job); });
      setMeta(item, 'Not sent.', retry);
    });
  }

  var typingOut = { on: false, last: 0, timer: null };

  // Best effort, at most every 3 seconds, and off after 4 quiet seconds.
  function typingSignal(active) {
    if (!state.sessionId) return;
    clearTimeout(typingOut.timer);
    if (active) {
      typingOut.timer = setTimeout(function () { typingSignal(false); }, 4000);
      if (typingOut.on && Date.now() - typingOut.last < 3000) return;
      typingOut.on = true;
      typingOut.last = Date.now();
      cb.typing(state.sessionId, true)['catch'](noop);
    } else if (typingOut.on) {
      typingOut.on = false;
      cb.typing(state.sessionId, false)['catch'](noop);
    }
  }

  // ---------- identity ----------

  function formSettings() {
    var f = settings.leadCaptureForm;
    return f && typeof f === 'object' ? f : {};
  }

  function identityBody(c) {
    var b = {};
    if (c.firstName) b.firstName = c.firstName;
    if (c.lastName) b.lastName = c.lastName;
    var full = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ');
    if (full) b.name = full;
    if (c.email) b.email = c.email;
    var phone = c.phone ? normalPhone(c.phone, formSettings().defaultCountryCode) : '';
    if (phone) b.phone = phone;
    return b;
  }

  function sendIdentity(contact, how) {
    var body = identityBody(contact);
    if (!body.email && !body.phone) return Promise.reject(new Error('no email or phone'));
    var sid = state.sessionId;
    return cb.identity(sid, body).then(function () {
      state.identified = true;
      state.identitySource = how;
      setItem(local(), identKey(), JSON.stringify({ s: sid, sig: contactSig(contact) }));
      clearSavedContact();
      log('CloseBot has the visitor\u2019s details (' + how + ')');
      sendAiNote(contact, state.extra);
      sendExtraFields(contact, state.extra);
    }, function (err) {
      if (how === 'auto') {
        log('CloseBot did not take the details; asking the visitor');
        var failed = state.contact;
        state.contact = null;
        if (state.settled && formEnabled()) showForm(failed);
      }
      throw err;
    });
  }

  function formEnabled() {
    return formSettings().isEnabled !== false;
  }

  function needsForm() {
    return formEnabled() && !state.contact && !isIdentified();
  }

  // The first thing in the chat once it is known whether there is a past
  // conversation: CloseBot's Welcome Message, or the greeting, shown in the
  // page only; then the details form when the visitor is not known.
  function settleOpening() {
    if (state.settled || !ui) return;
    state.settled = true;
    hideConnecting();
    var formNeeded = needsForm();
    if (!state.history) {
      var welcome = trim(String(settings.welcomeMessage || ''));
      if (welcome) addOpening(greetingText(welcome));
      else if (!formNeeded && config.greeting) addOpening(greetingText(config.greeting));
    }
    if (formNeeded) showForm(null);
    updateComposer();
  }

  function addOpening(text) {
    if (!text || ui.log.querySelector('.gmmc-opening')) return;
    var item = addMessage('bot', text, { time: null });
    item.classList.add('gmmc-opening');
  }

  // ---------- built-in details form ----------

  var FIELD_LABELS = { firstName: 'First name', lastName: 'Last name', name: 'Name', email: 'Email', phone: 'Phone' };
  var FIELD_INPUT = {
    firstName: ['text', 'given-name'],
    lastName: ['text', 'family-name'],
    name: ['text', 'name'],
    email: ['email', 'email'],
    phone: ['tel', 'tel']
  };

  function fieldKindName(s) {
    s = s.toLowerCase();
    if (/e-?mail/.test(s)) return 'email';
    if (/phone|tel|mobile/.test(s)) return 'phone';
    if (/first|given/.test(s)) return 'firstName';
    if (/last|surname|family/.test(s)) return 'lastName';
    if (/name/.test(s)) return 'name';
    return null;
  }

  // The fields CloseBot's lead form settings ask for, as far as they can be
  // read; first and last name, email and phone otherwise. Email or phone is
  // always there, since one of them is what finds the HighLevel contact.
  function formFields() {
    var list = formSettings().fields;
    var out = [];
    var have = {};
    if (Array.isArray(list)) {
      list.forEach(function (f) {
        var o = typeof f === 'string' ? { key: f } : (f && typeof f === 'object' ? f : null);
        if (!o || o.enabled === false || o.isEnabled === false || o.visible === false || o.show === false) return;
        var kind = fieldKindName(String(o.key || o.name || o.type || o.field || o.id || ''));
        if (!kind || have[kind]) return;
        have[kind] = true;
        out.push({
          kind: kind,
          label: trim(String(o.label || o.placeholder || '')).replace(/\s*\*$/, '') || FIELD_LABELS[kind],
          required: o.required === true || o.isRequired === true
        });
      });
    }
    if (!out.length) {
      ['firstName', 'lastName', 'email', 'phone'].forEach(function (k) {
        out.push({ kind: k, label: FIELD_LABELS[k], required: false });
      });
    } else if (!have.email && !have.phone) {
      out.push({ kind: 'email', label: FIELD_LABELS.email, required: true });
    }
    return out;
  }

  function showForm(prefill) {
    if (state.formShown || !ui) return;
    state.formShown = true;
    var fs = formSettings();
    var fields = formFields();
    var form = el('form', 'gmmc-form');
    form.noValidate = true;
    form.setAttribute('aria-labelledby', 'gmmc-form-intro');
    var intro = el('p', 'gmmc-form-intro', trim(String(fs.formText || '')) || DEFAULT_FORM_TEXT);
    intro.id = 'gmmc-form-intro';
    form.appendChild(intro);
    var row = null;
    fields.forEach(function (f, i) {
      var wrap = el('div', 'gmmc-field');
      var id = 'gmmc-f-' + f.kind;
      var label = el('label', null, f.label);
      label.setAttribute('for', id);
      if (f.required) label.appendChild(el('span', 'gmmc-req', ' *'));
      var input = el('input');
      input.id = id;
      input.name = f.kind;
      input.type = FIELD_INPUT[f.kind][0];
      input.setAttribute('autocomplete', FIELD_INPUT[f.kind][1]);
      if (f.required) input.setAttribute('aria-required', 'true');
      if (prefill && prefill[f.kind]) input.value = prefill[f.kind];
      var err = el('p', 'gmmc-error');
      err.id = id + '-error';
      err.hidden = true;
      wrap.appendChild(label);
      wrap.appendChild(input);
      wrap.appendChild(err);
      // First and last name side by side.
      var next = fields[i + 1];
      if (f.kind === 'firstName' && next && next.kind === 'lastName') {
        row = el('div', 'gmmc-row');
        row.appendChild(wrap);
        form.appendChild(row);
      } else if (f.kind === 'lastName' && row) {
        row.appendChild(wrap);
        row = null;
      } else {
        form.appendChild(wrap);
      }
    });
    var formError = el('p', 'gmmc-form-error');
    formError.setAttribute('role', 'alert');
    formError.hidden = true;
    form.appendChild(formError);
    var submit = el('button', 'gmmc-submit', trim(String(fs.submitButtonText || '')) || DEFAULT_SUBMIT);
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitForm(form, fields, submit, formError);
    });
    ui.formSlot.appendChild(form);
    ui.form = form;
    updateComposer();
    scrollDown(true, true);
    log('showing the details form');
  }

  function fieldError(form, kind, message) {
    var input = form.querySelector('#gmmc-f-' + kind);
    var err = form.querySelector('#gmmc-f-' + kind + '-error');
    if (!input || !err) return;
    err.textContent = message || '';
    err.hidden = !message;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', err.id);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  function submitForm(form, fields, submit, formError) {
    var values = {};
    var bad = [];
    var cc = formSettings().defaultCountryCode;
    fields.forEach(function (f) {
      var v = trim(form.querySelector('#gmmc-f-' + f.kind).value);
      var message = '';
      if (f.required && !v) message = 'Please fill this in.';
      else if (v && f.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) message = 'Please enter a valid email.';
      else if (v && f.kind === 'phone' && !normalPhone(v, cc)) message = 'Please enter a valid phone number.';
      fieldError(form, f.kind, message);
      if (message) bad.push(f.kind);
      else if (v) values[f.kind] = v;
    });
    if (!bad.length && !values.email && !values.phone) {
      var target = fields.some(function (f) { return f.kind === 'email'; }) ? 'email' : 'phone';
      fieldError(form, target, 'Please enter your email or phone.');
      bad.push(target);
    }
    if (bad.length) {
      var first = form.querySelector('#gmmc-f-' + bad[0]);
      if (first) first.focus();
      return;
    }
    var contact = clean(values);
    formError.hidden = true;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    ensureSession().then(function () {
      return sendIdentity(contact, 'form');
    }).then(function () {
      state.contact = contact;
      rememberName(contact);
      removeForm();
      if (!state.history && !trim(String(settings.welcomeMessage || '')) && config.greeting) {
        addOpening(greetingText(config.greeting));
      }
      updateComposer();
      focusInput();
    }, function () {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      formError.textContent = 'We couldn\u2019t save your details just now. Please try again.';
      formError.hidden = false;
    });
  }

  function removeForm() {
    if (ui.form && ui.form.parentNode) ui.form.parentNode.removeChild(ui.form);
    ui.form = null;
    state.formShown = false;
  }

  // ---------- UI ----------

  var ICONS = {
    jar: '<svg viewBox="10 4 44 58" fill="currentColor" aria-hidden="true" focusable="false"><rect x="20" y="6" width="24" height="8" rx="3"/><path fill-rule="evenodd" d="M22 17H42C48 17 52 21 52 27V43C52 49 48 53 42 53H25L15 60L17 51C14 49 12 46 12 43V27C12 21 16 17 22 17ZM24 32a3 3 0 1 0 0 6a3 3 0 1 0 0-6ZM32 32a3 3 0 1 0 0 6a3 3 0 1 0 0-6ZM40 32a3 3 0 1 0 0 6a3 3 0 1 0 0-6Z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-width="2.6"/></svg>',
    headset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15.5 7.6"/></svg>'
  };

  // The corner button shows the JARchat jar; data-launcher-icon="closebot"
  // uses the icon picked in CloseBot instead.
  function launcherIcon(name) {
    if (config.launcherIcon !== 'closebot') return ICONS.jar;
    name = String(name || '').toLowerCase();
    if (/head|support|agent/.test(name)) return ICONS.headset;
    if (/help|question/.test(name)) return ICONS.help;
    if (/spark|star|bot|robot|ai/.test(name)) return ICONS.sparkle;
    if (/dots|typing|comment/.test(name)) return ICONS.dots;
    return ICONS.chat;
  }

  var CSS = [
    ':host{all:initial;display:block}',
    ':host([hidden]){display:none!important}',
    '.gmmc-root{--gmmc-accent:' + DEFAULT_COLOR + ';--gmmc-accent-ink:#2f7a58;--gmmc-on-accent:#fff;' +
      '--gmmc-header-bg:var(--gmmc-accent-ink);--gmmc-header-text:var(--gmmc-on-accent);' +
      '--gmmc-visitor-bg:var(--gmmc-accent-ink);--gmmc-visitor-text:var(--gmmc-on-accent);' +
      '--gmmc-surface:#fff;--gmmc-bg:#f6f7f9;--gmmc-text:#1f2937;--gmmc-muted:#667085;--gmmc-line:#e4e7ec;' +
      '--gmmc-field-line:#d0d5dd;--gmmc-bot-bg:#fff;--gmmc-bot-text:#1f2937;--gmmc-bot-line:#e6e8ec;' +
      '--gmmc-radius:16px;--gmmc-bubble-radius:18px;--gmmc-tail:6px;--gmmc-field-radius:10px;' +
      '--gmmc-font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;' +
      '--gmmc-font-size:15px;--gmmc-online:#22c55e;--gmmc-danger:#b42318;' +
      'box-sizing:border-box;font-family:var(--gmmc-font);font-size:var(--gmmc-font-size);line-height:1.45;' +
      'color:var(--gmmc-text);text-align:left;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}',
    '.gmmc-root *,.gmmc-root *::before,.gmmc-root *::after{box-sizing:border-box}',
    '.gmmc-root.gmmc-dark{--gmmc-surface:#111827;--gmmc-bg:#0b1220;--gmmc-text:#e5e7eb;--gmmc-muted:#9ca3af;' +
      '--gmmc-line:#1f2937;--gmmc-field-line:#374151;--gmmc-bot-bg:#1f2937;--gmmc-bot-text:#e5e7eb;--gmmc-bot-line:#273244}',
    '.gmmc-inline{height:100%}',
    // Panel
    '.gmmc-panel{display:flex;flex-direction:column;overflow:hidden;background:var(--gmmc-surface);' +
      'border-radius:var(--gmmc-radius);border:var(--gmmc-border,1px solid var(--gmmc-line));' +
      'box-shadow:var(--gmmc-shadow,0 1px 3px rgba(16,24,40,.06),0 8px 24px rgba(16,24,40,.06))}',
    '.gmmc-inline .gmmc-panel{width:100%;height:100%}',
    '.gmmc-bubble .gmmc-panel{position:fixed;z-index:2147483000;right:20px;bottom:96px;width:var(--gmmc-width,380px);' +
      'height:var(--gmmc-height,640px);max-width:calc(100vw - 40px);max-height:calc(100vh - 120px);' +
      'box-shadow:var(--gmmc-shadow,0 16px 48px rgba(16,24,40,.22),0 2px 8px rgba(16,24,40,.08));' +
      'transform-origin:bottom right;transition:opacity .18s ease,transform .18s ease}',
    '.gmmc-bubble.gmmc-left .gmmc-panel{right:auto;left:20px;transform-origin:bottom left}',
    '.gmmc-bubble:not(.gmmc-open) .gmmc-panel{opacity:0;transform:translateY(12px) scale(.98);visibility:hidden;' +
      'pointer-events:none;transition:opacity .18s ease,transform .18s ease,visibility 0s .18s}',
    // Launcher
    '.gmmc-launcher{position:fixed;z-index:2147483001;right:20px;bottom:20px;width:60px;height:60px;margin:0;padding:0;' +
      'border:0;border-radius:50%;background:var(--gmmc-accent);color:var(--gmmc-on-accent);cursor:pointer;display:flex;' +
      'align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(16,24,40,.25);-webkit-appearance:none;' +
      'appearance:none;transition:transform .15s ease,box-shadow .15s ease;animation:gmmc-pop .3s ease-out both}',
    '.gmmc-launcher:hover{transform:scale(1.05);box-shadow:0 10px 28px rgba(16,24,40,.3)}',
    '.gmmc-launcher:focus-visible{outline:3px solid var(--gmmc-accent);outline-offset:3px}',
    '.gmmc-left .gmmc-launcher{right:auto;left:20px}',
    '.gmmc-launcher .gmmc-ico{position:absolute;display:flex;transition:transform .2s ease,opacity .2s ease}',
    '.gmmc-launcher svg{width:28px;height:28px}',
    '.gmmc-launcher .gmmc-ico-open svg{width:30px;height:34px}',
    '.gmmc-launcher .gmmc-ico-close{opacity:0;transform:rotate(-60deg)}',
    '.gmmc-open .gmmc-launcher .gmmc-ico-open{opacity:0;transform:rotate(60deg)}',
    '.gmmc-open .gmmc-launcher .gmmc-ico-close{opacity:1;transform:none}',
    '.gmmc-badge{position:absolute;top:-3px;right:-3px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;' +
      'background:#d92d20;color:#fff;font-size:12px;font-weight:700;line-height:22px;text-align:center;box-shadow:0 0 0 2px #fff}',
    '.gmmc-badge[hidden]{display:none}',
    // Header
    '.gmmc-header{flex:none;display:flex;align-items:center;gap:12px;padding:14px 14px 14px 16px;' +
      'background:var(--gmmc-header-bg);color:var(--gmmc-header-text)}',
    '.gmmc-noheader .gmmc-header{display:none}',
    '.gmmc-avatar{position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:40px;height:40px;' +
      'border-radius:50%;background:rgba(255,255,255,.18);color:inherit}',
    '.gmmc-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}',
    '.gmmc-avatar svg{width:22px;height:22px}',
    '.gmmc-avatar .gmmc-dot{position:absolute;right:0;bottom:0;width:11px;height:11px;border-radius:50%;' +
      'background:var(--gmmc-online);box-shadow:0 0 0 2px var(--gmmc-header-bg)}',
    '.gmmc-heading{flex:1;min-width:0}',
    '.gmmc-title{margin:0;padding:0;font-size:1.07em;font-weight:650;line-height:1.25;color:inherit;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:normal;text-transform:none}',
    '.gmmc-status{margin:2px 0 0;padding:0;font-size:.8em;line-height:1.2;opacity:.88}',
    '.gmmc-status:empty{display:none}',
    '.gmmc-close{flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;margin:0;padding:0;' +
      'border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer}',
    '.gmmc-close svg{width:20px;height:20px}',
    '.gmmc-close:hover{background:rgba(255,255,255,.16)}',
    '.gmmc-close:focus-visible{outline:2px solid currentColor;outline-offset:1px}',
    // Banner (reconnecting)
    '.gmmc-banner{flex:none;margin:0;padding:7px 16px;font-size:.8em;background:#fffaeb;color:#93370d;border-bottom:1px solid #fedf89}',
    '.gmmc-banner[hidden]{display:none}',
    // Messages
    '.gmmc-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:16px 14px 10px;background:var(--gmmc-bg)}',
    '.gmmc-scroll:focus-visible{outline:2px solid var(--gmmc-accent);outline-offset:-2px}',
    '.gmmc-log{display:flex;flex-direction:column}',
    '.gmmc-msg{display:flex;flex-direction:column;max-width:84%;margin-top:10px;animation:gmmc-in .22s ease-out both}',
    '.gmmc-msg:first-child{margin-top:0}',
    '.gmmc-msg.gmmc-cont{margin-top:3px}',
    '.gmmc-bot{align-self:flex-start;align-items:flex-start}',
    '.gmmc-lead{align-self:flex-end;align-items:flex-end}',
    '.gmmc-who{display:flex;align-items:center;gap:6px;margin:0 0 4px 4px;font-size:.75em;font-weight:600;color:var(--gmmc-muted)}',
    '.gmmc-who img{width:18px;height:18px;border-radius:50%;object-fit:cover}',
    '.gmmc-text{margin:0;padding:9px 14px;border-radius:var(--gmmc-bubble-radius);white-space:pre-wrap;overflow-wrap:anywhere}',
    '.gmmc-bot .gmmc-text{background:var(--gmmc-bot-bg);color:var(--gmmc-bot-text);border:1px solid var(--gmmc-bot-line);' +
      'border-bottom-left-radius:var(--gmmc-tail);box-shadow:0 1px 2px rgba(16,24,40,.04)}',
    '.gmmc-lead .gmmc-text{background:var(--gmmc-visitor-bg);color:var(--gmmc-visitor-text);border-bottom-right-radius:var(--gmmc-tail)}',
    '.gmmc-text a{color:inherit;text-decoration:underline;text-underline-offset:2px}',
    '.gmmc-text strong{font-weight:650}',
    '.gmmc-meta{margin:3px 6px 0;font-size:.7em;color:var(--gmmc-muted)}',
    '.gmmc-meta:empty{display:none}',
    '.gmmc-pending .gmmc-text{opacity:.72}',
    '.gmmc-failed .gmmc-text{opacity:.55}',
    '.gmmc-failed .gmmc-meta{color:var(--gmmc-danger)}',
    '.gmmc-retry{margin:0 0 0 4px;padding:0;border:0;background:none;color:inherit;font:inherit;font-weight:600;' +
      'text-decoration:underline;cursor:pointer}',
    '.gmmc-files{display:flex;flex-direction:column;gap:6px;margin-top:6px}',
    '.gmmc-lead .gmmc-files{align-items:flex-end}',
    '.gmmc-files img{display:block;max-width:220px;max-height:220px;border-radius:12px;border:1px solid var(--gmmc-line)}',
    '.gmmc-filelink{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:12px;font-size:.88em;' +
      'background:var(--gmmc-bot-bg);border:1px solid var(--gmmc-bot-line);color:var(--gmmc-text);text-decoration:none}',
    '.gmmc-filelink svg{width:16px;height:16px;flex:none}',
    '.gmmc-filelink:hover{text-decoration:underline}',
    // Typing
    '.gmmc-typing{display:flex;align-items:center;gap:8px;margin-top:10px}',
    '.gmmc-typing[hidden]{display:none}',
    '.gmmc-dots{display:inline-flex;align-items:center;gap:4px;padding:13px 14px;background:var(--gmmc-bot-bg);' +
      'border:1px solid var(--gmmc-bot-line);border-radius:var(--gmmc-bubble-radius);border-bottom-left-radius:var(--gmmc-tail)}',
    '.gmmc-dots i{display:block;width:7px;height:7px;border-radius:50%;background:var(--gmmc-muted);animation:gmmc-dot 1.2s ease-in-out infinite both}',
    '.gmmc-dots i:nth-child(2){animation-delay:.15s}',
    '.gmmc-dots i:nth-child(3){animation-delay:.3s}',
    '.gmmc-typing-label{font-size:.75em;color:var(--gmmc-muted)}',
    // Notices (connecting, can't connect)
    '.gmmc-notice{display:flex;flex-direction:column;align-items:center;gap:10px;margin:24px 8px;text-align:center;' +
      'font-size:.88em;color:var(--gmmc-muted)}',
    '.gmmc-notice[hidden]{display:none}',
    '.gmmc-notice button{padding:8px 16px;border:1px solid var(--gmmc-field-line);border-radius:999px;background:var(--gmmc-surface);' +
      'color:var(--gmmc-text);font:inherit;font-weight:600;cursor:pointer}',
    '.gmmc-notice button:focus-visible{outline:2px solid var(--gmmc-accent);outline-offset:2px}',
    // Details form
    '.gmmc-form{margin:12px 0 4px;padding:16px;background:var(--gmmc-surface);border:1px solid var(--gmmc-line);' +
      'border-radius:var(--gmmc-bubble-radius);box-shadow:0 1px 3px rgba(16,24,40,.06);animation:gmmc-in .22s ease-out both}',
    '.gmmc-form-intro{margin:0 0 12px;padding:0;font-weight:600;line-height:1.4;color:var(--gmmc-text)}',
    '.gmmc-row{display:flex;gap:10px}',
    '.gmmc-row>.gmmc-field{flex:1;min-width:0}',
    '.gmmc-field{margin:0 0 10px}',
    '.gmmc-field label{display:block;margin:0 0 4px;font-size:.8em;font-weight:600;color:var(--gmmc-muted)}',
    '.gmmc-req{color:var(--gmmc-danger)}',
    '.gmmc-field input{display:block;width:100%;height:42px;margin:0;padding:0 12px;border:1px solid var(--gmmc-field-line);' +
      'border-radius:var(--gmmc-field-radius);background:var(--gmmc-surface);color:var(--gmmc-text);font:inherit;outline:none;' +
      '-webkit-appearance:none;appearance:none;transition:border-color .15s,box-shadow .15s}',
    '.gmmc-field input:focus{border-color:var(--gmmc-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--gmmc-accent) 22%,transparent)}',
    '.gmmc-field input[aria-invalid=true]{border-color:var(--gmmc-danger)}',
    '.gmmc-error,.gmmc-form-error{margin:4px 0 0;padding:0;font-size:.75em;color:var(--gmmc-danger)}',
    '.gmmc-error[hidden],.gmmc-form-error[hidden]{display:none}',
    '.gmmc-form-error{margin:0 0 10px}',
    '.gmmc-submit{display:block;width:100%;height:44px;margin:4px 0 0;border:0;border-radius:var(--gmmc-field-radius);' +
      'background:var(--gmmc-accent-ink);color:var(--gmmc-on-accent);font:inherit;font-weight:600;cursor:pointer;transition:filter .15s}',
    '.gmmc-submit:hover{filter:brightness(1.07)}',
    '.gmmc-submit:focus-visible{outline:3px solid var(--gmmc-accent);outline-offset:2px}',
    '.gmmc-submit[disabled]{opacity:.65;cursor:progress}',
    // Composer
    '.gmmc-composer{flex:none;display:flex;align-items:flex-end;gap:8px;margin:0;padding:10px 12px 12px;' +
      'background:var(--gmmc-surface);border-top:1px solid var(--gmmc-line)}',
    '.gmmc-input{flex:1;min-width:0;height:44px;min-height:44px;max-height:132px;margin:0;padding:11px 16px;resize:none;' +
      'border:1px solid var(--gmmc-field-line);border-radius:22px;background:var(--gmmc-surface);color:var(--gmmc-text);' +
      'font:inherit;line-height:1.4;outline:none;overflow-y:hidden;transition:border-color .15s,box-shadow .15s}',
    '.gmmc-input:focus{border-color:var(--gmmc-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--gmmc-accent) 22%,transparent)}',
    '.gmmc-input::placeholder{color:var(--gmmc-muted);opacity:1}',
    '.gmmc-input:disabled{background:var(--gmmc-bg);cursor:not-allowed}',
    '.gmmc-send{flex:none;display:flex;align-items:center;justify-content:center;width:44px;height:44px;margin:0;padding:0;' +
      'border:0;border-radius:50%;background:var(--gmmc-accent-ink);color:var(--gmmc-on-accent);cursor:pointer;' +
      'transition:transform .12s ease,opacity .12s ease}',
    '.gmmc-send svg{width:20px;height:20px;margin-left:2px}',
    '.gmmc-send:disabled{opacity:.38;cursor:default}',
    '.gmmc-send:not(:disabled):hover{transform:scale(1.06)}',
    '.gmmc-send:focus-visible{outline:3px solid var(--gmmc-accent);outline-offset:2px}',
    '.gmmc-powered{flex:none;margin:0;padding:0 0 8px;text-align:center;font-size:.7em;color:var(--gmmc-muted);background:var(--gmmc-surface)}',
    '.gmmc-powered[hidden]{display:none}',
    '.gmmc-powered a{color:inherit}',
    '.gmmc-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
    '@keyframes gmmc-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
    '@keyframes gmmc-pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}',
    '@keyframes gmmc-dot{0%,80%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',
    // Phones: the bubble's window fills the screen.
    '@media (max-width:480px){.gmmc-bubble .gmmc-panel{top:0;right:0;bottom:0;left:0;width:auto;height:auto;max-width:none;' +
      'max-height:none;border:0;border-radius:0}.gmmc-bubble.gmmc-open .gmmc-launcher{display:none}' +
      '.gmmc-input,.gmmc-field input{font-size:16px}}',
    '@media (prefers-reduced-motion:reduce){.gmmc-root *,.gmmc-root *::before,.gmmc-root *::after{animation:none!important;transition:none!important}}'
  ].join('\n');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function mountUi() {
    if (ui) return;
    var bubble = config.layout === 'bubble';
    host = document.createElement('gmmc-chat');
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    if (bubble) {
      host.hidden = true; // until CloseBot's settings arrive
    } else {
      host.style.cssText = 'display:block;width:100%;max-width:100%;height:' + config.height;
    }
    var base = el('style', null, root === host ? CSS.replace(/:host/g, 'gmmc-chat') : CSS);
    var theme = el('style');
    var wrap = el('div', 'gmmc-root gmmc-' + config.layout);
    if (config.look.position === 'left') wrap.classList.add('gmmc-left');
    if (!bubble && config.look.header === 'hide') wrap.classList.add('gmmc-noheader');
    wrap.innerHTML =
      (bubble ? '<button type="button" class="gmmc-launcher" aria-controls="gmmc-panel" aria-expanded="false" aria-label="Open chat">' +
        '<span class="gmmc-ico gmmc-ico-open">' + launcherIcon('') + '</span><span class="gmmc-ico gmmc-ico-close">' + ICONS.close + '</span>' +
        '<span class="gmmc-badge" aria-hidden="true" hidden></span></button>' : '') +
      '<section class="gmmc-panel" id="gmmc-panel" aria-labelledby="gmmc-title"' + (bubble ? ' role="dialog" aria-modal="false"' : '') + '>' +
        '<header class="gmmc-header"><div class="gmmc-avatar" aria-hidden="true"></div>' +
          '<div class="gmmc-heading"><h2 class="gmmc-title" id="gmmc-title"></h2><p class="gmmc-status"></p></div>' +
          (bubble ? '<button type="button" class="gmmc-close" aria-label="Close chat">' + ICONS.close + '</button>' : '') +
        '</header>' +
        '<p class="gmmc-banner" role="status" hidden></p>' +
        '<div class="gmmc-scroll" tabindex="0">' +
          '<div class="gmmc-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages"></div>' +
          '<div class="gmmc-notice" role="status"><span class="gmmc-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
            '<span class="gmmc-sr">Connecting to the chat</span></div>' +
          '<div class="gmmc-form-slot"></div>' +
          '<div class="gmmc-typing" role="status" hidden><span class="gmmc-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
            '<span class="gmmc-typing-label"></span></div>' +
        '</div>' +
        '<form class="gmmc-composer" novalidate>' +
          '<label class="gmmc-sr" for="gmmc-input">Message</label>' +
          '<textarea class="gmmc-input" id="gmmc-input" rows="1" autocomplete="off"></textarea>' +
          '<button type="submit" class="gmmc-send" aria-label="Send message" disabled>' + ICONS.send + '</button>' +
        '</form>' +
        '<p class="gmmc-powered" hidden>Powered by <a href="https://closebot.com" target="_blank" rel="noopener">CloseBot</a></p>' +
      '</section>';
    if (root === host) document.head.appendChild(base); else root.appendChild(base);
    if (root === host) document.head.appendChild(theme); else root.appendChild(theme);
    root.appendChild(wrap);

    var q = function (sel) { return wrap.querySelector(sel); };
    ui = {
      root: root, wrap: wrap, theme: theme,
      launcher: q('.gmmc-launcher'), badge: q('.gmmc-badge'), panel: q('.gmmc-panel'),
      avatar: q('.gmmc-avatar'), title: q('.gmmc-title'), status: q('.gmmc-status'), close: q('.gmmc-close'),
      banner: q('.gmmc-banner'), scroll: q('.gmmc-scroll'), log: q('.gmmc-log'), notice: q('.gmmc-notice'),
      formSlot: q('.gmmc-form-slot'), typing: q('.gmmc-typing'), typingLabel: q('.gmmc-typing-label'),
      composer: q('.gmmc-composer'), input: q('.gmmc-input'), send: q('.gmmc-send'), powered: q('.gmmc-powered'),
      form: null
    };
    ui.title.textContent = config.title || DEFAULT_TITLE;
    ui.input.placeholder = DEFAULT_PLACEHOLDER;
    showAvatar(config.avatar);
    if (ui.launcher) q('.gmmc-ico-open').innerHTML = ICONS.chat;
    var cached = lookColor(getItem(local(), COLOR_KEY) || '');
    applyTheme(config.look.color || cached || DEFAULT_COLOR);
    bindUi();

    if (bubble) {
      document.body.appendChild(host);
    } else {
      script.parentNode.insertBefore(host, script.nextSibling);
    }
    log('mounted the ' + config.layout + ' chat');
  }

  // A picture that doesn't load falls back to the dots.
  function showAvatar(url) {
    ui.avatar.innerHTML = ICONS.dots;
    if (!url) return;
    var img = el('img');
    img.alt = '';
    img.onerror = function () {
      var dots = el('span');
      dots.innerHTML = ICONS.dots;
      if (img.parentNode) img.parentNode.replaceChild(dots.firstChild, img);
    };
    img.src = url;
    ui.avatar.replaceChild(img, ui.avatar.firstChild);
  }

  function applyTheme(accent) {
    ui.theme.textContent = themeCss(config.look, accent);
  }

  function bindUi() {
    var interacted = function () { state.interacted = true; };
    ui.wrap.addEventListener('pointerdown', interacted);
    ui.wrap.addEventListener('keydown', interacted);
    if (ui.launcher) ui.launcher.addEventListener('click', function () { if (state.open) closePanel(); else openPanel(); });
    if (ui.close) ui.close.addEventListener('click', function () { closePanel(); });
    ui.wrap.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && state.layout === 'bubble' && state.open) {
        e.preventDefault();
        closePanel();
      }
    });
    ui.composer.addEventListener('submit', function (e) {
      e.preventDefault();
      if (ui.input.disabled) return;
      var text = ui.input.value;
      if (!trim(text)) return;
      ui.input.value = '';
      autosize();
      updateSend();
      sendMessage(text);
    });
    ui.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        if (ui.composer.requestSubmit) ui.composer.requestSubmit();
        else ui.composer.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
    ui.input.addEventListener('input', function () {
      autosize();
      updateSend();
      if (trim(ui.input.value)) typingSignal(true);
    });
  }

  function autosize() {
    var t = ui.input;
    t.style.height = 'auto';
    var want = t.scrollHeight + 2;
    t.style.height = Math.min(Math.max(want, 44), 132) + 'px';
    // A scrollbar only once the text outgrows the box, not for a line or two.
    t.style.overflowY = want > 132 ? 'auto' : 'hidden';
  }

  function updateSend() {
    ui.send.disabled = ui.input.disabled || !trim(ui.input.value);
  }

  function updateComposer() {
    if (!ui) return;
    var waiting = state.formShown;
    ui.input.disabled = waiting;
    ui.input.placeholder = waiting
      ? 'Add your details above to start chatting'
      : (trim(String(settings.messagePlaceholder || '')) || DEFAULT_PLACEHOLDER);
    updateSend();
  }

  function applySettings() {
    var s = settings;
    var title = config.title || trim(String(s.chatTitle || s.headerTitle || '')) || DEFAULT_TITLE;
    ui.title.textContent = title;
    ui.panel.setAttribute('aria-label', title);
    ui.panel.removeAttribute('aria-labelledby');
    showAvatar(config.avatar || [s.avatarUrl, s.botAvatarUrl, s.avatar, s.logoUrl, s.iconUrl].filter(function (u) {
      return typeof u === 'string' && /^https:\/\//i.test(u);
    })[0]);
    var online = s.showOnlineStatus !== false;
    if (online) ui.avatar.appendChild(el('span', 'gmmc-dot'));
    ui.status.textContent = trim(String(s.headerSubtitle || s.subtitle || '')) || (online ? 'Online' : '');
    ui.powered.hidden = s.showPoweredByClosebot !== true;
    var tm = String(s.themeMode || '').toLowerCase();
    var dark = tm === 'dark' || ((tm === 'auto' || tm === 'system') &&
      !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
    ui.wrap.classList.toggle('gmmc-dark', dark);
    if (ui.launcher) ui.launcher.querySelector('.gmmc-ico-open').innerHTML = launcherIcon(s.iconName);
    var cbColor = lookColor(String(s.primaryColor || ''));
    if (cbColor) setItem(local(), COLOR_KEY, cbColor);
    var accent = config.look.color || cbColor || DEFAULT_COLOR;
    applyTheme(accent);
    if (ctaEl && !config.look.color) ctaEl.style.setProperty('--gmmc-accent', accent);
    updateComposer();
    host.hidden = false;
  }

  function hideConnecting() { if (ui) ui.notice.hidden = true; }

  function showProblem() {
    if (!ui) return;
    ui.notice.hidden = false;
    ui.notice.innerHTML = '';
    ui.notice.appendChild(el('span', null, 'We can\u2019t reach the chat right now.'));
    var retry = el('button', null, 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', function () {
      ui.notice.innerHTML = '<span class="gmmc-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="gmmc-sr">Connecting to the chat</span>';
      if (!cb) resolveWidget(1);
      else if (!state.configLoaded) loadSettings(1);
      else ensureSession()['catch'](noop);
    });
    ui.notice.appendChild(retry);
  }

  function hideProblem() {
    if (!ui || state.error) return;
    if (state.settled) ui.notice.hidden = true;
  }

  function showBanner(text) { if (ui) { ui.banner.textContent = text; ui.banner.hidden = false; } }
  function hideBanner() { if (ui) ui.banner.hidden = true; }

  function nearBottom() {
    var s = ui.scroll;
    return s.scrollHeight - s.scrollTop - s.clientHeight < 80;
  }

  function scrollDown(force, instant) {
    var s = ui.scroll;
    if (!force && !nearBottom()) return;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (instant || reduced || !s.scrollTo) s.scrollTop = s.scrollHeight;
    else s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
  }

  // Bold, links and markdown links in plain text, built as DOM nodes.
  var TOKEN = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|(https?:\/\/[^\s<>"']+)/g;

  function link(text, url) {
    var a = el('a', null, text);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow';
    return a;
  }

  function formatInto(node, text) {
    var last = 0;
    var m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text))) {
      if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) {
        node.appendChild(link(m[1], m[2]));
      } else if (m[3]) {
        node.appendChild(el('strong', null, m[3]));
      } else {
        var trail = (/[.,;:!?)\]]+$/.exec(m[4]) || [''])[0];
        var url = m[4].slice(0, m[4].length - trail.length);
        node.appendChild(link(url, url));
        if (trail) node.appendChild(document.createTextNode(trail));
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  }

  function filesOf(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (a) {
      if (typeof a === 'string') a = { url: a };
      if (!a || typeof a !== 'object') return null;
      var url = String(a.url || a.fileUrl || a.src || a.link || '');
      if (!/^https?:\/\//i.test(url)) return null;
      var type = String(a.type || a.mimeType || a.contentType || a.mime || '');
      var name = String(a.name || a.fileName || a.filename || a.title || '');
      if (!name) { try { name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || ''); } catch (_) { /* keep it blank */ } }
      name = name || 'Attachment';
      var image = /^image(\/|$)/i.test(type) || /\.(png|jpe?g|gif|webp|avif)([?#]|$)/i.test(url);
      return { url: url, name: name, image: image };
    }).filter(Boolean);
  }

  function timeLabel(d) {
    try { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; }
  }

  function setMeta(item, text, extra) {
    var meta = item.querySelector('.gmmc-meta');
    meta.textContent = text || (config.timestamps && item._time ? timeLabel(item._time) : '');
    if (extra) meta.appendChild(extra);
  }

  var lastWho = '';

  function addMessage(sender, text, opts) {
    opts = opts || {};
    var wasNear = nearBottom();
    var item = el('div', 'gmmc-msg gmmc-' + sender);
    var prev = ui.log.lastElementChild;
    var who = sender === 'bot' && opts.who && opts.who !== lastWho ? opts.who : '';
    if (sender === 'bot' && opts.who) lastWho = opts.who;
    if (prev && prev.getAttribute('data-sender') === sender && !who) item.classList.add('gmmc-cont');
    item.setAttribute('data-sender', sender);
    if (opts.id) item.setAttribute('data-id', opts.id);
    if (opts.pending) item.classList.add('gmmc-pending');
    item._text = text;
    item._time = opts.time || null;
    if (who) {
      var label = el('div', 'gmmc-who');
      if (typeof opts.icon === 'string' && /^https:\/\//i.test(opts.icon)) {
        var icon = el('img');
        icon.alt = '';
        icon.src = opts.icon;
        label.appendChild(icon);
      }
      label.appendChild(document.createTextNode(who));
      item.appendChild(label);
    }
    var speaker = sender === 'lead' ? 'You' : (opts.who || trim(ui.title.textContent) || 'Assistant');
    if (text) {
      var bubble = el('div', 'gmmc-text');
      bubble.appendChild(el('span', 'gmmc-sr', speaker + ': '));
      formatInto(bubble, text);
      if (item._time) bubble.title = item._time.toLocaleString();
      item.appendChild(bubble);
    }
    if (opts.files && opts.files.length) {
      var box = el('div', 'gmmc-files');
      if (!text) box.appendChild(el('span', 'gmmc-sr', speaker + ' sent:'));
      opts.files.forEach(function (f) {
        if (f.image) {
          var a = link('', f.url);
          var img = el('img');
          img.src = f.url;
          img.alt = f.name;
          img.loading = 'lazy';
          img.addEventListener('load', function () { scrollDown(false, true); });
          a.appendChild(img);
          box.appendChild(a);
        } else {
          var fl = link('', f.url);
          fl.className = 'gmmc-filelink';
          fl.innerHTML = ICONS.file;
          fl.appendChild(document.createTextNode(f.name));
          box.appendChild(fl);
        }
      });
      item.appendChild(box);
    }
    item.appendChild(el('div', 'gmmc-meta'));
    setMeta(item, null);
    ui.log.appendChild(item);
    scrollDown(sender === 'lead' || wasNear, opts.history);
    return item;
  }

  var typing = { ai: false, human: '', timer: null };

  function setTyping(kind, on, name) {
    if (kind === 'ai') typing.ai = on;
    else typing.human = on ? (name || 'Someone') : '';
    clearTimeout(typing.timer);
    // Never leave the dots up if the "stopped" event goes missing.
    if (typing.ai || typing.human) {
      typing.timer = setTimeout(function () { typing.ai = false; typing.human = ''; renderTyping(); }, 45000);
    }
    renderTyping();
  }

  function renderTyping() {
    if (!ui) return;
    var show = typing.ai || !!typing.human;
    var wasNear = nearBottom();
    ui.typing.hidden = !show;
    if (typing.human) {
      ui.typingLabel.className = 'gmmc-typing-label';
      ui.typingLabel.textContent = typing.human + ' is typing\u2026';
    } else {
      ui.typingLabel.className = 'gmmc-typing-label gmmc-sr';
      ui.typingLabel.textContent = show ? 'Typing\u2026' : '';
    }
    if (show && wasNear) scrollDown(true);
  }

  var unread = 0;

  function setUnread(n) {
    unread = n;
    if (!ui || !ui.badge) return;
    ui.badge.textContent = n > 9 ? '9+' : String(n);
    ui.badge.hidden = !n;
    ui.launcher.setAttribute('aria-label', n ? 'Open chat, ' + n + ' new message' + (n === 1 ? '' : 's') : 'Open chat');
  }

  var audio = null;

  function ding() {
    if (!settings.enableMessageSound || !state.interacted) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio = audio || new AC();
      var t = audio.currentTime;
      var o = audio.createOscillator();
      var g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g);
      g.connect(audio.destination);
      o.start(t);
      o.stop(t + 0.3);
    } catch (_) { /* no sound */ }
  }

  function focusInput() {
    var target = ui.form ? ui.form.querySelector('input') : ui.input;
    if (!target || target.disabled) return;
    try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
  }

  function openPanel() {
    if (!ui) return;
    if (state.layout === 'inline') {
      try { host.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { host.scrollIntoView(); }
      setTimeout(focusInput, 350);
      return;
    }
    host.hidden = false;
    state.open = true;
    ui.wrap.classList.add('gmmc-open');
    ui.launcher.setAttribute('aria-expanded', 'true');
    setUnread(0);
    ui.launcher.setAttribute('aria-label', 'Close chat');
    // A visitor who opens the chat wants to talk: start the conversation.
    if (state.started && !sessionPromise && !state.formShown) ensureSession()['catch'](noop);
    scrollDown(true, true);
    setTimeout(focusInput, 60);
  }

  function closePanel() {
    if (!ui || state.layout !== 'bubble' || !state.open) return;
    var hadFocus = ui.root.activeElement && ui.wrap.contains(ui.root.activeElement);
    state.open = false;
    ui.wrap.classList.remove('gmmc-open');
    ui.launcher.setAttribute('aria-expanded', 'false');
    setUnread(unread);
    if (hadFocus) ui.launcher.focus();
  }

  // CloseBot's auto-open setting: only a delay trigger is understood, once
  // per browser tab, and never on phones, where the chat fills the screen.
  function autoOpen() {
    if (state.layout !== 'bubble' || getItem(store(), AUTO_OPEN_KEY)) return;
    if (window.innerWidth <= 480) return;
    var t = settings.autoOpenTriggers;
    // CloseBot sends {timeOnPage: {seconds, isEnabled, action}, exitIntent, scrollPercentage}.
    if (t && typeof t === 'object' && t.timeOnPage && typeof t.timeOnPage === 'object') {
      var top = t.timeOnPage;
      t = (top.action && top.action !== 'open') ? [] : [{ type: 'timeOnPage', seconds: top.seconds, isEnabled: top.isEnabled }];
    }
    var list = Array.isArray(t) ? t : (t && typeof t === 'object' ? (Array.isArray(t.triggers) ? t.triggers : [t]) : []);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || typeof o !== 'object' || o.enabled === false || o.isEnabled === false) continue;
      if (!/time|delay|second/i.test(String(o.type || o.trigger || o.kind || ''))) continue;
      var n = Number(o.delay != null ? o.delay : (o.seconds != null ? o.seconds : (o.delaySeconds != null ? o.delaySeconds : o.value)));
      if (!(n >= 0)) continue;
      var ms = n > 600 ? n : n * 1000;
      setTimeout(function () {
        if (state.open) return;
        setItem(store(), AUTO_OPEN_KEY, '1');
        openPanel();
      }, ms);
      return;
    }
  }

  // ---------- call to action on the page ----------

  // A card on the page that greets the visitor by name and points them at the
  // chat: above the inline chat, or where the tag is with a button that opens
  // the chat in the bubble layout. It follows the look options.
  var CTA_ID = 'gmmc-cta';
  var CTA_DEFAULTS = {
    title: 'You\u2019re all set, {first_name}!',
    inline: { text: 'Have a question while you wait? Our virtual assistant is right below and ready to chat.', button: 'Start chatting' },
    bubble: { text: 'Have a question while you wait? Our virtual assistant is ready to chat.', button: 'Chat with us' }
  };
  var CTA_ICON = ICONS.jar.replace('aria-hidden="true"', 'aria-hidden="true" width="22" height="29"');
  var CTA_ARROW = { inline: '\u2193', bubble: '\u2192' };

  function addCtaStyles() {
    if (document.getElementById('gmmc-cta-style')) return;
    var C = '.gmmc-cta';
    var style = document.createElement('style');
    style.id = 'gmmc-cta-style';
    style.textContent = [
      C + '{--gmmc-accent:' + DEFAULT_COLOR + ';--gmmc-on-accent:#fff;--gmmc-bg:#fff;--gmmc-text:#111827;--gmmc-radius:14px;' +
        '--gmmc-shadow:0 6px 24px rgba(17,24,39,.08);--gmmc-border:1px solid rgba(17,24,39,.08);' +
        'box-sizing:border-box;position:relative;overflow:hidden;display:flex;align-items:center;gap:18px;' +
        'width:100%;margin:0 0 16px;padding:22px 24px 22px 28px;background:var(--gmmc-bg);color:var(--gmmc-text);' +
        'border:var(--gmmc-border);border-radius:var(--gmmc-radius);box-shadow:var(--gmmc-shadow);' +
        'font-family:var(--gmmc-font,inherit);font-size:var(--gmmc-size,16px);line-height:1.45;text-align:left;' +
        'letter-spacing:normal;text-transform:none;animation:gmmc-cta-in .4s ease-out both}',
      C + ' *{box-sizing:border-box;font-family:inherit;letter-spacing:inherit;text-transform:none}',
      C + '::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--gmmc-accent)}',
      C + ' .gmmc-cta-icon{flex:none;display:flex;align-items:center;justify-content:center;width:52px;height:52px;' +
        'border-radius:50%;background:var(--gmmc-accent);color:var(--gmmc-on-accent);' +
        'box-shadow:0 0 0 6px color-mix(in srgb,var(--gmmc-accent) 14%,transparent)}',
      C + ' .gmmc-cta-body{flex:1;min-width:0}',
      C + ' .gmmc-cta-title{margin:0 0 4px;padding:0;font-size:1.3em;font-weight:700;line-height:1.25;color:inherit}',
      C + ' .gmmc-cta-text{margin:0;padding:0;font-size:.95em;color:inherit;opacity:.78}',
      C + ' .gmmc-cta-text p{margin:0 0 .5em}' + C + ' .gmmc-cta-text p:last-child{margin-bottom:0}',
      C + ' .gmmc-cta-text ul,' + C + ' .gmmc-cta-text ol{margin:.3em 0 .5em;padding:0 0 0 1.3em}',
      C + ' .gmmc-cta-text a{color:inherit;text-decoration:underline}',
      C + ' .gmmc-cta-text strong{font-weight:700}',
      C + '.gmmc-cta-has-video{flex-wrap:wrap}',
      C + ' .gmmc-cta-video{flex:0 0 100%;position:relative;aspect-ratio:16/9;overflow:hidden;' +
        'border-radius:calc(var(--gmmc-radius) * .6);background:#000}',
      C + ' .gmmc-cta-video iframe,' + C + ' .gmmc-cta-video video{position:absolute;top:0;left:0;width:100%;height:100%;border:0;margin:0}',
      C + ' .gmmc-cta-btn{flex:none;display:inline-flex;align-items:center;gap:8px;margin:0;padding:12px 22px;' +
        'border:0;border-radius:var(--gmmc-btn-radius,999px);background:var(--gmmc-accent);color:var(--gmmc-on-accent);' +
        'font-size:1em;font-weight:600;line-height:1.2;cursor:pointer;-webkit-appearance:none;appearance:none;' +
        'box-shadow:0 2px 8px color-mix(in srgb,var(--gmmc-accent) 35%,transparent);' +
        'position:relative;transition:transform .15s,box-shadow .15s,filter .15s,background-color .3s}',
      C + ' .gmmc-cta-btn:hover{transform:translateY(-1px);filter:brightness(1.06);' +
        'box-shadow:0 6px 18px color-mix(in srgb,var(--gmmc-accent) 40%,transparent)}',
      C + ' .gmmc-cta-btn:focus-visible{outline:2px solid var(--gmmc-accent);outline-offset:3px}',
      C + ' .gmmc-cta-arrow{display:inline-block;transition:transform .15s}',
      C + '::before,' + C + ' .gmmc-cta-icon{transition:background-color .3s}',
      C + ' .gmmc-cta-dots{display:none}',
      C + '.gmmc-cta-loading .gmmc-cta-btn{cursor:progress;transform:none;filter:none}',
      C + '.gmmc-cta-loading .gmmc-cta-label,' + C + '.gmmc-cta-loading .gmmc-cta-arrow{visibility:hidden}',
      C + '.gmmc-cta-loading .gmmc-cta-dots{display:flex;position:absolute;top:0;right:0;bottom:0;left:0;' +
        'align-items:center;justify-content:center;gap:5px}',
      C + ' .gmmc-cta-dots i{display:block;width:6px;height:6px;border-radius:50%;background:currentColor;' +
        'animation:gmmc-cta-dot 1s ease-in-out infinite both}',
      C + ' .gmmc-cta-dots i:nth-child(2){animation-delay:.15s}',
      C + ' .gmmc-cta-dots i:nth-child(3){animation-delay:.3s}',
      '@keyframes gmmc-cta-dot{0%,80%,100%{opacity:.35;transform:scale(.75)}40%{opacity:1;transform:none}}',
      C + '.gmmc-cta-out{opacity:0;transition:opacity .3s}',
      C + '.gmmc-cta-inline .gmmc-cta-btn:hover .gmmc-cta-arrow{transform:translateY(2px)}',
      C + '.gmmc-cta-bubble .gmmc-cta-btn:hover .gmmc-cta-arrow{transform:translateX(2px)}',
      '@keyframes gmmc-cta-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
      '@media (max-width:560px){' + C + '{flex-wrap:wrap;align-items:flex-start;gap:14px;padding:20px 18px 20px 22px}' +
        C + ' .gmmc-cta-icon{width:44px;height:44px}' + C + ' .gmmc-cta-body{flex-basis:calc(100% - 62px)}' +
        C + ' .gmmc-cta-btn{width:100%;justify-content:center}}',
      '@media (prefers-reduced-motion:reduce){' + C + ',' + C + ' *{animation:none!important;transition:none!important}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function ctaTitleText(template, name) {
    if (name) return template.replace(/\{\s*first_?name\s*\}/gi, name);
    // No name: "You're all set, {first_name}!" reads "You're all set!"
    return trim(template.replace(/[,\s]*\{\s*first_?name\s*\}/gi, ''));
  }

  // The card's text can carry a little formatting. It is rebuilt from a short
  // list of tags, so nothing else (scripts, styles, event handlers) gets in.
  var CTA_TAGS = { B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', U: 'u', BR: 'br', P: 'p', DIV: 'p', UL: 'ul', OL: 'ol', LI: 'li', A: 'a' };

  function fillName(text, name) {
    return text.replace(/\{\s*first_?name\s*\}/gi, name || 'there');
  }

  function copyRich(from, to, name) {
    for (var n = from.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { to.appendChild(document.createTextNode(fillName(n.nodeValue, name))); continue; }
      if (n.nodeType !== 1) continue;
      var tag = CTA_TAGS[n.nodeName];
      if (!tag) {
        if (!/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|NOSCRIPT|SVG|MATH)$/i.test(n.nodeName)) copyRich(n, to, name);
        continue;
      }
      var el = document.createElement(tag);
      if (tag === 'a') {
        var href = trim(n.getAttribute('href'));
        if (!/^(https?:|mailto:|tel:)/i.test(href)) { copyRich(n, to, name); continue; }
        el.href = href;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      }
      copyRich(n, el, name);
      to.appendChild(el);
    }
  }

  function setCtaText(box, html, name) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var t = document.createElement('template');
    t.innerHTML = String(html || '');
    copyRich(t.content, box, name);
    box.style.display = trim(box.textContent) ? '' : 'none';
  }

  // A video link becomes a player: YouTube, Vimeo, Loom, Wistia, or a direct
  // video file. Anything else is skipped.
  function ctaVideoSrc(url) {
    var u;
    try { u = new URL(trim(url)); } catch (_) { return null; }
    if (u.protocol !== 'https:') return null;
    var host = u.hostname.replace(/^(www\.|m\.)/, '');
    var path = u.pathname;
    var m;
    if (host === 'youtu.be') m = path.match(/^\/([\w-]{6,})/);
    else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
      m = path === '/watch' ? [0, u.searchParams.get('v')] : path.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/);
    }
    if (m && m[1] && /^[\w-]{6,}$/.test(m[1])) return { frame: 'https://www.youtube-nocookie.com/embed/' + m[1] + '?rel=0' };
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      m = path.match(/(?:^|\/)(\d{5,})(?:\/([\da-f]{6,}))?/);
      if (m) {
        var h = m[2] || u.searchParams.get('h');
        return { frame: 'https://player.vimeo.com/video/' + m[1] + (h && /^[\da-f]+$/.test(h) ? '?h=' + h : '') };
      }
    }
    if (host === 'loom.com') {
      m = path.match(/^\/(?:share|embed)\/([\da-f]{16,})/);
      if (m) return { frame: 'https://www.loom.com/embed/' + m[1] };
    }
    if (/(^|\.)wistia\.(com|net)$/.test(host)) {
      m = path.match(/\/(?:medias|iframe)\/(\w{6,})/);
      if (m) return { frame: 'https://fast.wistia.net/embed/iframe/' + m[1] };
    }
    if (/\.(mp4|webm|mov|m4v)$/i.test(path)) return { file: u.href };
    return null;
  }

  function ctaVideo(url) {
    var src = ctaVideoSrc(url);
    if (!src) { log('data-cta-video isn\u2019t a video link we can play: ' + url); return null; }
    var box = document.createElement('div');
    box.className = 'gmmc-cta-video';
    var v;
    if (src.frame) {
      v = document.createElement('iframe');
      v.src = src.frame;
      v.title = 'Video';
      v.setAttribute('loading', 'lazy');
      v.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
      v.setAttribute('allowfullscreen', '');
      v.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    } else {
      v = document.createElement('video');
      v.src = src.file;
      v.controls = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('preload', 'metadata');
    }
    box.appendChild(v);
    return box;
  }

  function styleCta(el, l, accent) {
    var set = function (prop, v) { if (v) el.style.setProperty(prop, v); };
    set('--gmmc-accent', l.color || accent);
    set('--gmmc-on-accent', l.visitorText || l.headerText || inkOn(l.color || accent).fg);
    set('--gmmc-bg', l.background);
    set('--gmmc-text', l.textColor);
    set('--gmmc-font', l.font);
    set('--gmmc-size', l.fontSize);
    if (l.radius) {
      set('--gmmc-radius', l.radius);
      var n = parseFloat(l.radius);
      set('--gmmc-btn-radius', /px$/.test(l.radius) ? Math.min(n, 999) + 'px' : l.radius);
    }
    if (l.shadow) set('--gmmc-shadow', SHADOWS[l.shadow]);
    if (l.border === 'off') set('--gmmc-border', '0 solid transparent');
    if (l.border === 'on') set('--gmmc-border', '1px solid #e5e7eb');
  }

  function buildCta(layout, texts, look, name, accent) {
    addCtaStyles();
    var d = CTA_DEFAULTS[layout];
    var card = document.createElement('div');
    card.className = 'gmmc-cta gmmc-cta-' + layout;
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'Chat with us');
    card.innerHTML = '<div class="gmmc-cta-icon">' + CTA_ICON + '</div>' +
      '<div class="gmmc-cta-body"><p class="gmmc-cta-title"></p><div class="gmmc-cta-text"></div></div>' +
      '<button type="button" class="gmmc-cta-btn"><span class="gmmc-cta-label"></span>' +
      '<span class="gmmc-cta-arrow" aria-hidden="true">' + CTA_ARROW[layout] + '</span>' +
      '<span class="gmmc-cta-dots" aria-hidden="true"><i></i><i></i><i></i></span></button>';
    var title = texts.title === null || texts.title === undefined ? CTA_DEFAULTS.title : texts.title;
    card.querySelector('.gmmc-cta-title').textContent = ctaTitleText(title, name);
    setCtaText(card.querySelector('.gmmc-cta-text'), texts.text === null || texts.text === undefined ? d.text : texts.text, name);
    card.querySelector('.gmmc-cta-label').textContent = trim(texts.button) || d.button;
    if (!trim(card.querySelector('.gmmc-cta-title').textContent)) card.querySelector('.gmmc-cta-title').style.display = 'none';
    var video = trim(texts.video) ? ctaVideo(texts.video) : null;
    if (video) { card.insertBefore(video, card.firstChild); card.classList.add('gmmc-cta-has-video'); }
    styleCta(card, look, accent);
    return card;
  }

  var ctaEl = null;
  var ctaIsReady = false;

  function ctaPlace(layout) {
    if (config.ctaTarget) {
      var target = null;
      try { target = document.querySelector(config.ctaTarget); } catch (_) { /* bad selector */ }
      if (target) return function (card) { target.appendChild(card); };
      log('data-cta-target matched nothing; using the default spot');
    }
    if (layout === 'inline' && host && host.parentNode) return function (card) { host.parentNode.insertBefore(card, host); };
    if (!inBody()) return null;
    return function (card) { script.parentNode.insertBefore(card, script.nextSibling); };
  }

  // The card goes in as soon as the page is ready, its button loading until
  // the chat has its settings; if the chat never gets them, it goes away.
  function showCta() {
    if (!config.source || !config.cta || ctaEl || document.getElementById(CTA_ID)) return;
    var layout = config.layout;
    var put = ctaPlace(layout);
    if (!put) { log('no spot for the call to action on the page'); return; }
    var cached = lookColor(getItem(local(), COLOR_KEY) || '');
    ctaEl = buildCta(layout, { title: config.ctaTitle, text: config.ctaText, button: config.ctaButton, video: config.ctaVideo },
      config.look, greetingName, lookColor(String(settings.primaryColor || '')) || cached || DEFAULT_COLOR);
    ctaEl.id = CTA_ID;
    var btn = ctaEl.querySelector('.gmmc-cta-btn');
    btn.addEventListener('click', function () { if (ctaIsReady) openPanel(); });
    put(ctaEl);
    if (state.started) { ctaReady(); return; }
    ctaEl.classList.add('gmmc-cta-loading');
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-busy', 'true');
    setTimeout(function () {
      if (ctaIsReady || !ctaEl) return;
      log('the chat did not load; removing the call to action');
      var card = ctaEl;
      ctaEl = null;
      card.classList.add('gmmc-cta-out');
      setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 300);
    }, config.ctaWaitMs);
  }

  function ctaReady() {
    ctaIsReady = true;
    if (!ctaEl) return;
    ctaEl.classList.remove('gmmc-cta-loading');
    var btn = ctaEl.querySelector('.gmmc-cta-btn');
    btn.removeAttribute('aria-disabled');
    btn.removeAttribute('aria-busy');
  }

  // The name can arrive after the card (backend lookup, details form).
  function updateCtaName() {
    if (!ctaEl) return;
    var title = config.ctaTitle === null ? CTA_DEFAULTS.title : config.ctaTitle;
    ctaEl.querySelector('.gmmc-cta-title').textContent = ctaTitleText(title, greetingName);
    var text = config.ctaText === null ? CTA_DEFAULTS[ctaEl.classList.contains('gmmc-cta-bubble') ? 'bubble' : 'inline'].text : config.ctaText;
    setCtaText(ctaEl.querySelector('.gmmc-cta-text'), text, greetingName);
  }

  // ---------- boot ----------

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // CloseBot's widget settings, tried twice. Without them the source ID is
  // wrong or CloseBot is down: the bubble stays hidden, the call to action
  // goes away, and the inline chat says so with a button to try again.
  function loadSettings(attempt) {
    cb.config().then(function (r) {
      settings = settingsOf(r);
      state.configLoaded = true;
      state.error = '';
      maybeStart();
    }, function () {
      if (attempt < 1) { setTimeout(function () { loadSettings(attempt + 1); }, 1500); return; }
      log('could not load CloseBot\u2019s widget settings');
      state.error = 'config';
      onReady(function () { mountUi(); hideConnecting(); showProblem(); });
    });
  }

  // Which of the source's chat widgets is for this page. The address is read
  // after the visitor's details were taken out of it.
  function resolveWidget(attempt) {
    var lookup = config.widgetKey ? Promise.resolve(config.widgetKey)
      : widgetFor(config.closebotApi, config.source, location.href.split('#')[0]);
    lookup.then(function (key) {
      if (!key) {
        log('no CloseBot chat widget targets this page; check the widget\u2019s page targeting in CloseBot');
        state.error = 'no-widget';
        noWidget();
        return;
      }
      cb = closebot(config.closebotApi, key);
      loadSettings(0);
    }, function () {
      if (attempt < 1) { setTimeout(function () { resolveWidget(attempt + 1); }, 1500); return; }
      log('could not reach CloseBot');
      state.error = 'config';
      onReady(function () { mountUi(); hideConnecting(); showProblem(); });
    });
  }

  // No chat for this page: nothing shows, and the inline box takes no space.
  function noWidget() {
    onReady(function () {
      if (host && host.parentNode) host.parentNode.removeChild(host);
      if (ctaEl && ctaEl.parentNode) ctaEl.parentNode.removeChild(ctaEl);
      ctaEl = null;
    });
  }

  // Both the settings and the visitor are known: show the chat.
  function maybeStart() {
    if (!state.configLoaded || !state.resolved || !ui || state.started) return;
    state.started = true;
    applySettings();
    var stored = storedSessionFor(state.contact);
    // Talk to CloseBot right away inline, for a known visitor, or to pick up
    // an earlier conversation; otherwise wait until the bubble is opened.
    var eager = config.layout === 'inline' || !!state.contact || !!stored;
    if (!stored) { state.historyDone = true; settleOpening(); }
    if (eager) ensureSession()['catch'](noop);
    ctaReady();
    autoOpen();
  }

  var urlResult = takeUrlContact();
  captureFromPageForms();
  captureFromHighLevelEmbeds();
  tagFormsWithCode();

  var api = {
    version: VERSION,
    open: function () { openPanel(); },
    close: function () { closePanel(); },
    // A snapshot for tests and debugging; it holds no contact details.
    state: function () {
      return {
        layout: state.layout,
        configLoaded: state.configLoaded,
        started: state.started,
        sessionId: state.sessionId,
        resumed: state.resumed,
        connected: state.connected,
        reconnects: state.reconnects,
        identified: isIdentified(),
        contactSource: state.contactSource,
        formShown: state.formShown,
        open: state.layout === 'inline' ? true : state.open,
        typing: typing.ai || !!typing.human,
        noteAdded: state.noteAdded,
        error: state.error,
        messages: ui ? Array.prototype.map.call(ui.log.querySelectorAll('.gmmc-msg'), function (m) {
          return { sender: m.getAttribute('data-sender'), text: m._text };
        }) : []
      };
    }
  };
  window.GMMChatWidget = api;

  if (!config.source) {
    log('no data-source: remembering form details only');
    return;
  }

  // The inline chat goes in right away, so the page keeps its place for it.
  if (config.layout === 'inline') mountUi();
  resolveWidget(0);
  watchStream();

  onReady(function () {
    mountUi();
    rememberName(null);
    setTimeout(showCta, 0);
    resolveContact(urlResult, function (contact, source) {
      state.contact = contact;
      state.contactSource = source;
      rememberName(contact);
      var extra = {};
      [(contact && contact.extra) || {}, urlResult.extra].forEach(function (o) {
        Object.keys(o).forEach(function (k) { extra[k] = o[k]; });
      });
      state.extra = extra;
      if (config.note) {
        noteText = getItem(store(), NOTE_KEY) || '';
        setNote(extra);
      }
      log(contact ? 'contact found via ' + source : 'no contact found; the chat asks for details');
      state.resolved = true;
      maybeStart();
    });
  });
})(window, document);
