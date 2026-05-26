# render-mcp-server

MCP server for operating Render infrastructure from Cursor and other MCP clients.

## Deploy on Render

1. Create a new Blueprint from this repo's `render.yaml`.
2. Set `RENDER_API_KEY` in the service's environment (Dashboard → Environment).
3. Optionally set `MCP_AUTH_TOKEN` for a separate client auth token (defaults to `RENDER_API_KEY` if unset).
4. After deploy, note the service URL (e.g. `https://render-mcp-server.onrender.com`).

The service listens on `PORT` and exposes MCP at `/mcp` and health at `/health`.

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

Without `PORT`, the server uses stdio. With `PORT` set, it serves HTTP and requires the `Authorization: Bearer` header on `/mcp`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RENDER_API_KEY` | Yes | Render API key for accessing the Render platform |
| `MCP_AUTH_TOKEN` | No | Separate token for authenticating MCP clients (defaults to `RENDER_API_KEY`) |
| `PORT` | No | Set to enable HTTP mode (otherwise uses stdio) |
| `RENDER_CACHE_TTL_MS` | No | Topology cache TTL in ms (default: 30000) |
| `RENDER_LOG_DEFAULT_WINDOW_MIN` | No | Default log window in minutes (default: 10) |

## Requirements

- Node.js >= 20.0.0
