# GMM Chat Widget (`chat.js`)

A second, separate embed that draws its **own** chat window and talks to CloseBot directly. The original `embed.js` (served as `/embed.js`) is unchanged: it loads CloseBot's widget script and works around it. Pick one per page.

Try it live at https://gmm-chatwidget.vercel.app/chat-demo.html once deployed (bubble layout, live CloseBot source `4ts0AHLEWQsK5N84`).

## The tag

```html
<script src="https://gmm-chatwidget.vercel.app/chat.js" data-source="CLOSEBOT_SOURCE_ID"></script>
```

It takes the same attributes as `embed.js`, so a tag written by the setup page works by swapping `embed.js` for `chat.js`. `data-source` can be the source ID or CloseBot's whole script tag (the part after `source=` is used). Without `data-source` it shows no chat and only remembers what the visitor submits on a form page, like the bare `embed.js` tag. The two read and write the same browser storage (`gmmcw_contact` and friends), so the form page can keep using `embed.js`.

## How it differs from `embed.js`

| | `embed.js` | `chat.js` |
| --- | --- | --- |
| Chat window | CloseBot's own script (cb.js), restyled with CSS on its class names | Drawn by the embed, inside a Shadow DOM (`<gmmc-chat>`), so site CSS and ours never clash |
| Who the visitor is | Fills CloseBot's hidden contact form and presses submit | Sends the details straight to CloseBot's identity endpoint as soon as the conversation exists |
| Visitor not known | CloseBot's form | A built-in form in the chat (name, email, phone), following CloseBot's **Form** settings; the message box waits until it's sent |
| Form answers note | Added to the first message by wrapping `fetch` | Added to the first message directly; AI-only note through `/api/note` once CloseBot knows the visitor |
| Breaks if | CloseBot renames its classes or form | CloseBot changes its chat endpoints (see Known risk) |

## What the chat does

