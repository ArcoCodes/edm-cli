export function printOutput(json: boolean, value: unknown, humanLines: string[]): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    for (const line of humanLines) {
      console.log(line);
    }
  }
}
