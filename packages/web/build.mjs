import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outdir = join(__dirname, 'dist');
const production = process.argv.includes('--production');

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

// Bundle the app JS + CSS
await build({
  entryPoints: [join(__dirname, 'src/index.ts')],
  bundle: true,
  minify: production,
  sourcemap: !production,
  format: 'esm',
  target: 'es2022',
  outdir,
  entryNames: 'app',
  loader: {
    '.ts': 'ts',
  },
  // Inline all CSS from highlight.js etc.
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
});

// Copy index.html into dist, injecting the script tag
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
writeFileSync(join(outdir, 'index.html'), html);

console.log('Build complete -> packages/web/dist/');
