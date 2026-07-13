import type { ApiClient } from '../http-client.js';
import type { Campaign, SendChunkResult } from '../types.js';
import { filterToQuery, type RecipientFilter } from '../recipients.js';

export class AbortedError extends Error {}

export interface SendOptions {
  confirm: (message: string) => Promise<boolean>;
  onProgress: (result: SendChunkResult) => void;
  yes?: boolean;
}

export async function runSend(client: ApiClient, id: string, opts: SendOptions): Promise<SendChunkResult> {
  const { campaign } = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`);
  const filter: RecipientFilter = campaign.recipientFilter ? JSON.parse(campaign.recipientFilter) : { type: 'all' };
  const { count } = await client.request<{ count: number }>(`/api/campaigns/recipients/preview?${filterToQuery(filter)}`);

  if (!opts.yes) {
    const proceed = await opts.confirm(`This will send real emails to ${count} recipients. Continue?`);
    if (!proceed) throw new AbortedError('Send aborted by user');
  }

  let result = await client.request<SendChunkResult>(`/api/campaigns/${id}/send`, { method: 'POST' });
  opts.onProgress(result);
  while (!result.done) {
    result = await client.request<SendChunkResult>(`/api/campaigns/${id}/send/continue`, {
      method: 'POST',
      body: JSON.stringify({ offset: 0, generation: result.generation }),
    });
    opts.onProgress(result);
  }
  return result;
}

export interface ResendFailedResult {
  status: string;
}

export async function runResendFailed(
  client: ApiClient,
  id: string,
  opts: { confirm: (m: string) => Promise<boolean>; yes?: boolean }
): Promise<ResendFailedResult> {
  if (!opts.yes) {
    const proceed = await opts.confirm(`Resend all failed emails for campaign ${id}?`);
    if (!proceed) throw new AbortedError('Resend aborted by user');
  }
  return client.request<ResendFailedResult>(`/api/campaigns/${id}/resend-failed`, { method: 'POST' });
}

export async function runDelete(
  client: ApiClient,
  id: string,
  opts: { confirm: (m: string) => Promise<boolean>; yes?: boolean }
): Promise<void> {
  if (!opts.yes) {
    const proceed = await opts.confirm(`Delete campaign ${id}? This cannot be undone.`);
    if (!proceed) throw new AbortedError('Delete aborted by user');
  }
  await client.request(`/api/campaigns/${id}`, { method: 'DELETE' });
}
