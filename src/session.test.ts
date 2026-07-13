import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { saveSession, loadSession, clearSession } from './session.js';

function tempSessionPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'edm-cli-test-')), 'session.json');
}

test('loadSession returns null when no file exists', () => {
  assert.equal(loadSession(tempSessionPath()), null);
});

test('saveSession then loadSession round-trips the data', () => {
  const filePath = tempSessionPath();
  saveSession({ cookie: 'a=1', email: 'x@youware.com', savedAt: 123 }, filePath);
  assert.deepEqual(loadSession(filePath), { cookie: 'a=1', email: 'x@youware.com', savedAt: 123 });
});

test('saveSession writes the file with mode 600', () => {
  const filePath = tempSessionPath();
  saveSession({ cookie: 'a=1', email: 'x@youware.com', savedAt: 123 }, filePath);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test('clearSession removes an existing session file', () => {
  const filePath = tempSessionPath();
  saveSession({ cookie: 'a=1', email: 'x@youware.com', savedAt: 123 }, filePath);
  clearSession(filePath);
  assert.equal(fs.existsSync(filePath), false);
});

test('clearSession is a no-op when no file exists', () => {
  assert.doesNotThrow(() => clearSession(tempSessionPath()));
});
