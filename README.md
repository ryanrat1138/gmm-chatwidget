# GMM Chat Widget

A smart chat for form thank-you pages. After someone submits a HighLevel form, HighLevel survey or Typeform, the thank-you page opens a CloseBot AI chat that already knows what they submitted.

- **Sources:** HighLevel forms and surveys, Typeform (Typeform submissions create or update the HighLevel contact)
- **CRM of record:** HighLevel
- **AI:** CloseBot (API + chat widget)

**Setup:** open https://gmm-chatwidget.vercel.app and follow its five steps: CloseBot (paste the source ID), Your form, Chat style, Install (copy the tag onto the thank-you page) and Test. A second, chat-free tag goes on the form page when the form is on your own site, and Typeform users get the redirect link to set up.

See [docs/PLAN.md](docs/PLAN.md) for the architecture, data flow, security notes and phased build. The live version of the plan is at https://claude.ai/code/artifact/5025efa5-0f98-4b86-888c-340c0c85a75f

## Layout

| Path | What goes there |
| --- | --- |
| `api/` | `fields.js`: `POST /api/fields` saves extra details from the thank-you page (e.g. `business_info`) to the HighLevel contact. `note.js`: `POST /api/note` adds the thank-you page's form answers to the visitor's CloseBot conversation as a note only the AI sees. `typeform.js`: `POST /api/typeform` reads a Typeform's questions for the setup page, with the visitor's own token (read only, not stored). Webhook intake and `/api/context` are not built yet |
| `loader/` | `embed.js`: the one-tag embed. Loads CloseBot's chat and fills its contact form in the background. Details in [loader/README.md](loader/README.md) |
| `site/` | The step-by-step setup page served at the project's root URL, and its guide |
| `test/` | Browser tests for the embed against a mock CloseBot widget |
| `docs/` | Plan and setup notes |

## Hosting

Vercel builds from the GitHub repo on every push to `main`. The build copies `loader/embed.js`, `site/index.html` and `site/guide.html` into `public/`, so only the embed (`/embed.js`), the setup page (`/`) and its guide (`/guide.html`) are served. Settings are in `vercel.json`. Functions in `api/` deploy from the same project.

### Extra details for the AI (`/api/fields`)

Optional: by default the embed passes `data-fields` answers to the AI with the visitor's first chat message (see `loader/README.md`). With `data-save-fields="true"` it also sends them to `POST /api/fields`, which upserts the HighLevel contact by email or phone and sets the matching custom fields. CloseBot gives the AI every field on the contact. To turn it on, set these in the Vercel project's environment variables and redeploy:

- `HIGHLEVEL_PRIVATE_TOKEN`: a sub-account Private Integration Token with `contacts.write` and `locations/customFields.readonly`
- `HIGHLEVEL_LOCATION_ID`: the sub-account id
- `ALLOWED_FIELDS`: custom field keys pages may set, without `contact.` (e.g. `business_info`)
- `ALLOWED_ORIGINS`: the sites allowed to call it (e.g. `https://greatmountainmarketing.com`)

Each key must already exist as a contact custom field in HighLevel. The service works with one HighLevel sub-account.

### Form answers as an AI-only note (`/api/note`)

With a CloseBot API key, the embed's `data-fields` answers go on the visitor's CloseBot conversation as an internal note that only the AI sees (CloseBot's `POST /lead/{leadId}/note` with `aiVisible`), instead of riding along with their first message. The service finds the conversation by searching CloseBot's leads for the visitor's email or phone, retrying for a few seconds while CloseBot creates it, and only uses a lead that matches the visitor and has been active in the last hour. When there's no key or no match, the embed falls back to the first-message note. To turn it on, set these in the Vercel project's environment variables and redeploy:

- `CLOSEBOT_API_KEY`: a key from CloseBot's Settings > API Keys (app.closebot.com/settings?tab=keys)
- `ALLOWED_ORIGINS`: the sites allowed to call it (shared with `/api/fields`)
- `CLOSEBOT_SOURCE_IDS` (optional): CloseBot source ids to search in, comma separated
- `HIGHLEVEL_PRIVATE_TOKEN` and `HIGHLEVEL_LOCATION_ID` (optional): also match the lead by its HighLevel contact id

Like `/api/fields`, anyone who knows a visitor's email can call it from an allowed origin, so the note is labelled as answers given by the visitor, values are capped at 500 characters, and quiet conversations are left alone.

## Secrets

Never commit API keys. Put them in `.env.local` (ignored by git) or in the hosting provider's environment settings:

- `HIGHLEVEL_PRIVATE_TOKEN`
- `HIGHLEVEL_LOCATION_ID`
- `CLOSEBOT_API_KEY`
- `TYPEFORM_WEBHOOK_SECRET`
- `HIGHLEVEL_HOOK_SECRET`
