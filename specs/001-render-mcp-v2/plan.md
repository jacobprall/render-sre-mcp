# Implementation Plan: Render MCP Server v2

## Technical Context

| Aspect | Decision | Reference |
|--------|----------|-----------|
| Language | TypeScript (ES2022, Node 20+) | — |
| MCP SDK | `@modelcontextprotocol/server` (low-level `Server` class) | [research.md](research.md) Decision 1 |
| Render API | `render-api` npm package | [research.md](research.md) Decision 2 |
| Transport (stdio) | `StdioServerTransport` from SDK | [research.md](research.md) Decision 3 |
| Transport (HTTP) | Express + `McpServer.createHttpStreamTransport` or raw stream handler | [research.md](research.md) Decision 3 |
| Log processing | In-process string normalization | [research.md](research.md) Decision 5 |
| Project structure | Single package, `src/` directory | [research.md](research.md) Decision 6 |

## Project Structure

```
render-mcp-server/
├── src/
│   ├── index.ts              # Entrypoint: detect mode, start server
│   ├── server.ts             # MCP Server setup, handlers, transport
│   ├── topology.ts           # TopologyCache: fetch, cache, describe
│   ├── tools/
│   │   ├── deploy.ts         # render_deploy
│   │   ├── logs.ts           # render_logs (summary + raw)
│   │   ├── env-vars.ts       # render_env_vars
│   │   ├── inspect.ts        # render_inspect
│   │   ├── restart.ts        # render_restart
│   │   └── run-command.ts    # render_run_command
│   ├── log-processor.ts      # Log dedup, grouping, correlation, signals
│   └── render-api.ts         # Thin wrapper / re-exports from render-api pkg
├── package.json
├── tsconfig.json
└── README.md
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  MCP Client (Agent)                  │
│                                                     │
│  tools/list → dynamic descriptions with topology    │
│  tools/call → tool execution                        │
│  ← notifications/tools/list_changed                 │
└──────────────┬────────────────────────┬─────────────┘
               │ stdio                  │ HTTP
┌──────────────▼────────────────────────▼─────────────┐
│                   server.ts                          │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  tools/list handler                          │   │
│  │  → topology.describe(toolName) for each tool │   │
│  │  → rebuild inputSchema enums from cache      │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  tools/call handler                          │   │
│  │  → refresh topology if stale                 │   │
│  │  → dispatch to tool handler                  │   │
│  │  → if topology changed, send list_changed    │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  TopologyCache                               │   │
│  │  → snapshot: TopologySnapshot                │   │
│  │  → refresh(): fetch all resources            │   │
│  │  → isStale(): check TTL                      │   │
│  │  → describe(tool): build description string  │   │
│  │  → resourceIds(type): enum array for schema  │   │
│  │  → changed(): did last refresh change state? │   │
│  └──────────────────────────┬───────────────────┘   │
│                             │                       │
└─────────────────────────────┼───────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   Render REST API  │
                    │   api.render.com   │
                    └───────────────────┘
```

## Implementation Phases

### Phase 1: Project Scaffold

**Goal:** Buildable TypeScript project with dependencies installed.

**Tasks:**
1. Initialize `package.json` with name, version, bin entry, type: module
2. Configure `tsconfig.json` (ES2022, NodeNext module, strict)
3. Install dependencies:
   - `@modelcontextprotocol/server` — MCP protocol server
   - `render-api` — typed Render REST API client
   - `express` — HTTP server for hosted mode
   - `zod` — schema validation (required by MCP SDK)
4. Install dev dependencies: `typescript`, `@types/node`, `@types/express`, `tsx`
5. Add scripts: `build`, `start`, `dev`
6. Create `src/index.ts` with a minimal "hello" MCP server to verify the setup compiles and runs

**Exit criteria:** `npm run build` succeeds, `npm start` starts a stdio MCP server that responds to `initialize`.

### Phase 2: Render API Client + Topology Cache

**Goal:** Fetch and cache the full account topology; generate dynamic description strings.

**Tasks:**
1. Create `src/render-api.ts`:
   - Initialize `render-api` client with API key from env
   - Export functions: `fetchServices()`, `fetchPostgres()`, `fetchKeyValue()`, `fetchServiceLogs()`, `fetchDeploys()`, `fetchEnvVars()`, `triggerDeploy()`, `restartService()`, `setEnvVars()`, `runJob()`
   - Handle pagination (use `listAll` where available)
   - Map API responses to our `RenderService`, `RenderPostgres`, `RenderKeyValue` types

2. Create `src/topology.ts`:
   - `TopologyCache` class:
     - `snapshot: TopologySnapshot | null`
     - `fetchedAt: number` (timestamp)
     - `ttlMs: number` (configurable, default 30000)
     - `refreshing: Promise<void> | null` (dedup concurrent refreshes)
   - `async refresh()`:
     - Fetch services, postgres, redis in parallel
     - Compute `allResources` union
     - Compute per-service error indicators (lightweight log query — count errors in last 10m)
     - Compute per-service env var counts
     - Store snapshot, update `fetchedAt`
     - Return whether the topology structurally changed (for `list_changed` decision)
   - `isStale(): boolean` — `Date.now() - fetchedAt > ttlMs`
   - `async ensureFresh()` — refresh if stale, dedup concurrent calls
   - `describe(toolName: string): string` — generate the dynamic description for a specific tool
   - `resourceIds(filter?): string[]` — return ID enum arrays for input schemas
   - Error activity indicators:
     - During refresh, for each service, fetch last 10 min of logs, count errors
     - Store as `errorCounts: Map<string, { count: number, label: string }>`
     - Used in `render_logs` description (e.g., "12 errors in last 10m")

