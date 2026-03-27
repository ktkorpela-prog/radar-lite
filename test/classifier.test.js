import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classify, getThresholds } from '../src/classifier.js';

describe('classifier — rules engine pre-scorer', () => {

  it('scores low-risk action below T2 threshold', () => {
    // external_api base score 6, no signals, permissive T2 threshold at 7 → below T2
    const result = classify('Check weather forecast', 'external_api', 0.0);
    assert.equal(result.riskScore, 6);
    assert.equal(result.rawTier, 1);
    assert.equal(result.activityType, 'external_api');
    assert.equal(result.wouldEscalate, false);
    assert.equal(result.escalateTier, null);
    // No verdict — Vela Lite owns the verdict now
    assert.equal(result.verdict, undefined);
  });

  it('scores high-risk email above T2 threshold', () => {
    const result = classify('Send price increase email to all 50,000 users', 'email', 0.7);
    assert.ok(result.riskScore >= 5);
    assert.ok(result.rawTier >= 2);
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
    const permissive = getThresholds(0.0);
    const conservative = getThresholds(1.0);
    assert.ok(permissive.t2 > conservative.t2);
  });

  it('clamps score between 1 and 25', () => {
    const result = classify('Send draft test preview internal email', 'default', 0.0);
    assert.ok(result.riskScore >= 1);
    assert.ok(result.riskScore <= 25);
  });

  it('warns on unknown activity type and scores as default', () => {
    const result = classify('Do something', 'unknown_type', 0.5);
    assert.equal(result.activityType, 'unknown_type');
    assert.ok(result.riskScore >= 1);
    assert.ok(result.triggerReason.includes('Unknown type'));
  });

  it('returns wouldEscalate for extreme risk', () => {
    const result = classify('Delete all credit card payment records for everyone', 'financial', 1.0);
    assert.equal(result.wouldEscalate, true);
    assert.ok(result.escalateTier >= 3);
  });

  it('financial actions have high base score', () => {
    const result = classify('Transfer funds', 'financial', 0.5);
    assert.ok(result.riskScore >= 10);
  });

  it('returns rawTier without capping', () => {
    // Max score financial at conservative should give rawTier 3 or 4
    const result = classify('Delete all credit card payment records for everyone', 'financial', 1.0);
    assert.ok(result.rawTier >= 3);
  });
});
