import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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

const catalogueDir = resolve(root, 'build-data/catalogue');
const libraryDir = resolve(root, 'build-data/library-export');

/**
 * Serves the PC source-library export (npm run library:refresh) at /library/ in development,
 * and bundles it into the app as library/ only for local builds (FBTV_BUNDLE_LIBRARY=1, set by
 * `npm run package -- --with-library`). Public and release builds never contain the library:
 * it holds unreviewed third-party lists and, with provider profiles, the owner's own sources.
 * The TV can also read it from `npm run library:serve` on the home network.
 */
function libraryExport(): Plugin {
  return {
    name: 'fbtv-library-export',
    configureServer(server) {
      server.middlewares.use('/library/', (req, res, next) => {
        const file = resolve(libraryDir, (req.url || '').replace(/^\/+/, '').split('?')[0] || '');
        if (!file.startsWith(libraryDir) || !existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (process.env.FBTV_BUNDLE_LIBRARY !== '1') {
        this.info('Library not bundled (public build). Local build: npm run package -- --with-library');
        return;
      }
      if (!existsSync(resolve(libraryDir, 'registry.json'))) {
        this.warn('No library export in build-data/library-export — run `npm run library:refresh`.');
        return;
      }
      const copyDir = (from: string, to: string) => {
        mkdirSync(to, { recursive: true });
        for (const f of readdirSync(from, { withFileTypes: true })) {
          if (f.isDirectory()) copyDir(resolve(from, f.name), resolve(to, f.name));
          else if (f.name.endsWith('.json')) copyFileSync(resolve(from, f.name), resolve(to, f.name));
        }
      };
      copyDir(libraryDir, resolve(outDir, 'library'));
    },
  };
}

/**
 * Bundles the latest catalogue snapshot (from `npm run catalogue`) into the app so the
 * first launch works offline, and serves it at /catalogue/ during development.
 */
function catalogueSnapshot(): Plugin {
  return {
    name: 'fbtv-catalogue-snapshot',
    configureServer(server) {
      server.middlewares.use('/catalogue/', (req, res, next) => {
        const file = resolve(catalogueDir, (req.url || '').replace(/^\/+/, '').split('?')[0] || '');
        if (!file.startsWith(catalogueDir) || !existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (!existsSync(resolve(catalogueDir, 'manifest.json'))) {
        this.warn('No catalogue snapshot in build-data/catalogue — the app will start empty. Run `npm run catalogue`.');
        return;
      }
      const target = resolve(outDir, 'catalogue');
      mkdirSync(target, { recursive: true });
      for (const f of readdirSync(catalogueDir)) if (f.endsWith('.json')) copyFileSync(resolve(catalogueDir, f), resolve(target, f));
    },
  };
}

/** Writes appinfo.json (single version source: package.json) and copies lazily loaded player engines. */
const VENDOR_FILES: Record<string, string> = {
  'hls.min.js': 'node_modules/hls.js/dist/hls.min.js',
  'mpegts.js': 'node_modules/mpegts.js/dist/mpegts.js',
};

/** Dev server: serve the lazily loaded engines at /vendor/ as the build does. */
function vendorDev(): Plugin {
  return {
    name: 'fbtv-vendor-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/vendor/', (req, res, next) => {
        const rel = VENDOR_FILES[(req.url || '').replace(/^\/+/, '').split('?')[0] || ''];
        if (!rel) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(resolve(root, rel)));
      });
    },
  };
}

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
      for (const [name, rel] of Object.entries(VENDOR_FILES)) copyFileSync(resolve(root, rel), resolve(vendor, name));
    },
  };
}

export default defineConfig({
  root: resolve(root, 'src/app'),
  publicDir: resolve(root, 'src/app/public'),
  base: './',
  plugins: [preact(), webosHtml(), webosAssets(), vendorDev(), catalogueSnapshot(), libraryExport()],
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