**Exit criteria:** Unit-testable cache that produces description strings from mock Render API data.

### Phase 3: MCP Server + Transport

**Goal:** Working MCP server with `tools/list` returning dynamic descriptions and both transports functional.

**Tasks:**
1. Create `src/server.ts`:
   - Instantiate low-level `Server` from `@modelcontextprotocol/server`
   - Declare capabilities: `{ tools: { listChanged: true } }`
   - Register `tools/list` handler:
     - Call `topology.ensureFresh()`
     - Return tool definitions with `description: topology.describe(toolName)` and `inputSchema` with rebuilt enum arrays
   - Register `tools/call` handler:
     - Call `topology.ensureFresh()`
     - Dispatch to appropriate tool handler based on tool name
     - After execution, if topology changed, call `server.notification({ method: 'notifications/tools/list_changed' })`
   - Tool definitions (6 tools): name, base description, input schema shape, handler reference

2. Create `src/index.ts`:
   - Detect mode: if `PORT` env var is set → HTTP, else → stdio
   - **Stdio mode:**
     - Create `StdioServerTransport`
     - Connect server to transport
   - **HTTP mode:**
     - Create Express app
     - Mount MCP endpoint at `/mcp` using `StreamableHTTPServerTransport`
     - Auth middleware: check `Authorization: Bearer <key>`, reject 401 if missing/invalid
     - Optionally mount webhook endpoint at `/webhook` (future)
     - Listen on `PORT`

**Exit criteria:** `tools/list` returns 6 tools with dynamic descriptions; both stdio and HTTP transports respond to `initialize` and `tools/list`.

### Phase 4: Tool Implementations

**Goal:** All 6 tools execute correctly against the Render API.

**Tasks:**
1. `src/tools/deploy.ts` — `render_deploy`:
   - Validate serviceId against topology
   - Call `triggerDeploy(serviceId, { clearCache })`
   - Return deploy ID, status, commit info
   - Trigger topology refresh after deploy

2. `src/tools/logs.ts` — `render_logs`:
   - Route: summary mode (default) or raw mode (`raw: true`)
   - **Summary mode:** fetch logs → pipe through `LogProcessor` → return structured summary
   - **Raw mode:** fetch logs with filters → return timestamped lines

3. `src/log-processor.ts` — Log processing engine:
   - `normalize(line)`: replace UUIDs, timestamps, numbers, paths with `*`
   - `group(lines)`: cluster by normalized template, count occurrences
   - `correlate(groups)`: find co-occurring patterns within 30-second windows
   - `summarize(groups, correlations)`: produce `LogSummary` with patterns, request summary, signals
   - `formatSummary(summary)`: render as compact markdown text

4. `src/tools/env-vars.ts` — `render_env_vars`:
   - List: fetch env vars, mask values (show `****`), option to reveal
   - Set: update env vars via API, return confirmation

5. `src/tools/inspect.ts` — `render_inspect`:
   - Detect resource type by ID prefix
   - Service: fetch service details + last deploy + failure info
   - Postgres: fetch DB details + connection strings + disk usage
   - Key-value: fetch KV details + connection strings + eviction policy
   - Format as detailed markdown

6. `src/tools/restart.ts` — `render_restart`:
   - Call restart endpoint
   - Return confirmation with new instance start time

7. `src/tools/run-command.ts` — `render_run_command`:
   - Create a one-off job via API
   - Poll for completion or stream output
   - Return output and exit code

**Exit criteria:** Each tool can be called via `tools/call` and returns correct results from the Render API.

### Phase 5: Integration + Polish

**Goal:** End-to-end working prototype.

**Tasks:**
1. Wire topology refresh into tool call lifecycle (pre-call refresh, post-call change detection)
2. Add debouncing to `notifications/tools/list_changed` (max one per 5s window)
3. Add error handling:
   - Render API unreachable → clear error, no stale data
   - Invalid API key → clear 401 message
   - Rate limited → retry with backoff, surface if persistent
4. Add `README.md` with quickstart instructions
5. Test stdio mode with Cursor
6. Test HTTP mode locally with curl/MCP Inspector

**Exit criteria:** Developer can install, configure, and use the server with Cursor to check service status, deploy, read logs, and manage env vars on real Render infrastructure.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `render-api` package missing endpoints we need | Medium | Medium | Fall back to raw fetch for missing endpoints |
| Log error counting on refresh adds latency | Medium | Low | Make error indicators async/optional; don't block description generation |
| Render API rate limits during topology refresh | Low | Medium | Use single paginated call per resource type; cache aggressively |
| MCP SDK's low-level Server API is underdocumented | Medium | Medium | Reference existing MCP servers (GitHub, filesystem) for patterns |
| `run_command` API behavior unclear (jobs vs SSH) | Medium | Medium | Start with Render's Jobs API; defer SSH-based commands |

## Dependencies Between Phases

```
Phase 1 (scaffold)
    ↓
Phase 2 (API client + topology)
    ↓
Phase 3 (MCP server + transport)
    ↓
Phase 4 (tool implementations)  ← can partially parallelize tools
    ↓
Phase 5 (integration + polish)
```

Phases are strictly sequential. Within Phase 4, individual tools are independent and could be implemented in parallel.
