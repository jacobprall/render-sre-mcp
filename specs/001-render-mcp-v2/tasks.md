# Tasks: Render MCP Server v2

**Feature**: [spec.md](spec.md)
**Plan**: [plan.md](plan.md)
**Contracts**: [contracts/mcp-tools.md](contracts/mcp-tools.md)
**Generated**: 2026-05-25

---

## Phase 1: Setup

**Goal**: Buildable TypeScript project with all dependencies installed.

- [X] T001 Initialize `package.json` with name `render-mcp-server`, version, `"type": "module"`, bin entry pointing to `dist/index.js`, and scripts (`build`, `start`, `dev`) in `package.json`
- [X] T002 Configure `tsconfig.json` with ES2022 target, NodeNext module resolution, strict mode, `outDir: dist`, `rootDir: src` in `tsconfig.json`
- [X] T003 Install runtime dependencies: `@modelcontextprotocol/server`, `render-api`, `express`, `zod` via npm
- [X] T004 Install dev dependencies: `typescript`, `@types/node`, `@types/express`, `tsx` via npm
- [X] T005 Create minimal `src/index.ts` that instantiates a low-level MCP `Server`, connects to `StdioServerTransport`, and responds to `initialize` — verify with `npm run build`

---

## Phase 2: Foundational

**Goal**: Render API client wrapper and TopologyCache that fetch live data and produce dynamic description strings. These block all user stories.

- [X] T006 Define TypeScript types for `RenderService`, `RenderPostgres`, `RenderKeyValue`, `RenderResource` (union), `TopologySnapshot` per data-model.md in `src/types.ts`
- [X] T007 Create `src/render-api.ts` — initialize `render-api` client from `RENDER_API_KEY` env var, export `fetchServices()` with pagination that returns `RenderService[]`
- [X] T008 [P] Add `fetchPostgres()` to `src/render-api.ts` — paginated fetch returning `RenderPostgres[]`
- [X] T009 [P] Add `fetchKeyValue()` to `src/render-api.ts` — paginated fetch returning `RenderKeyValue[]`
- [X] T010 Add `fetchServiceLogs(serviceId, options)` to `src/render-api.ts` — fetch log lines with time range and limit filters
- [X] T011 [P] Add `fetchDeploys(serviceId)` to `src/render-api.ts` — fetch recent deploys for a service
- [X] T012 [P] Add `fetchEnvVars(serviceId)` to `src/render-api.ts` — fetch env vars for a service
- [X] T013 [P] Add mutation functions to `src/render-api.ts`: `triggerDeploy(serviceId, opts)`, `restartService(serviceId)`, `setEnvVars(serviceId, vars)`, `createJob(serviceId, command)`
- [X] T014 Create `src/topology.ts` — `TopologyCache` class with `snapshot`, `fetchedAt`, `ttlMs` (from `RENDER_CACHE_TTL_MS` env, default 30000), and `refreshing` promise dedup field
- [X] T015 Implement `TopologyCache.refresh()` in `src/topology.ts` — parallel fetch of services, postgres, key-value; compute `allResources` union; store snapshot; detect structural changes (return boolean)
- [X] T016 Implement `TopologyCache.isStale()` and `ensureFresh()` in `src/topology.ts` — TTL-based staleness check, dedup concurrent refresh calls via shared promise
- [X] T017 Implement `TopologyCache.describe(toolName)` in `src/topology.ts` — generate dynamic description strings per tool per contracts/mcp-tools.md (topology table format: `id │ name │ type │ status [│ url]`)
- [X] T018 Implement `TopologyCache.resourceIds(filter?)` in `src/topology.ts` — return enum arrays of resource IDs for input schema generation, filtered by type (services-only vs all resources)
- [X] T019 Implement `TopologyCache.computeErrorIndicators()` in `src/topology.ts` — for each service, fetch last 10m of logs via `fetchServiceLogs`, count error lines, store as map of `{ count, label }` for use in logs tool description

---

## Phase 3: Morning Check-In (Core MCP Server)

**Goal**: Agent connects and sees all services, health, URLs in tool descriptions. `tools/list` returns 6 tools with dynamic descriptions. Both stdio and HTTP transports work.

> User story: "Developer opens Cursor, agent's tool listing already shows services with names, IDs, health, URLs. Agent answers 'is everything running?' from context — no tool call needed."
>
> Independent test: Start server with `RENDER_API_KEY`, call `tools/list`, verify response contains 6 tools whose descriptions include real service names, IDs, and status.