- **Opening message:** CloseBot's Welcome Message if one is set, otherwise the greeting (`data-greeting`, default "Hey {first_name}, what can I help you with today?"). It is shown in the page only, never sent to CloseBot, and skipped when an earlier conversation comes back.
- **Conversation:** visitor and bot bubbles, typing dots while the AI writes (and "Dana is typing…" for a person on the team), links and **bold** in replies, attachments as images or file links. Enter sends, Shift+Enter starts a new line. A message that fails to send can be retried.
- **Coming back:** the conversation is stored per browser (`gmmchat_session_{source}` in localStorage) and resumed with its history. A different known visitor on the same browser gets a new conversation. If CloseBot no longer has the old one, a new one starts.
- **Connection:** replies stream in over server-sent events. If the stream drops, it reconnects with growing pauses (1s, 2s, 4s… up to 30s), asks for the history again and shows only what was missed. A watchdog reopens a stream that closed quietly or went silent after a message.
- **Layouts:** `inline` (default) fills the space where the tag is, at `data-height`. `bubble` adds a corner button that opens a window; on phones the window fills the screen. A tag in the page `<head>` uses the bubble. The bubble starts talking to CloseBot only when opened, unless the visitor is already known or has a conversation to come back to.
- **Settings from CloseBot:** title (`chatTitle`/`headerTitle`), color (`primaryColor`), Welcome Message, message box placeholder, online status, the "Powered by CloseBot" line (only when CloseBot's setting says so), message sound, dark theme (`themeMode`), launcher icon (`iconName`), the lead form's text, fields, button and default country, and a time-delay auto-open (desktop only, once per tab). Every setting is optional.
- **Accessibility:** labelled controls, `role="log"` with polite announcements for new messages, focus moves into the window on open and back to the button on close, Escape closes the bubble, visible focus rings, and no animation with reduced motion. Text on the brand color is kept at 4.5:1: a mid-tone color like the default green is deepened slightly where text sits on it, and light colors get dark text.
- **Call to action** (`data-cta`): the same card as `embed.js`, greeting the visitor by name; its button opens the bubble or puts the cursor in the inline chat. It goes away if the chat can't load within `data-cta-wait`.

## Attributes

All `embed.js` attributes are accepted. These apply:

| Attribute | Default | What it does |
| --- | --- | --- |
| `data-source` | none | CloseBot source ID (or CloseBot's script tag) |
| `data-layout` | `inline` | `inline` or `bubble` |
| `data-height` | `600px` | Inline chat height; on the bubble layout, the window height on desktop |
| `data-width` | `380px` | Bubble window width on desktop |
| `data-position` | right | `left` for the bubble on the left |
| `data-color` | CloseBot's, else `#40916C` | Brand color |
| `data-font`, `data-font-size`, `data-radius`, `data-background`, `data-text-color`, `data-bot-bubble`, `data-bot-text`, `data-visitor-bubble`, `data-visitor-text`, `data-header-text`, `data-header="hide"`, `data-shadow`, `data-border` | | As in `embed.js`, applied to this chat |
| `data-title` | CloseBot's title, else "Chat with us" | Header title |
| `data-timestamps` | off | `on` shows the time under each message (always in the hover title) |
| `data-greeting` | `Hey {first_name}, …` | Opening message when CloseBot has no Welcome Message; `off` for none |
| `data-fields`, `data-note`, `data-note-key`, `data-save-fields`, `data-api` | | Form answers for the AI, as in `embed.js` |
| `data-cta`, `data-cta-title`, `data-cta-text`, `data-cta-button`, `data-cta-wait`, `data-cta-target` | | Call to action, as in `embed.js` |
| `data-email`, `data-phone`, `data-first-name`, `data-last-name`, `data-name` | | HighLevel merge fields |
| `data-backend`, `data-hl-origins`, `data-debug` | | As in `embed.js` |
| `data-widget-key` | | The chat widget's own public key, to skip looking it up for the page (see below) |
| `data-closebot-api` | `https://api.closebot.com` | Where CloseBot's chat endpoints are (for tests) |

Ignored, because they only make sense for CloseBot's own widget: `data-autosubmit`, `data-form-timeout`, `data-closebot-src`, and the setup page's custom CSS (it targets CloseBot's class names).

Contact details come from the same places as `embed.js`, first match wins: the form page's saved details, HighLevel merge-field attributes, URL parameters (removed from the address bar as soon as the tag runs), then the backend lookup.

`window.GMMChatWidget` has `version`, `open()`, `close()` and `state()` (a snapshot for tests and debugging, with no contact details).

## CloseBot endpoints used

The same public endpoints CloseBot's widget script calls, with no API key. All of them are in the "transport" section of `chat.js`.

The source key in `data-source` is not the chat's key. Like cb.js, `chat.js` first asks CloseBot which chat widget targets the current page, and uses that widget's public key for everything else. So the page has to be targeted by one of the source's chat widgets in CloseBot (or the tag needs `data-widget-key`). If no widget targets the page, nothing shows, as with cb.js.

| Call | What for |
| --- | --- |
| `GET /chat-widget/source/{sourceKey}/widget-for-page?pageUrl=` | The chat widget's public key for this page: `{publicKey}`, or 204 for none |
| `GET /chat-widget/{key}/config` | Widget settings |
| `POST /chat-widget/{key}/session` `{visitorId, sessionId?}` | Start or resume a conversation: `{sessionId, resumedSession}` |
| `GET /chat-widget/{key}/session/{id}/stream[?backfill=true]` | Server-sent events: `connected`, `backfill-done`, `message-sent`, `ai_typing`, `human_typing` (others ignored) |
| `POST …/session/{id}/message` `{message}` | Visitor message |
| `POST …/session/{id}/identity` `{firstName, lastName, name, email, phone}` | Tie the conversation to the HighLevel contact (only known fields; phone as +1… for ten-digit numbers) |
| `POST …/session/{id}/typing` `{active}` | Visitor typing, at most every 3 seconds |
| `POST …/session/{id}/page-visit` `{url, title}` | The page, once per visit (after contact details are removed from the URL) |

## Known risk

These are CloseBot's widget endpoints, not part of CloseBot's published API docs. They were read from cb.js on 2026-10-20 and built against a mock (`test/fixtures/mock-closebot-api.js`). The page lookup, settings, starting a conversation and the stream's first event were checked live from greatmountainmarketing.com; the rest wasn't. CloseBot can change them without notice; if it does, this chat stops working until the transport section is updated, while `embed.js` (which uses CloseBot's own script) keeps working. Before relying on it, try the demo page against the live source and check:

- the source's allowed domains include the site (and `gmm-chatwidget.vercel.app` for the demo), since CloseBot checks the page's origin;
- `/identity` puts the conversation on the right HighLevel contact;
- the message and stream shapes match (a bot reply appears once, history comes back on reload).

Details read loosely because they couldn't be checked live: the settings may arrive wrapped in an object; lead-form `fields` may be names or objects; avatar and subtitle settings use guessed names; auto-open follows CloseBot's `autoOpenTriggers.timeOnPage` but only opens for the `open` action (a `preview` is ignored); the message `POST` may or may not return a `messageId` (the visitor's message is matched to CloseBot's echo by its text either way).

## Tests

```
NODE_PATH=$(npm root -g) node test/chat.test.js
node test/fixtures/mock-closebot-api.js 8796   # the mock on its own, for trying pages by hand
```
