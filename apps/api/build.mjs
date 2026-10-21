import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  packages: 'external',
  format: 'esm',
  outfile: 'dist/main.js',
  plugins: [
    {
      name: 'bundle-workspace-contracts',
      setup(b) {
        b.onResolve({ filter: /^@coflow\/contracts(?:\/|$)/ }, (args) => ({
          path: path.join(
            root,
            'packages/contracts/src',
            args.path === '@coflow/contracts'
              ? 'index.ts'
              : args.path.split('/').at(-1).replace(/\.js$/, '.ts'),
          ),
        }));
      },
    },
  ],
});
