import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VelaLite } from '../src/vela-lite.js';

describe('Vela Lite profile', () => {

  it('profile is frozen', () => {
    assert.ok(Object.isFrozen(VelaLite.profile));
  });

  it('profile has required fields', () => {
    assert.equal(VelaLite.profile.name, 'Vela Lite');
    assert.equal(VelaLite.profile.version, '1.0.0');
    assert.equal(VelaLite.profile.by, 'EssentianLabs');
    assert.ok(VelaLite.profile.role);
    assert.ok(VelaLite.profile.note);
  });

  it('profile cannot be modified', () => {
    assert.throws(() => {
      VelaLite.profile.name = 'hacked';
    }, TypeError);
  });

  it('profile note mentions paid tier', () => {
    assert.ok(VelaLite.profile.note.includes('radar.essentianlabs.com'));
  });
});
