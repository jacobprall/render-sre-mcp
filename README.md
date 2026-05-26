# render-mcp-server

An MCP server that gives AI agents a live view of your Render infrastructure through **dynamic tool descriptions** — the agent sees your services, their health, URLs, and IDs directly in its tool listing, with no discovery calls needed.

## Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/YOUR_ORG/render-mcp-server)

1. Click the button above (or use the Blueprint below)
2. Enter your [Render API key](https://render.com/docs/api#creating-an-api-key) when prompted
3. Once deployed, copy your service URL (e.g. `https://render-mcp-server-xxxx.onrender.com`)
4. Add to your agent's MCP config:

```json
{
  "mcpServers": {
    "render": {
      "url": "https://render-mcp-server-xxxx.onrender.com/mcp",
      "headers": {
        "Authorization": "Bearer rnd_xxxxx"
      }
    }
  }
}
```

That's it — your agent now has full infrastructure awareness.

## Quick Start (Local)

### stdio mode

```bash
RENDER_API_KEY=rnd_xxxxx npx render-mcp-server
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "render": {
      "command": "npx",
      "args": ["render-mcp-server"],
      "env": {
        "RENDER_API_KEY": "rnd_xxxxx"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "render": {
      "command": "npx",
      "args": ["render-mcp-server"],
      "env": {
        "RENDER_API_KEY": "rnd_xxxxx"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `render_deploy` | Trigger a deploy on any service |
| `render_logs` | Retrieve processed log summaries (deduplicated errors, patterns, correlations) or raw lines |
| `render_env_vars` | List or set environment variables |
| `render_inspect` | Get detailed resource info (plan, region, deploys, crash details, connection strings) |
| `render_restart` | Restart a service without a full deploy |
| `render_run_command` | Execute a one-off command in a service's environment |

Every tool description embeds a live topology table showing your services, databases, and key-value stores with their current status. The agent knows what's running before making any tool call.

## How It Works

```
Agent calls tools/list
       │
       ▼
┌──────────────────────────┐
│  TopologyCache           │
│  • Fetches services,     │
│    databases, KV stores  │
│  • Counts errors per svc │
│  • Builds descriptions   │
└──────────┬───────────────┘
           │
           ▼
Tool descriptions include:
  srv-cx7q │ my-api    │ web    │ deployed │ https://my-api.onrender.com
  srv-ab3p │ my-worker │ worker │ deployed
  dpg-kf8n │ my-db     │ postgres│ available
```

When infrastructure state changes, the cache refreshes (30s TTL) and sends `notifications/tools/list_changed` so the agent's worldview stays current.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RENDER_API_KEY` | Yes | — | Your Render API key |
| `PORT` | No | stdio | Set to enable HTTP mode |
| `RENDER_CACHE_TTL_MS` | No | 30000 | Cache staleness threshold (ms) |
| `RENDER_LOG_DEFAULT_WINDOW_MIN` | No | 10 | Default log summary window (minutes) |

## Development

```bash
npm install
npm run dev    # Run with tsx (hot reload)
npm run build  # Compile TypeScript
npm start      # Run compiled JS
```
