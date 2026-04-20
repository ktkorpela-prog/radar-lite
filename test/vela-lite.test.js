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
  });

  it('profile cannot be modified', () => {
    assert.throws(() => { VelaLite.profile.name = 'hacked'; }, TypeError);
  });
});

describe('v0.3 verdict model — T1 PROCEED', () => {

  it('low risk returns status PROCEED with reviewRequired false', async () => {
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { external_api_call: 0.5 } });

    const result = await radar.assess('Read internal config from disk', 'external_api_call');
    assert.equal(result.status, 'PROCEED');
    assert.equal(result.proceed, true);
    assert.equal(result.reviewRequired, false);
    assert.equal(result.tier, 1);
    assert.equal(result.promptMode, 'oneliner');
  });
});

describe('v0.3 verdict model — T2 always HOLD', () => {

  it('high risk returns status HOLD with reviewRequired true', async () => {
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { email_single: 0.7 } });

    const result = await radar.assess('Send price increase email to all 50,000 users', 'email_single');
    assert.equal(result.status, 'HOLD');
    assert.equal(result.proceed, false);
    assert.equal(result.reviewRequired, true);
    assert.ok(result.tier >= 2, `Expected tier >= 2, got ${result.tier}`);
    assert.ok(result.holdAction);
  });

  it('T2 without LLM key returns HOLD not PROCEED', async () => {
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { financial: 0.9 } });

    const result = await radar.assess('Transfer funds to vendor', 'financial');
    assert.equal(result.status, 'HOLD');
    assert.equal(result.proceed, false);
    assert.equal(result.reviewRequired, true);
  });
});

describe('v0.3 verdict model — DENY', () => {

  it('deny policy returns status DENY', async () => {
    const { default: radar } = await import('../src/index.js');
    const { savePolicy } = await import('../src/register.js');
    radar.configure({});

    await savePolicy('*wipe everything*', 'deny');
    const result = await radar.assess('wipe everything from production', 'data_delete_bulk');
    assert.equal(result.status, 'DENY');
    assert.equal(result.proceed, false);
    assert.equal(result.reviewRequired, false);
    assert.equal(result.policyDecision, 'deny');
    assert.equal(result.options, null);
    assert.equal(result.holdAction, undefined);
    assert.ok(result.reason.includes('override'));
  });

  it('score 20+ with irreversibility triggers DENY', async () => {
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { data_delete_bulk: 0.9 } });

    const result = await radar.assess('Delete all credit card payment records for everyone permanently', 'data_delete_bulk');
    assert.equal(result.status, 'DENY');
    assert.equal(result.proceed, false);
    assert.ok(result.riskScore >= 20);
    assert.ok(result.reason.includes('irreversibility'));
  });

  it('override_deny requires reason and decidedBy', async () => {
    const { default: radar } = await import('../src/index.js');
    const { savePolicy } = await import('../src/register.js');
    radar.configure({});

    await savePolicy('*nuke*', 'deny');
    const result = await radar.assess('nuke the database', 'data_delete_bulk');
    assert.equal(result.status, 'DENY');

    // Missing reason
    await assert.rejects(
      () => radar.strategy(result.callId, 'override_deny', { decidedBy: 'admin' }),
      { message: /non-empty reason/ }
    );

    // Missing decidedBy
    await assert.rejects(
      () => radar.strategy(result.callId, 'override_deny', { reason: 'approved by CTO' }),
      { message: /non-empty decidedBy/ }
    );

    // Valid override
    const strat = await radar.strategy(result.callId, 'override_deny', {
      reason: 'Approved by CTO after compliance review',
      decidedBy: 'admin@company.com'
    });
    assert.equal(strat.success, true);
    assert.equal(strat.chosenStrategy, 'override_deny');
    assert.equal(strat.overrideReason, 'Approved by CTO after compliance review');
  });

  it('override_deny fails on non-DENY assessment', async () => {
    const { default: radar } = await import('../src/index.js');
    radar.configure({ activities: { web_search: 0.3 } });

    const result = await radar.assess('search for docs', 'web_search');
    assert.equal(result.status, 'PROCEED');

    await assert.rejects(
      () => radar.strategy(result.callId, 'override_deny', { reason: 'test', decidedBy: 'admin' }),
      { message: /not DENY/ }
    );
  });
});

describe('v0.3 — human_required stays HOLD', () => {

  it('human_required policy returns HOLD not DENY', async () => {
    const { default: radar } = await import('../src/index.js');
    const { savePolicy } = await import('../src/register.js');
    radar.configure({});

    await savePolicy('*sensitive transfer*', 'human_required');
    const result = await radar.assess('sensitive transfer of data', 'data_write');
    assert.equal(result.status, 'HOLD');
    assert.equal(result.reviewRequired, true);
    assert.equal(result.policyDecision, 'human_required');
    assert.ok(result.holdAction);
  });

  it('requiresHumanReview returns HOLD not DENY', async () => {
    const { default: radar } = await import('../src/index.js');
    const { saveActivityConfig } = await import('../src/register.js');
    radar.configure({ llmKey: 'fake-key' });

    await saveActivityConfig('system_execute', { requiresHumanReview: true });
    const result = await radar.assess('Run deploy script', 'system_execute');
    assert.equal(result.status, 'HOLD');
    assert.equal(result.reviewRequired, true);
    assert.equal(result.holdAction, 'halt');
  });
});

describe('v0.3 — RADAR disabled', () => {

  it('returns PROCEED when disabled', async () => {
    process.env.RADAR_ENABLED = 'false';
    const { default: radar } = await import('../src/index.js');
    radar.configure({});

    const result = await radar.assess('Delete everything', 'data_delete_bulk');
    assert.equal(result.status, 'PROCEED');
    assert.equal(result.proceed, true);
    assert.equal(result.radarEnabled, false);
    delete process.env.RADAR_ENABLED;
  });
});
