# render-sre-mcp

An SRE teammate for your Render infrastructure, delivered via MCP server. Connects to any MCP client and gives AI agents the ability to efficiently diagnose incidents, inspect resources, read metrics, and take safe remedial actions.

## What it does

- **Live topology** — Cached infrastructure state embedded in every tool description. Agents always see your current services, error counts, and resource pressure.
- **Incident diagnosis** — `render_diagnose` builds a one-shot brief from logs, deploys, and metrics with a confidence-rated hypothesis and suggested next steps.
- **Log analysis** — `render_logs` deduplicates error patterns, summarizes HTTP traffic, and detects correlations (or returns raw lines on demand).
- **Metrics** — `render_metrics` compares peaks to limits for memory, CPU, latency, and connections.
- **Deploy history** — `render_deploys` timelines recent deploys and flags regression candidates within 30 min of go-live.
- **Resource inspection** — `render_inspect` deep-dives any service, Postgres, or Key Value store.
- **Remediation** — `render_deploy`, `render_restart`, `render_run_command`, `render_env_vars`, and `render_configure` with tiered safety: safe changes apply immediately, risky changes require explicit confirmation.

## Deploy on Render

1. Create a Blueprint from this repo's `render.yaml`.
2. Set `RENDER_API_KEY` (Dashboard → Environment).
3. Optionally set `MCP_AUTH_TOKEN` for a separate client auth token (defaults to `RENDER_API_KEY`).
4. Note the service URL after deploy (e.g. `https://render-mcp-server.onrender.com`).

The server exposes MCP at `/mcp`, a health check at `/health`, and optionally `POST /webhooks/render` when `RENDER_WEBHOOK_SECRET` is set.

### Webhooks (hosted, optional)

Push deploy/build events into live tool descriptions without polling the API. Requires a **Professional** (or higher) Render workspace.

1. Set `RENDER_WEBHOOK_SECRET` on the MCP service (signing secret from Dashboard → Workspace → Integrations → Webhooks).
2. Register webhook URL: `https://YOUR-SERVICE.onrender.com/webhooks/render`
3. Subscribe to: Deploy started/ended, Build started/ended

See [specs/001-webhook-deploy-updates/quickstart.md](specs/001-webhook-deploy-updates/quickstart.md) for verification steps.

## Connect

### Hosted (HTTP)

Use your Render service URL with the auth token as the `Authorization` bearer:

```json
{
  "mcpServers": {
    "render": {
      "url": "https://YOUR-SERVICE.onrender.com/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_AUTH_TOKEN or RENDER_API_KEY>"
      }
    }
  }
}
```

### Local (stdio)

Clone the repo, set your key, and point Cursor at the project:

```bash
export RENDER_API_KEY=rnd_xxxxx
npm install
npm run dev
```

```json
{
  "mcpServers": {
    "render": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/render-agent",
      "env": {
        "RENDER_API_KEY": "rnd_xxxxx"
      }
    }
  }
}
```

Without `PORT`, the server runs in stdio mode. With `PORT` set, it serves HTTP with Bearer auth on `/mcp`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RENDER_API_KEY` | Yes | Render API key for accessing the Render platform |
| `MCP_AUTH_TOKEN` | No | Separate token for authenticating MCP clients (defaults to `RENDER_API_KEY`) |
| `PORT` | No | Set to enable HTTP mode (otherwise uses stdio) |
| `RENDER_CACHE_TTL_MS` | No | Topology cache TTL in ms (default: 30000) |
| `RENDER_LOG_DEFAULT_WINDOW_MIN` | No | Default log window in minutes (default: 10) |
| `RENDER_WEBHOOK_SECRET` | No | Webhook signing secret; enables `POST /webhooks/render` in HTTP mode |
| `RENDER_WEBHOOK_DEBOUNCE_MS` | No | Debounce for MCP `tools/listChanged` after webhooks (default: 2000) |

## Requirements

- Node.js >= 20.0.0

## Notes

Platform API access is implemented in `src/api/` as a thin REST client against `https://api.render.com/v1` (no third-party Render npm client).

Live topology in tool descriptions relies on the MCP `tools/listChanged` notification and dynamic tool description updates. This is an experimental part of the MCP specification—client support varies. Cursor supports it; other clients may display stale descriptions until they implement the notification handler.
