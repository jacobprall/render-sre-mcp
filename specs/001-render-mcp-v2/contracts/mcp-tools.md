# MCP Tools Contract: Render MCP Server v2

This document defines the exact MCP tool interface exposed to clients. Each tool specifies its name, dynamic description format, input schema, and output shape.

---

## Tool 1: `render_deploy`

### Description (dynamic)

```
Trigger a deploy on a Render service.

Services:
srv-cx7q │ my-api    │ web     │ deployed │ https://my-api.onrender.com
srv-ab3p │ my-worker │ worker  │ deployed
srv-mn4r │ my-cron   │ cron    │ deployed
```

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "serviceId": {
      "type": "string",
      "description": "Service ID to deploy",
      "enum": ["srv-cx7q", "srv-ab3p", "srv-mn4r"]
    },
    "clearCache": {
      "type": "boolean",
      "description": "Clear build cache before deploying",
      "default": false
    }
  },
  "required": ["serviceId"]
}
```

### Output

```json
{
  "content": [{
    "type": "text",
    "text": "Deploy triggered on my-api (srv-cx7q)\nDeploy ID: dep-abc123\nStatus: build_in_progress\nCommit: abc1234 — Fix auth middleware"
  }]
}
```

---

## Tool 2: `render_logs`

### Description (dynamic)

```
Retrieve and analyze logs from a Render resource. Returns a processed summary by default (deduplicated errors, patterns, correlations). Pass raw: true for unprocessed lines.

Resources:
srv-cx7q │ my-api    │ web     │ clean
srv-ab3p │ my-worker │ worker  │ 12 errors in last 10m
dpg-kf8n │ my-db     │ postgres│ clean
red-pq2r │ my-cache  │ redis   │ clean
```

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "resourceId": {
      "type": "string",
      "description": "Resource ID to get logs from",
      "enum": ["srv-cx7q", "srv-ab3p", "dpg-kf8n", "red-pq2r"]
    },
    "raw": {
      "type": "boolean",
      "description": "Return unprocessed log lines instead of summary",
      "default": false
    },
    "severity": {
      "type": "string",
      "enum": ["error", "warning", "info"],
      "description": "Filter by severity (raw mode only)"
    },
    "startTime": {
      "type": "string",
      "format": "date-time",
      "description": "Start of time window (ISO 8601). Default: 10 minutes ago"
    },
    "endTime": {
      "type": "string",
      "format": "date-time",
      "description": "End of time window (ISO 8601). Default: now"
    },
    "search": {
      "type": "string",
      "description": "Text search filter (raw mode only)"
    },
    "limit": {
      "type": "number",
      "description": "Max lines to return (raw mode only, default: 100)"
    }
  },
  "required": ["resourceId"]
}
```

### Output (summary mode)

```json
{
  "content": [{
    "type": "text",
    "text": "## Logs: my-worker (srv-ab3p) — last 10 minutes\n\n### Error Patterns\n1. \"Out of memory\" × 12 | first: 19:00:03 | last: 19:09:47 | still active\n   Sample: Worker process killed: OOMKilled (exit 137), RSS 512MB\n\n### Correlations\n- \"Out of memory\" co-occurs with \"redis connection refused\" (same 30s window)\n\n### Signals\n- ⚠ Error spike: 12 OOM errors in 10m (vs 0 in previous window)\n- ⚠ New error type: \"redis connection refused\" first seen 19:00:05"
  }]
}
```

### Output (raw mode)

```json
{
  "content": [{
    "type": "text",
    "text": "2026-05-25T19:00:03Z [error] Worker process killed: OOMKilled (exit 137), RSS 512MB\n2026-05-25T19:00:05Z [error] Error: connect ECONNREFUSED 10.0.0.5:6379\n..."
  }]
}
```

---

## Tool 3: `render_env_vars`

### Description (dynamic)

```
Read or set environment variables on a Render service.

Services:
srv-cx7q │ my-api    │ 14 env vars
srv-ab3p │ my-worker │ 8 env vars
srv-mn4r │ my-cron   │ 3 env vars
```

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "serviceId": {
      "type": "string",
      "description": "Service ID",
      "enum": ["srv-cx7q", "srv-ab3p", "srv-mn4r"]
    },
    "action": {
      "type": "string",
      "enum": ["list", "set"],
      "description": "List current env vars or set new values",
      "default": "list"
    },
    "reveal": {
      "type": "boolean",
      "description": "Show actual values instead of masked (list action only)",
      "default": false
    },
    "vars": {
      "type": "object",
      "description": "Key-value pairs to set (set action only)",
      "additionalProperties": { "type": "string" }
    }
  },
  "required": ["serviceId"]
}
```

### Output (list)

```json
{
  "content": [{
    "type": "text",
    "text": "Environment variables for my-api (srv-cx7q):\nDATABASE_URL = ****\nREDIS_URL = ****\nNODE_ENV = production\nPORT = 10000\n... (14 total)"
  }]
}
```

### Output (set)

```json
{
  "content": [{
    "type": "text",
    "text": "Set 1 env var on my-api (srv-cx7q):\n  STRIPE_SECRET_KEY = ****\n\nNote: Changes take effect on next deploy. Run render_deploy to apply now."
  }]
}
```

---

## Tool 4: `render_inspect`

### Description (dynamic)

```
Get detailed information about any Render resource — plan, region, last deploy, crash details, connection info.

