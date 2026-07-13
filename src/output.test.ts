import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printOutput } from './output.js';

function captureConsoleLog(fn: () => void): string[] {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test('printOutput prints human lines when json is false', () => {
  const lines = captureConsoleLog(() => printOutput(false, { id: 'c1' }, ['id: c1', 'status: draft']));
  assert.deepEqual(lines, ['id: c1', 'status: draft']);
});

test('printOutput prints pretty JSON when json is true', () => {
  const lines = captureConsoleLog(() => printOutput(true, { id: 'c1' }, ['id: c1']));
  assert.deepEqual(lines, [JSON.stringify({ id: 'c1' }, null, 2)]);
});
