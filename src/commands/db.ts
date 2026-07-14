import { executeQuery, loadApiKey, type DbQueryResult } from '../db-client.js';
import { saveConfig } from '../config.js';

export async function runDbSetup(opts: {
  promptHidden: (message: string) => Promise<string>;
  configFilePath?: string;
}): Promise<void> {
  const key = await opts.promptHidden('EdgeSpark API key:');
  if (!key.trim()) {
    throw new Error('API key cannot be empty.');
  }
  saveConfig({ edgesparkApiKey: key.trim() }, opts.configFilePath);
}

export async function runQuery(
  sql: string,
  fetchImpl?: typeof fetch,
  configFilePath?: string,
): Promise<DbQueryResult> {
  const apiKey = loadApiKey(configFilePath);
  return executeQuery(sql, apiKey, fetchImpl);
}
