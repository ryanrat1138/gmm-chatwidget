# GMM Chat Widget

A smart chat for form thank-you pages. After someone submits a HighLevel form, HighLevel survey or Typeform, the thank-you page opens a CloseBot AI chat that already knows what they submitted.

- **Sources:** HighLevel forms and surveys, Typeform (Typeform submissions create or update the HighLevel contact)
- **CRM of record:** HighLevel
- **AI:** CloseBot (API + chat widget)

See [docs/PLAN.md](docs/PLAN.md) for the architecture, data flow, security notes and phased build. The live version of the plan is at https://claude.ai/code/artifact/5025efa5-0f98-4b86-888c-340c0c85a75f

## Layout

| Path | What goes there |
| --- | --- |
| `api/` | (not built yet) Context service: webhook intake (HighLevel, Typeform), `/api/context`, CloseBot seeding |
| `loader/` | `gmm-chat-prefill.js`: fills and submits CloseBot's chat lead form in the background. Setup in [loader/README.md](loader/README.md) |
| `test/` | Browser tests for the loader against a mock CloseBot widget |
| `docs/` | Plan and setup notes |

## Hosting

Vercel builds from the GitHub repo on every push to `main`. The build copies `loader/gmm-chat-prefill.js` into `public/`, so only the script is served, at `https://<project>.vercel.app/gmm-chat-prefill.js`. Settings are in `vercel.json`. The `api/` service will deploy from the same project when it is built.

## Secrets

Never commit API keys. Put them in `.env.local` (ignored by git) or in the hosting provider's environment settings:

- `HIGHLEVEL_PRIVATE_TOKEN`
- `CLOSEBOT_API_KEY`
- `TYPEFORM_WEBHOOK_SECRET`
- `HIGHLEVEL_HOOK_SECRET`
