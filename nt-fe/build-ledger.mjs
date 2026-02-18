#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWatch = process.argv.includes('--watch');

const config = {
  entryPoints: [resolve(__dirname, 'src/ledger-wallet/index.js')],
  bundle: true,
  format: 'esm',
  outfile: resolve(__dirname, 'public/ledger-wallet/ledger-executor.js'),
  platform: 'browser',
  target: ['es2020'],
  sourcemap: isWatch ? 'inline' : false,
  minify: !isWatch,
  treeShaking: true,
  external: [],
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
  },
  inject: [resolve(__dirname, 'esbuild-shims.js')],
  banner: {
    js: '// Ledger Hardware Wallet Executor - Bundled with esbuild\n',
  },
};

try {
  if (isWatch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('👀 Watching for changes in src/ledger-wallet/...');
    console.log('📦 Output: public/ledger-wallet/ledger-executor.js');
  } else {
    await esbuild.build(config);
    console.log('✅ Ledger wallet bundle created successfully!');
    console.log('📦 Output: public/ledger-wallet/ledger-executor.js');
  }
} catch (error) {
  console.error('❌ Build failed:', error);
  process.exit(1);
}
