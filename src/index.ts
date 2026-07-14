import { buildProgram, defaultDeps } from './cli.js';
import { checkForUpdate } from './update-check.js';
import { confirm } from './prompt.js';

const BASE_URL = 'https://optimal-dodo-5009.edgespark.app';

await checkForUpdate({ confirm });

const program = buildProgram(defaultDeps(BASE_URL));
await program.parseAsync(process.argv);
