import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_URL = 'git+https://github.com/ArcoCodes/edm-cli.git';
const RAW_PKG_URL = 'https://raw.githubusercontent.com/ArcoCodes/edm-cli/main/package.json';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function getLocalVersion(): string {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  return pkg.version;
}

async function fetchRemoteVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(RAW_PKG_URL);
    if (!res.ok) return null;
    const pkg = (await res.json()) as { version: string };
    return pkg.version;
  } catch {
    return null;
  }
}

function shouldSkip(): boolean {
  if (!process.stdout.isTTY) return true;
  const skip = ['--help', '-h', '--version', '-V', '--json'];
  if (process.argv.some((a) => skip.includes(a))) return true;
  return false;
}

async function promptAndUpdate(
  local: string,
  remote: string,
  confirmFn: (message: string) => Promise<boolean>,
): Promise<void> {
  console.error(`\nUpdate available: ${local} → ${remote}`);
  const yes = await confirmFn(`Run "npm install -g ${REPO_URL}" now?`);
  if (!yes) return;
  console.error('Updating...');
  try {
    execSync(`npm install -g ${REPO_URL}`, { stdio: 'inherit' });
    console.error('Updated successfully. Please re-run your command.\n');
    process.exit(0);
  } catch {
    console.error(`Update failed. You can update manually:\n  npm install -g ${REPO_URL}\n`);
  }
}

export async function checkForUpdate(opts: {
  confirm: (message: string) => Promise<boolean>;
  configFilePath?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (shouldSkip()) return;

  const config = loadConfig(opts.configFilePath);
  const now = Date.now();
  const localVersion = getLocalVersion();

  if (config.lastUpdateCheck && (now - config.lastUpdateCheck) < CHECK_INTERVAL_MS) {
    if (config.latestVersion && config.latestVersion !== localVersion) {
      await promptAndUpdate(localVersion, config.latestVersion, opts.confirm);
    }
    return;
  }

  const remoteVersion = await fetchRemoteVersion(opts.fetchImpl);

  saveConfig({
    lastUpdateCheck: now,
    latestVersion: remoteVersion ?? undefined,
  }, opts.configFilePath);

  if (remoteVersion && remoteVersion !== localVersion) {
    await promptAndUpdate(localVersion, remoteVersion, opts.confirm);
  }
}
