# render-sre-mcp

An MCP server that connects AI coding agents to your [Render](https://render.com) workspace. Use it from Cursor or any MCP client to inspect services, read logs and metrics, understand deploy history, diagnose incidents, and take remedial action.

## What you can do

- **Investigate problems** — Pull log summaries (deduplicated errors, HTTP patterns), metrics vs limits, and recent deploys. Use `render_observe` with `mode: bundle` for all three at once, or `render_diagnose` for a structured incident brief with a suggested cause and next steps.
- **Inspect a resource** — Plan, region, connection info, last deploy, and crash details for any service, database, or key-value store.
- **Ship and operate** — Trigger deploys, restart services, run one-off commands (migrations, seeds), manage environment variables, and change platform settings (plan, scaling, health checks) with guardrails on risky changes.

## Tools and resources

### Workspace inventory (read first)

- **`render://workspace`** — MCP resource with a fresh view of your workspace: service, Postgres, and Redis IDs, types, status, and deploy hints when available. Refreshes on a short cache interval, after deploys, and via webhooks on hosted deployments. Read this before calling other tools so you have the right `resourceId` or `serviceId`.

### Tools

- **`render_workspace`** — Deep inspect of one resource (`resourceId`): plan, region, connections, last deploy.
- **`render_observe`** — Logs, metrics, deploy history, or all three in one call (`resourceId`, `mode`).
  - Modes: `bundle` (default), `logs`, `metrics`, `deploys`
  - Pass `raw: true` on logs or metrics for unprocessed output
- **`render_diagnose`** — Incident brief for a service or Postgres (`resourceId`): likely cause, evidence, suggested next steps.
- **`render_deploy`** — Start a deploy (`serviceId`, optional `clearCache`).
- **`render_service`** — Operate on a service (`serviceId`, `action`): `restart`, `run_command`, `env_vars`, `configure`
  - `env_vars`: `envAction` `list` or `set`; `reveal: true` to show values
  - `configure`: plan downgrades and enabling auto-deploy need `confirmed: true` and user approval in chat

You can also copy resource IDs from the Render Dashboard if your client does not read MCP resources.

## Quick start (local)

```bash
cd render-agent  # or your clone path
npm install
npm run build
export RENDER_API_KEY=rnd_xxxxx
```

Add to Cursor (`.cursor/mcp.json` or MCP settings):

```json
{
  "mcpServers": {
    "render": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/path/to/render-agent",
      "env": {
        "RENDER_API_KEY": "rnd_xxxxx"
      }
    }
  }
}
```

Restart the MCP server in Cursor after code changes (`npm run build`).

## Hosted on Render

Deploy from this repo's `render.yaml` (service name `render-mcp-server`).

1. Create a Blueprint from the repo.
2. Set `RENDER_API_KEY` in the service environment.
3. Optionally set `MCP_AUTH_TOKEN` if you want a separate token for MCP clients (defaults to `RENDER_API_KEY`).

Your MCP endpoint is `https://<your-service>.onrender.com/mcp` with `Authorization: Bearer <token>`.

| Path | Purpose |
|------|---------|
| `/mcp` | MCP over HTTP |
| `/health` | Health check |
| `/webhooks/render` | Workspace webhooks (optional) |

### Webhooks (optional)

On Professional workspaces, you can register a webhook so deploy and build events update the live workspace inventory without polling.

1. Set `RENDER_WEBHOOK_SECRET` on the MCP service (from Dashboard → Integrations → Webhooks).
2. URL: `https://<your-service>.onrender.com/webhooks/render`
3. Subscribe to deploy and build started/ended events.

See [specs/001-webhook-deploy-updates/quickstart.md](specs/001-webhook-deploy-updates/quickstart.md) for setup and verification.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RENDER_API_KEY` | Yes | Render API key |
| `MCP_AUTH_TOKEN` | No | Bearer token for MCP clients (defaults to `RENDER_API_KEY`) |
| `PORT` | No | When set, runs HTTP server; otherwise stdio |
| `RENDER_CACHE_TTL_MS` | No | How often workspace inventory refreshes (default 30000) |
| `RENDER_LOG_DEFAULT_WINDOW_MIN` | No | Default log lookback in minutes (default 10) |
| `RENDER_WEBHOOK_SECRET` | No | Enables webhook endpoint in HTTP mode |
| `RENDER_WEBHOOK_DEBOUNCE_MS` | No | Webhook notify debounce in ms (default 2000) |

## Requirements

- Node.js 20+
