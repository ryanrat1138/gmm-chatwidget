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

- Chat widget settings: turn on **Form** and include **Email** and **Phone**. The embed fills and sends that form out of sight: the visitor doesn't see the form, its intro message or CloseBot's "Thanks, got it!" note, just the conversation. If the embed has no details, or CloseBot rejects them, the visitor sees the form as usual. With no **Welcome Message** set in CloseBot, the chat then opens with the embed's greeting ("Hey Ann, what can I help you with today?"); set `data-greeting` to change it. The greeting is shown in the page only, so CloseBot's conversation history and the AI don't include it.
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

### Form answers for the AI

With `data-fields="business_info,team_size"`, a thank-you URL like `...?email=@Email&business_info=@Business&team_size=@Team` hands those answers to CloseBot's AI along with the visitor's first chat message, as a note after it: `[Form answers, for reference: Business info: HVAC; Team size: 6-20]`. The AI has them for its first reply, even while HighLevel is still filling in the contact's fields. The visitor's chat shows only what they typed, and the note is cut out again when CloseBot reloads the conversation, but HighLevel's conversation view shows it as part of their message. The answers are removed from the address bar like the contact details, and kept for the browser tab until a message goes through. `data-note="off"` turns this off.

`data-save-fields="true"` also writes the answers to the HighLevel contact through `/api/fields` (see the main README). Most setups don't need it: the Typeform-to-HighLevel connection already maps answers to custom fields.

### Call to action

Once the chat loads, the embed adds a card to the page that greets the visitor by name ("You're all set, Ann!") and points them to the chat. In the inline layout it sits right above the chat, and its button scrolls to the chat and puts the cursor in the message box. In the bubble layout it sits where the tag is, and its button opens the chat window. It follows the look options (color, font, font size, radius, background, text color, shadow, border) and uses CloseBot's color when `data-color` isn't set. With no name known, the heading drops the name ("You're all set!").

## All options

| Attribute | Default | What it does |
| --- | --- | --- |
| `data-source` | none | CloseBot source ID. Without it the embed adds no chat: it saves form details, and still fills CloseBot's form on a page that loads CloseBot itself |
| `data-layout` | `inline` | `inline` shows the chat where the tag is; `bubble` uses the corner button |
| `data-height` | `600px` | Height of the inline chat; on the bubble layout, the chat window height on desktop |
| `data-color` | CloseBot's | Brand color: header, visitor messages, send and corner button |
| `data-font` | CloseBot's | `site` for the page's font, or a font name already loaded on the page |
| `data-font-size` | `14px` | Message and input text size |
| `data-radius` | `12px` | Corner roundness of the chat window, bubbles and inputs |
| `data-background`, `data-text-color` | CloseBot's | Chat area background and text |
| `data-bot-bubble`, `data-bot-text` | CloseBot's | Bot message colors |
| `data-visitor-bubble`, `data-visitor-text` | brand color, white | Visitor message colors |
| `data-header-text` | white | Header title color |
| `data-header` | shown | `hide` removes the header in the inline layout (the bubble layout keeps it for its close button) |
| `data-shadow` | CloseBot's | `none`, `soft` or `strong` |
| `data-border` | CloseBot's | `on` (thin line) or `off` |
| `data-position` | right | `left` puts the corner button and window on the left (bubble layout) |
| `data-width` | `360px` | Chat window width on desktop (bubble layout); `data-height` sets its height |
| `data-greeting` | `Hey {first_name}, what can I help you with today?` | First bot message when the visitor is identified and the chat would otherwise be empty. `{first_name}` becomes their first name, or "there". `off` for none. A CloseBot Welcome Message or past conversation takes its place |
| `data-fields` | none | Form answers to pass to the AI with the visitor's first message, comma separated (e.g. `business_info`). Read from the thank-you page URL, or from same-named fields on a same-site form page (put it on the form page tag too) |
| `data-note` | `on` | `off` stops the answers going with the first message |
| `data-save-fields` | `false` | `true` also saves the answers on the HighLevel contact through `/api/fields`, which needs configuring; see the main README |
| `data-api` | the embed's own site | Where `/api/fields` lives |
| `data-cta` | `on` | `off` for no call-to-action card on the page |
| `data-cta-title` | `You're all set, {first_name}!` | Card heading. `{first_name}` becomes the first name; with none, the name and the comma before it drop out |
| `data-cta-text` | "Have a question while you wait? Our virtual assistant is …" | Card text; empty for none |
| `data-cta-button` | `Start chatting` (inline), `Chat with us` (bubble) | Button label |
| `data-cta-target` | next to the chat or tag | A CSS selector (e.g. `#chat-cta`) for an element to put the card in instead |
| `data-email`, `data-phone`, `data-first-name`, `data-last-name`, `data-name` | none | Contact details rendered into the page, usually HighLevel merge fields |
| `data-autosubmit` | `true` | `false` fills the form but leaves the visitor to press submit |
| `data-backend` | none | Turns on the webhook-and-code lookup |
| `data-form-timeout` | `600000` | How long (ms) to wait for CloseBot's form to appear |
| `data-hl-origins` | HighLevel domains | Extra origins allowed to send embedded HighLevel form messages |
| `data-closebot-src` | CloseBot's script URL | Override for testing |
| `data-debug` | `false` | Logs what it found and did to the console (never the values) |

`window.GMMChat` exposes `version`, `source` (which of the above was used), `contact.hasEmail` / `contact.hasPhone`, `fill(contact)` and `clear()`, plus `lookCss(options)` and `ctaPreview(options, name)` for the setup page.

## Known limits

- CloseBot doesn't document filling its form from the page. The embed finds it by the class names and placeholders in today's CloseBot script, so a CloseBot update can break the fill. The chat itself keeps working; the visitor just types their details.
- CloseBot hides its form after one submit per browser, so a returning visitor on the same browser keeps their earlier identity.
- One CloseBot widget per page.
- Matching needs an email or a phone. A name alone isn't enough.
- The form answers reach the AI only once the visitor sends a message. They ride on CloseBot's message request, which isn't a public API either; if CloseBot changes it, the note is simply left off.

## Tests

```
npm i -g playwright   # once
NODE_PATH=$(npm root -g) node test/embed.test.js
node test/api.test.js
```

The tests run the embed against a mock of CloseBot's widget (`test/fixtures/mock-closebot.js`). They don't prove the live widget accepts the background submit; that needs a live test.

## Styling

The look options restyle CloseBot's chat with CSS, using CloseBot's own class names as seen in cb.js on 2026-10-19. They are not a public API: if a CloseBot release renames them, that part of the chat falls back to CloseBot's look. Anything the options don't cover can go in a `<style>` block next to the tag, targeting `[data-cb]` elements; the setup page's Custom CSS box writes that block.
