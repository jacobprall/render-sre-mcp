import {
  RenderAuthError,
  RenderNetworkError,
  RenderRateLimitError,
  RenderTimeoutError,
} from './errors.js';

export const API_BASE = 'https://api.render.com/v1';
const DEFAULT_TIMEOUT_MS = 30_000;

let cachedOwnerId: string | null = null;

export function getApiKey(): string {
  const key = process.env.RENDER_API_KEY ?? '';
  if (!key) {
    throw new Error('RENDER_API_KEY is required. Set it as an environment variable.');
  }
  return key;
}

export async function getOwnerId(): Promise<string> {
  if (cachedOwnerId) return cachedOwnerId;
  const data = await renderGet<Array<{ owner: { id: string } }>>('/owners', { limit: '1' });
  if (!data.length) throw new Error('No owner found for this API key');
  cachedOwnerId = data[0]!.owner.id;
  return cachedOwnerId;
}

export interface RenderRequestOptions {
  query?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export async function renderRequest<T>(
  method: string,
  path: string,
  options?: RenderRequestOptions
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (options?.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (resp.status === 401) {
      throw new RenderAuthError('Unauthorized');
    }
    if (resp.status === 429) {
      throw new RenderRateLimitError('Too many requests');
    }
    if (!resp.ok) {
      const body = await resp.text();
      const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
      throw new Error(`Render API ${method} ${path}: ${resp.status} ${snippet}`);
    }

    if (resp.status === 204 || resp.headers.get('content-length') === '0') {
      return undefined as T;
    }

    return (await resp.json()) as T;
  } catch (err) {
    if (
      err instanceof RenderAuthError ||
      err instanceof RenderRateLimitError ||
      err instanceof RenderTimeoutError
    ) {
      throw err;
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new RenderTimeoutError('Request timed out', timeoutMs);
    }
    if (err instanceof TypeError) {
      throw new RenderNetworkError(err.message, err);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function renderGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  return renderRequest<T>('GET', path, { query });
}

export function renderPost<T>(
  path: string,
  body?: unknown,
  query?: Record<string, string>
): Promise<T> {
  return renderRequest<T>('POST', path, { body, query });
}

export function renderPatch<T>(path: string, body: unknown): Promise<T> {
  return renderRequest<T>('PATCH', path, { body });
}

export function renderPut<T>(path: string, body: unknown): Promise<T> {
  return renderRequest<T>('PUT', path, { body });
}

type CursorPage = Record<string, unknown> & { cursor?: string };

/**
 * Paginate list endpoints that return `[{ [itemKey]: T, cursor?: string }, ...]`.
 */
export async function paginateAll<T>(
  path: string,
  itemKey: string,
  query?: Record<string, string>,
  maxItems?: number
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;

  while (true) {
    const pageQuery: Record<string, string> = { limit: '100', ...query };
    if (cursor) pageQuery.cursor = cursor;

    const page = await renderGet<CursorPage[]>(path, pageQuery);
    if (!Array.isArray(page) || page.length === 0) break;

    for (const row of page) {
      const item = row[itemKey];
      if (item !== null && item !== undefined && typeof item === 'object') {
        items.push(item as T);
        if (maxItems !== undefined && items.length >= maxItems) return items;
      }
    }

    const last = page[page.length - 1];
    cursor = typeof last?.cursor === 'string' ? last.cursor : undefined;
    if (!cursor) break;
  }

  return items;
}