Resources:
srv-cx7q │ my-api    │ web     │ deployed │ https://my-api.onrender.com
srv-ab3p │ my-worker │ worker  │ failed   │ OOMKilled 3m ago
dpg-kf8n │ my-db     │ postgres│ available
red-pq2r │ my-cache  │ redis   │ available
```

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "resourceId": {
      "type": "string",
      "description": "Resource ID to inspect",
      "enum": ["srv-cx7q", "srv-ab3p", "dpg-kf8n", "red-pq2r"]
    }
  },
  "required": ["resourceId"]
}
```

### Output (service)

```json
{
  "content": [{
    "type": "text",
    "text": "## my-worker (srv-ab3p)\nType: worker\nPlan: starter\nRegion: oregon\nBranch: main\nCreated: 2026-03-15\n\n### Last Deploy\nID: dep-xyz789\nStatus: update_failed\nCommit: def5678 — Add batch processor\nStarted: 2026-05-25T18:55:00Z\nFinished: 2026-05-25T18:57:30Z\n\n### Failure Details\nExit code: 137 (OOMKilled)\nMemory at crash: 512MB / 512MB\nRestart count (last hour): 4"
  }]
}
```

### Output (database)

```json
{
  "content": [{
    "type": "text",
    "text": "## my-db (dpg-kf8n)\nType: postgres\nVersion: 16\nPlan: basic_256mb\nRegion: oregon\nStatus: available\nDisk: 1.2GB / 10GB\n\n### Connection\nInternal: postgres://my_db_user:****@dpg-kf8n/my_db\nExternal: postgres://my_db_user:****@dpg-kf8n-external.oregon.render.com/my_db"
  }]
}
```

---

## Tool 5: `render_restart`

### Description (dynamic)

```
Restart a running service without triggering a full deploy (no rebuild).

Services:
srv-cx7q │ my-api    │ web     │ deployed
srv-ab3p │ my-worker │ worker  │ failed
```

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "serviceId": {
      "type": "string",
      "description": "Service ID to restart",
      "enum": ["srv-cx7q", "srv-ab3p"]
    }
  },
  "required": ["serviceId"]
}
```

### Output

```json
{
  "content": [{
    "type": "text",
    "text": "Restarted my-worker (srv-ab3p)\nNew instance started at 2026-05-25T19:15:00Z"
  }]
}
```

---

## Tool 6: `render_run_command`

### Description (dynamic)

```
Execute a one-off command in a service's environment (e.g., migrations, seed scripts).

Services:
srv-cx7q │ my-api    │ web     │ deployed
srv-ab3p │ my-worker │ worker  │ deployed
```

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "serviceId": {
      "type": "string",
      "description": "Service to run the command on",
      "enum": ["srv-cx7q", "srv-ab3p"]
    },
    "command": {
      "type": "string",
      "description": "Command to execute (e.g., 'npx prisma migrate deploy')"
    }
  },
  "required": ["serviceId", "command"]
}
```

### Output

```json
{
  "content": [{
    "type": "text",
    "text": "## Command: npx prisma migrate deploy\nService: my-api (srv-cx7q)\nExit code: 0\n\nOutput:\nPrisma Migrate applied 2 migrations:\n  20260525_add_users_table\n  20260525_add_sessions_table\n\nAll migrations applied successfully."
  }]
}
```

---

## Dynamic Description Generation Rules

1. **Topology table** is appended to every tool description. Each line: `id │ name │ type │ status [│ url]`
2. **Enum arrays** in input schemas are rebuilt from the topology cache on every `tools/list` call.
3. **Error indicators** (logs tool only) are computed from a lightweight log query during description generation.
4. **Env var counts** (env vars tool only) are fetched during topology refresh and cached.
5. **Max description size**: ~100 tokens for the topology section. For accounts with 50+ resources, all resources are shown (one line each stays well under context limits).

## Notification Contract

When the topology changes (detected via lazy refresh or webhook), the server sends:

```json
{"jsonrpc": "2.0", "method": "notifications/tools/list_changed"}
```

Clients that support this notification re-fetch `tools/list` to get updated descriptions and enum values.
