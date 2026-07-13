import { Command } from 'commander';
import { createApiClient, ApiError, type ApiClient } from './http-client.js';
import { loadSession } from './session.js';
import { printOutput } from './output.js';
import { runLogin, runLogout, runWhoami } from './commands/auth.js';
import { runCreate, runUpdate, runSetHtml, runSetText, runSetRecipients } from './commands/campaign-write.js';
import { runList, runGet, runLogs, runPreviewRecipients } from './commands/campaign-read.js';
import { runSend, runResendFailed, runDelete, AbortedError } from './commands/campaign-send.js';
import { promptText, promptHidden, confirm } from './prompt.js';

export interface CliDeps {
  baseUrl: string;
  sessionFilePath?: string;
  fetchImpl?: typeof fetch;
  promptText: (message: string) => Promise<string>;
  promptHidden: (message: string) => Promise<string>;
  confirm: (message: string) => Promise<boolean>;
}

export function defaultDeps(baseUrl: string): CliDeps {
  return { baseUrl, promptText, promptHidden, confirm };
}

function requireClient(deps: CliDeps): ApiClient {
  const session = loadSession(deps.sessionFilePath);
  if (!session) {
    throw new Error('Not logged in — run "edm-cli login" first.');
  }
  return createApiClient(deps.baseUrl, session.cookie, deps.fetchImpl);
}

function isJson(command: Command): boolean {
  return Boolean((command.optsWithGlobals() as { json?: boolean }).json);
}