- [X] T020 [US1] Create `src/server.ts` — export `createServer(topology)` that instantiates low-level `Server` with `{ capabilities: { tools: { listChanged: true } } }`, server name `render-mcp-server`, version from package.json
- [X] T021 [US1] Register `tools/list` handler in `src/server.ts` — call `topology.ensureFresh()`, return 6 tool definitions with `description: topology.describe(name)` and `inputSchema` with enum arrays from `topology.resourceIds()`
- [X] T022 [US1] Register `tools/call` handler in `src/server.ts` — call `topology.ensureFresh()`, dispatch to tool handler by name, after execution check `topology.changed()` and send `notifications/tools/list_changed` if true
- [X] T023 [US1] Update `src/index.ts` — detect `PORT` env var: if absent, start stdio transport; if present, start Express HTTP server
- [X] T024 [US1] Implement stdio mode in `src/index.ts` — create `StdioServerTransport`, connect server, handle graceful shutdown on SIGINT/SIGTERM
- [X] T025 [US1] Implement HTTP mode in `src/index.ts` — create Express app, mount `StreamableHTTPServerTransport` at `/mcp`, add auth middleware that validates `Authorization: Bearer <key>` against `RENDER_API_KEY` (reject 401), listen on `PORT`
- [X] T026 [US1] Add notification debouncing in `src/server.ts` — track last `tools/list_changed` send time, suppress if within 5-second window per FR-2

---

## Phase 4: Debug a Failure (Logs + Inspect)

**Goal**: Agent can retrieve processed log summaries and inspect resource details to debug failures.

> User story: "Developer asks 'why is my worker crashing?' Agent sees 'failed │ OOMKilled' in tool descriptions, logs tool shows '12 errors in last 10m'. Agent calls `render_logs` → processed summary (1 error pattern × 12, correlated). Calls `render_inspect` → crash details. ~20 lines total."
>
> Independent test: Call `render_logs` with a service ID → get structured summary under 30 lines. Call `render_inspect` → get plan, region, last deploy, failure details.

- [X] T027 [US2] Create `src/log-processor.ts` — export `LogProcessor` class with `normalize(line)` method that replaces UUIDs, ISO timestamps, numbers, URL paths with `*` placeholders
- [X] T028 [US2] Implement `LogProcessor.group(lines)` in `src/log-processor.ts` — cluster raw log lines by normalized template, produce `LogPattern[]` with count, firstSeen, lastSeen, stillActive, sample
- [X] T029 [US2] Implement `LogProcessor.detectSeverity(line)` in `src/log-processor.ts` — classify each line as error/warning/info based on keywords and status codes
- [X] T030 [US2] Implement `LogProcessor.correlate(patterns)` in `src/log-processor.ts` — find patterns whose firstSeen times fall within a 30-second window, populate `correlatedWith` arrays
- [X] T031 [US2] Implement `LogProcessor.summarizeRequests(lines)` in `src/log-processor.ts` — for HTTP services, parse status codes and paths to produce `RequestSummary` with byStatus distribution, topErrors, slowRequests
- [X] T032 [US2] Implement `LogProcessor.detectSignals(patterns, requestSummary)` in `src/log-processor.ts` — identify actionable signals: error spikes, new error types, dependency failures
- [X] T033 [US2] Implement `LogProcessor.formatSummary(summary)` in `src/log-processor.ts` — render `LogSummary` as compact markdown text (Error Patterns, Correlations, Request Summary, Signals sections)
- [X] T034 [US2] Create `src/tools/logs.ts` — implement `render_logs` tool handler: parse input args, determine summary vs raw mode, fetch logs via `fetchServiceLogs()`, route through `LogProcessor` for summary mode, return formatted text per contracts/mcp-tools.md
- [X] T035 [US2] Implement raw mode in `src/tools/logs.ts` — when `raw: true`, fetch logs with severity/search/limit filters, return timestamped lines without processing
- [X] T036 [P] [US2] Create `src/tools/inspect.ts` — implement `render_inspect` tool handler: detect resource type by ID prefix (`srv-`/`dpg-`/`red-`), fetch full details + last deploy (services) or connection info (databases/KV), format as markdown per contracts/mcp-tools.md

---

## Phase 5: Deploy & Restart

**Goal**: Agent can trigger deploys and restart services.

> User story: "Developer says 'deploy my API.' Agent sees service ID in descriptions, calls `render_deploy`. Topology updates to 'deploying', then 'healthy'."
>
> Independent test: Call `render_deploy` with a service ID → get deploy ID + status. Call `render_restart` → get confirmation with timestamp.

- [X] T037 [P] [US3] Create `src/tools/deploy.ts` — implement `render_deploy` tool handler: validate serviceId exists in topology, call `triggerDeploy(serviceId, { clearCache })`, return deploy ID, status, commit info per contracts/mcp-tools.md, trigger topology refresh
- [X] T038 [P] [US3] Create `src/tools/restart.ts` — implement `render_restart` tool handler: validate serviceId, call `restartService(serviceId)`, return confirmation with new instance start time, trigger topology refresh

