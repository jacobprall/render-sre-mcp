# Quickstart: Render MCP Server v2

## Prerequisites

- Node.js 20+
- A Render account with at least one deployed service
- A Render API key (Settings → API Keys in Dashboard)

## Local Use (stdio)

```bash
# Install and run
RENDER_API_KEY=rnd_xxxxx npx render-mcp-server

# Or clone and run from source
git clone https://github.com/render-oss/render-mcp-server-v2.git
cd render-mcp-server-v2
npm install
RENDER_API_KEY=rnd_xxxxx npm start
```

### Configure in Cursor

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

### Configure in Claude Desktop

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

## Hosted Use (HTTP on Render)

1. Deploy the MCP server to Render (one-click or Blueprint)
2. Note the service URL (e.g., `https://render-mcp.onrender.com`)
3. Configure your agent with the HTTP endpoint:

```json
{
  "mcpServers": {
    "render": {
      "url": "https://render-mcp.onrender.com/mcp",
      "headers": {
        "Authorization": "Bearer rnd_xxxxx"
      }
    }
  }
}
```

## Verify It Works

Once configured, ask your agent:

> "What Render services do I have running?"

The agent should answer from its tool descriptions — no tool call needed. You'll see your services, their IDs, status, and URLs listed in the tool panel.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RENDER_API_KEY` | Yes | — | Your Render API key |
| `PORT` | No | stdio | Set to enable HTTP mode (Render sets this automatically) |
| `RENDER_CACHE_TTL_MS` | No | 30000 | Topology cache staleness threshold (ms) |
| `RENDER_LOG_DEFAULT_WINDOW_MIN` | No | 10 | Default log summary time window (minutes) |
