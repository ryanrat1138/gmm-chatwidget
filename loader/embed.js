/*!
 * JARchat embed v0.8.0 (embed.js)
 *
 * One tag that adds the CloseBot AI chat to a page and, on a thank-you page,
 * fills CloseBot's lead form with the name, email and phone the visitor just
 * submitted, so the chat lands on their existing HighLevel contact without
 * asking them to type it again.
 *
 * Thank-you page: the tag below, with data-source, shows the chat. Put it as
 * high on the page as the builder allows, ahead of analytics, so contact
 * details in the URL are removed before CloseBot or anything else reads them.
 *
 * Form page (only when the form is on the same site): the bare tag, with no
 * data-source, saves what the visitor submits and shows no chat.
 *
 *   <script src="https://gmm-chatwidget.vercel.app/embed.js"></script>
 *
 * Thank-you page:
 *
 *   <script src="https://gmm-chatwidget.vercel.app/embed.js"
 *     data-source="CLOSEBOT_SOURCE_ID"
 *     data-layout="inline"                  (inline = chat shows where the tag is;
 *                                            bubble = chat button bottom-right)
 *     data-height="600px"                   (inline only)
 *     data-fields="business_info"           (extra details from the form, passed
 *                                            to the AI with the visitor's first
 *                                            chat message; data-note="off" for
 *                                            not; data-save-fields="true" also
 *                                            saves them on the HighLevel contact)
 *     data-greeting="Hey {first_name}, what can I help you with today?"
 *                                           (first message once the visitor is
 *                                            identified; "off" for none)
 *     data-email="{{contact.email}}"        (optional, HighLevel-hosted pages)
 *     data-phone="{{contact.phone}}"
 *     data-first-name="{{contact.first_name}}"
 *     data-last-name="{{contact.last_name}}"></script>
 *
 * Look (all optional; leave one out to keep CloseBot's own setting):
 *   data-color="#1d4ed8"        brand color: header, visitor bubbles, button
 *   data-font="site"            "site" for the page's font, or a font name
 *   data-font-size="15px"       message and input text size
 *   data-radius="16px"          corner roundness of the chat and bubbles
 *   data-background="#ffffff"   chat area background
 *   data-text-color="#111827"   chat text
 *   data-bot-bubble / data-bot-text          bot message colors
 *   data-visitor-bubble / data-visitor-text  visitor message colors
 *   data-header-text="#ffffff"  header title color
 *   data-header="hide"          no header (inline layout only)
 *   data-shadow="none|soft|strong"  data-border="on|off"
 *   data-position="left"        corner button on the left (bubble layout)
 *   data-width="400px"          chat window width (bubble layout, desktop)
 *   data-height on the bubble layout sets the chat window height (desktop).
 *
 * Call to action (data-cta="off" for none). It greets the visitor by name
 * above the inline chat, or, in the bubble layout, sits where the tag is with
 * a button that opens the chat. It shows as soon as the page is ready, its
 * button loading until the chat is (data-cta-wait ms, default 20000, before
 * it gives up). It uses the look options above, and CloseBot's color when
 * data-color isn't set.
 *   data-cta-title="You're all set, {first_name}!"
 *   data-cta-text="Have a question while you wait? ..."   (empty for none)
 *     It can use <strong>, <em>, <u>, <a href>, <ul>/<ol>/<li>, <p> and <br>,
 *     and {first_name}; anything else is dropped.
 *   data-cta-video="https://youtu.be/..."   a video at the top of the card: YouTube,
 *     Vimeo, Loom, Wistia, or a direct .mp4/.webm link
 *   data-cta-button="Chat with us"
 *   data-cta-target="#chat-cta"  put it inside this element instead
 *
 * Without data-source it never adds a chat: it saves form details, and on a
 * page that loads CloseBot's own script it still fills the form.
 * Advanced: data-api, data-backend, data-autosubmit, data-form-timeout,
 * data-hl-origins, data-closebot-src, data-debug.
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

  if (window.GMMChat) return; // tag pasted twice

  var VERSION = '0.8.0';
  var STORE_KEY = 'gmmcw_contact';
  var NAME_KEY = 'gmmcw_first_name';
  var DEFAULT_GREETING = 'Hey {first_name}, what can I help you with today?';
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
  var CLOSEBOT_SRC = 'https://api.closebot.com/scripts/cb.js';
  var CONTAINER_ID = 'cb-widget-container';
  var HL_ORIGIN_RE = /(^|\.)(leadconnectorhq\.com|msgsndr\.com|gohighlevel\.com)$/i;

  var script = document.currentScript || (function () {
    // Loaded late (a WordPress or Cloudflare script optimizer): find our own tag.
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) if (/\/embed\.js([?#]|$)/.test(all[i].src)) return all[i];
    return all[all.length - 1];
  })();

  function scriptOrigin() {
    try { return new URL(script.src).origin; } catch (_) { return ''; }
  }

  function attr(name) {
    return script ? script.getAttribute('data-' + name) : null;
  }

  var config = {
    source: trim(attr('source')),
    fields: (attr('fields') || '').split(',').map(trim).filter(function (k) { return /^[A-Za-z0-9_]+$/.test(k); }),
    api: (attr('api') || scriptOrigin()).replace(/\/+$/, ''),
    layout: attr('layout') === 'bubble' ? 'bubble' : 'inline',
    height: attr('height') || '600px',
    look: parseLook(attr),
    greeting: greetingSetting(attr('greeting')),
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
    closebotSrc: attr('closebot-src') || CLOSEBOT_SRC,
    backend: (attr('backend') || '').replace(/\/+$/, ''),
    autosubmit: attr('autosubmit') !== 'false',
    debug: attr('debug') === 'true',
    formTimeoutMs: parseInt(attr('form-timeout') || '600000', 10),
    ctaWaitMs: parseInt(attr('cta-wait') || '20000', 10),
    hlOrigins: (attr('hl-origins') || '').split(',').map(trim).filter(Boolean)
  };

  function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }

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

  // CSS that restyles CloseBot's chat. CloseBot sets some of its look inline
  // (brand color, button color), so every rule is !important. Selectors come
  // from cb.js as inspected on 2026-10-19 and may change with a release, in
  // which case the chat simply keeps CloseBot's own look.
  function lookCss(l) {
    var P = '[data-cb].cb-panel';
    var out = [];
    var add = function (sel, decl) { out.push(sel + '{' + decl + '}'); };
    var imp = function (prop, v) { return prop + ':' + v + '!important;'; };
    if (l.color) {
      add(P, imp('--cb-color', l.color));
      add('.cb-btn', imp('background', l.color));
    }
    if (l.background) add(P, imp('--cb-bg', l.background));
    if (l.textColor) add(P, imp('--cb-text', l.textColor));
    if (l.font) {
      add(P, imp('font-family', l.font));
      add(P + ' *', imp('font-family', 'inherit'));
    }
    if (l.fontSize) add(P + ' .cb-messages,' + P + ' .cb-input', imp('font-size', l.fontSize));
    if (l.radius) {
      var n = parseFloat(l.radius);
      var unit = l.radius.replace(/^[\d.]+/, '');
      var bubble = unit === 'px' ? Math.min(n, 20) + 'px' : l.radius;
      var tail = unit === 'px' ? Math.min(n, 4) + 'px' : '4px';
      add(P, imp('border-radius', l.radius));
      add(P + ' .cb-msg', imp('border-radius', bubble));
      add(P + ' .cb-msg.bot', imp('border-bottom-left-radius', tail));
      add(P + ' .cb-msg.lead', imp('border-bottom-right-radius', tail));
      add(P + ' .cb-input,' + P + ' .cb-send,' + P + ' .cb-form-input,' + P + ' .cb-form-submit', imp('border-radius', bubble));
    }
    if (l.botBubble) add(P + ' .cb-msg.bot', imp('background', l.botBubble));
    if (l.botText) add(P + ' .cb-msg.bot', imp('color', l.botText));
    if (l.visitorBubble) add(P + ' .cb-msg.lead', imp('background', l.visitorBubble));
    if (l.visitorText) add(P + ' .cb-msg.lead', imp('color', l.visitorText));
    if (l.headerText) add(P + ' .cb-header', imp('color', l.headerText));
    // The header holds the close button, so it only goes in the inline layout.
    if (l.header === 'hide') add(P + '.cb-container-mode .cb-header', imp('display', 'none'));
    if (l.shadow) {
      var shadows = { none: 'none', soft: '0 4px 16px rgba(0,0,0,.10)', strong: '0 12px 40px rgba(0,0,0,.28)' };
      add(P, imp('box-shadow', shadows[l.shadow]));
    }
    if (l.border === 'on') add(P, imp('border', '1px solid var(--cb-border, #e5e7eb)'));
    if (l.border === 'off') add(P, imp('border', 'none'));
    if (l.position === 'left') {
      add('.cb-btn', imp('left', '20px') + imp('right', 'auto'));
      add(P + ':not(.cb-container-mode)', imp('left', '20px') + imp('right', 'auto'));
    }
    // Window size on desktop only; CloseBot's own phone layout stays.
    var size = '';
    if (l.width) size += imp('width', l.width);
    if (l.windowHeight) size += imp('height', l.windowHeight);
    if (size) out.push('@media (min-width:481px){' + P + ':not(.cb-container-mode){' + size + '}}');
    return out.join('\n');
  }

  function applyLook() {
    var css = lookCss(config.look);
    if (!css || document.getElementById('gmmcw-look')) return;
    var style = document.createElement('style');
    style.id = 'gmmcw-look';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    log('applied look');
  }

  // CloseBot's chat names the agent persona that answered (with its picture)
  // in the header next to the title, and has a slot for a picture by each
  // message. Neither shows: the header keeps just CloseBot's chat title.
  // Class names from cb.js as inspected on 2026-10-22.
  function hidePersona() {
    if (document.getElementById('gmmcw-persona')) return;
    var style = document.createElement('style');
    style.id = 'gmmcw-persona';
    style.textContent = '[data-cb] .cb-header-chatter,[data-cb] .cb-msg-avatar{display:none!important}';
    (document.head || document.documentElement).appendChild(style);
  }

  // CloseBot's corner button shows the JARchat jar instead of CloseBot's icon
  // (data-launcher-icon="closebot" keeps CloseBot's). CloseBot rebuilds the
  // button's icon, so this is CSS: its icon is hidden and the jar drawn in white.
  var JAR_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='10 4 44 58'%3E%3Crect x='20' y='6' width='24' height='8' rx='3'/%3E%3Cpath fill-rule='evenodd' d='M22 17H42C48 17 52 21 52 27V43C52 49 48 53 42 53H25L15 60L17 51C14 49 12 46 12 43V27C12 21 16 17 22 17ZM24 32a3 3 0 1 0 0 6a3 3 0 1 0 0-6ZM32 32a3 3 0 1 0 0 6a3 3 0 1 0 0-6ZM40 32a3 3 0 1 0 0 6a3 3 0 1 0 0-6Z'/%3E%3C/svg%3E\")";

  function applyLauncherIcon() {
    if (config.launcherIcon === 'closebot' || document.getElementById('gmmcw-launcher')) return;
    var B = '[data-cb].cb-btn';
    var style = document.createElement('style');
    style.id = 'gmmcw-launcher';
    style.textContent = B + '>svg{display:none!important}' +
      B + '::before{content:"";display:block;width:28px;height:36px;background:#fff;' +
      '-webkit-mask:' + JAR_MASK + ' center/contain no-repeat;mask:' + JAR_MASK + ' center/contain no-repeat}';
    (document.head || document.documentElement).appendChild(style);
  }

  function greetingSetting(v) {
    if (v === null) return DEFAULT_GREETING;
    v = trim(v);
    return v.toLowerCase() === 'off' ? '' : v;
  }

  function log() {
    if (!config.debug || !window.console) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[jarchat embed]');
    window.console.log.apply(window.console, args);
  }

  // ---------- storage ----------

  function store() {
    try { return window.sessionStorage; } catch (_) { return null; }
  }

  function saveContact(contact, source, extra) {
    var s = store();
    if (!s || !hasIdentity(contact)) return;
    var record = clean(contact);
    if (extra && Object.keys(extra).length) record.extra = extra;
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

  function isWidgetElement(el) {
    return !!(el && el.closest && el.closest('.cb-panel, .cb-form-card'));
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
    var code = urlResult.code || (store() && store().getItem(CODE_KEY));
    fetchBackendContact(code, function (c) { done(c, c ? 'backend' : 'none'); });
  }

  // With data-save-fields="true", extra details (data-fields) also go to the
  // service next to this script, which writes them to the HighLevel contact.
  function sendExtraFields(contact, extra) {
    if (!config.saveFields || !config.fields.length || !config.api || !window.fetch) return;
    if (!Object.keys(extra).length) { log('no extra fields to send'); return; }
    window.fetch(config.api + '/api/fields', {
      method: 'POST',
      // text/plain keeps this a simple request, so there is no CORS preflight.
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ email: contact.email || '', phone: contact.phone || '', fields: extra }),
      credentials: 'omit',
      keepalive: true
    }).then(function (res) {
      api.fieldsSent = res.ok;
      log(res.ok ? 'sent extra fields: ' + Object.keys(extra).join(', ') : 'extra fields not saved (' + res.status + ')');
    })['catch'](function () { api.fieldsSent = false; log('extra fields not sent'); });
  }

  // ---------- form answers note for the AI ----------

  // The data-fields answers ride along with the visitor's first chat message,
  // after a marker, so CloseBot's AI has them for its first reply even while
  // HighLevel is still filling in the contact. The visitor's bubble shows only
  // what they typed, and the note is cut from the conversation when CloseBot
  // shows it again on a return visit. HighLevel's conversation keeps it.
  var NOTE_KEY = 'gmmcw_note';
  var NOTE_MARK = '[Form answers, for reference:';
  var MESSAGE_URL = /\/chat-widget\/[^\/?#]+\/session\/[^\/?#]+\/message(\?|$)/;
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
    var s = store();
    if (s) { try { s.setItem(NOTE_KEY, noteText); } catch (_) { /* ignore */ } }
    log('form answers will go with the first chat message:', Object.keys(extra).join(', '));
  }

  function forgetNote() {
    noteText = '';
    var s = store();
    if (s) { try { s.removeItem(NOTE_KEY); } catch (_) { /* ignore */ } }
  }

  // CloseBot posts each visitor message with fetch, so the note is added to
  // the request on its way out, once.
  function addNoteToFirstMessage() {
    if (!config.source || !config.note || !window.fetch) return;
    var s = store();
    if (s) { try { noteText = s.getItem(NOTE_KEY) || ''; } catch (_) { /* ignore */ } }
    var original = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (noteText && init && typeof init.body === 'string' && MESSAGE_URL.test(url) &&
          String(init.method || '').toUpperCase() === 'POST') {
        var body = null;
        try { body = JSON.parse(init.body); } catch (_) { /* not JSON: leave it */ }
        if (body && typeof body.message === 'string' && body.message.indexOf(NOTE_MARK) === -1) {
          var note = noteText;
          var changed = {};
          for (var k in init) changed[k] = init[k];
          body.message += note;
          changed.body = JSON.stringify(body);
          noteText = '';
          return original.call(window, input, changed).then(function (res) {
            if (res.ok) { forgetNote(); log('form answers sent with the first message'); } else noteText = note;
            return res;
          }, function (err) { noteText = note; throw err; });
        }
      }
      return original.apply(window, arguments);
    };
  }

  // When the service next to this script has a CloseBot API key, the answers
  // go on the visitor's CloseBot conversation as a note only the AI sees, and
  // the first message stays as typed. Without a key, or when CloseBot has no
  // conversation for the visitor yet, the first message carries them as above.
  var NOTE_SENT_KEY = 'gmmcw_note_sent';

  function noteRequest(contact, extra) {
    var r = { email: contact.email || '', phone: contact.phone || '', answers: extra };
    if (config.noteKey) r.key = config.noteKey; // the customer's own sealed CloseBot key
    return r;
  }

  function sendAiNote(contact, extra) {
    if (!config.note || !config.api || !window.fetch || !hasIdentity(contact)) return;
    if (!Object.keys(extra).length) return;
    var s = store();
    try { if (s && s.getItem(NOTE_SENT_KEY)) { forgetNote(); return; } } catch (_) { /* ignore */ }
    window.fetch(config.api + '/api/note', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(noteRequest(contact, extra)),
      credentials: 'omit'
    }).then(function (res) {
      return res.json()['catch'](function () { return {}; });
    }).then(function (r) {
      api.noteAdded = !!(r && r.added);
      if (api.noteAdded) {
        forgetNote();
        try { if (s) s.setItem(NOTE_SENT_KEY, '1'); } catch (_) { /* ignore */ }
        log('form answers added to the conversation as an AI note');
      } else {
        log('AI note not added (' + ((r && r.reason) || 'error') + '); answers go with the first message');
      }
    })['catch'](function () { api.noteAdded = false; log('AI note not sent; answers go with the first message'); });
  }

  // Cut the note out of a visitor message CloseBot shows again from history.
  function hideNote(item) {
    if (item.textContent.indexOf(NOTE_MARK) === -1) return;
    var walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, null, false);
    var node, cut = false, after = [];
    while ((node = walker.nextNode())) {
      if (cut) { after.push(node); continue; }
      var at = node.data.indexOf(NOTE_MARK);
      if (at !== -1) { node.data = node.data.slice(0, at).replace(/\s+$/, ''); cut = true; }
    }
    after.forEach(function (n) { n.data = ''; });
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

  // While the embed sends the form for the visitor, CloseBot's form intro,
  // the typing dots before the fields, the fields and the "Thanks, got it!"
  // card stay hidden, so the chat opens as a normal conversation. If CloseBot
  // rejects the details, the form is shown again for the visitor to fix.
  var QUIET = 'gmmcw-quiet';
  var QUIET_TYPING = 'gmmcw-quiet-typing';
  var HIDDEN = 'gmmcw-hidden';
  var THINKING = 'gmmcw-thinking';
  var FORM_ECHO = 'Thanks, got it!';

  // CloseBot saves its "Thanks, got it!" note in the conversation, so it comes
  // back as a bot message when the visitor returns to the page. Hide that too.
  function isFormEcho(item) {
    if (item.classList.contains(HIDDEN)) return true;
    if (!item.classList.contains('bot') || trim(item.textContent) !== FORM_ECHO) return false;
    item.classList.add(HIDDEN);
    return true;
  }

  function hideFormEchoes() {
    var scan = function () {
      var items = document.querySelectorAll('.cb-messages .cb-msg-item.bot');
      for (var i = 0; i < items.length; i++) isFormEcho(items[i]);
      var mine = document.querySelectorAll('.cb-messages .cb-msg-item.lead');
      for (var j = 0; j < mine.length; j++) hideNote(mine[j]);
    };
    addQuietStyles();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    scan();
  }

  function addQuietStyles() {
    if (document.getElementById('gmmcw-style')) return;
    var style = document.createElement('style');
    style.id = 'gmmcw-style';
    style.textContent =
      'html.' + QUIET + ' .cb-form-text-item,html.' + QUIET + ' .cb-form-row,' +
      'html.' + QUIET_TYPING + ' .cb-typing-indicator:not(.' + THINKING + '),' +
      'html.' + QUIET_TYPING + ' .cb-form-notice,.' + HIDDEN + '{display:none!important}';
    (document.head || document.documentElement).appendChild(style);
  }

  function setQuiet(on, typingToo) {
    var cl = document.documentElement.classList;
    if (on) { addQuietStyles(); cl.add(QUIET); } else cl.remove(QUIET);
    if (on && typingToo) cl.add(QUIET_TYPING); else cl.remove(QUIET_TYPING);
    showThinking(on && typingToo);
  }

  // While the details are being sent, the chat shows CloseBot's own typing
  // dots, kept below anything else in the chat, instead of an empty panel.
  var thinkingObserver = null;

  function showThinking(on) {
    var dots = document.querySelector('.' + THINKING);
    if (!on) {
      if (thinkingObserver) { thinkingObserver.disconnect(); thinkingObserver = null; }
      if (dots && dots.parentNode) dots.parentNode.removeChild(dots);
      return;
    }
    if (thinkingObserver) return;
    var place = function () {
      var list = document.querySelector('.cb-messages');
      // Only once CloseBot has started its form: a visitor it already knows
      // never gets one, and the chat must not sit on dots forever.
      if (!list || !list.querySelector('.cb-form-text-item, .cb-form-row, .cb-form-card')) return;
      var el = list.querySelector('.' + THINKING);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cb-typing-indicator ' + THINKING;
        el.innerHTML = '<div class="cb-typing-dots"><span></span><span></span><span></span></div>';
      }
      if (list.lastElementChild !== el) list.appendChild(el);
    };
    thinkingObserver = new MutationObserver(place);
    thinkingObserver.observe(document.documentElement, { childList: true, subtree: true });
    place();
  }

  function watchSubmitResult(card) {
    var done = false;
    var finish = function (ok) {
      if (done) return;
      done = true;
      obs.disconnect();
      clearTimeout(timer);
      setQuiet(ok, false);
      if (ok) formJustSent = true;
      log(ok ? 'CloseBot accepted the details' : 'CloseBot did not accept the details; showing the form');
    };
    var check = function () {
      if (card.querySelector('.cb-form-submitted')) return finish(true);
      var err = card.querySelector('.cb-form-error');
      if (err && !err.classList.contains('hidden') && err.textContent) finish(false);
    };
    var obs = new MutationObserver(check);
    obs.observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    // No answer either way (say CloseBot refused a field without showing an
    // error): show the form rather than leave the visitor with a hidden one.
    var timer = setTimeout(function () { finish(false); }, 15000);
    check();
  }

  function watchForLeadForm(contact) {
    if (identifiedWithCloseBot()) { log('CloseBot already knows this visitor; no form to fill'); return; }
    var handled = false;
    var quiet = config.autosubmit && hasIdentity(contact);
    if (quiet) setQuiet(true, true);
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
          watchSubmitResult(card);
          submit.click();
          clearSavedContact();
          log('submitted the lead form');
        }, 50);
      } else {
        setQuiet(false);
      }
    };
    var observer = new MutationObserver(tryCard);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    tryCard();
    setTimeout(function () {
      observer.disconnect();
      if (!handled) setQuiet(false);
    }, config.formTimeoutMs);
  }

  // ---------- greeting ----------

  // Once the visitor is identified, CloseBot skips its form and, with no
  // Welcome Message set, opens to an empty chat. This adds a first message
  // from the bot in that case only: it never shows next to CloseBot's own
  // messages, and it is shown in the page only, not saved in CloseBot.
  var greetingName = '';
  var formJustSent = false; // our own submit went through: no need to wait

  function rememberName(contact) {
    var first = contact && (contact.firstName || trim((contact.name || '').split(' ')[0]));
    var s = store();
    if (first) {
      greetingName = first;
      if (s) { try { s.setItem(NAME_KEY, first); } catch (_) { /* ignore */ } }
    } else if (!greetingName && s) {
      try { greetingName = s.getItem(NAME_KEY) || ''; } catch (_) { /* ignore */ }
    }
    updateCtaName();
  }

  function greetingText() {
    return config.greeting.replace(/\{\s*first_?name\s*\}/gi, greetingName || 'there');
  }

  function identifiedWithCloseBot() {
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        if ((window.localStorage.key(i) || '').indexOf('cb_identity_') === 0) return true;
      }
    } catch (_) { /* storage blocked */ }
    return false;
  }

  // 'talk' once anyone has said something, 'wait' while CloseBot's form is
  // still open or the bot is typing, otherwise 'empty'.
  function chatState(list) {
    if (list.querySelector('.gmmcw-greeting')) return 'talk';
    var items = list.querySelectorAll('.cb-msg-item');
    for (var i = 0; i < items.length; i++) {
      if (!items[i].classList.contains('cb-form-text-item') && !isFormEcho(items[i])) return 'talk';
    }
    if (list.querySelector('.cb-typing-indicator, .cb-ai-typing')) return 'wait';
    var card = list.querySelector('.cb-form-card');
    if (card && !card.querySelector('.cb-form-submitted')) return 'wait';
    return 'empty';
  }

  function addGreeting(list) {
    var item = document.createElement('div');
    item.className = 'cb-msg-item bot gmmcw-greeting';
    var msg = document.createElement('div');
    msg.className = 'cb-msg bot';
    msg.textContent = greetingText();
    item.appendChild(msg);
    list.appendChild(item);
    log('added greeting');
  }

  // CloseBot's config, past conversation and form all arrive on their own
  // schedule, so unless the embed has just sent the form itself, the chat
  // has to look empty for two seconds before the greeting goes in.
  // A Welcome Message or past conversation wins.
  function watchForEmptyChat() {
    if (!config.source || !config.greeting) return;
    var emptyChecks = 0;
    var check = function () {
      var list = document.querySelector('.cb-messages');
      var state = list ? chatState(list) : 'wait';
      if (state === 'talk') return stop();
      emptyChecks = state === 'empty' && identifiedWithCloseBot() ? emptyChecks + 1 : 0;
      if (emptyChecks >= (formJustSent ? 1 : 4)) { addGreeting(list); stop(); }
    };
    var poll = setInterval(check, 500);
    var giveUp = setTimeout(stop, config.formTimeoutMs);
    function stop() { clearInterval(poll); clearTimeout(giveUp); }
  }

  // ---------- call to action on the page ----------

  // A card on the page that greets the visitor by name and points them at the
  // chat: above the chat in the inline layout, or where the tag is with a
  // button that opens the chat in the bubble layout. It uses the look options,
  // and CloseBot's own color when data-color isn't set. It shows once the chat
  // does, so it never points at a chat that isn't there.
  var CTA_ID = 'gmmcw-cta';
  var CTA_DEFAULTS = {
    title: 'You\u2019re all set, {first_name}!',
    inline: { text: 'Have a question while you wait? Our virtual assistant is right below and ready to chat.', button: 'Start chatting' },
    bubble: { text: 'Have a question while you wait? Our virtual assistant is ready to chat.', button: 'Chat with us' }
  };
  var CTA_ICON = '<svg viewBox="10 4 44 58" width="22" height="29" aria-hidden="true" fill="currentColor"><rect x="20" y="6" width="24" height="8" rx="3"/>' +
    '<path fill-rule="evenodd" d="M22 17H42C48 17 52 21 52 27V43C52 49 48 53 42 53H25L15 60L17 51C14 49 12 46 12 43V27C12 21 16 17 22 17Z' +
    'M24 32a3 3 0 1 0 0 6a3 3 0 1 0 0-6ZM32 32a3 3 0 1 0 0 6a3 3 0 1 0 0-6ZM40 32a3 3 0 1 0 0 6a3 3 0 1 0 0-6Z"/></svg>';
  var CTA_ARROW = { inline: '\u2193', bubble: '\u2192' };
  var CTA_PENDING_COLOR = '#9ca3af'; // until CloseBot's color is known

  function addCtaStyles() {
    if (document.getElementById('gmmcw-cta-style')) return;
    var C = '.gmmcw-cta';
    var style = document.createElement('style');
    style.id = 'gmmcw-cta-style';
    style.textContent = [
      C + '{--gmmcw-accent:#2563eb;--gmmcw-on-accent:#fff;--gmmcw-bg:#fff;--gmmcw-text:#111827;--gmmcw-radius:14px;' +
        '--gmmcw-shadow:0 6px 24px rgba(17,24,39,.08);--gmmcw-border:1px solid rgba(17,24,39,.08);' +
        'box-sizing:border-box;position:relative;overflow:hidden;display:flex;align-items:center;gap:18px;' +
        'width:100%;margin:0 0 16px;padding:22px 24px 22px 28px;background:var(--gmmcw-bg);color:var(--gmmcw-text);' +
        'border:var(--gmmcw-border);border-radius:var(--gmmcw-radius);box-shadow:var(--gmmcw-shadow);' +
        'font-family:var(--gmmcw-font,inherit);font-size:var(--gmmcw-size,16px);line-height:1.45;text-align:left;' +
        'letter-spacing:normal;text-transform:none;animation:gmmcw-cta-in .4s ease-out both}',
      C + ' *{box-sizing:border-box;font-family:inherit;letter-spacing:inherit;text-transform:none}',
      C + '::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--gmmcw-accent)}',
      C + ' .gmmcw-cta-icon{flex:none;display:flex;align-items:center;justify-content:center;width:52px;height:52px;' +
        'border-radius:50%;background:var(--gmmcw-accent);color:var(--gmmcw-on-accent);' +
        'box-shadow:0 0 0 6px color-mix(in srgb,var(--gmmcw-accent) 14%,transparent)}',
      C + ' .gmmcw-cta-body{flex:1;min-width:0}',
      C + ' .gmmcw-cta-title{margin:0 0 4px;padding:0;font-size:1.3em;font-weight:700;line-height:1.25;color:inherit}',
      C + ' .gmmcw-cta-text{margin:0;padding:0;font-size:.95em;color:inherit;opacity:.78}',
      C + ' .gmmcw-cta-text p{margin:0 0 .5em}' + C + ' .gmmcw-cta-text p:last-child{margin-bottom:0}',
      C + ' .gmmcw-cta-text ul,' + C + ' .gmmcw-cta-text ol{margin:.3em 0 .5em;padding:0 0 0 1.3em}',
      C + ' .gmmcw-cta-text a{color:inherit;text-decoration:underline}',
      C + ' .gmmcw-cta-text strong{font-weight:700}',
      // A video goes full width at the top of the card.
      C + '.gmmcw-cta-has-video{flex-wrap:wrap}',
      C + ' .gmmcw-cta-video{flex:0 0 100%;position:relative;aspect-ratio:16/9;overflow:hidden;' +
        'border-radius:calc(var(--gmmcw-radius) * .6);background:#000}',
      C + ' .gmmcw-cta-video iframe,' + C + ' .gmmcw-cta-video video{position:absolute;top:0;left:0;width:100%;height:100%;border:0;margin:0}',
      C + ' .gmmcw-cta-btn{flex:none;display:inline-flex;align-items:center;gap:8px;margin:0;padding:12px 22px;' +
        'border:0;border-radius:var(--gmmcw-btn-radius,999px);background:var(--gmmcw-accent);color:var(--gmmcw-on-accent);' +
        'font-size:1em;font-weight:600;line-height:1.2;cursor:pointer;-webkit-appearance:none;appearance:none;' +
        'box-shadow:0 2px 8px color-mix(in srgb,var(--gmmcw-accent) 35%,transparent);' +
        'position:relative;transition:transform .15s,box-shadow .15s,filter .15s,background-color .3s}',
      C + ' .gmmcw-cta-btn:hover{transform:translateY(-1px);filter:brightness(1.06);' +
        'box-shadow:0 6px 18px color-mix(in srgb,var(--gmmcw-accent) 40%,transparent)}',
      C + ' .gmmcw-cta-btn:focus-visible{outline:2px solid var(--gmmcw-accent);outline-offset:3px}',
      C + ' .gmmcw-cta-arrow{display:inline-block;transition:transform .15s}',
      C + '::before,' + C + ' .gmmcw-cta-icon{transition:background-color .3s}',
      // Loading: the button keeps its size, with dots in place of its label.
      C + ' .gmmcw-cta-dots{display:none}',
      C + '.gmmcw-cta-loading .gmmcw-cta-btn{cursor:progress;transform:none;filter:none}',
      C + '.gmmcw-cta-loading .gmmcw-cta-label,' + C + '.gmmcw-cta-loading .gmmcw-cta-arrow{visibility:hidden}',
      C + '.gmmcw-cta-loading .gmmcw-cta-dots{display:flex;position:absolute;top:0;right:0;bottom:0;left:0;' +
        'align-items:center;justify-content:center;gap:5px}',
      C + ' .gmmcw-cta-dots i{display:block;width:6px;height:6px;border-radius:50%;background:currentColor;' +
        'animation:gmmcw-cta-dot 1s ease-in-out infinite both}',
      C + ' .gmmcw-cta-dots i:nth-child(2){animation-delay:.15s}',
      C + ' .gmmcw-cta-dots i:nth-child(3){animation-delay:.3s}',
      '@keyframes gmmcw-cta-dot{0%,80%,100%{opacity:.35;transform:scale(.75)}40%{opacity:1;transform:none}}',
      C + '.gmmcw-cta-out{opacity:0;transition:opacity .3s}',
      C + '.gmmcw-cta-inline .gmmcw-cta-btn:hover .gmmcw-cta-arrow{transform:translateY(2px)}',
      C + '.gmmcw-cta-bubble .gmmcw-cta-btn:hover .gmmcw-cta-arrow{transform:translateX(2px)}',
      '@keyframes gmmcw-cta-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
      '@media (max-width:560px){' + C + '{flex-wrap:wrap;align-items:flex-start;gap:14px;padding:20px 18px 20px 22px}' +
        C + ' .gmmcw-cta-icon{width:44px;height:44px}' + C + ' .gmmcw-cta-body{flex-basis:calc(100% - 62px)}' +
        C + ' .gmmcw-cta-btn{width:100%;justify-content:center}}',
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
    box.className = 'gmmcw-cta-video';
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

  // The look options that fit a card on the page; size options are the chat's.
  function styleCta(el, l, accent) {
    var set = function (prop, v) { if (v) el.style.setProperty(prop, v); };
    set('--gmmcw-accent', l.color || accent);
    set('--gmmcw-on-accent', l.visitorText || l.headerText);
    set('--gmmcw-bg', l.background);
    set('--gmmcw-text', l.textColor);
    set('--gmmcw-font', l.font);
    set('--gmmcw-size', l.fontSize);
    if (l.radius) {
      set('--gmmcw-radius', l.radius);
      var n = parseFloat(l.radius);
      set('--gmmcw-btn-radius', /px$/.test(l.radius) ? Math.min(n, 999) + 'px' : l.radius);
    }
    if (l.shadow) set('--gmmcw-shadow', { none: 'none', soft: '0 4px 16px rgba(0,0,0,.10)', strong: '0 12px 40px rgba(0,0,0,.28)' }[l.shadow]);
    if (l.border === 'off') set('--gmmcw-border', '0 solid transparent');
    if (l.border === 'on') set('--gmmcw-border', '1px solid #e5e7eb');
  }

  function buildCta(layout, texts, look, name, accent) {
    addCtaStyles();
    var d = CTA_DEFAULTS[layout];
    var el = document.createElement('div');
    el.className = 'gmmcw-cta gmmcw-cta-' + layout;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Chat with us');
    el.innerHTML = '<div class="gmmcw-cta-icon">' + CTA_ICON + '</div>' +
      '<div class="gmmcw-cta-body"><p class="gmmcw-cta-title"></p><div class="gmmcw-cta-text"></div></div>' +
      '<button type="button" class="gmmcw-cta-btn"><span class="gmmcw-cta-label"></span>' +
      '<span class="gmmcw-cta-arrow" aria-hidden="true">' + CTA_ARROW[layout] + '</span>' +
      '<span class="gmmcw-cta-dots" aria-hidden="true"><i></i><i></i><i></i></span></button>';
    var title = texts.title === null || texts.title === undefined ? CTA_DEFAULTS.title : texts.title;
    el.querySelector('.gmmcw-cta-title').textContent = ctaTitleText(title, name);
    setCtaText(el.querySelector('.gmmcw-cta-text'), texts.text === null || texts.text === undefined ? d.text : texts.text, name);
    el.querySelector('.gmmcw-cta-label').textContent = trim(texts.button) || d.button;
    if (!trim(el.querySelector('.gmmcw-cta-title').textContent)) el.querySelector('.gmmcw-cta-title').style.display = 'none';
    var video = trim(texts.video) ? ctaVideo(texts.video) : null;
    if (video) { el.insertBefore(video, el.firstChild); el.classList.add('gmmcw-cta-has-video'); }
    styleCta(el, look, accent);
    return el;
  }

  function closebotPanel() {
    return document.querySelector('[data-cb].cb-panel') || document.querySelector('.cb-panel');
  }

  // Inline: bring the chat into view and put the cursor in its message box.
  // Bubble: open the chat window, as CloseBot's corner button does.
  function openChat(layout) {
    var panel = closebotPanel();
    if (!panel) return;
    var input = panel.querySelector('.cb-input');
    if (layout === 'inline') {
      var box = document.getElementById(CONTAINER_ID) || panel;
      try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { box.scrollIntoView(); }
      if (input) setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); } }, 350);
      return;
    }
    var btn = document.querySelector('.cb-btn[data-cb]') || document.querySelector('.cb-btn');
    if (panel.classList.contains('hidden') && btn) btn.click();
    else if (input) input.focus();
  }

  var ctaEl = null;

  function ctaPlace(layout) {
    if (config.ctaTarget) {
      var target = null;
      try { target = document.querySelector(config.ctaTarget); } catch (_) { /* bad selector */ }
      if (target) return function (el) { target.appendChild(el); };
      log('data-cta-target matched nothing; using the default spot');
    }
    var box = document.getElementById(CONTAINER_ID);
    if (layout === 'inline' && box) return function (el) { box.parentNode.insertBefore(el, box); };
    var parent = script && script.parentNode;
    if (!parent || parent === document.head || !document.body || !document.body.contains(script)) return null;
    return function (el) { parent.insertBefore(el, (box && box.parentNode === parent ? box : script).nextSibling); };
  }

  var CTA_COLOR_KEY = 'gmmcw_cb_color';

  function panelColor(panel) {
    try { return lookColor(getComputedStyle(panel).getPropertyValue('--cb-color')); } catch (_) { return ''; }
  }

  // The card goes in as soon as the page is ready, with its button showing
  // loading dots until CloseBot's chat is there to open. CloseBot's color is
  // remembered for next time, so a returning visitor sees it from the start.
  // If the chat never shows, the card goes away again.
  function showCta() {
    if (!config.source || !config.cta || ctaEl || document.getElementById(CTA_ID)) return;
    var layout = document.getElementById(CONTAINER_ID) ? 'inline' : 'bubble';
    var put = ctaPlace(layout);
    if (!put) { log('no spot for the call to action on the page'); return; }
    var cached = '';
    try { cached = lookColor(window.localStorage.getItem(CTA_COLOR_KEY) || ''); } catch (_) { /* storage blocked */ }
    ctaEl = buildCta(layout, { title: config.ctaTitle, text: config.ctaText, button: config.ctaButton, video: config.ctaVideo }, config.look, greetingName, cached || CTA_PENDING_COLOR);
    ctaEl.id = CTA_ID;
    var btn = ctaEl.querySelector('.gmmcw-cta-btn');
    var ready = false;
    ctaEl.classList.add('gmmcw-cta-loading');
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-busy', 'true');
    btn.addEventListener('click', function () { if (ready) openChat(layout); });
    put(ctaEl);
    log('added call to action; waiting for the chat');

    var setAccent = function (panel) {
      if (config.look.color) return;
      var c = panelColor(panel);
      if (!c) return;
      ctaEl.style.setProperty('--gmmcw-accent', c);
      try { window.localStorage.setItem(CTA_COLOR_KEY, c); } catch (_) { /* storage blocked */ }
    };
    var activate = function () {
      var panel = closebotPanel();
      if (!panel) return false;
      ready = true;
      ctaEl.classList.remove('gmmcw-cta-loading');
      btn.removeAttribute('aria-disabled');
      btn.removeAttribute('aria-busy');
      setAccent(panel);
      // CloseBot sets its color once its settings load, which can be later.
      if (!config.look.color) {
        new MutationObserver(function () { setAccent(panel); }).observe(panel, { attributes: true, attributeFilter: ['style'] });
      }
      log('chat is ready; call to action active');
      return true;
    };
    if (activate()) return;
    var obs = new MutationObserver(function () { if (activate()) { obs.disconnect(); clearTimeout(giveUp); } });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    var giveUp = setTimeout(function () {
      obs.disconnect();
      if (ready || !ctaEl) return;
      log('no chat showed; removing the call to action');
      var el = ctaEl;
      ctaEl = null;
      el.classList.add('gmmcw-cta-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, config.ctaWaitMs);
  }

  // The name can arrive after the card (backend lookup).
  function updateCtaName() {
    if (!ctaEl) return;
    var title = config.ctaTitle === null ? CTA_DEFAULTS.title : config.ctaTitle;
    ctaEl.querySelector('.gmmcw-cta-title').textContent = ctaTitleText(title, greetingName);
    var text = config.ctaText === null ? CTA_DEFAULTS[ctaEl.classList.contains('gmmcw-cta-bubble') ? 'bubble' : 'inline'].text : config.ctaText;
    setCtaText(ctaEl.querySelector('.gmmcw-cta-text'), text, greetingName);
  }

  // ---------- CloseBot: container and script ----------

  function closebotLoaded() {
    var all = document.getElementsByTagName('script');
    for (var i = 0; i < all.length; i++) {
      if ((all[i].src || '').indexOf('/scripts/cb.js') !== -1) return true;
    }
    return false;
  }

  // Inline layout: an empty box right after this tag that CloseBot mounts the
  // chat into. It takes no space until the chat appears, so pages where no
  // CloseBot widget is targeted (the form page, say) are unaffected.
  function placeContainer() {
    if (!config.source || config.layout !== 'inline' || document.getElementById(CONTAINER_ID)) return;
    var parent = script && script.parentNode;
    if (!parent || parent === document.head || !document.body || !document.body.contains(script)) {
      log('tag is not in the page body; using the chat bubble');
      return;
    }
    var box = document.createElement('div');
    box.id = CONTAINER_ID;
    box.style.width = '100%';
    box.style.maxWidth = '100%';
    parent.insertBefore(box, script.nextSibling);
    var grow = function () {
      if (!box.firstElementChild) return false;
      box.style.height = config.height;
      return true;
    };
    if (!grow()) {
      var obs = new MutationObserver(function () { if (grow()) obs.disconnect(); });
      obs.observe(box, { childList: true });
    }
  }

  function loadCloseBot() {
    if (!config.source) return;
    if (closebotLoaded()) { log('CloseBot script already on the page'); return; }
    var el = document.createElement('script');
    var src = config.closebotSrc;
    el.src = src + (src.indexOf('?') === -1 ? '?' : '&') + 'source=' + encodeURIComponent(config.source);
    el.async = true;
    (document.head || document.documentElement).appendChild(el);
    log('loading CloseBot');
  }

  // ---------- boot ----------

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  var urlResult = takeUrlContact();
  placeContainer();
  applyLook();
  applyLauncherIcon();
  hidePersona();
  addNoteToFirstMessage();
  // Wait for the page to finish parsing, so a CloseBot tag further down the
  // page is seen and CloseBot is not loaded twice.
  onReady(loadCloseBot);
  captureFromPageForms();
  captureFromHighLevelEmbeds();
  tagFormsWithCode();

  var api = {
    version: VERSION,
    contact: null,
    source: null,
    fieldsSent: null,
    fill: function (contact) { watchForLeadForm(clean(contact)); },
    clear: clearSavedContact,
    // For the setup page preview: CSS for a set of data-* look options.
    lookCss: function (options) {
      return lookCss(parseLook(function (name) { return options ? options[name] : null; }));
    },
    // For the setup page preview: the call-to-action card for a set of data-*
    // options (layout, look, cta-title, cta-text, cta-button, cta-video) and a name.
    ctaPreview: function (options, name) {
      var o = options || {};
      var get = function (k) { return o[k] === undefined ? null : o[k]; };
      var layout = o.layout === 'bubble' ? 'bubble' : 'inline';
      return buildCta(layout, { title: get('cta-title'), text: get('cta-text'), button: get('cta-button'), video: get('cta-video') }, parseLook(get), name || '', '#3b82f6');
    }
  };
  window.GMMChat = api;

  onReady(hideFormEchoes);
  onReady(watchForEmptyChat);
  onReady(function () {
    rememberName(null);
    // Contact details already on hand resolve right away, so the card goes in
    // with the name; a backend lookup fills it in later.
    setTimeout(showCta, 0);
    resolveContact(urlResult, function (contact, source) {
      api.source = source;
      rememberName(contact);
      var extra = {};
      [(contact && contact.extra) || {}, urlResult.extra].forEach(function (o) {
        Object.keys(o).forEach(function (k) { extra[k] = o[k]; });
      });
      if (config.note) setNote(extra);
      if (!contact) { log('no contact found; visitor fills the form'); return; }
      api.contact = { hasEmail: !!contact.email, hasPhone: !!contact.phone };
      log('contact found via', source);
      sendExtraFields(contact, extra);
      sendAiNote(contact, extra);
      watchForLeadForm(contact);
    });
  });
})(window, document);