---

## Phase 6: Configure Environment

**Goal**: Agent can list and set environment variables on services.

> User story: "Developer says 'add STRIPE_SECRET_KEY to my API.' Agent calls `render_env_vars` to set variable. Asks whether to deploy now."
>
> Independent test: Call `render_env_vars` with action `list` → get masked variable list. Call with action `set` → confirmation message.

- [X] T039 [P] [US4] Create `src/tools/env-vars.ts` — implement `render_env_vars` tool handler: list action fetches vars via `fetchEnvVars()`, masks values (show `****`), optionally reveals; set action calls `setEnvVars()`, returns confirmation with note about deploy per contracts/mcp-tools.md

---

## Phase 7: Run Commands

**Goal**: Agent can execute one-off commands in a service's environment.

> User story: "Developer says 'run migrations on my API.' Agent calls `render_run_command` with service ID and `npx prisma migrate deploy`."
>
> Independent test: Call `render_run_command` with a service ID and command → get output and exit code.

- [X] T040 [P] [US5] Create `src/tools/run-command.ts` — implement `render_run_command` tool handler: validate serviceId, call `createJob(serviceId, command)` via Render Jobs API, poll for completion, return command output and exit code per contracts/mcp-tools.md

---

## Phase 8: Polish & Cross-Cutting Concerns

**Goal**: Production-quality error handling, README, and end-to-end verification.

- [X] T041 Add error handling for Render API unreachable in `src/render-api.ts` — catch network errors, throw typed `RenderApiUnreachableError` with clear message per spec edge cases
- [X] T042 Add error handling for invalid/missing API key in `src/render-api.ts` — catch 401 responses, throw typed `RenderAuthError` with guidance message
- [X] T043 Add rate limit retry with exponential backoff in `src/render-api.ts` — catch 429 responses, retry up to 3 times, surface to caller if persistent
- [X] T044 [P] Add empty-account handling in `src/topology.ts` — when no resources found, set description to "No services found. Deploy via render.yaml or the Render Dashboard to get started." and return empty enum arrays
- [X] T045 [P] Add error propagation in `src/server.ts` — catch `RenderApiUnreachableError` and `RenderAuthError` in tool call handler, return `isError: true` MCP responses with clear messages
- [X] T046 Write project `README.md` with quickstart (stdio + HTTP), configuration table, tool descriptions overview, and architecture diagram based on quickstart.md
- [X] T047 Verify end-to-end: build project (`npm run build`), start in stdio mode with real `RENDER_API_KEY`, call `tools/list` and confirm dynamic descriptions, call at least one tool (`render_inspect`) and confirm response

---

## Dependencies

```
Phase 1 (Setup: T001–T005)
    ↓
Phase 2 (Foundational: T006–T019)
    ↓
Phase 3 (US1 Core Server: T020–T026)
    ↓ (all tools depend on server + topology)
Phase 4 (US2 Logs+Inspect: T027–T036)  ←─ can run in parallel with ↓
Phase 5 (US3 Deploy+Restart: T037–T038) ←─ can run in parallel with ↑ ↓
Phase 6 (US4 Env Vars: T039)           ←─ can run in parallel with ↑ ↓
Phase 7 (US5 Run Command: T040)        ←─ can run in parallel with ↑
    ↓ (all tools complete)
Phase 8 (Polish: T041–T047)
```

### Parallel Execution Opportunities

**Within Phase 2** (after T006–T007):
- T008, T009, T011, T012, T013 are independent API wrapper functions — all parallelizable

**Phases 4–7** (after Phase 3):
- All tool implementations (T027–T040) can run in parallel since they operate on independent files and share only the topology cache read interface
- Within Phase 4: T036 (inspect) is independent of T027–T035 (logs)

**Within Phase 8**:
- T041–T045 (error handling) are independent of T046 (README)

---

## Implementation Strategy

**MVP (Phases 1–3)**: Scaffold + API client + topology cache + MCP server with dynamic descriptions. Agent can see infrastructure state in tool listings. No tools execute yet, but the core value proposition (dynamic context) is demonstrable.

**Incremental delivery**:
1. **MVP**: Phases 1–3 (server starts, `tools/list` returns real infrastructure) — ~60% of user value
2. **+Observability**: Phase 4 (logs + inspect) — debugging workflows
3. **+Operations**: Phases 5–6 (deploy, restart, env vars) — action workflows
4. **+Commands**: Phase 7 (run command) — advanced operations
5. **+Polish**: Phase 8 (error handling, README) — production readiness
