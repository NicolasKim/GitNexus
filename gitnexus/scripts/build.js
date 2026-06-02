#!/usr/bin/env node
/**
 * Build script that compiles gitnexus and inlines gitnexus-shared into the dist.
 *
 * Steps:
 *  1. Build gitnexus-shared (tsc)
 *  2. Build gitnexus (tsc)
 *  3. Copy gitnexus-shared/dist → dist/_shared
 *  4. Rewrite bare 'gitnexus-shared' specifiers → relative paths
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHARED_ROOT = path.resolve(ROOT, '..', 'gitnexus-shared');
const DIST = path.join(ROOT, 'dist');
const SHARED_DEST = path.join(DIST, '_shared');
const DEFAULT_BUILD_TIMEOUT_MS = 300_000;

function getBuildTimeoutMs() {
  const raw = process.env.GITNEXUS_BUILD_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_BUILD_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  console.warn(
    `[build] ignoring invalid GITNEXUS_BUILD_TIMEOUT_MS=${JSON.stringify(raw)}; using ${DEFAULT_BUILD_TIMEOUT_MS}ms`,
  );
  return DEFAULT_BUILD_TIMEOUT_MS;
}

const BUILD_TIMEOUT_MS = getBuildTimeoutMs();

/** Rolldown (Vite 8) ships platform bindings as optionalDependencies; partial installs often omit them. */
function webNativeBindingsMissing(webRoot) {
  const rolldownScope = path.join(webRoot, 'node_modules', '@rolldown');
  if (!fs.existsSync(rolldownScope)) return true;
  return !fs.readdirSync(rolldownScope).some((name) => name.startsWith('binding-'));
}

// Published-package guard: when installed from the npm registry the
// monorepo sibling `gitnexus-shared` does not exist and `dist/` is
// already pre-built. Skip the build to avoid a misleading ENOENT
// crash (#1795).
if (!fs.existsSync(SHARED_ROOT)) {
  if (fs.existsSync(DIST)) {
    console.log('[build] skipping — dist/ already present (published package).');
    process.exit(0);
  }
  console.error(
    `[build] gitnexus-shared not found at ${SHARED_ROOT} and no dist/ exists.\n` +
      'Are you running from the monorepo checkout? Run `npm install` from the repo root first.',
  );
  process.exit(1);
}

// ── 1. Build gitnexus-shared ───────────────────────────────────────
console.log('[build] compiling gitnexus-shared…');
// Resolve tsc from gitnexus (not cwd): shared package has no local node_modules on fresh install.
const tscCmd =
  process.platform === 'win32'
    ? path.join(ROOT, 'node_modules', '.bin', 'tsc.cmd')
    : path.join(ROOT, 'node_modules', '.bin', 'tsc');
if (!fs.existsSync(tscCmd)) {
  console.error(
    `[build] TypeScript compiler not found at ${tscCmd}.\n` +
      'Run `npm install` in gitnexus/ first (typescript is a devDependency).',
  );
  process.exit(1);
}
execSync(tscCmd, { cwd: SHARED_ROOT, stdio: 'inherit', timeout: BUILD_TIMEOUT_MS });

// ── 2. Build gitnexus ──────────────────────────────────────────────
console.log('[build] compiling gitnexus…');
execSync(tscCmd, { cwd: ROOT, stdio: 'inherit', timeout: BUILD_TIMEOUT_MS });

// ── 3. Copy shared dist ────────────────────────────────────────────
console.log('[build] copying shared module into dist/_shared…');
fs.cpSync(path.join(SHARED_ROOT, 'dist'), SHARED_DEST, { recursive: true });

// ── 4. Rewrite imports ─────────────────────────────────────────────
console.log('[build] rewriting gitnexus-shared imports…');
let rewritten = 0;

function rewriteFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.includes('gitnexus-shared')) return;

  const relDir = path.relative(path.dirname(filePath), SHARED_DEST);
  // Always use posix separators and point to the package index
  const relImport = relDir.split(path.sep).join('/') + '/index.js';

  const updated = content
    .replace(/from\s+['"]gitnexus-shared['"]/g, `from '${relImport}'`)
    .replace(/import\(\s*['"]gitnexus-shared['"]\s*\)/g, `import('${relImport}')`);

  if (updated !== content) {
    fs.writeFileSync(filePath, updated);
    rewritten++;
  }
}

function walk(dir, extensions, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, cb);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      cb(full);
    }
  }
}

walk(DIST, ['.js', '.d.ts'], rewriteFile);

// ── 5. Make CLI entry executable ────────────────────────────────────
const cliEntry = path.join(DIST, 'cli', 'index.js');
if (fs.existsSync(cliEntry)) fs.chmodSync(cliEntry, 0o755);

// ── 6. Build & copy web UI ──────────────────────────────────────────
const WEB_ROOT = path.resolve(ROOT, '..', 'gitnexus-web');
const WEB_DEST = path.join(DIST, '..', 'web');

if (fs.existsSync(path.join(WEB_ROOT, 'package.json'))) {
  const skipWeb =
    process.env.GITNEXUS_SKIP_WEB_BUILD === '1' || process.env.GITNEXUS_SKIP_WEB_BUILD === 'true';
  if (skipWeb) {
    console.log('[build] skipping web UI (GITNEXUS_SKIP_WEB_BUILD is set).');
  } else {
    console.log('[build] building gitnexus-web…');
    const webNodeModules = path.join(WEB_ROOT, 'node_modules');
    if (!fs.existsSync(webNodeModules) || webNativeBindingsMissing(WEB_ROOT)) {
      if (fs.existsSync(webNodeModules) && webNativeBindingsMissing(WEB_ROOT)) {
        console.log(
          '[build] gitnexus-web node_modules is incomplete (missing rolldown native binding); running npm ci…',
        );
      } else {
        console.log('[build] installing gitnexus-web dependencies…');
      }
      // Rolldown/Vite platform bindings are optionalDependencies; plain `npm ci` often omits them (npm/cli#4828).
      execSync('npm ci --include=optional', {
        cwd: WEB_ROOT,
        stdio: 'inherit',
        timeout: BUILD_TIMEOUT_MS,
      });
    }
    execSync('npm run build', { cwd: WEB_ROOT, stdio: 'inherit', timeout: BUILD_TIMEOUT_MS });

    // Copy dist → gitnexus/web/ (shipped in the npm package)
    fs.rmSync(WEB_DEST, { recursive: true, force: true });
    fs.cpSync(path.join(WEB_ROOT, 'dist'), WEB_DEST, { recursive: true });
    console.log('[build] copied web UI → gitnexus/web/');
  }
} else {
  console.log('[build] skipping web UI (gitnexus-web not found)');
}

console.log(`[build] done — rewrote ${rewritten} files.`);
