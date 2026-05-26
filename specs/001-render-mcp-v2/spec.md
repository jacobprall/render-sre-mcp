# Feature Specification: Render MCP Server v2

## Overview

A Model Context Protocol (MCP) server that gives AI agents a live, always-current view of a user's Render infrastructure and lets them operate on it without the user leaving the agent interface. Unlike the existing Render MCP server (which wraps individual API calls as static tools), this server uses **dynamic tool descriptions** — tool listings that are computed at request time from live Render API data — so the agent already knows what services exist, their health, URLs, and IDs before making any tool call.

The server replaces the Render Dashboard for day-to-day agent-driven workflows: deploying code, reading logs, setting environment variables, investigating failures, and restarting services.

## Context & Motivation

Developers using AI agents (Cursor, Claude Desktop, etc.) currently must switch to the Render Dashboard to check service status, read logs, deploy, or configure environment variables. The existing Render MCP server (`render-oss/render-mcp-server`) provides 24+ tools that map 1:1 to REST API endpoints, requiring the agent to make multiple discovery calls before it can act.

This server takes a different approach: the topology of the user's Render account is embedded directly in every tool's description. The agent sees service names, IDs, health status, and URLs in its tool listing — no discovery step needed. When infrastructure state changes (deploy, crash, scale), the server pushes `notifications/tools/list_changed` so the agent's worldview stays current.

## Clarifications

### Session 2026-05-25

- Q: Should the HTTP endpoint require its own auth layer, or is the Render API key sufficient? → A: API key in the Authorization header doubles as MCP endpoint auth. Reject requests with missing/invalid key at the transport level.
- Q: What default time window for log retrieval when none is specified? → A: Last 10 minutes.
- Q: On cold start, should the first tools/list block and fetch, or return empty and push later? → A: Block and fetch synchronously. Agent sees real data from first interaction.
- Q: How should the server behave when the Render API is unreachable? → A: Fail all tool calls with a clear error. Do not serve stale cached data.

## Actors

- **Developer** — The human user working inside an AI agent (Cursor, Claude Desktop, etc.) who wants to manage their Render infrastructure without opening the Dashboard.
- **AI Agent** — The LLM-powered agent that reads tool descriptions, reasons about infrastructure state, and calls tools to take action.
- **Render Platform** — The cloud platform hosting the developer's services, databases, and key-value stores. Accessed via its REST API.

## Functional Requirements

### FR-1: Dynamic Tool Descriptions

The server MUST compute tool descriptions at request time by querying the Render API for the user's current services, databases, and key-value stores. Each tool description that operates on a resource MUST embed a compact topology table showing resource IDs, names, types, and current status.

**Acceptance criteria:**
- On the first `tools/list` call (cold start), the server blocks and fetches the full topology from the Render API synchronously before returning. The agent sees real, populated descriptions from its first interaction — never empty placeholders.
- On subsequent calls, descriptions contain the current state of all resources visible to the API key (served from cache, refreshed if stale)
- Resource IDs in descriptions match the `enum` constraints in the tool's `inputSchema`
- Descriptions are compact (one line per resource, max ~100 tokens per tool for the topology section)
- A resource that is unhealthy shows its status and a brief reason (e.g., "OOMKilled 3m ago")
- The logs tool description includes a per-service error activity indicator (e.g., "4 errors in last 5m" or "clean") so the agent knows where to look before calling the tool

### FR-2: Topology Refresh

The server MUST keep its internal topology cache current using a hybrid approach:

1. **Lazy refresh on tool call** — Before executing any tool, refresh the topology cache if it is older than a configurable staleness threshold (default: 30 seconds). If the topology changed, send `notifications/tools/list_changed` after the tool result.
2. **Refresh on `tools/list`** — Always rebuild descriptions from the latest cache (or re-fetch if stale) when a client requests the tool listing.
3. **Webhook-driven refresh (optional)** — Accept incoming Render deploy webhooks. On webhook event, update the cache and send `notifications/tools/list_changed`.

**Acceptance criteria:**
- After a deploy completes, the agent sees the updated status in tool descriptions within 30 seconds (lazy) or immediately (webhook)
- Rapid state changes (flapping services) are debounced — at most one `notifications/tools/list_changed` per 5-second window
- The server works correctly even if no webhooks are configured (lazy refresh only)

### FR-3: Deploy Tool

The server MUST provide a tool to trigger a deploy on any service visible to the API key.

