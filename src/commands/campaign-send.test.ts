import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSend, runResendFailed, runDelete, AbortedError } from './campaign-send.js';
import type { ApiClient } from '../http-client.js';

function queuedClient(responses: unknown[]): { client: ApiClient; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const client: ApiClient = {
    request: async (reqPath: string) => {
      calls.push(reqPath);
      const response = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return response as any;
    },
  };
  return { client, calls };
}

test('runSend confirms with the recipient count, then drives the chunk loop to completion', async () => {
  const { client, calls } = queuedClient([
    { campaign: { id: 'c1', recipientFilter: null, sendGeneration: 0 } },
    { count: 2 },
    { done: false, completed: false, generation: 1, sentCount: 1, failedCount: 0, totalRecipients: 2 },
    { done: true, completed: true, generation: 1, sentCount: 2, failedCount: 0, totalRecipients: 2 },
  ]);
  const progress: unknown[] = [];
  let confirmedMessage = '';
  const result = await runSend(client, 'c1', {
    confirm: async (message) => { confirmedMessage = message; return true; },
    onProgress: (r) => progress.push(r),
  });
  assert.equal(confirmedMessage, 'This will send real emails to 2 recipients. Continue?');
  assert.equal(result.completed, true);
  assert.equal(progress.length, 2);
  assert.deepEqual(calls, [
    '/api/campaigns/c1',
    '/api/campaigns/recipients/preview?type=all',
    '/api/campaigns/c1/send',
    '/api/campaigns/c1/send/continue',
  ]);
});

test('runSend throws AbortedError when the user declines confirmation', async () => {
  const { client } = queuedClient([
    { campaign: { id: 'c1', recipientFilter: null, sendGeneration: 0 } },
    { count: 2 },
  ]);
  await assert.rejects(
    () => runSend(client, 'c1', { confirm: async () => false, onProgress: () => {} }),
    AbortedError
  );
});

test('runSend skips confirmation when yes is true', async () => {
  const { client } = queuedClient([
    { campaign: { id: 'c1', recipientFilter: null, sendGeneration: 0 } },
    { count: 2 },
    { done: true, completed: true, generation: 1, sentCount: 2, failedCount: 0, totalRecipients: 2 },
  ]);
  let confirmCalled = false;
  const result = await runSend(client, 'c1', {
    yes: true,
    confirm: async () => { confirmCalled = true; return true; },
    onProgress: () => {},
  });
  assert.equal(confirmCalled, false);
  assert.equal(result.completed, true);
});

test('runResendFailed requires confirmation unless yes is set', async () => {
  const { client, calls } = queuedClient([{ status: 'sending' }]);
  await assert.rejects(
    () => runResendFailed(client, 'c1', { confirm: async () => false }),
    AbortedError
  );
  assert.equal(calls.length, 0);
});

test('runResendFailed calls the resend-failed endpoint when confirmed', async () => {
  const { client, calls } = queuedClient([{ status: 'sending' }]);
  const result = await runResendFailed(client, 'c1', { confirm: async () => true });
  assert.equal(calls[0], '/api/campaigns/c1/resend-failed');
  assert.equal(result.status, 'sending');
});

test('runDelete calls DELETE when confirmed', async () => {
  const { client, calls } = queuedClient([{}]);
  await runDelete(client, 'c1', { confirm: async () => true });
  assert.equal(calls[0], '/api/campaigns/c1');
});

test('runDelete throws AbortedError without calling the API when declined', async () => {
  const { client, calls } = queuedClient([{}]);
  await assert.rejects(() => runDelete(client, 'c1', { confirm: async () => false }), AbortedError);
  assert.equal(calls.length, 0);
});
