// Bundles the server (and the shared package) into dist/ for production mode.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Native modules and packages with runtime file lookups stay in node_modules.
  external: ['better-sqlite3', '@node-rs/argon2', 'pino', 'thread-stream', 'pino-pretty'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' });
await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' });
