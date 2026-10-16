# Techzolo WhatsApp CRM

Techzolo WhatsApp CRM helps teams manage WhatsApp conversations, contacts,
sales pipelines, broadcasts, and automations in one place.

Built with Next.js, React, TypeScript, Tailwind CSS, and Supabase.

## Features

- Shared inbox with contact details and conversation history.
- Contact management, sales pipelines, and team member roles.
- WhatsApp message templates and broadcast campaigns.
- Automations, visual flows, and AI agents with your own provider keys.
- Public API, outbound webhooks, and an optional MCP server.
- English, Spanish, Portuguese, and Korean interfaces.

## Run locally

Use Node.js 20 or later and npm. You also need a Supabase project and Meta
WhatsApp Business API credentials to connect a WhatsApp number.

```bash
git clone https://github.com/Kartikgauttam14/WhatsApp-.git
cd WhatsApp-
npm install
cp .env.local.example .env.local
```

On PowerShell, use `Copy-Item .env.local.example .env.local` for the last step.
Fill in the Supabase and Meta configuration described in the example file.
Keep service-role keys, provider keys, and encryption secrets private.

Apply the SQL files in `supabase/migrations/` in filename order to your
Supabase project, then start the app:

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000) and create your account.
Set `NEXT_PUBLIC_SITE_URL` to your deployment URL when deploying publicly.

## Development

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Run the production build with `npm start`.

## Documentation

- [Docker deployment](docs/docker.md)
- [Authentication emails](docs/auth-emails.md)
- [WhatsApp connection troubleshooting](docs/whatsapp-connection-troubleshooting.md)
- [Multiple WhatsApp Business Accounts](docs/multi-waba.md)
- [Public API and webhooks](docs/public-api.md)
- [MCP integration](docs/mcp.md)
- [Contributing](CONTRIBUTING.md)

Existing `wacrm_live_` API keys, `X-Wacrm-*` webhook headers, `WACRM_*`
MCP settings, and the published `wacrm-mcp` package remain compatible.
These identifiers are retained for integrations; the product name is
**Techzolo WhatsApp CRM**.

## License and attribution

MIT licensed; see [LICENSE](LICENSE). Techzolo WhatsApp CRM is based on
[ArnasDon/wacrm](https://github.com/ArnasDon/wacrm). Original copyright
notices and historical release notes are preserved.

WhatsApp is a trademark of its respective owner. This project is not
affiliated with or endorsed by Meta or WhatsApp.
