import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classify, formatT1 } from '../src/classifier.js';

describe('T1 classifier', () => {

  it('classifies low-risk action as T1 PROCEED', () => {
    // default base score 4, no signals, permissive T2 threshold at 7 → T1
    const result = classify('Check weather forecast', 'external_api', 0.0);
    assert.equal(result.tier, 1);
    assert.equal(result.verdict, 'PROCEED');
    assert.equal(result.activityType, 'external_api');
  });

  it('classifies high-risk email as T2 HOLD', () => {
    const result = classify('Send price increase email to all 50,000 users', 'email', 0.7);
    assert.equal(result.tier, 2);
    assert.equal(result.verdict, 'HOLD');
    assert.ok(result.riskScore >= 5);
  });

  it('increases score for mass/scale signals', () => {
    const base = classify('Send email', 'email', 0.5);
    const mass = classify('Send bulk email to everyone', 'email', 0.5);
    assert.ok(mass.riskScore > base.riskScore);
  });

  it('decreases score for draft/test signals', () => {
    const base = classify('Send email to users', 'email', 0.5);
    const draft = classify('Send draft test email internally', 'email', 0.5);
    assert.ok(draft.riskScore < base.riskScore);
  });

  it('sensitive data signals increase score', () => {
    const base = classify('Process transaction', 'financial', 0.5);
    const sensitive = classify('Process credit card payment', 'financial', 0.5);
    assert.ok(sensitive.riskScore > base.riskScore);
  });

  it('slider at 0.0 (permissive) raises thresholds', () => {
    const permissive = classify('Send email to users', 'email', 0.0);
    const conservative = classify('Send email to users', 'email', 1.0);
    // Same action — permissive should yield lower tier or same
    assert.ok(permissive.tier <= conservative.tier);
  });

  it('clamps score between 1 and 25', () => {
    const result = classify('Send draft test preview internal email', 'default', 0.0);
    assert.ok(result.riskScore >= 1);
    assert.ok(result.riskScore <= 25);
  });

  it('defaults to default activity type for unknown types', () => {
    const result = classify('Do something', 'unknown_type', 0.5);
    assert.equal(result.activityType, 'unknown_type');
    assert.ok(result.riskScore >= 1);
  });

  it('formatT1 produces correct output format', () => {
    const result = {
      tier: 1,
      riskScore: 4,
      triggerReason: 'Base email risk',
      verdict: 'PROCEED',
      activityType: 'email'
    };
    const formatted = formatT1(result);
    assert.equal(formatted, 'VELA LITE (T1) | PROCEED | Base email risk | email | score 4');
  });

  it('financial actions have high base score', () => {
    const result = classify('Transfer funds', 'financial', 0.5);
    assert.ok(result.riskScore >= 10);
  });
});
