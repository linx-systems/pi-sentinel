import * as esbuild from 'esbuild';
import { mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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
  // Copy manifest using read/write to avoid Bun copyFileSync issues
  const manifestContent = readFileSync(join(srcDir, 'manifest.json'));
  writeFileSync(join(distDir, 'manifest.json'), manifestContent);

  // Copy HTML files
  mkdirSync(join(distDir, 'popup'), { recursive: true });
  mkdirSync(join(distDir, 'sidebar'), { recursive: true });
  mkdirSync(join(distDir, 'options'), { recursive: true });

  // Use read/write for all file copies to avoid Bun copyFileSync issues
  const copyFile = (src, dest) => writeFileSync(dest, readFileSync(src));

  copyFile(join(srcDir, 'popup/popup.html'), join(distDir, 'popup/popup.html'));
  copyFile(join(srcDir, 'popup/popup.css'), join(distDir, 'popup/popup.css'));
  copyFile(join(srcDir, 'sidebar/sidebar.html'), join(distDir, 'sidebar/sidebar.html'));
  copyFile(join(srcDir, 'sidebar/sidebar.css'), join(distDir, 'sidebar/sidebar.css'));
  copyFile(join(srcDir, 'options/options.html'), join(distDir, 'options/options.html'));
  copyFile(join(srcDir, 'options/options.css'), join(distDir, 'options/options.css'));

  // Copy icons using shell command to avoid Bun filesystem issues
  if (existsSync(join(srcDir, 'icons'))) {
    mkdirSync(join(distDir, 'icons'), { recursive: true });
    execSync(`cp -r "${join(srcDir, 'icons')}"/* "${join(distDir, 'icons')}"`);
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
