import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProofVerifier } from './maintenance/verify-proof.js';
export {
  verifyProofFile,
  runProofVerifier,
} from './maintenance/verify-proof.js';
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runProofVerifier();
