import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runList, runGet, runLogs, runPreviewRecipients } from './campaign-read.js';
import type { ApiClient } from '../http-client.js';

function recordingClient(response: unknown): { client: ApiClient; calls: string[] } {
  const calls: string[] = [];
  const client: ApiClient = {
    request: async (reqPath: string) => { calls.push(reqPath); return response as any; },
  };
  return { client, calls };
}

test('runList builds the query string from status/limit/offset', async () => {
  const { client, calls } = recordingClient({ campaigns: [] });
  await runList(client, { status: 'draft', limit: 10, offset: 20 });
  assert.equal(calls[0], '/api/campaigns?status=draft&limit=10&offset=20');
});

test('runList omits absent filters', async () => {
  const { client, calls } = recordingClient({ campaigns: [] });
  await runList(client, {});
  assert.equal(calls[0], '/api/campaigns?');
});

test('runGet fetches a single campaign by id', async () => {
  const { client, calls } = recordingClient({ campaign: { id: 'c1' } });
  const campaign = await runGet(client, 'c1');
  assert.equal(calls[0], '/api/campaigns/c1');
  assert.equal(campaign.id, 'c1');
});

test('runLogs builds the query string from status/email/limit/offset', async () => {
  const { client, calls } = recordingClient({ logs: [] });
  await runLogs(client, 'c1', { status: 'failed', email: 'a@b.com', limit: 5, offset: 0 });
  assert.equal(calls[0], '/api/campaigns/c1/logs?status=failed&email=a%40b.com&limit=5&offset=0');
});

test('runPreviewRecipients returns the count for the parsed filter', async () => {
  const { client, calls } = recordingClient({ count: 42 });
  const count = await runPreviewRecipients(client, { recipients: 'active', days: '7' });
  assert.equal(calls[0], '/api/campaigns/recipients/preview?type=active&days=7');
  assert.equal(count, 42);
});
