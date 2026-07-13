import * as readline from 'node:readline';

export async function promptText(message: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(`${message}: `, resolve));
  rl.close();
  return answer.trim();
}

export async function confirm(message: string): Promise<boolean> {
  const answer = await promptText(`${message} [y/N]`);
  return /^y(es)?$/i.test(answer);
}

const ENTER_CODES = new Set([10, 13]); // line feed, carriage return
const EOF_CODE = 4; // Ctrl+D
const INTERRUPT_CODE = 3; // Ctrl+C
const DELETE_CODES = new Set([8, 127]); // backspace, delete

export async function promptHidden(message: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(`${message}: `);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let input = '';
    const onData = (char: string) => {
      const code = char.charCodeAt(0);
      if (ENTER_CODES.has(code) || code === EOF_CODE) {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
        return;
      }
      if (code === INTERRUPT_CODE) {
        process.stdout.write('\n');
        process.exit(1);
      }
      if (DELETE_CODES.has(code)) {
        input = input.slice(0, -1);
        return;
      }
      input += char;
    };
    stdin.on('data', onData);
  });
}
