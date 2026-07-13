import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SessionData {
  cookie: string;
  email: string;
  savedAt: number;
}

export function sessionFilePath(): string {
  return path.join(os.homedir(), '.edm-cli', 'session.json');
}

export function saveSession(data: SessionData, filePath: string = sessionFilePath()): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function loadSession(filePath: string = sessionFilePath()): SessionData | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionData;
  } catch {
    return null;
  }
}

export function clearSession(filePath: string = sessionFilePath()): void {
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}
