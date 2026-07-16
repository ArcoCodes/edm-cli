import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProgram, defaultDeps } from './cli.js';

test('buildProgram registers the expected top-level and campaign subcommands', () => {
  const program = buildProgram(defaultDeps('https://example.test'));
  const topNames = program.commands.map((c) => c.name()).sort();
  assert.deepEqual(topNames, ['asset', 'campaign', 'db', 'login', 'logout', 'sender', 'whoami']);

  const campaign = program.commands.find((c) => c.name() === 'campaign');
  assert.ok(campaign);
  const campaignNames = campaign!.commands.map((c) => c.name()).sort();
  assert.deepEqual(campaignNames, [
    'create', 'delete', 'get', 'list', 'logs', 'preview-recipients',
    'resend-failed', 'send', 'set-html', 'set-recipients', 'set-text', 'update',
  ]);
});

test('campaign create requires --name, --subject, and --file', () => {
  const program = buildProgram(defaultDeps('https://example.test'));
  const campaign = program.commands.find((c) => c.name() === 'campaign')!;
  const create = campaign.commands.find((c) => c.name() === 'create')!;
  const requiredFlags = create.options.filter((o) => o.mandatory).map((o) => o.long);
  assert.deepEqual(requiredFlags.sort(), ['--file', '--name', '--subject']);
});
