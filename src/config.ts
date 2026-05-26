export interface AppConfig {
  renderApiKey: string;
  mcpAuthToken?: string;
  port: number | null;
  cacheTtlMs: number;
  logDefaultWindowMin: number;
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  const renderApiKey = process.env.RENDER_API_KEY ?? '';
  const mcpAuthToken = process.env.MCP_AUTH_TOKEN || undefined;

  let port: number | null = null;
  if (process.env.PORT) {
    const parsed = parseInt(process.env.PORT, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      console.error(`Invalid PORT: "${process.env.PORT}". Must be an integer 0–65535.`);
      process.exit(1);
    }
    port = parsed;
  }

  const cacheTtlMs = parsePositiveInt(process.env.RENDER_CACHE_TTL_MS, 30000);
  const logDefaultWindowMin = parsePositiveInt(process.env.RENDER_LOG_DEFAULT_WINDOW_MIN, 10);

  cached = { renderApiKey, mcpAuthToken, port, cacheTtlMs, logDefaultWindowMin };
  return cached;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
