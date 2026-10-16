# GMM Chat Embed

One tag that adds the CloseBot AI chat to a page. On a thank-you page it also fills CloseBot's contact form with the name, email and phone the visitor just submitted and sends it in the background, so the chat starts on their existing HighLevel contact.

The easiest way to set it up is the setup page at https://gmm-chatwidget.vercel.app, which writes the tag for you.

## The tags

**Thank-you page** (shows the chat):

```html
<script src="https://gmm-chatwidget.vercel.app/embed.js" data-source="CLOSEBOT_SOURCE_ID"></script>
```

The source ID is in CloseBot under the HighLevel source's Setup tab (the part after `source=` in CloseBot's own script tag).

By default the chat shows in the page where the tag is pasted. Add `data-layout="bubble"` for CloseBot's standard corner chat button instead. A tag in the page `<head>` also uses the corner button.

**Form page** (no chat; only when the form is on your own site, including an embedded HighLevel form):

```html
<script src="https://gmm-chatwidget.vercel.app/embed.js"></script>
```

Without `data-source` the embed never adds a chat. It remembers what the visitor submits so the thank-you page can fill CloseBot's form. Skip it for Typeform (the answers come through the redirect URL instead) and for HighLevel funnel forms.

## In CloseBot

- Chat widget settings: turn on **Form** and include **Email** and **Phone**. The embed fills and sends that form out of sight: the visitor doesn't see the form, its intro message or CloseBot's "Thanks, got it!" note, just the conversation. If the embed has no details, or CloseBot rejects them, the visitor sees the form as usual.
- Target the widget to the thank-you page URL only, so CloseBot's own script doesn't show it on the form page, and put the site's domain on the source's allowed domains.
- CloseBot's own script tag can stay on the site. The embed won't load CloseBot a second time. Put the embed above it so CloseBot never sees contact details in the address bar.

## Where the visitor's details come from

First match wins:

1. **Same site:** the form page tag saves what was submitted in the browser tab for 30 minutes.
2. **HighLevel thank-you page:** add the merge fields to the tag (the setup page does this when you tick the HighLevel box):
   ```html
   data-email="{{contact.email}}" data-phone="{{contact.phone}}"
   data-first-name="{{contact.first_name}}" data-last-name="{{contact.last_name}}"
   ```
3. **Typeform:** in Endings, turn on Redirect to URL and add the answers to the thank-you address, for example `https://site.com/thank-you?email=@Email&phone=@Phone&first_name=@First name` (type `@` and pick each question). The embed removes them from the address bar as soon as it loads.
4. **Webhook (later):** `data-backend="https://…"` looks the contact up by a one-time code. Needs the backend, not built yet.

## All options

| Attribute | Default | What it does |
| --- | --- | --- |
| `data-source` | none | CloseBot source ID. Without it the embed adds no chat: it saves form details, and still fills CloseBot's form on a page that loads CloseBot itself |
| `data-layout` | `inline` | `inline` shows the chat where the tag is; `bubble` uses the corner button |
| `data-height` | `600px` | Height of the inline chat |
| `data-email`, `data-phone`, `data-first-name`, `data-last-name`, `data-name` | none | Contact details rendered into the page, usually HighLevel merge fields |
| `data-autosubmit` | `true` | `false` fills the form but leaves the visitor to press submit |
| `data-backend` | none | Turns on the webhook-and-code lookup |
| `data-form-timeout` | `600000` | How long (ms) to wait for CloseBot's form to appear |
| `data-hl-origins` | HighLevel domains | Extra origins allowed to send embedded HighLevel form messages |
| `data-closebot-src` | CloseBot's script URL | Override for testing |
| `data-debug` | `false` | Logs what it found and did to the console (never the values) |

`window.GMMChat` exposes `version`, `source` (which of the above was used), `contact.hasEmail` / `contact.hasPhone`, `fill(contact)` and `clear()`.

## Known limits

- CloseBot doesn't document filling its form from the page. The embed finds it by the class names and placeholders in today's CloseBot script, so a CloseBot update can break the fill. The chat itself keeps working; the visitor just types their details.
- CloseBot hides its form after one submit per browser, so a returning visitor on the same browser keeps their earlier identity.
- One CloseBot widget per page.
- Matching needs an email or a phone. A name alone isn't enough.

## Tests

```
npm i -g playwright   # once
NODE_PATH=$(npm root -g) node test/embed.test.js
```

The tests run the embed against a mock of CloseBot's widget (`test/fixtures/mock-closebot.js`). They don't prove the live widget accepts the background submit; that needs a live test.
