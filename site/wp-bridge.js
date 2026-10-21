/*
 * JARchat setup inside WordPress.
 *
 * The JARchat plugin shows this setup page in a frame on Settings › JARchat,
 * with ?wp=<the WordPress admin's origin>. This adds a "Save to WordPress"
 * button to the install step that hands the finished code to the plugin, so
 * nobody copies and pastes. Outside that frame it does nothing.
 */
(function () {
  if (window.parent === window) return;
  var m = /[?&]wp=([^&#]+)/.exec(location.search);
  var origin;
  try { origin = m && new URL(decodeURIComponent(m[1])).origin; } catch (_) { origin = null; }
  if (!origin || !/^https?:\/\//.test(origin)) return;
  var $ = function (id) { return document.getElementById(id); };
  var install = $('step-install'), tyCard = $('tyCard');
  if (!install || !tyCard) return;

  document.documentElement.classList.add('in-wp');
  var style = document.createElement('style');
  // The tips under the code are about pasting it by hand.
  style.textContent = '.in-wp .topbar,.in-wp .wp-hide,.in-wp #tyCard .ticks{display:none!important}' +
    '.wp-save{border-color:var(--accent)!important;background:var(--accent-soft)!important}' +
    '.wp-save .action{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-top:12px}' +
    '.wp-save .status{font-size:15px;font-weight:600}' +
    '.wp-save .status.err{color:var(--err)}.wp-save .status.ok{color:var(--ok)}';
  document.head.appendChild(style);

  // Switching between the two chat windows stays inside WordPress.
  [].forEach.call(document.querySelectorAll('.widget-pick a.choice'), function (a) {
    a.setAttribute('href', a.getAttribute('href').replace(/[?#].*$/, '') + location.search);
  });

  var card = document.createElement('div');
  card.className = 'part-card wp-save';
  card.id = 'wpSave';
  card.innerHTML = '<h3>Save to WordPress</h3>' +
    '<p class="hint">Saves the code below to the JARchat plugin on this site, so there\'s nothing to copy. ' +
    'Then add a Shortcode block with <code>[jarchat]</code> to the thank-you page<span id="wpFormHint">, ' +
    'and <code>[jarchat_form]</code> to the page with the form</span>.</p>' +
    '<div class="action"><button id="wpSaveBtn" class="btn btn-primary" type="button">Save to WordPress</button>' +
    '<span class="status" id="wpSaveStatus" role="status"></span></div>';
  install.insertBefore(card, tyCard);

  var btn = $('wpSaveBtn'), status = $('wpSaveStatus'), copy = $('copy'), formCard = $('formCard');
  var timer = null;

  // Save follows Copy: both stay off until the code has a source ID.
  function sync() {
    btn.disabled = copy.disabled || btn.getAttribute('aria-busy') === 'true';
    $('wpFormHint').hidden = formCard.hidden;
  }
  new MutationObserver(sync).observe(copy, { attributes: true, attributeFilter: ['disabled'] });
  new MutationObserver(sync).observe(formCard, { attributes: true, attributeFilter: ['hidden'] });
  sync();

  function done(ok, text) {
    clearTimeout(timer);
    btn.removeAttribute('aria-busy');
    status.className = 'status ' + (ok ? 'ok' : 'err');
    status.textContent = text;
    sync();
  }

  btn.addEventListener('click', function () {
    btn.setAttribute('aria-busy', 'true');
    sync();
    status.className = 'status';
    status.textContent = 'Saving…';
    parent.postMessage({
      type: 'jarchat:save',
      chat: $('out').textContent,
      // Typeform and funnel forms don't use the form page code; leave whatever is saved.
      form: formCard.hidden ? null : $('formOut').textContent
    }, origin);
    timer = setTimeout(function () {
      done(false, 'WordPress didn\'t answer. Update the JARchat plugin, reload this page and try again.');
    }, 15000);
  });

  addEventListener('message', function (e) {
    if (e.source !== parent || e.origin !== origin || !e.data || e.data.type !== 'jarchat:saved') return;
    done(!!e.data.ok, String(e.data.message || (e.data.ok ? 'Saved.' : 'Couldn\'t save.')));
  });
})();
