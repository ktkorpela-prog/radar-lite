import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkSelfInstall } from '../preinstall-guard.js';

// v0.4.5 — coverage for the self-install trap detector.
// The shell exit code / stderr message is not tested (would require
// subprocess spawn + timing); this covers the pure decision function.

const OWN_NAME = '@essentianlabs/radar-lite';

// Platform-agnostic fs stub. The guard calls path.join(initCwd, 'package.json')
// which normalises to backslashes on Windows / forward slashes on POSIX; the
// stub normalises keys the same way so tests pass on both.
function stubFs(files = {}) {
  const normalised = {};
  for (const [k, v] of Object.entries(files)) {
    // Match the exact shape path.join produces so tests are cross-platform.
    // The keys we're given end with '/package.json' — split, rejoin.
    const idx = k.lastIndexOf('/');
    if (idx >= 0) {
      normalised[join(k.slice(0, idx), k.slice(idx + 1))] = v;
    } else {
      normalised[k] = v;
    }
  }
  return {
    readJsonExists: (p) => Object.prototype.hasOwnProperty.call(normalised, p),
    readJson: (p) => {
      if (!Object.prototype.hasOwnProperty.call(normalised, p)) {
        throw new Error(`ENOENT: ${p}`);
      }
      return normalised[p];
    }
  };
}

describe('v0.4.5 preinstall-guard — checkSelfInstall', () => {

  it('BLOCKS: npm install radar-lite from inside radar-lite dev repo (the trap)', () => {
    const result = checkSelfInstall({
      cwd: '/home/karin/radar-lite/node_modules/@essentianlabs/radar-lite',
      initCwd: '/home/karin/radar-lite',
      ...stubFs({
        '/home/karin/radar-lite/package.json': JSON.stringify({ name: OWN_NAME, version: '0.4.4' })
      })
    });
    assert.equal(result, true, 'should block the self-install trap');
  });

  it('ALLOWS: consumer npm install radar-lite in their own project', () => {
    const result = checkSelfInstall({
      cwd: '/home/joe/myapp/node_modules/@essentianlabs/radar-lite',
      initCwd: '/home/joe/myapp',
      ...stubFs({
        '/home/joe/myapp/package.json': JSON.stringify({ name: 'myapp', version: '1.0.0' })
      })
    });
    assert.equal(result, false, 'consumer install must not be blocked');
  });

  it('ALLOWS: npm install (no args) in the dev repo — cwd === initCwd', () => {
    const result = checkSelfInstall({
      cwd: '/home/karin/radar-lite',
      initCwd: '/home/karin/radar-lite',
      ...stubFs({
        '/home/karin/radar-lite/package.json': JSON.stringify({ name: OWN_NAME, version: '0.4.4' })
      })
    });
    assert.equal(result, false, 'dev-setup install must not be blocked');
  });

  it('ALLOWS: no INIT_CWD (manual node invocation, not via npm)', () => {
    const result = checkSelfInstall({
      cwd: '/somewhere',
      initCwd: undefined,
      ...stubFs({})
    });
    assert.equal(result, false, 'non-npm invocation must not be blocked');
  });

  it('ALLOWS: parent package.json missing (edge case)', () => {
    const result = checkSelfInstall({
      cwd: '/home/joe/myapp/node_modules/@essentianlabs/radar-lite',
      initCwd: '/home/joe/myapp',
      ...stubFs({}) // no package.json at initCwd
    });
    assert.equal(result, false, 'missing parent package.json must not block');
  });

  it('ALLOWS: parent package.json is malformed JSON', () => {
    const result = checkSelfInstall({
      cwd: '/home/joe/myapp/node_modules/@essentianlabs/radar-lite',
      initCwd: '/home/joe/myapp',
      ...stubFs({
        '/home/joe/myapp/package.json': '{ not valid json'
      })
    });
    assert.equal(result, false, 'malformed parent package.json must not block');
  });

  it('ALLOWS: parent package.json has no name field', () => {
    const result = checkSelfInstall({
      cwd: '/home/joe/myapp/node_modules/@essentianlabs/radar-lite',
      initCwd: '/home/joe/myapp',
      ...stubFs({
        '/home/joe/myapp/package.json': JSON.stringify({ version: '1.0.0' })
      })
    });
    assert.equal(result, false, 'nameless parent package.json must not block');
  });

  it('ALLOWS: parent package.json name is similar but not exact match', () => {
    // Defensive: prevent typosquatting-style false positives, e.g. a fork
    // called "@myfork/radar-lite" or a plain "radar-lite" (unscoped).
    for (const name of ['radar-lite', '@myfork/radar-lite', '@essentianlabs/radar-lite-plus', '@essentianlabs/radar', '']) {
      const result = checkSelfInstall({
        cwd: '/home/joe/myapp/node_modules/@essentianlabs/radar-lite',
        initCwd: '/home/joe/myapp',
        ...stubFs({
          '/home/joe/myapp/package.json': JSON.stringify({ name })
        })
      });
      assert.equal(result, false, `name "${name}" must not trigger the guard`);
    }
  });

  it('handles cwd and initCwd with trailing slash / normalisation', () => {
    // resolve() handles trailing slashes, but explicit test guards regression.
    const result = checkSelfInstall({
      cwd: '/home/karin/radar-lite/',
      initCwd: '/home/karin/radar-lite',
      ...stubFs({
        '/home/karin/radar-lite/package.json': JSON.stringify({ name: OWN_NAME })
      })
    });
    assert.equal(result, false, 'trailing-slash cwd == initCwd must not block');
  });
});
