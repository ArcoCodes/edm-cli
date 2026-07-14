import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_URL = 'git+https://github.com/ArcoCodes/edm-cli.git';
const RAW_PKG_URL = 'https://raw.githubusercontent.com/ArcoCodes/edm-cli/main/package.json';

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

export async function checkForUpdate(opts: {
  confirm: (message: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!process.stdout.isTTY) return;
  const skip = ['--help', '-h', '--version', '-V', '--json'];
  if (process.argv.some((a) => skip.includes(a))) return;

  const remoteVersion = await fetchRemoteVersion(opts.fetchImpl);
  if (!remoteVersion) return;

  const localVersion = getLocalVersion();
  if (remoteVersion === localVersion) return;

  console.error(`\nUpdate available: ${localVersion} → ${remoteVersion}`);
  const yes = await opts.confirm(`Run "npm install -g ${REPO_URL}" now?`);
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
