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

  // Plugin 1.2 and later (&fit=1) grow the frame to fit this page, so
  // WordPress's own scrollbar is the only one.
  if (/[?&]fit=1(&|#|$)/.test(location.search)) fitFrame();

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

  function fitFrame() {
    document.documentElement.classList.add('wp-fit');
    // WordPress already shows the JARchat heading, and the step buttons sit
    // at the end of each step once nothing scrolls inside the frame.
    style.textContent += '.wp-fit,.wp-fit body{overflow:hidden}' +
      '.wp-fit .intro h1,.wp-fit .intro .lead{display:none}.wp-fit .widget-pick-label{margin-top:0}' +
      '.wp-fit main{padding-top:20px;padding-bottom:24px}.wp-fit .wizard-nav{position:static}';
    var last = 0;
    function size() {
      var h = Math.ceil(document.body.getBoundingClientRect().height);
      if (h === last) return;
      last = h;
      parent.postMessage({ type: 'jarchat:height', height: h }, origin);
    }
    if (window.ResizeObserver) new ResizeObserver(size).observe(document.body);
    addEventListener('load', size);
    size();
    // A new step starts at the step buttons; WordPress scrolls there if they're out of view.
    addEventListener('hashchange', function () {
      var stepper = $('stepper');
      size();
      if (stepper) parent.postMessage({ type: 'jarchat:step', top: Math.round(stepper.getBoundingClientRect().top) }, origin);
    });
    // The guide's pop-up would open in the middle of a frame taller than the
    // screen, so guide links open the guide in a new tab instead.
    addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a.guide')) e.stopPropagation();
    }, true);
  }
})();
