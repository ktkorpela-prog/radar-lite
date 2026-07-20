import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '../src/index.js';

// v0.4.4 — coverage for the version-comparison used by the self-check.
// The network flow (fetch + cache + stderr warn) is intentionally NOT tested
// here — it's fire-and-forget with 24h cache, and mocking fetch adds more
// weight than the 20-line feature warrants. This is the pure-function slice.

describe('v0.4.4 update-check — compareVersions', () => {
  it('returns 0 for identical versions', () => {
    assert.equal(compareVersions('0.4.3', '0.4.3'), 0);
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  });

  it('returns 1 when first > second (patch bump)', () => {
    assert.equal(compareVersions('0.4.4', '0.4.3'), 1);
  });

  it('returns -1 when first < second (patch bump)', () => {
    assert.equal(compareVersions('0.4.3', '0.4.4'), -1);
  });

  it('handles minor bumps correctly', () => {
    assert.equal(compareVersions('0.5.0', '0.4.99'), 1);
    assert.equal(compareVersions('0.4.99', '0.5.0'), -1);
  });

  it('handles major bumps correctly', () => {
    assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
    assert.equal(compareVersions('0.99.99', '1.0.0'), -1);
  });

  it('treats missing segments as 0', () => {
    // "1.0" is effectively "1.0.0"
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('1', '1.0.0'), 0);
    assert.equal(compareVersions('1.0.1', '1'), 1);
  });

  it('handles version prefixes gracefully (parseInt tolerates trailing text)', () => {
    // Semver-suffix cases: 0.4.4-beta, 0.4.4-rc.1
    // parseInt('4-beta') = 4, so these compare as base version — fine for
    // the "is there a newer stable" use case.
    assert.equal(compareVersions('0.4.4-beta', '0.4.4'), 0);
    assert.equal(compareVersions('0.4.5-beta', '0.4.4'), 1);
  });

  it('non-numeric input does not throw', () => {
    // parseInt('abc') = NaN, || 0 fallback → treated as 0. Safe against
    // malformed cache data.
    assert.equal(compareVersions('abc.def', '0.0.0'), 0);
    assert.equal(compareVersions('0.4.3', 'garbage'), 1);
  });
});
