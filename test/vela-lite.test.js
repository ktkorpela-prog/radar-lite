import { describe, it, beforeEach } from 'node:test';
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

describe('assess() — no LLM key flows', () => {

  it('low risk without key returns oneliner mode', async () => {
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { external_api_call: 0.5 } });

    const result = await radar.assess('Read internal config from disk', 'external_api_call');
    assert.equal(result.t2Attempted, false);
    assert.equal(result.promptMode, 'oneliner');
    assert.equal(result.tier, 1);
    assert.equal(result.policyDecision, 'assess');
    assert.ok(result.vela.includes('VELA LITE (T1)'));
  });

  it('high risk without key returns tldr mode', async () => {
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { email_single: 0.7 } });

    const result = await radar.assess('Send price increase email to all 50,000 users', 'email_single');
    assert.equal(result.promptMode, 'tldr');
    assert.equal(result.tier, 2);
    assert.equal(result.policyDecision, 'assess');
  });

  it('wouldEscalate surfaces on extreme risk', async () => {
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { financial: 1.0 } });

    const result = await radar.assess('Delete all credit card payment records for everyone', 'financial');
    assert.equal(result.wouldEscalate, true);
    assert.ok(result.escalateTier >= 3);
  });
});

describe('assess() — deprecated types', () => {

  it('deprecated "email" type still works', async () => {
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { email: 0.7 } });

    const result = await radar.assess('Send notification', 'email');
    assert.equal(result.activityType, 'email_single');
    assert.equal(result.policyDecision, 'assess');
  });
});

describe('assess() — policy decisions', () => {

  it('human_required policy returns HOLD immediately', async () => {
    const { default: radar } = await import('../src/index.js');
    const { savePolicy } = await import('../src/register.js');
    radar.configure({});

    await savePolicy('*delete*', 'human_required');
    const result = await radar.assess('delete all records', 'data_delete_bulk');
    assert.equal(result.proceed, false);
    assert.equal(result.verdict, 'HOLD');
    assert.equal(result.policyDecision, 'human_required');
    assert.equal(result.t2Attempted, false);
  });

  it('no_assessment policy returns PROCEED immediately', async () => {
    const { default: radar } = await import('../src/index.js');
    const { savePolicy } = await import('../src/register.js');
    radar.configure({});

    await savePolicy('*search*', 'no_assessment');
    const result = await radar.assess('search for docs', 'web_search');
    assert.equal(result.proceed, true);
    assert.equal(result.verdict, 'PROCEED');
    assert.equal(result.policyDecision, 'no_assessment');
    assert.equal(result.riskScore, 0);
  });
});

describe('assess() — activity human review toggle', () => {

  it('requires_human_review returns HOLD bypassing Vela', async () => {
    const { default: radar } = await import('../src/index.js');
    const { saveActivityConfig } = await import('../src/register.js');
    radar.configure({ llmKey: 'fake-key' });

    await saveActivityConfig('system_execute', { requiresHumanReview: true });
    const result = await radar.assess('Run deploy script', 'system_execute');
    assert.equal(result.proceed, false);
    assert.equal(result.verdict, 'HOLD');
    assert.equal(result.policyDecision, 'human_required');
    assert.equal(result.t2Attempted, false);
    assert.equal(result.vela, null);
  });
});
