import * as esbuild from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, existsSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const srcDir = join(rootDir, 'src');
const distDir = join(rootDir, 'dist');

const isWatch = process.argv.includes('--watch');

// Clean dist directory
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}
mkdirSync(distDir, { recursive: true });

// Base esbuild options
const baseOptions = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  target: ['firefox115'],
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
  },
  jsx: 'automatic',
  jsxImportSource: 'preact',
};

// Build configurations
const builds = [
  {
    entryPoints: [join(srcDir, 'background/index.ts')],
    outfile: join(distDir, 'background.js'),
    ...baseOptions,
    format: 'iife', // Background scripts work with IIFE too
  },
  {
    entryPoints: [join(srcDir, 'popup/index.tsx')],
    outfile: join(distDir, 'popup/popup.js'),
    ...baseOptions,
    format: 'iife',
  },
  {
    entryPoints: [join(srcDir, 'sidebar/index.tsx')],
    outfile: join(distDir, 'sidebar/sidebar.js'),
    ...baseOptions,
    format: 'iife',
  },
  {
    entryPoints: [join(srcDir, 'options/index.tsx')],
    outfile: join(distDir, 'options/options.js'),
    ...baseOptions,
    format: 'iife',
  },
];

// Copy static files
function copyStatic() {
  // Copy manifest
  copyFileSync(join(srcDir, 'manifest.json'), join(distDir, 'manifest.json'));

  // Copy HTML files
  mkdirSync(join(distDir, 'popup'), { recursive: true });
  mkdirSync(join(distDir, 'sidebar'), { recursive: true });
  mkdirSync(join(distDir, 'options'), { recursive: true });

  copyFileSync(join(srcDir, 'popup/popup.html'), join(distDir, 'popup/popup.html'));
  copyFileSync(join(srcDir, 'popup/popup.css'), join(distDir, 'popup/popup.css'));
  copyFileSync(join(srcDir, 'sidebar/sidebar.html'), join(distDir, 'sidebar/sidebar.html'));
  copyFileSync(join(srcDir, 'sidebar/sidebar.css'), join(distDir, 'sidebar/sidebar.css'));
  copyFileSync(join(srcDir, 'options/options.html'), join(distDir, 'options/options.html'));
  copyFileSync(join(srcDir, 'options/options.css'), join(distDir, 'options/options.css'));

  // Copy icons
  if (existsSync(join(srcDir, 'icons'))) {
    cpSync(join(srcDir, 'icons'), join(distDir, 'icons'), { recursive: true });
  }

  console.log('Static files copied');
}

async function build() {
  try {
    if (isWatch) {
      // Create contexts for watch mode
      const contexts = await Promise.all(
        builds.map((config) => esbuild.context(config))
      );

      // Start watching
      await Promise.all(contexts.map((ctx) => ctx.watch()));
      console.log('Watching for changes...');

      // Copy static files initially
      copyStatic();
    } else {
      // One-time build
      await Promise.all(builds.map((config) => esbuild.build(config)));
      copyStatic();
      console.log('Build complete!');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
