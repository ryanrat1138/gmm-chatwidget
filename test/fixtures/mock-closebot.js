// Minimal stand-in for CloseBot's cb.js lead form, matching the DOM and
// behaviour seen in cb.js on 2026-10-15/16: plain DOM; a form intro message
// (.cb-form-text-item) and typing dots, then the fields card inside a
// .cb-form-row; inputs with placeholders and no names; a type="button" submit
// that reads .value, POSTs, and on success replaces the card's contents with
// a "Thanks, got it!" .cb-form-submitted note, or on failure shows
// .cb-form-error. Set window.__mockFail to make the submit fail.
(function () {
  window.__identity = null;
  window.__cbLoads = (window.__cbLoads || 0) + 1;
  var me = document.currentScript;
  window.__cbSource = me && me.src ? new URL(me.src).searchParams.get('source') : null;
  window.__urlSeenByCloseBot = location.href;
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }
  // Records whether each form element was visible at the moment it was
  // added, so tests can tell what a visitor would have seen.
  window.__seen = [];
  function note(e, name) { window.__seen.push({ name: name, shown: e.getClientRects().length > 0 }); return e; }
  function mount() {
    var panel = el('div', { class: 'cb-panel' });
    var messages = el('div', { class: 'cb-messages' });
    panel.appendChild(messages);
    messages.appendChild(el('div', { class: 'cb-msg-item bot' }, 'Hi! How can I help?'));
    (document.getElementById('cb-widget-container') || document.body).appendChild(panel);
    note(messages.appendChild(el('div', { class: 'cb-msg-item bot cb-form-text-item' }, 'Before we chat, can I get your details?')), 'intro');
    var typing = note(messages.appendChild(el('div', { class: 'cb-typing-indicator' }, '...')), 'form-typing');

    setTimeout(function () {
      typing.parentNode.removeChild(typing);
      var card = el('div', { class: 'cb-form-card' });
      var first = el('input', { class: 'cb-form-input', type: 'text', placeholder: 'First Name' });
      var last = el('input', { class: 'cb-form-input', type: 'text', placeholder: 'Last Name' });
      var email = el('input', { class: 'cb-form-input', type: 'email', placeholder: 'Email *' });
      var phone = el('input', { class: 'cb-form-input', type: 'tel', placeholder: '(555) 123-4567' });
      phone.autocomplete = 'tel';
      phone.addEventListener('input', function () { window.__phoneInputEvents = (window.__phoneInputEvents || 0) + 1; });
      var error = el('div', { class: 'cb-form-error hidden' });
      var submit = el('button', { class: 'cb-form-submit', type: 'button' }, 'Submit');
      submit.addEventListener('click', function () {
        var raw = phone.value.trim(), p = null;
        if (raw) p = raw.charAt(0) === '+' ? raw : '+1' + raw.replace(/\D/g, '');
        window.__identity = {
          firstName: first.value.trim() || null, lastName: last.value.trim() || null,
          email: email.value.trim() || null, phone: p
        };
        setTimeout(function () {
          if (window.__mockFail) {
            error.textContent = 'Unable to save your details right now. Please try again.';
            error.classList.remove('hidden');
            return;
          }
          card.innerHTML = '';
          note(card.appendChild(el('div', { class: 'cb-form-submitted' }, 'Thanks, got it!')), 'thanks');
          note(messages.appendChild(el('div', { class: 'cb-typing-indicator cb-ai-typing' }, '...')), 'ai-typing');
        }, 100);
      });
      [first, last, email, phone, error, submit].forEach(function (x) { card.appendChild(x); });
      note(messages.appendChild(el('div', { class: 'cb-form-row' }, null)).appendChild(card), 'fields');
    }, 300);
  }
  if (!window.__mockNoMount) setTimeout(mount, Number(window.__mockDelay || 400));
})();
