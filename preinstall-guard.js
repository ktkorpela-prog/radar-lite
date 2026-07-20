#!/usr/bin/env node
// v0.4.5 — self-install guard.
//
// Prevents `npm install @essentianlabs/radar-lite` from succeeding when
// run from inside the radar-lite dev repo itself — the trap that
// silently adds radar-lite as a dependency of itself in package.json,
// leaves a stale copy in node_modules/@essentianlabs/radar-lite/, and
// then confuses future `npm audit fix` runs into further mistakes.
//
// This trap fired twice on 2026-07-20 alone (once during v0.4.3 audit
// fix, once during v0.4.4 post-publish testing). Preinstall block IS
// the fix — the earlier changelog notes were documentation-only and
// operators (including the package's own author) still hit it.
//
// Behaviour matrix (see checkSelfInstall() below):
//
//   Scenario                                     | Guard fires?
//   ---------------------------------------------|-------------
//   Consumer: cd myproject && npm install radar  | NO   (name mismatch)
//   Author:   cd radar-lite && npm install       | NO   (cwd === INIT_CWD)
//   Author:   cd radar-lite && npm install radar | YES  (this is the trap)
//   npm ci in the dev repo (no radar in lock)    | NO   (cwd === INIT_CWD)
//   Malformed / missing parent package.json      | NO   (silent pass, don't block on edge cases)
//
// Robustness: any parse error or missing file → allow install. The
// guard is defensive against the specific known trap; it never blocks
// on ambiguity.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OWN_NAME = '@essentianlabs/radar-lite';

/**
 * Decide whether the preinstall guard should fire.
 *
 * @param {object} args
 * @param {string} args.cwd         - process.cwd() at time of invocation
 * @param {string|undefined} args.initCwd - process.env.INIT_CWD (npm sets this)
 * @param {(p: string) => boolean} args.readJsonExists - fs stub
 * @param {(p: string) => string} args.readJson - file-read stub
 * @returns {boolean} true if guard should block, false to allow install
 */
export function checkSelfInstall({ cwd, initCwd, readJsonExists, readJson }) {
  // No INIT_CWD → probably a manual node invocation, not npm. Don't block.
  if (!initCwd) return false;

  // If we're running from the same directory that invoked npm, we ARE the
  // local package being dev-installed (npm install with no args). Never block.
  if (resolve(cwd) === resolve(initCwd)) return false;

  // We're being installed as a dep INTO initCwd. Check whether initCwd IS our
  // own package (i.e., someone is trying to install us into ourselves).
  const parentPkgPath = join(initCwd, 'package.json');
  if (!readJsonExists(parentPkgPath)) return false;

  let parentPkg;
  try {
    parentPkg = JSON.parse(readJson(parentPkgPath));
  } catch (e) {
    return false; // malformed package.json — don't block install on edge cases
  }

  return parentPkg && parentPkg.name === OWN_NAME;
}

// When invoked directly (via `node preinstall-guard.js` from package.json),
// run the check against real fs + env and exit with error on trap.
// The URL check ensures the exported function stays testable without
// side-effects at import time.
const runningDirectly = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
                        import.meta.url.endsWith('/preinstall-guard.js');

if (runningDirectly) {
  const shouldBlock = checkSelfInstall({
    cwd: process.cwd(),
    initCwd: process.env.INIT_CWD,
    readJsonExists: existsSync,
    readJson: (p) => readFileSync(p, 'utf-8')
  });

  if (shouldBlock) {
    console.error('');
    console.error('  ✗ Refusing to install @essentianlabs/radar-lite as a self-dependency.');
    console.error('');
    console.error('    You appear to be running `npm install @essentianlabs/radar-lite`');
    console.error('    from inside the radar-lite dev repository itself. This adds');
    console.error('    radar-lite as a dependency of itself in package.json — a broken');
    console.error('    package state that also traps future `npm audit fix` runs.');
    console.error('');
    console.error('    If you meant to install dev dependencies for local development:');
    console.error('      npm install                              (no arguments)');
    console.error('');
    console.error('    If you meant to install into a different project:');
    console.error('      cd /path/to/consumer-project');
    console.error('      npm install @essentianlabs/radar-lite');
    console.error('');
    console.error('    If you meant to test the update-check banner or self-check flow,');
    console.error('    do that from a separate test project — not from the dev repo.');
    console.error('');
    process.exit(1);
  }
}