function handleAction(fn: () => Promise<void>): void {
  fn().catch((err: unknown) => {
    if (err instanceof AbortedError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    if (err instanceof ApiError) {
      console.error(`Error: ${err.message} (HTTP ${err.status})`);
      if (err.status === 401) console.error('Session expired or invalid — run "edm-cli login" again.');
      process.exitCode = 1;
      return;
    }
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

export function buildProgram(deps: CliDeps): Command {
  const program = new Command();
  program
    .name('edm-cli')
    .description('Agent-friendly CLI for the EDM campaign tool')
    .option('--json', 'output structured JSON instead of human-readable text');

  program
    .command('login')
    .description('Log in with email + password and cache the session')
    .action(() => handleAction(async () => {
      const result = await runLogin({
        baseUrl: deps.baseUrl,
        promptText: deps.promptText,
        promptHidden: deps.promptHidden,
        fetchImpl: deps.fetchImpl,
        sessionFilePath: deps.sessionFilePath,
      });
      console.log(`Logged in as ${result.email}`);
    }));

  program
    .command('logout')
    .description('Clear the cached session')
    .action(() => handleAction(async () => {
      runLogout(deps.sessionFilePath);
      console.log('Logged out.');
    }));

  program
    .command('whoami')
    .description('Show the current session identity and send permission')
    .action((_opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const me = await runWhoami(client);
      printOutput(isJson(command), me, [
        `email: ${me.email}`,
        `isSuperAdmin: ${me.isSuperAdmin}`,
        `canSend: ${me.canSend}`,
      ]);
    }));

  const campaign = program.command('campaign').description('Manage EDM campaigns');

  campaign
    .command('create')
    .requiredOption('--name <name>', 'campaign name')
    .requiredOption('--subject <subject>', 'email subject')
    .option('--description <description>', 'internal description')
    .option('--content-type <type>', 'html or text', 'html')
    .requiredOption('--file <path>', 'path to the HTML or text body')
    .option('--recipients <type>', 'all|active|plan_starter|plan_standard|plan_advanced|manual')
    .option('--days <n>', 'lookback window for --recipients active')
    .option('--emails <list>', 'comma-separated emails for --recipients manual')
    .option('--test', 'mark as a test campaign')
    .action((opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runCreate(client, {
        name: opts.name,
        subject: opts.subject,
        description: opts.description,
        contentType: opts.contentType,
        file: opts.file,
        test: opts.test,
        recipientFlags: { recipients: opts.recipients, days: opts.days, emails: opts.emails },
      });
      printOutput(isJson(command), result, [`Created campaign ${result.id}`]);
    }));

  campaign
    .command('update <id>')
    .option('--name <name>')
    .option('--subject <subject>')
    .option('--description <description>')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runUpdate(client, id, opts);
      printOutput(isJson(command), result, [`Updated campaign ${result.id}`]);
    }));

  campaign
    .command('set-html <id>')
    .requiredOption('--file <path>', 'path to the HTML body')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runSetHtml(client, id, opts.file);
      printOutput(isJson(command), result, [`Updated HTML for campaign ${result.id}`]);
    }));

  campaign
    .command('set-text <id>')
    .requiredOption('--file <path>', 'path to the plain-text body')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runSetText(client, id, opts.file);
      printOutput(isJson(command), result, [`Updated text content for campaign ${result.id}`]);
    }));

  campaign
    .command('set-recipients <id>')
    .requiredOption('--recipients <type>', 'all|active|plan_starter|plan_standard|plan_advanced|manual')
    .option('--days <n>')
    .option('--emails <list>')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runSetRecipients(client, id, { recipients: opts.recipients, days: opts.days, emails: opts.emails });
      printOutput(isJson(command), result, [`Updated recipients for campaign ${result.id}`]);
    }));

  campaign
    .command('list')
    .option('--status <status>', 'draft|sending|completed|failed|pending')
    .option('--limit <n>')
    .option('--offset <n>')
    .action((opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const campaigns = await runList(client, {
        status: opts.status,
        limit: opts.limit ? Number(opts.limit) : undefined,
        offset: opts.offset ? Number(opts.offset) : undefined,
      });
      printOutput(
        isJson(command),
        campaigns,
        campaigns.map((c) => `${c.id}  ${c.status.padEnd(10)}  ${c.name}  (sent ${c.sentCount}/${c.totalRecipients ?? '?'})`)
      );
    }));

  campaign
    .command('get <id>')
    .option('--full', 'include raw htmlContent/textContent')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runGet(client, id);
      const lines = [
        `id: ${result.id}`,
        `name: ${result.name}`,
        `subject: ${result.subject}`,
        `status: ${result.status}`,
        `contentType: ${result.contentType}`,
        `recipientFilter: ${result.recipientFilter ?? '(none)'}`,
        `sent/failed/total: ${result.sentCount}/${result.failedCount}/${result.totalRecipients ?? '?'}`,
      ];
      if (opts.full) {
        lines.push(`htmlContent: ${result.htmlContent ?? '(none)'}`);
        lines.push(`textContent: ${result.textContent ?? '(none)'}`);
      }
      printOutput(isJson(command), result, lines);
    }));

  campaign
    .command('logs <id>')
    .option('--status <status>', 'pending|sent|failed')
    .option('--email <email>')
    .option('--limit <n>')
    .option('--offset <n>')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const logs = await runLogs(client, id, {
        status: opts.status,
        email: opts.email,
        limit: opts.limit ? Number(opts.limit) : undefined,
        offset: opts.offset ? Number(opts.offset) : undefined,
      });
      printOutput(isJson(command), logs, logs.map((l) => `${l.recipientEmail}  ${l.status}${l.error ? `  error=${l.error}` : ''}`));
    }));

  campaign
    .command('preview-recipients')
    .requiredOption('--recipients <type>', 'all|active|plan_starter|plan_standard|plan_advanced|manual')
    .option('--days <n>')
    .option('--emails <list>')
    .action((opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const count = await runPreviewRecipients(client, { recipients: opts.recipients, days: opts.days, emails: opts.emails });
      printOutput(isJson(command), { count }, [`${count} recipients match this filter`]);
    }));

  campaign
    .command('send <id>')
    .option('--yes', 'skip the confirmation prompt')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runSend(client, id, {
        yes: opts.yes,
        confirm: deps.confirm,
        onProgress: (r) => console.error(`sent ${r.sentCount ?? 0} / failed ${r.failedCount ?? 0} / total ${r.totalRecipients ?? '?'}`),
      });
      printOutput(isJson(command), result, [result.completed ? 'Send completed.' : `Send stopped: ${result.error ?? 'unknown reason'}`]);
    }));

  campaign
    .command('resend-failed <id>')
    .option('--yes', 'skip the confirmation prompt')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runResendFailed(client, id, { yes: opts.yes, confirm: deps.confirm });
      printOutput(isJson(command), result, [`Status: ${result.status}`]);
    }));

  campaign
    .command('delete <id>')
    .option('--yes', 'skip the confirmation prompt')
    .action((id, opts) => handleAction(async () => {
      const client = requireClient(deps);
      await runDelete(client, id, { yes: opts.yes, confirm: deps.confirm });
      console.log(`Deleted campaign ${id}`);
    }));

  return program;
}
