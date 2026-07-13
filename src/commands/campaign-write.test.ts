import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCreate, runUpdate, runSetHtml, runSetText, runSetRecipients } from './campaign-write.js';
import type { ApiClient } from '../http-client.js';
import type { Campaign } from '../types.js';

function tempFile(content: string, ext = '.html'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edm-cli-test-'));
  const file = path.join(dir, `content${ext}`);
  fs.writeFileSync(file, content);
  return file;
}

function fakeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c1', name: 'n', subject: 's', description: null, contentType: 'html',
    htmlContent: null, textContent: null, status: 'draft', recipientFilter: null,
    totalRecipients: null, sentCount: 0, failedCount: 0, openedCount: 0, clickedCount: 0,
    isTest: 0, startedAt: null, completedAt: null, createdBy: null, sentBy: null,
    lastError: null, sendGeneration: 0, createdAt: 0, updatedAt: 0, ...overrides,
  };
}

function recordingClient(response: unknown): { client: ApiClient; calls: Array<{ path: string; init?: RequestInit }> } {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  return {
    calls,
    client: {
      request: async (reqPath: string, init?: RequestInit) => {
        calls.push({ path: reqPath, init });
        return response as any;
      },
    },
  };
}

test('runCreate reads the file and POSTs htmlContent for html campaigns', async () => {
  const file = tempFile('<p>hi</p>');
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runCreate(client, { name: 'N', subject: 'S', file, recipientFlags: {} });
  assert.equal(calls[0].path, '/api/campaigns');
  assert.equal(calls[0].init?.method, 'POST');
  const body = JSON.parse(calls[0].init?.body as string);
  assert.equal(body.htmlContent, '<p>hi</p>');
  assert.equal(body.contentType, 'html');
});

test('runCreate POSTs textContent for text campaigns', async () => {
  const file = tempFile('hello', '.txt');
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runCreate(client, { name: 'N', subject: 'S', file, contentType: 'text', recipientFlags: {} });
  const body = JSON.parse(calls[0].init?.body as string);
  assert.equal(body.textContent, 'hello');
  assert.equal(body.contentType, 'text');
});

test('runCreate includes a parsed recipientFilter when --recipients is given', async () => {
  const file = tempFile('<p>hi</p>');
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runCreate(client, { name: 'N', subject: 'S', file, recipientFlags: { recipients: 'active', days: '7' } });
  const body = JSON.parse(calls[0].init?.body as string);
  assert.deepEqual(body.recipientFilter, { type: 'active', days: 7 });
});

test('runCreate throws when the file does not exist', async () => {
  const { client } = recordingClient({ campaign: fakeCampaign() });
  await assert.rejects(
    () => runCreate(client, { name: 'N', subject: 'S', file: '/no/such/file.html', recipientFlags: {} }),
    /File not found/
  );
});

test('runUpdate PUTs the given fields', async () => {
  const { client, calls } = recordingClient({ campaign: fakeCampaign({ name: 'New' }) });
  const campaign = await runUpdate(client, 'c1', { name: 'New' });
  assert.equal(calls[0].path, '/api/campaigns/c1');
  assert.equal(calls[0].init?.method, 'PUT');
  assert.equal(campaign.name, 'New');
});

test('runSetHtml reads the file and PUTs htmlContent + contentType html', async () => {
  const file = tempFile('<p>v2</p>');
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runSetHtml(client, 'c1', file);
  const body = JSON.parse(calls[0].init?.body as string);
  assert.equal(body.htmlContent, '<p>v2</p>');
  assert.equal(body.contentType, 'html');
});

test('runSetText reads the file and PUTs textContent + contentType text', async () => {
  const file = tempFile('plain body', '.txt');
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runSetText(client, 'c1', file);
  const body = JSON.parse(calls[0].init?.body as string);
  assert.equal(body.textContent, 'plain body');
  assert.equal(body.contentType, 'text');
});

test('runSetRecipients PUTs the parsed recipientFilter', async () => {
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runSetRecipients(client, 'c1', { recipients: 'manual', emails: 'a@b.com' });
  const body = JSON.parse(calls[0].init?.body as string);
  assert.deepEqual(body.recipientFilter, { type: 'manual', emails: ['a@b.com'] });
});
