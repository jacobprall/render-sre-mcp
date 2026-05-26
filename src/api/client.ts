import { RenderClient } from 'render-api';

let client: RenderClient | null = null;
let cachedOwnerId: string | null = null;

export function getApiKey(): string {
  const key = process.env.RENDER_API_KEY;
  if (!key) {
    throw new Error('RENDER_API_KEY is required. Set it as an environment variable.');
  }
  return key;
}

export function getClient(): RenderClient {
  if (!client) {
    client = new RenderClient({ apiKey: getApiKey() });
  }
  return client;
}

export async function getOwnerId(): Promise<string> {
  if (cachedOwnerId) return cachedOwnerId;
  const key = getApiKey();
  const resp = await fetch('https://api.render.com/v1/owners?limit=1', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) throw new Error(`Failed to fetch owner: ${resp.status}`);
  const data = await resp.json() as Array<{ owner: { id: string } }>;
  if (!data.length) throw new Error('No owner found for this API key');
  cachedOwnerId = data[0].owner.id;
  return cachedOwnerId;
}
