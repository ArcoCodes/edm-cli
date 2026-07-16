import type { ApiClient } from '../http-client.js';

interface SenderSettings {
  senderEmail: string | null;
  senderName: string | null;
  resendApiKey: string | null;
}

export async function runSenderShow(client: ApiClient): Promise<SenderSettings> {
  const me = await client.request<SenderSettings & { email: string }>('/api/me');
  return {
    senderEmail: me.senderEmail,
    senderName: me.senderName,
    resendApiKey: me.resendApiKey,
  };
}

export async function runSenderSet(
  client: ApiClient,
  opts: {
    senderEmail?: string;
    senderName?: string;
    promptHidden: (message: string) => Promise<string>;
    setKey?: boolean;
  },
): Promise<SenderSettings> {
  const payload: Record<string, string | null> = {};
  if (opts.senderEmail !== undefined) payload.senderEmail = opts.senderEmail || null;
  if (opts.senderName !== undefined) payload.senderName = opts.senderName || null;
  if (opts.setKey) {
    const key = await opts.promptHidden('Resend API Key:');
    if (!key.trim()) throw new Error('API key cannot be empty.');
    payload.resendApiKey = key.trim();
  }
  return client.request<SenderSettings>('/api/me/sender', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function runSenderClear(client: ApiClient): Promise<SenderSettings> {
  return client.request<SenderSettings>('/api/me/sender', {
    method: 'PUT',
    body: JSON.stringify({ senderEmail: null, senderName: null, resendApiKey: null }),
  });
}
