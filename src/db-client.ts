import { loadConfig, type Config } from './config.js';

export class DbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbError';
  }
}

export interface DbQueryResult {
  rows: Record<string, unknown>[];
  count: number;
}

const YOUMENG_PROJECT_ID = '1fb1f523-4ee1-4af5-9f1b-aefc12c84ab4';
const EDGESPARK_SQL_API = 'https://api.edgespark.dev/api/v1/project/database/sql/execute';

function validateReadOnly(sql: string): void {
  const first = sql.trimStart().toUpperCase();
  if (!first.startsWith('SELECT') && !first.startsWith('WITH')) {
    throw new DbError('Only read-only queries are allowed (must start with SELECT or WITH).');
  }
}

export function loadApiKey(configFilePath?: string): string {
  const fromEnv = process.env.EDGESPARK_API_KEY;
  if (fromEnv) return fromEnv;

  const config: Config = loadConfig(configFilePath);
  if (config.edgesparkApiKey) return config.edgesparkApiKey;

  throw new DbError('EdgeSpark API key not configured — run "edm-cli db setup" first.');
}

export async function executeQuery(
  sql: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DbQueryResult> {
  validateReadOnly(sql);

  const res = await fetchImpl(EDGESPARK_SQL_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      project_id: YOUMENG_PROJECT_ID,
      environment: 'production',
      sql,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const msg =
      (body.message as string | undefined) ??
      (body.error as string | undefined) ??
      `HTTP ${res.status}`;
    throw new DbError(`EdgeSpark SQL API error: ${msg}`);
  }

  const data = body.data as { success?: boolean; results?: Array<{ rows: Record<string, unknown>[]; meta: Record<string, unknown> }> } | undefined;
  if (!data?.success) {
    throw new DbError(`Query failed: ${JSON.stringify(body)}`);
  }

  const results = data.results;
  if (!results?.length) {
    return { rows: [], count: 0 };
  }

  const rows = results[0].rows ?? [];
  return { rows, count: rows.length };
}
