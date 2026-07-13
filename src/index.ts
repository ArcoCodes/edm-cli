import { buildProgram, defaultDeps } from './cli.js';

const BASE_URL = 'https://optimal-dodo-5009.edgespark.app';

const program = buildProgram(defaultDeps(BASE_URL));
await program.parseAsync(process.argv);
