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

describe('Vela Lite flow integration (no LLM key)', () => {

  it('low risk without key returns rules fallback with oneliner mode', async () => {
    // Dynamic import to get fresh config
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { external_api: 0.0 } });

    const result = await radar.assess('Check weather forecast', 'external_api');
    assert.equal(result.t2Attempted, false);
    assert.equal(result.promptMode, 'oneliner');
    assert.equal(result.tier, 1);
    assert.equal(result.verdict, 'PROCEED');
    assert.ok(result.vela.includes('VELA LITE (T1)'));
    assert.ok(result.vela.includes('No LLM key'));
    assert.equal(result.options, null);
  });

  it('high risk without key returns rules fallback with tldr mode', async () => {
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { email: 0.7 } });

    const result = await radar.assess('Send price increase email to all 50,000 users', 'email');
    assert.equal(result.t2Attempted, false);
    assert.equal(result.promptMode, 'tldr');
    assert.equal(result.tier, 2);
    assert.equal(result.verdict, 'PROCEED');
    assert.ok(result.vela.includes('No LLM key'));
    assert.equal(result.options, null);
  });

  it('wouldEscalate surfaces on extreme risk without key', async () => {
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { financial: 1.0 } });

    const result = await radar.assess('Delete all credit card payment records for everyone', 'financial');
    assert.equal(result.wouldEscalate, true);
    assert.ok(result.escalateTier >= 3);
    assert.equal(result.t2Attempted, false);
  });
});
