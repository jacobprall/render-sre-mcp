import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('transport mode', () => {
  it('stdio transport does not register webhook routes', async () => {
    const src = await readFile(join(root, 'src/transport/stdio.ts'), 'utf8');
    assert.doesNotMatch(src, /webhooks\/render/);
    assert.doesNotMatch(src, /createWebhookHandler/);
  });

  it('http transport registers webhooks only when secret configured', async () => {
    const src = await readFile(join(root, 'src/transport/http.ts'), 'utf8');
    assert.match(src, /config\.webhookSecret/);
    assert.match(src, /\/webhooks\/render/);
  });
});
