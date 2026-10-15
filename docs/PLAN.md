# Thank You Page AI Chat Widget: Implementation Plan

Oct 15, 2026 · @Ryan

## Summary

Build one small context service that catches every form submission by webhook, keys it to a random one-time `ref` carried to the thank-you page, and hands that context to CloseBot so the AI opens the chat already knowing what the person submitted.

- **Sources:** HighLevel forms, HighLevel surveys, and Typeform. HighLevel is the single contact record. Typeform submissions create or update the HighLevel contact too, and CloseBot reads its contact data from HighLevel for every source.
- **AI:** CloseBot. Context reaches it through two documented routes: CRM contact fields it already reads, and AI-visible internal notes posted with `POST /lead/{leadId}/note` ([CloseBot API](https://developers.closebot.com/llms.txt)).
- **Minimal PII in URLs.** The thank-you page URL carries only the opaque `ref`; answers travel server to server, and name, email and phone appear only in the URL fallback, stripped on load.
- **One decision gates the front end.** CloseBot's documented widget embed is a bare `<div id="cb-widget-container">` with no way to pass a contact id ([embed docs](https://docs.closebot.com/en/articles/14646203-embedded-chat-widgets-and-custom-styling)). Phase 0 confirms with CloseBot whether the native widget can attach to a known HighLevel contact. If yes, use the native widget. If not, use a thin custom chat box on CloseBot's Blank (webhook) source, which takes a contact id on every message by design ([webhook source docs](https://docs.closebot.com/en/articles/16358483-custom-blank-source-channel-webhook)).
- **Default hosting:** a Vercel serverless project with a small key-value store, since Vercel is already connected to this workspace. Any host with HTTPS functions and a TTL store works. The code lives in a local git repo at C:\GMM-ChatWidget.

## Architecture

A single context service sits between the form tools, the CRM and CloseBot, so the browser never holds an API key or a submitted answer.

_(Architecture diagram: see the [live plan](https://claude.ai/code/artifact/5025efa5-0f98-4b86-888c-340c0c85a75f).)_

Forms post to the service by webhook; the service enriches from HighLevel and seeds CloseBot; the thank-you page asks the service for context by `ref` and hosts the chat.

| Component | Role | Built or configured |
| --- | --- | --- |
| Loader script | Mints and reads `ref`, renders greeting, mounts chat | Built, one `<script>` tag per client site |
| Context service | Webhook intake, enrichment, `ref` store, CloseBot seeding | Built, Vercel functions + KV |
| HighLevel workflows | Form Submitted / Survey Submitted to Custom Webhook | Configured per sub-account |
| Typeform webhook | Sends responses to the service | Configured per form |
| CloseBot source and bot | HighLevel source + widget (Route A) or Blank source (Route B) | Configured per client |

## Data flow per source

Every source follows the same four beats: mint a `ref` before submit, catch the submission by webhook, redirect with only the `ref`, then look up context on the thank-you page.

| Step | HighLevel form | HighLevel survey | Typeform |
| --- | --- | --- | --- |
| 1. Mint `ref` | Loader script on the form page creates a 128-bit random `ref`, stores it in a first-party cookie, and writes it into a hidden field `cb_ref` (HighLevel forms prefill hidden fields from URL parameters) | Same as forms, hidden field `cb_ref` | Pass `ref` as a URL parameter (formerly "hidden field") on the form link or embed |
| 2. Catch submission | Workflow trigger **Form Submitted** → **Custom Webhook** action POSTs `{{contact.id}}`, the `cb_ref` value, form id and location id, with a secret header ([action docs](https://help.gohighlevel.com/support/solutions/articles/155000003305-workflow-action-custom-webhook)) | Workflow trigger **Survey Submitted** → same Custom Webhook | Typeform webhook to the service, verified with `Typeform-Signature` ([docs](https://www.typeform.com/developers/webhooks/secure-your-webhooks/)) |
| 3. Enrich | Service fetches the contact and recent submission with a Private Integration token: `GET /contacts/{id}`, `GET /forms/submissions?q={contactId}` | `GET /surveys/submissions?q={contactId}` returns answers and custom field values ([docs](https://marketplace.gohighlevel.com/docs/ghl/surveys/get-surveys-submissions.md)) | Answers arrive in the webhook body. Service upserts a HighLevel contact by email and writes key answers to custom fields |
| 4. Redirect | On submit, open thank-you URL. `ref` comes from the cookie, or from a merge field in the redirect URL if Phase 0 shows that works | Same | Redirect on completion to `https://<site>/thank-you?ref=@ref` (recalling a URL parameter is supported, [docs](https://help.typeform.com/hc/en-us/articles/360050455852-Use-URL-parameters-in-redirect-links)) |
| 5. Load context | Thank-you page calls `GET /api/context?ref=…`; polls for up to about 10 s because the webhook can land after the redirect | Same | Same |
| 6. Start chat | Service seeds CloseBot (next section) and returns a short greeting summary to the page | Same | Same |

Stored per `ref`: source, form id, HighLevel contact id, CloseBot lead id once known, a normalized answer list, and a created-at time. It expires after 24 hours.

**Fallback order for identifying the visitor on the thank-you page:**

1. `ref` from the URL or the first-party cookie.
2. URL parameters with name, email and phone in the redirect (HighLevel merge fields or Typeform recall). The backend looks the contact up in HighLevel by email, then phone.
3. Email or phone typed into the chat's pre-chat form, matched by HighLevel's duplicate-contact rules.

Option 2 puts personal details in the address bar, so the loader limits the exposure: it runs first on the thank-you page, POSTs the values to the backend, then removes them from the URL with `history.replaceState` before the CloseBot pixel or any analytics loads. The page also sends `Referrer-Policy: no-referrer`. Form answers never go in the URL.

## Passing context to CloseBot

The bot sees the submission through CRM fields plus one AI-visible note, whichever widget route Phase 0 picks. All CloseBot calls go to `https://api.closebot.com` with the `X-CB-KEY` header, server side only.

| Mechanism | How | What the bot gets | Use it for |
| --- | --- | --- | --- |
| HighLevel contact fields | Service writes answers to HighLevel custom fields, for Typeform as well as HighLevel forms; CloseBot's HighLevel source reads contact data (`GET /lead/{leadId}?includeExternal=true` shows it) | Structured values the bot's job flows can branch on | Fields the bot should act on: service interest, budget, timeline |
| AI-visible note | `POST /lead/{leadId}/note` with `aiVisible: true`. Notes are never sent to the contact | A plain-language summary: "Just submitted *Free Consult* form. Wants X, timeline Y, asked Z." | Free-text answers and anything without a custom field |
| Lead fields | `PUT /lead/{leadId}` with `fields: [{field, value}]` | CloseBot-side fields | Values that don't belong in the CRM |

**Route A: native CloseBot widget (preferred if Phase 0 passes).** Install the Sales Intelligence Pixel and a widget scoped to the thank-you page. Once the widget conversation is tied to the HighLevel contact, the service finds the lead (`POST /lead/search` on the source, match `contactId`) and posts the note. Open question: how the widget learns who the visitor is. Its form settings can require name, email and phone before replying ([form settings](https://docs.closebot.com/en/articles/14645998-form-settings)), and HighLevel's duplicate-contact rules should then match the existing contact on email or phone. The cost is that the person retypes one detail they just submitted. Phase 0 tests this match.

**Route B (webhook fallback): custom chat box on a Blank (webhook) source.** A small chat box on the page talks to our service. The service posts each visitor message to `POST /webhook/event/{sourceId}` with `contactId` = the HighLevel contact id, the message, and `state` = `ref`. CloseBot sends replies to our outbound endpoint, which pushes them to the browser over server-sent events. The note and Contact Map supply the context. Cost: we build and style the chat UI, and the conversation lives in CloseBot rather than the HighLevel inbox unless we copy it back.

**Opening line.** In either route, the service can use CloseBot's "Send a message to a lead" endpoint, or let the bot's welcome message reference the note, so the chat opens with "Thanks, Sam. I saw you're interested in X, want to book a call?" rather than a generic hello.

## Auth, security and PII handling

Secrets stay on the server, the browser only ever holds an unguessable, short-lived `ref`, and every inbound webhook is verified before it is stored.

| Concern | Control |
| --- | --- |
| HighLevel API access | Private Integration token per sub-account, scopes limited to `contacts.readonly`, `contacts.write`, `forms.readonly`, `surveys.readonly`. Rotate every 90 days using "rotate and expire later" (old and new both work for 7 days) ([docs](https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken.md)) |
| CloseBot API access | One `X-CB-KEY` per agency account, stored as an environment secret, never shipped to the browser |
| Typeform webhook | Verify `Typeform-Signature`: HMAC SHA-256 over the raw body with the webhook secret, base64, `sha256=` prefix; constant-time compare |
| HighLevel workflow webhook | Custom header `X-Hook-Secret` with a long random value, checked on every call; reject unknown location ids |
| The `ref` | 128-bit random, URL-safe, expires after 24 hours, never derived from email or contact id. `/api/context` returns only a display summary (first name, form name, short answer recap), never email, phone or raw answers |
| PII in URLs and logs | Answers never go in URLs. Name, email and phone appear only in the URL fallback and are stripped before analytics or the CloseBot pixel load. Logs record `ref`, source and status only |
| Browser endpoints | CORS limited to each client's thank-you domains; rate limit `/api/context` and chat endpoints per IP and per `ref` |
| Retention | Submission cache deleted at 24 hours. HighLevel and CloseBot remain the long-term records under the client's existing policies |
| Consent | Thank-you page states that the assistant uses the details just submitted, with a link to the client's privacy policy |

## Phased build

Six phases, each ending in something testable on a real form. Phase 0 is short and decides the widget route before any UI is built.

1. **Phase 0: Verify against live accounts.**
   - Ask CloseBot support whether the native widget can attach to an existing HighLevel contact (pixel identity, a JS hook, or a URL parameter). Also test matching on email or phone: start a widget chat, enter the email or phone used on the form, and confirm it lands on the existing contact, not a duplicate.
   - Test whether a HighLevel form's redirect URL resolves `{{contact.id}}` or a hidden field value; test that `cb_ref` prefills on an embedded form.
   - Confirm `GET /forms/submissions` mirrors the surveys endpoint and returns custom field values.
   - *Done when:* the widget route (A or B) is chosen and each source's `ref` handoff is proven by hand.
2. **Phase 1: Context service.**
   - Endpoints: `POST /hooks/typeform`, `POST /hooks/highlevel`, `GET /api/context`. Per-client config maps form ids to HighLevel location, token and CloseBot source.
   - Key-value store with 24-hour TTL; signature and secret checks. The Typeform hook creates or updates the HighLevel contact (matched on email, then phone, following the location's duplicate-contact rules) and writes answers to custom fields.
   - *Done when:* a test submission from each of the three sources lands under its `ref` and `/api/context` returns the redacted summary.
3. **Phase 2: Thank-you page and loader.**
   - One script tag for client sites: mints `ref` on form pages, reads it on the thank-you page, polls `/api/context`, renders a personalized greeting.
   - Works on HighLevel funnel pages (custom code element) and on external sites.
   - *Done when:* submitting each form shows "Thanks, {first name}" with the right form name within 10 seconds.
4. **Phase 3: CloseBot hookup.**
   - Route A: pixel and widget scoped to the thank-you page; service finds the lead and posts the AI-visible note.
   - Route B: Blank source configured (inbound mapping, outbound endpoint, Contact Map), chat box with server-sent events.
   - *Done when:* the bot's first reply references a detail only the submission contained, for all three sources.
5. **Phase 4: CRM sync.**
   - Conversation summary or transcript written back as a HighLevel note; tag the contact `ty-chat-engaged`.
   - *Done when:* a sales rep sees the submission and the chat outcome on the HighLevel contact without opening CloseBot.
6. **Phase 5: Harden and roll out.**
   - Rate limits, error alerts, token rotation runbook, a per-client onboarding checklist, and a fallback that shows the plain thank-you message if context or chat fails.
   - *Done when:* one pilot client runs for two weeks with no lost context and the fallback verified.

## Risks and open questions

The largest unknown is identity in CloseBot's native widget; everything else has a documented path.

| Risk or question | Impact | Fallback |
| --- | --- | --- |
| Native widget can't be tied to a known contact | Bot starts blind or asks the person to retype details | Route B custom chat box on a Blank source |
| HighLevel redirect can't carry `ref` or contact id (merge fields in redirect URLs are an open feature request, [ideas board](https://ideas.gohighlevel.com/forms/p/in-form-builder-on-submit-redirect-to-url-allow-using-custom-values-and-merge-fi)) | Thank-you page can't find its context | First-party cookie set by the loader on the form page; requires form and thank-you page on the same site |
| Webhook lands after the redirect | Empty first render | Poll `/api/context` up to about 10 s, then start the chat without context and add the note when it arrives |
| HighLevel form embedded in an iframe on another domain | Cookie and hidden-field prefill may not cross the frame | Pass `cb_ref` in the embed URL; verify in Phase 0 |
| CloseBot API changes or rate limits | Notes or messages fail | Retry with backoff; the chat still works without the note |
| Who builds and hosts it | Shapes Phase 1 | Default is a Vercel project owned by the agency; confirm before Phase 1 |

## Name ideas

Shortlist: **Carryover** or **Afterform** say what the product does, while **Cairn** fits the Great Mountain brand. None has been checked for trademarks or domains yet. Basecamp (37signals) and Trailhead (Salesforce) are taken and were dropped.

| Name | Angle | Why it fits |
| --- | --- | --- |
| Carryover | Smart chat | Carries the form answers straight into the conversation |
| Afterform | Smart chat | Made-up word, easy to own; the chat that comes after the form |
| Primed | Smart chat | The chat opens already primed with what the visitor just told you |
| FormAware | Smart chat | Says plainly that the chat knows the form |
| Answerback | Smart chat | Answers back using the person's own answers |
| SubmitSense | Smart chat | Makes sense of the submission the moment it lands |
| Cairn | Mountain | Trail-marker stones; the chat marks the next step after the form |
| Foothold | Mountain | The first grip on a lead right after they submit |
| Switchback | Mountain | Turns the visitor back toward booking |
| Ridgeline | Mountain | The view of what comes next |
| Warm Handoff | Sales | The lead never goes cold between form and human |
| FollowThrough | Sales | Picks up right where the form left off |