**Acceptance criteria:**
- Agent can deploy by passing a service ID (visible in tool descriptions)
- Tool returns the deploy ID, status, and commit info
- After deploy completes, topology descriptions update to reflect new status

### FR-4: Logs Tool (Processed)

The server MUST provide a tool to retrieve logs from any service or database, with server-side processing that reduces noise and surfaces signal before the results enter the agent's context window.

**Default behavior (summary mode):**

The server processes raw log lines before returning them. The default response is a structured summary, not raw lines:

1. **Deduplication** — Identical or near-identical log lines are collapsed into a single pattern with a count, first occurrence, last occurrence, and whether the pattern is still active.
2. **Pattern grouping** — Similar errors are clustered by message template (ignoring variable parts like timestamps, IDs, and request paths).
3. **Correlation** — Errors that co-occur within the same time window are flagged as potentially related (e.g., "redis connection refused" and "GET /api/users 500" starting at the same moment).
4. **Severity triage** — Errors are returned first, then warnings. Info-level logs are omitted unless the agent explicitly requests them.
5. **Request summarization** — For HTTP services, includes a status code distribution and top failing paths.
6. **Signal detection** — Highlights actionable patterns: dependency failures, error spikes, new error types not seen in previous windows.

**Drill-down mode:**

When the agent needs raw lines (e.g., to read a full stack trace or inspect a specific time window), it can pass a `raw: true` flag with optional filters (severity, time range, text search, limit). This bypasses processing and returns unprocessed log lines with timestamps.

**Acceptance criteria:**
- Default call with only a resource ID returns a processed summary covering the last 10 minutes: unique error patterns with counts, correlations, request summary, and signals
- The default 10-minute window can be overridden by passing explicit `startTime`/`endTime` parameters
- Processed summary is compact (typically under 30 lines regardless of raw log volume)
- Agent can switch to raw mode for unprocessed lines with filters
- Works for services, postgres, and key-value instances
- Tool description includes a one-line error activity indicator per service (e.g., "4 errors in last 10m" or "clean")

### FR-5: Environment Variables Tool

The server MUST provide a tool to read and set environment variables on any service.

**Acceptance criteria:**
- Agent can list current env vars for a service (values masked by default, with an option to reveal)
- Agent can set/update one or more env vars in a single call
- Setting env vars does NOT automatically trigger a deploy (agent decides separately)
- Tool description shows which services have env vars configured

### FR-6: Inspect Tool

The server MUST provide a tool to get detailed information about any resource — deeper than what the tool description shows.

**Acceptance criteria:**
- Returns full resource details: plan, region, created date, last deploy info, restart count
- For unhealthy services: crash reason, exit code, memory usage at crash
- For databases: connection string, version, disk usage, status
- For key-value stores: connection string, plan, eviction policy

### FR-7: Restart Tool

The server MUST provide a tool to restart a running service without triggering a full deploy.

**Acceptance criteria:**
- Agent can restart by passing a service ID
- Restart is confirmed with new instance start time
- Topology description updates to reflect the restart

### FR-8: Run Command Tool

The server MUST provide a tool to execute a one-off command against a service (e.g., database migrations, seed scripts).

**Acceptance criteria:**
- Agent provides a service ID and command string
- Tool returns command output and exit code
- Command runs in the service's environment with its env vars

### FR-9: Dual Transport Support

The server MUST support both stdio (for local use via `npx`) and Streamable HTTP (for hosted deployment on Render).

**Acceptance criteria:**
- Running with no arguments starts in stdio mode
- Running with `--http` or `PORT` env var starts an HTTP server
- Both transports support `notifications/tools/list_changed`
- HTTP transport supports stateful sessions with session IDs

### FR-10: Authentication via Render API Key

The server MUST authenticate to the Render API using a user-provided API key.

**Acceptance criteria:**
- Accepts `RENDER_API_KEY` from environment variable (stdio mode)
- For HTTP transport, accepts the key from the `Authorization` header (Bearer token). The API key serves as both Render API auth and MCP endpoint auth — requests with a missing or invalid key are rejected at the transport level before any tool execution.
- All Render API calls use the provided key
- Invalid or missing key produces a clear error message (HTTP 401 for transport, tool error for invalid key on first API call)

## User Scenarios

### Scenario 1: Morning Check-In

The developer opens Cursor and starts a conversation. The agent's tool listing already shows:
```
srv-cx7q │ my-api    │ web     │ healthy │ https://my-api.onrender.com
srv-ab3p │ my-worker │ worker  │ healthy
dpg-kf8n │ my-db     │ postgres│ available
```
The developer asks "is everything running okay?" The agent answers from context — no tool call needed.

