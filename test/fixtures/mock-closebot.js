// Minimal stand-in for CloseBot's cb.js lead form, matching the DOM and
// submit behaviour seen in cb.js on 2026-10-15: plain DOM, inputs with
// placeholders and no names, a type="button" submit that reads .value.
(function () {
  window.__identity = null;
  window.__cbLoads = (window.__cbLoads || 0) + 1;
  var me = document.currentScript;
  window.__cbSource = me && me.src ? new URL(me.src).searchParams.get('source') : null;
  window.__urlSeenByCloseBot = location.href;
  function el(tag, attrs) { var e = document.createElement(tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function mount() {
    var panel = el('div', { class: 'cb-panel' });
    var card = el('div', { class: 'cb-form-card' });
    var first = el('input', { class: 'cb-form-input', type: 'text', placeholder: 'First Name' });
    var last = el('input', { class: 'cb-form-input', type: 'text', placeholder: 'Last Name' });
    var email = el('input', { class: 'cb-form-input', type: 'email', placeholder: 'Email *' });
    var phone = el('input', { class: 'cb-form-input', type: 'tel', placeholder: '(555) 123-4567' });
    phone.autocomplete = 'tel';
    phone.addEventListener('input', function () { window.__phoneInputEvents = (window.__phoneInputEvents || 0) + 1; });
    var submit = el('button', { class: 'cb-form-submit', type: 'button' });
    submit.textContent = 'Submit';
    submit.addEventListener('click', function () {
      var raw = phone.value.trim(), p = null;
      if (raw) p = raw.charAt(0) === '+' ? raw : '+1' + raw.replace(/\D/g, '');
      window.__identity = {
        firstName: first.value.trim() || null, lastName: last.value.trim() || null,
        email: email.value.trim() || null, phone: p
      };
      card.classList.add('hidden');
    });
    [first, last, email, phone, submit].forEach(function (x) { card.appendChild(x); });
    panel.appendChild(card);
    (document.getElementById('cb-widget-container') || document.body).appendChild(panel);
  }
  if (!window.__mockNoMount) setTimeout(mount, Number(window.__mockDelay || 400));
})();
