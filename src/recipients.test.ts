import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipientFilter, filterToQuery } from './recipients.js';

test('parseRecipientFilter requires --recipients', () => {
  assert.throws(() => parseRecipientFilter({}), /--recipients is required/);
});

test('parseRecipientFilter rejects an unknown type', () => {
  assert.throws(() => parseRecipientFilter({ recipients: 'bogus' }), /Invalid --recipients value/);
});

test('parseRecipientFilter returns {type:"all"} for all', () => {
  assert.deepEqual(parseRecipientFilter({ recipients: 'all' }), { type: 'all' });
});

test('parseRecipientFilter defaults days to 30 for active', () => {
  assert.deepEqual(parseRecipientFilter({ recipients: 'active' }), { type: 'active', days: 30 });
});

test('parseRecipientFilter honors an explicit --days for active', () => {
  assert.deepEqual(parseRecipientFilter({ recipients: 'active', days: '7' }), { type: 'active', days: 7 });
});

test('parseRecipientFilter rejects an out-of-range --days', () => {
  assert.throws(() => parseRecipientFilter({ recipients: 'active', days: '400' }), /--days must be an integer between 1 and 365/);
});

test('parseRecipientFilter parses a comma-separated --emails list for manual', () => {
  assert.deepEqual(
    parseRecipientFilter({ recipients: 'manual', emails: 'a@b.com, c@d.com' }),
    { type: 'manual', emails: ['a@b.com', 'c@d.com'] }
  );
});

test('parseRecipientFilter rejects manual with no --emails', () => {
  assert.throws(() => parseRecipientFilter({ recipients: 'manual' }), /--emails is required/);
});

test('parseRecipientFilter rejects an invalid email in --emails', () => {
  assert.throws(() => parseRecipientFilter({ recipients: 'manual', emails: 'not-an-email' }), /Invalid email address/);
});

test('parseRecipientFilter passes through plan_starter/plan_standard/plan_advanced', () => {
  assert.deepEqual(parseRecipientFilter({ recipients: 'plan_starter' }), { type: 'plan_starter' });
  assert.deepEqual(parseRecipientFilter({ recipients: 'plan_standard' }), { type: 'plan_standard' });
  assert.deepEqual(parseRecipientFilter({ recipients: 'plan_advanced' }), { type: 'plan_advanced' });
});

test('filterToQuery serializes each filter type', () => {
  assert.equal(filterToQuery({ type: 'all' }), 'type=all');
  assert.equal(filterToQuery({ type: 'active', days: 7 }), 'type=active&days=7');
  assert.equal(filterToQuery({ type: 'manual', emails: ['a@b.com', 'c@d.com'] }), 'type=manual&emails=a%40b.com%2Cc%40d.com');
});
