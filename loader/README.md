# GMM Chat Embed

One tag that adds the CloseBot AI chat to a page. On a thank-you page it also fills CloseBot's contact form with the name, email and phone the visitor just submitted and sends it in the background, so the chat starts on their existing HighLevel contact.

The easiest way to set it up is the setup page at https://gmm-chatwidget.vercel.app, which writes the tag for you.

## The tag

```html
<script src="https://gmm-chatwidget.vercel.app/embed.js" data-source="CLOSEBOT_SOURCE_ID"></script>
```

Paste the same tag on the form page and the thank-you page. The source ID is in CloseBot under the HighLevel source's Setup tab (the part after `source=` in CloseBot's own script tag).

By default the chat shows in the page where the tag is pasted. The box takes no space until a chat appears, so on pages CloseBot's widget isn't targeted to (the form page, say) nothing shows. If the tag is in the page `<head>`, or `data-layout="bubble"` is set, the chat shows as CloseBot's usual corner button instead.

## In CloseBot

- Chat widget settings: turn on **Form**, include **Email** and **Phone**, and show it immediately. The embed fills and sends that form; if it has no details, the visitor fills it as usual.
- Target the widget to the thank-you page URL and put the site's domain on the source's allowed domains.
- CloseBot's own script tag can stay on the site. The embed won't load CloseBot a second time. Put the embed above it so CloseBot never sees contact details in the address bar.

## Where the visitor's details come from

First match wins:

1. **Same site:** the embed on the form page saves what was submitted in the browser tab for 30 minutes.
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
| `data-source` | none | CloseBot source ID. Without it the embed only fills the form, for pages that load CloseBot themselves |
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
