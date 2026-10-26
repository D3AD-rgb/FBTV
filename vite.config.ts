import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
const appConfig = JSON.parse(readFileSync(resolve(root, 'fbtv.config.json'), 'utf8')) as {
  appId: string;
  title: string;
  vendor: string;
  catalogue: { manifestUrl: string };
};

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'uncommitted';
  }
}

const outDir = resolve(root, 'dist/app');

/**
 * webOS packaged apps load from file://, where module scripts are blocked and
 * `crossorigin` attributes break loading. Rewrite Vite's HTML to classic deferred scripts.
 */
function webosHtml(): Plugin {
  return {
    name: 'fbtv-webos-html',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
        .replace(/<script type="module" src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
        .replace(/ crossorigin(="[^"]*")?/g, '');
    },
  };
}

/** Writes appinfo.json (single version source: package.json) and copies lazily loaded player engines. */
function webosAssets(): Plugin {
  return {
    name: 'fbtv-webos-assets',
    apply: 'build',
    closeBundle() {
      const appinfo = {
        id: appConfig.appId,
        version: pkg.version === '0.0.0' ? '0.0.1' : pkg.version,
        vendor: appConfig.vendor,
        type: 'web',
        main: 'index.html',
        title: appConfig.title,
        icon: 'icons/icon-80.png',
        largeIcon: 'icons/icon-130.png',
        splashBackground: 'icons/splash.png',
        bgColor: '#0E1013',
        resolution: '1920x1080',
        disableBackHistoryAPI: true,
        handlesRelaunch: false,
        requiredMemory: 300,
        // Luna permissions (enforced from webOS 26/27). systemconfig.query: getSystemInfo for Diagnostics.
        requiredACG: ['systemconfig.query'],
      };
      writeFileSync(resolve(outDir, 'appinfo.json'), JSON.stringify(appinfo, null, 2) + '\n');
      const vendor = resolve(outDir, 'vendor');
      mkdirSync(vendor, { recursive: true });
      copyFileSync(resolve(root, 'node_modules/hls.js/dist/hls.min.js'), resolve(vendor, 'hls.min.js'));
      copyFileSync(resolve(root, 'node_modules/mpegts.js/dist/mpegts.js'), resolve(vendor, 'mpegts.js'));
    },
  };
}

export default defineConfig({
  root: resolve(root, 'src/app'),
  publicDir: resolve(root, 'src/app/public'),
  base: './',
  plugins: [preact(), webosHtml(), webosAssets()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_ID__: JSON.stringify(appConfig.appId),
    __APP_TITLE__: JSON.stringify(appConfig.title),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
    __CATALOGUE_MANIFEST_URL__: JSON.stringify(appConfig.catalogue.manifestUrl),
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2015',
    cssTarget: 'chrome53',
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'app.js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: { port: 5173, strictPort: true },
  test: {
    root,
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
