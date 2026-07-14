import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ApiClient } from '../http-client.js';

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export interface UploadResult {
  key: string;
  url: string;
}

export interface AssetFile {
  path: string;
  size: number;
  uploadedAt: string;
  url: string;
}

export async function runUpload(
  client: ApiClient,
  filePath: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadResult> {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const filename = path.basename(resolved);
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    throw new Error(`Unsupported image type: .${ext} (allowed: ${Object.keys(CONTENT_TYPES).join(', ')})`);
  }

  const presign = await client.request<{
    uploadUrl: string;
    requiredHeaders: Record<string, string>;
    key: string;
  }>('/api/images/presign', {
    method: 'POST',
    body: JSON.stringify({ filename, contentType }),
  });

  const fileBuffer = fs.readFileSync(resolved);

  const putRes = await fetchImpl(presign.uploadUrl, {
    method: 'PUT',
    headers: {
      ...presign.requiredHeaders,
      'Content-Type': contentType,
    },
    body: fileBuffer,
  });

  if (!putRes.ok) {
    throw new Error(`Upload failed: HTTP ${putRes.status}`);
  }

  const url = `${baseUrl}/api/public/img/${presign.key}`;
  return { key: presign.key, url };
}

export async function runListAssets(client: ApiClient): Promise<AssetFile[]> {
  const result = await client.request<{ files: AssetFile[] }>('/api/images/list');
  return result.files;
}

export async function runDeleteAsset(client: ApiClient, key: string): Promise<void> {
  await client.request('/api/images/' + key, { method: 'DELETE' });
}
