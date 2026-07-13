import type { ApiClient } from '../http-client.js';
import type { Campaign, SendLog } from '../types.js';
import { parseRecipientFilter, filterToQuery, type RecipientFlags } from '../recipients.js';

export interface ListOpts {
  status?: string;
  limit?: number;
  offset?: number;
}

export async function runList(client: ApiClient, opts: ListOpts): Promise<Campaign[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  const result = await client.request<{ campaigns: Campaign[] }>(`/api/campaigns?${params.toString()}`);
  return result.campaigns;
}

export async function runGet(client: ApiClient, id: string): Promise<Campaign> {
  const result = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`);
  return result.campaign;
}

export interface LogsOpts {
  status?: string;
  email?: string;
  limit?: number;
  offset?: number;
}

export async function runLogs(client: ApiClient, id: string, opts: LogsOpts): Promise<SendLog[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.email) params.set('email', opts.email);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  const result = await client.request<{ logs: SendLog[] }>(`/api/campaigns/${id}/logs?${params.toString()}`);
  return result.logs;
}

export async function runPreviewRecipients(client: ApiClient, flags: RecipientFlags): Promise<number> {
  const filter = parseRecipientFilter(flags);
  const result = await client.request<{ count: number }>(`/api/campaigns/recipients/preview?${filterToQuery(filter)}`);
  return result.count;
}
