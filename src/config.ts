import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface Config {
  edgesparkApiKey?: string;
  lastUpdateCheck?: number;
  latestVersion?: string;
}

export function configFilePath(): string {
  return path.join(os.homedir(), '.edm-cli', 'config.json');
}

export function loadConfig(filePath: string = configFilePath()): Config {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Config;
  } catch {
    return {};
  }
}

export function saveConfig(data: Config, filePath: string = configFilePath()): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const existing = loadConfig(filePath);
  const merged = { ...existing, ...data };
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}
