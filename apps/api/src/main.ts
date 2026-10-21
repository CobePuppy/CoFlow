import { start } from './app.js';
export { db } from './shared/context.js';
export { start };
if (!process.env.COFLOW_IMPORT_ONLY) void start();
