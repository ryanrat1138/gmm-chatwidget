# GMM Chat Prefill (loader)

`gmm-chat-prefill.js` fills CloseBot's chat-widget lead form with the name, email and phone the visitor just submitted, then submits it in the background. CloseBot matches on email or phone, so the chat attaches to the visitor's existing HighLevel contact and the AI sees their contact fields from the first message.

No backend is needed for the first three sources below. The webhook path (source 4) needs the Phase 1 service, which is not built yet.

## Before you install

1. In CloseBot, open the source's chat widget settings and turn on the **Form** (lead capture) with **Email** and **Phone** fields. The script fills that form; without it there is nothing to fill.
2. Map form and survey answers to HighLevel contact custom fields, so CloseBot can see them on the contact.
3. Host `gmm-chat-prefill.js` somewhere public (the client's site, a CDN, or the Phase 1 Vercel project). The examples use `https://YOUR-HOST/gmm-chat-prefill.js`.

## Install

Put the tag **above** the CloseBot widget code, the Sales Intelligence Pixel and any analytics. It removes contact details from the URL as soon as it loads, so later scripts never see them.

### Form page (same site as the thank-you page)

```html
<script src="https://YOUR-HOST/gmm-chat-prefill.js"></script>
```

It saves what the visitor types (or what an embedded HighLevel form reports) to `sessionStorage` for 30 minutes. This only carries over when the form page and thank-you page are on the same domain.

### Thank-you page on HighLevel (funnel or website page)

```html
<script src="https://YOUR-HOST/gmm-chat-prefill.js"
  data-email="{{contact.email}}"
  data-phone="{{contact.phone}}"
  data-first-name="{{contact.first_name}}"
  data-last-name="{{contact.last_name}}"></script>
```

HighLevel fills the merge fields after a form submit on its own pages. If a merge field is left unrendered, the script ignores it and tries the next source.

### Thank-you page after a Typeform

In Typeform, set **Redirect on completion** to the thank-you page and recall the answers into the URL:

```
https://client.com/thank-you?email=@email&phone=@phone&first_name=@first_name
```

Use the recall names of the client's own questions. On the thank-you page:

```html
<script src="https://YOUR-HOST/gmm-chat-prefill.js"></script>
```

Also set `Referrer-Policy: no-referrer` on the thank-you page if the host allows it, so the original URL is not sent to third parties as a referrer.

### Webhook path (later, needs the backend)

```html
<script src="https://YOUR-HOST/gmm-chat-prefill.js" data-backend="https://YOUR-BACKEND"></script>
```

With `data-backend`, the script puts a one-time `cb_ref` code into forms and HighLevel embeds on the form page, and the thank-you page asks `GET {backend}/api/context?code=…` for the contact (retrying for 10 seconds while the webhook arrives). The response must be `{"contact": {"email": …, "phone": …, "firstName": …, "lastName": …}}`.

## Options

| Attribute | Default | What it does |
| --- | --- | --- |
| `data-email`, `data-phone`, `data-first-name`, `data-last-name`, `data-name` | none | Contact details rendered into the page, usually HighLevel merge fields |
| `data-backend` | none | Turns on the webhook-and-code path |
| `data-autosubmit` | `true` | `false` fills the chat form but leaves the visitor to press submit |
| `data-form-timeout` | `600000` | How long (ms) to wait for the chat form to appear |
| `data-hl-origins` | HighLevel domains | Extra origins allowed to send embedded-form messages |
| `data-debug` | `false` | Logs what it found and did to the console (never logs the values) |

`window.GMMChatPrefill` exposes `version`, `source` (which source was used), `contact.hasEmail` / `contact.hasPhone`, `fill(contact)` to fill manually, and `clear()`.

## Known limits

- CloseBot does not document this. The script finds the form by its placeholders and class names from the current `cb.js`, so a CloseBot update can break it. If that happens the chat still works; the visitor just types their details.
- CloseBot hides the lead form after one submit per browser (a `cb_identity_` flag in localStorage). A returning visitor on the same browser keeps their earlier identity.
- One CloseBot widget per page.
- Submitting the form needs an email or a phone. Name alone is not enough to match a contact.

## Tests

```
npm i -g playwright   # once
NODE_PATH=$(npm root -g) node test/prefill.test.js
```

The tests run the script against a mock of the CloseBot form (`test/fixtures/mock-closebot.js`) covering each source, the URL clean-up, embed origin checks and the 30-minute expiry. They do not prove the live widget accepts a background submit; that needs the live test in Phase 0.
