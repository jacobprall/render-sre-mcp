# Data Model: Render MCP Server v2

## Entities

### TopologySnapshot

The full state of the user's Render account at a point in time. Rebuilt on every cache refresh.

| Field | Type | Description |
|-------|------|-------------|
| services | RenderService[] | All services (web, worker, static, cron) |
| databases | RenderPostgres[] | All Postgres instances |
| keyValueStores | RenderKeyValue[] | All Key Value (Redis) instances |
| fetchedAt | Date | When this snapshot was fetched |
| allResources | RenderResource[] | Derived: union of all resource types, for iteration |

### RenderService

| Field | Type | Source |
|-------|------|--------|
| id | string | `srv-xxxxx` from API |
| name | string | User-defined name |
| type | "web_service" \| "worker" \| "static_site" \| "cron_job" | API `type` field |
| status | string | "deployed" \| "deploying" \| "failed" \| "suspended" etc. |
| url | string \| null | Public URL (web services and static sites only) |
| region | string | e.g., "oregon", "frankfurt" |
| plan | string | e.g., "starter", "standard" |
| branch | string | Git branch being deployed |
| lastDeployAt | Date \| null | Timestamp of most recent deploy |
| lastDeployStatus | string \| null | "live" \| "build_failed" \| "update_failed" etc. |
| statusReason | string \| null | Brief reason for current status (e.g., "OOMKilled") |

### RenderPostgres

| Field | Type | Source |
|-------|------|--------|
| id | string | `dpg-xxxxx` from API |
| name | string | User-defined name |
| status | string | "available" \| "creating" \| "unavailable" etc. |
| plan | string | e.g., "free", "basic_256mb", "pro_4gb" |
| region | string | Deployment region |
| version | string | Postgres version (e.g., "16") |
| connectionString | string | Internal connection URL |
| externalConnectionString | string \| null | External connection URL (if enabled) |
| diskSizeGB | number | Allocated disk |

### RenderKeyValue

| Field | Type | Source |
|-------|------|--------|
| id | string | `red-xxxxx` from API |
| name | string | User-defined name |
| status | string | "available" \| "creating" \| "unavailable" etc. |
| plan | string | e.g., "free", "starter", "standard" |
| region | string | Deployment region |
| connectionString | string | Internal connection URL |
| externalConnectionString | string \| null | External connection URL (if enabled) |
| maxmemoryPolicy | string | Eviction policy |

### RenderResource (Union Type)

A discriminated union of RenderService | RenderPostgres | RenderKeyValue used for tools that operate on any resource type. Discriminated by the `id` prefix:
- `srv-` → service
- `dpg-` → postgres
- `red-` → key-value

### LogSummary

The processed output of the logs tool (summary mode).

| Field | Type | Description |
|-------|------|-------------|
| resourceId | string | Which resource these logs are from |
| window | { start: Date, end: Date } | Time range covered |
| patterns | LogPattern[] | Deduplicated error/warning patterns |
| requestSummary | RequestSummary \| null | HTTP status distribution (services only) |
| signals | string[] | Actionable observations |

### LogPattern

| Field | Type | Description |
|-------|------|-------------|
| template | string | Normalized message (variable parts replaced with `*`) |
| severity | "error" \| "warning" \| "info" | Highest severity in this pattern |
| count | number | Number of occurrences |
| firstSeen | Date | First occurrence in window |
| lastSeen | Date | Most recent occurrence |
| stillActive | boolean | Occurred in the last 60 seconds |
| sample | string | One full raw log line as an example |
| correlatedWith | string[] | Templates of co-occurring patterns |

### RequestSummary

| Field | Type | Description |
|-------|------|-------------|
| total | number | Total requests in window |
| byStatus | Record<string, number> | Count by status code group ("2xx", "4xx", "5xx") |
| topErrors | { path: string, count: number, avgMs: number }[] | Top 5 failing paths |
| slowRequests | { path: string, count: number, avgMs: number }[] | Top 5 slowest paths |

## State Transitions

### TopologyCache Lifecycle

```
COLD → FETCHING → READY → STALE → FETCHING → READY → ...
                            ↑                    │
                            └────────────────────┘
```

- **COLD**: No data. First `tools/list` triggers synchronous fetch.
- **FETCHING**: API call in flight. Concurrent requests wait for the same fetch.
- **READY**: Fresh data (< 30 seconds old). Serve from cache.
- **STALE**: Data older than 30 seconds. Next tool call or `tools/list` triggers refresh.

### Service Status (from Render API)

```
created → deploying → deployed (healthy)
                   ↘ build_failed
                   ↘ update_failed
deployed → suspended → deployed (on resume)
deployed → deploying (on redeploy)
```
