import * as fs from 'node:fs';
import type { ApiClient } from '../http-client.js';
import type { Campaign } from '../types.js';
import { parseRecipientFilter, type RecipientFlags } from '../recipients.js';

function readContentFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.trim()) {
    throw new Error(`File is empty: ${filePath}`);
  }
  return content;
}

export interface CreateOpts {
  name: string;
  subject: string;
  description?: string;
  contentType?: 'html' | 'text';
  file: string;
  test?: boolean;
  recipientFlags: RecipientFlags;
}

export async function runCreate(client: ApiClient, opts: CreateOpts): Promise<Campaign> {
  const contentType = opts.contentType ?? 'html';
  const content = readContentFile(opts.file);
  const recipientFilter = opts.recipientFlags.recipients ? parseRecipientFilter(opts.recipientFlags) : undefined;
  const body: Record<string, unknown> = {
    name: opts.name,
    subject: opts.subject,
    description: opts.description,
    contentType,
    isTest: opts.test,
    recipientFilter,
  };
  if (contentType === 'html') body.htmlContent = content;
  else body.textContent = content;
  const result = await client.request<{ campaign: Campaign }>('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return result.campaign;
}

export interface UpdateOpts {
  name?: string;
  subject?: string;
  description?: string;
}

export async function runUpdate(client: ApiClient, id: string, opts: UpdateOpts): Promise<Campaign> {
  const result = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify(opts),
  });
  return result.campaign;
}

export async function runSetHtml(client: ApiClient, id: string, filePath: string): Promise<Campaign> {
  const htmlContent = readContentFile(filePath);
  const result = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ contentType: 'html', htmlContent }),
  });
  return result.campaign;
}

export async function runSetText(client: ApiClient, id: string, filePath: string): Promise<Campaign> {
  const textContent = readContentFile(filePath);
  const result = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ contentType: 'text', textContent }),
  });
  return result.campaign;
}

export async function runSetRecipients(client: ApiClient, id: string, flags: RecipientFlags): Promise<Campaign> {
  const recipientFilter = parseRecipientFilter(flags);
  const result = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ recipientFilter }),
  });
  return result.campaign;
}