### Scenario 2: Debug a Failure

The developer asks "why is my worker crashing?" The agent sees `srv-ab3p │ worker │ failed │ OOMKilled 3m ago` in tool descriptions, and the logs tool shows `srv-ab3p │ 12 errors in last 5m`. It calls `render_logs` with `srv-ab3p` — the server returns a processed summary: 1 unique error pattern ("Out of memory" × 12, first at 19:00, still occurring), correlated with a memory spike. The agent calls `render_inspect` for crash details, identifies the root cause, and suggests a fix — all from ~20 lines of processed output instead of 500 raw log lines.

### Scenario 3: Deploy After Code Change

The developer fixes a bug and says "deploy my API." The agent sees `srv-cx7q │ my-api` in descriptions, calls `render_deploy` with that ID. The topology updates to `deploying`, then `healthy`. Agent confirms success.

### Scenario 4: Configure Environment

The developer says "add STRIPE_SECRET_KEY to my API service." The agent calls `render_env_vars` to set the variable on `srv-cx7q`. It asks whether to deploy now or later.

### Scenario 5: Investigate a Slow Endpoint

The developer says "my /api/search endpoint feels slow." The agent sees `srv-cx7q │ my-api │ healthy` but the logs tool shows `srv-cx7q │ 0 errors │ 23 slow requests in last 5m`. It calls `render_logs` — the processed summary shows GET /api/search averaging 2.3s, correlated with high database query times. The agent calls `render_inspect` on the postgres instance to check disk and connection usage, then suggests an index or query optimization.

## Edge Cases

- **No resources on account**: Tool descriptions show "No services found. Deploy via render.yaml or the Render Dashboard to get started." Tools that require resource IDs have empty enum arrays.
- **API key with limited permissions**: If the key cannot list services, the server returns a clear error explaining which permissions are needed.
- **Rate limiting**: If the Render API returns 429, the server retries with exponential backoff and surfaces the rate limit to the agent if persistent.
- **Render API outage**: If the Render API is unreachable, all tool calls fail with a clear "Render API unreachable" error. The server does not serve stale cached data — the agent knows the infrastructure view is unavailable and can communicate this to the developer.
- **Large accounts (50+ services)**: Descriptions remain compact (one line per resource). No pagination in descriptions — show all resources.
- **Stale cache during long conversations**: Lazy refresh ensures the cache is at most 30 seconds old on any tool call. Clients that don't support `notifications/tools/list_changed` get fresh data on next `tools/list` call.
- **Concurrent tool calls**: Topology cache is shared and thread-safe. Multiple simultaneous tool calls see a consistent snapshot.

## Success Criteria

- **SC-1**: A developer can deploy code, read logs, and set env vars on their Render services entirely from within an AI agent, without opening the Render Dashboard.
- **SC-2**: The agent knows the current state of all services (names, IDs, health, URLs) without making any discovery tool calls — this information is in the tool descriptions.
- **SC-3**: When a service's status changes (deploy, crash, restart), the agent sees the updated state within 30 seconds.
- **SC-4**: A new user can go from zero to connected in under 5 minutes: install/deploy the MCP server, paste the config into their agent, and see their services.
- **SC-5**: The server runs as both a local stdio process (`npx`) and a hosted HTTP service on Render.

## Assumptions

- The Render REST API (https://api.render.com/v1) remains stable and available.
- MCP clients (Cursor, Claude Desktop) support `notifications/tools/list_changed` or gracefully degrade to fresh `tools/list` calls.
- The Render API key provided has sufficient permissions to list and read all resource types (services, postgres, key-value) and to deploy/restart services and manage env vars.
- The prototype targets single-user / single-API-key use. Multi-tenant (multiple API keys per hosted instance) is a future enhancement.
- Resource creation and destruction are handled outside this server (via git push, Blueprints, or the Render Dashboard). This server observes and operates on existing resources.

## Out of Scope

- Resource creation (services, databases, key-value stores) — handled by git push + auto-deploy, Blueprints, or the Dashboard
- Resource deletion / destruction — handled via the Dashboard or API directly
- Blueprint-based environment orchestration
- TTL-based automatic resource cleanup
- Cost tracking and estimation
- Custom domain management
- Cron job management
- SQL query execution against Postgres (available in the existing MCP server)
- OAuth-based authentication (API key only for prototype)
- Multi-node / distributed deployment of the MCP server itself
