# Research: Render MCP Server v2

## Decision 1: MCP SDK approach for dynamic descriptions

**Decision:** Use the low-level `Server` class from `@modelcontextprotocol/server` with custom `tools/list` and `tools/call` handlers, rather than the high-level `McpServer.registerTool()` API.

**Rationale:** `McpServer.registerTool()` takes static description strings at registration time. Our core feature — descriptions computed at request time from live topology — requires intercepting `tools/list` to return freshly-built tool definitions on every call. The low-level `Server` class lets us set request handlers directly for `ListToolsRequestSchema` and `CallToolRequestSchema`, giving full control over what's returned.

**Alternatives considered:**
- `McpServer` with re-registration on topology change: Works but triggers `tools/list_changed` on re-register, creating a loop. Also registers/unregisters tools constantly.
- `McpServer` with `setRequestHandler` override (Issue #836 pattern): Mixes abstractions — uses `McpServer` but bypasses its tool registration. Fragile.

## Decision 2: Render API client

**Decision:** Use the `render-api` npm package (typed client for Render REST API) rather than building a custom HTTP client.

**Rationale:** The `render-api` package already covers all endpoints we need (services, deploys, env vars, postgres, key-value, logs, metrics, jobs) with TypeScript types, pagination helpers, retry logic, and rate limit handling. Writing our own would duplicate ~500 lines of boilerplate.

**Alternatives considered:**
- Raw `fetch` calls: No types, no pagination, no retry. Fine for a spike but not a prototype others will use.
- Auto-generated from OpenAPI spec: The spec endpoint returned 500 during research. Manual generation not worth the effort when a typed client exists.

## Decision 3: Transport strategy

**Decision:** Use `StdioServerTransport` (from `@modelcontextprotocol/server`) for local mode and `NodeStreamableHTTPServerTransport` (from `@modelcontextprotocol/node`) with Express for HTTP mode. Single entrypoint with `PORT` env var detection.

**Rationale:** These are the standard SDK transports. Express gives us a place to mount the webhook endpoint alongside the MCP endpoint. `PORT` detection is idiomatic for Render (Render sets `PORT` automatically on deploy).

**Alternatives considered:**
- Hono instead of Express: Lighter, but `@modelcontextprotocol/express` provides ready-made middleware with DNS rebinding protection.
- Custom HTTP server: No benefit over using the SDK's transport.

## Decision 4: Topology cache architecture

**Decision:** Single in-memory `TopologyCache` class that holds the full account state (services, databases, redis instances) and provides a `refresh()` method. Cache expiry is time-based (30-second TTL). A `describe(toolName)` method returns the dynamic description string for a given tool.

**Rationale:** The topology is small (one line per resource) and read-heavy. In-memory is sufficient for single-user prototype. The `describe()` method encapsulates the formatting logic so tool handlers don't need to know about description generation.

**Alternatives considered:**
- Per-tool caches: Unnecessary complexity. All tools share the same topology view.
- Redis/persistent cache: Overkill for single-user prototype with no multi-node deployment.

## Decision 5: Log processing strategy

**Decision:** Process logs server-side using simple string-based pattern matching. Group by normalized message template (replace UUIDs, timestamps, numbers, and paths with placeholders), count occurrences, detect temporal correlation by overlapping time windows.

**Rationale:** Full NLP or embedding-based log clustering is overkill. Render logs are structured enough that regex-based normalization (strip variable parts) produces useful groupings. This can be done in <50ms for 500 log lines.

**Alternatives considered:**
- Return raw logs and let the LLM process: Defeats the purpose — burns tokens and reasoning capacity on parsing.
- Use an external log analysis service: Adds a dependency and latency for the prototype.

## Decision 6: Project structure

**Decision:** Single package at repo root (not monorepo). The prototype is one deliverable — an MCP server. Monorepo structure (api/sdk/mcp packages) is deferred until the design stabilizes.

**Rationale:** The README's monorepo structure was aspirational. For a sprint prototype, a single `src/` directory with clear module boundaries is faster to develop, test, and deploy.

**Alternatives considered:**
- Monorepo with Turborepo: Premature. We'd spend time on build config instead of features.
