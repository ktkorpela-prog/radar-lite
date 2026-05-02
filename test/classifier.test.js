import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classify, getThresholds } from '../src/classifier.js';

describe('classifier — rules engine pre-scorer', () => {

  it('email_single scores base 12', () => {
    const result = classify('Send email', 'email_single', 0.5);
    assert.equal(result.riskScore, 12);
    assert.equal(result.activityType, 'email_single');
  });

  it('email_bulk scores higher than email_single', () => {
    const single = classify('Send email', 'email_single', 0.5);
    const bulk = classify('Send email', 'email_bulk', 0.5);
    assert.ok(bulk.riskScore > single.riskScore);
  });

  it('data_read has low base score', () => {
    const result = classify('Read user profile', 'data_read', 0.5);
    assert.equal(result.riskScore, 2);
  });

  it('data_write has medium base score', () => {
    const result = classify('Update user record', 'data_write', 0.5);
    assert.equal(result.riskScore, 6);
  });

  it('data_delete_bulk scores higher than data_delete_single', () => {
    const single = classify('Delete record', 'data_delete_single', 0.5);
    const bulk = classify('Delete record', 'data_delete_bulk', 0.5);
    assert.ok(bulk.riskScore > single.riskScore);
  });

  it('web_search has lowest base score', () => {
    const result = classify('Search for documentation', 'web_search', 0.5);
    assert.equal(result.riskScore, 1);
  });

  it('system_execute has high base score', () => {
    const result = classify('Run command', 'system_execute', 0.5);
    assert.equal(result.riskScore, 15);
  });

  it('system_files has high base score', () => {
    const result = classify('Modify config', 'system_files', 0.5);
    assert.equal(result.riskScore, 12);
  });

  it('financial retains highest base score', () => {
    const result = classify('Transfer funds', 'financial', 0.5);
    assert.equal(result.riskScore, 15);
  });

  it('publish matches old publishing score', () => {
    const result = classify('Post article', 'publish', 0.5);
    assert.equal(result.riskScore, 9);
  });

  it('external_api_call retains same score', () => {
    const result = classify('Call API', 'external_api_call', 0.5);
    assert.equal(result.riskScore, 6);
  });

  it('deprecated "external_api" resolves to external_api_call', () => {
    const result = classify('Call API', 'external_api', 0.5);
    assert.equal(result.activityType, 'external_api_call');
    assert.equal(result.riskScore, 6);
  });

  it('deprecated "email" resolves to email_single', () => {
    const result = classify('Send email', 'email', 0.5);
    assert.equal(result.activityType, 'email_single');
    assert.equal(result.riskScore, 12);
  });

  it('deprecated "publishing" resolves to publish', () => {
    const result = classify('Post article', 'publishing', 0.5);
    assert.equal(result.activityType, 'publish');
  });

  it('deprecated "data_deletion" resolves to data_delete_single', () => {
    const result = classify('Delete record', 'data_deletion', 0.5);
    assert.equal(result.activityType, 'data_delete_single');
  });

  it('increases score for mass/scale signals', () => {
    const base = classify('Send email', 'email_single', 0.5);
    const mass = classify('Send bulk email to everyone', 'email_single', 0.5);
    assert.ok(mass.riskScore > base.riskScore);
  });

  it('decreases score for draft/test signals', () => {
    const base = classify('Send email to users', 'email_single', 0.5);
    const draft = classify('Send draft test email internally', 'email_single', 0.5);
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
    const result = classify('Send draft test preview internal email', 'web_search', 0.0);
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

  it('returns rawTier without capping', () => {
    const result = classify('Delete all credit card payment records for everyone', 'financial', 1.0);
    assert.ok(result.rawTier >= 3);
  });

  // v0.4: stem-based irreversibility signal — catches camelCase API mutations
  // and noun forms. Validated in experiments/verb-regex-validation.mjs.

  it('camelCase volumeDelete matches irreversibility (v0.4)', () => {
    const r = classify('curl -X POST graphql/v2 -d mutation { volumeDelete(volumeId)} ', 'external_api_call', 0.5);
    assert.ok(r.triggerReason.includes('irreversibility'),
      `Expected irreversibility signal for volumeDelete, got: ${r.triggerReason}`);
    assert.ok(r.riskScore > 6, `Expected score > 6 for camelCase delete, got: ${r.riskScore}`);
  });

  it('camelCase dropTable matches irreversibility (v0.4)', () => {
    const r = classify('Run dropTable migration on production', 'system_execute', 0.5);
    assert.ok(r.triggerReason.includes('irreversibility'),
      `Expected irreversibility signal for dropTable, got: ${r.triggerReason}`);
  });

  it('camelCase terminateInstance matches irreversibility (v0.4)', () => {
    const r = classify('terminateInstance i-abc on AWS', 'system_execute', 0.5);
    assert.ok(r.triggerReason.includes('irreversibility'));
  });

  it('noun form "deletion" matches irreversibility (v0.4)', () => {
    const r = classify('user deletion completed for tenant', 'data_delete_single', 0.5);
    assert.ok(r.triggerReason.includes('irreversibility'),
      `Expected irreversibility for "deletion", got: ${r.triggerReason}`);
  });

  it('noun form "destruction" matches irreversibility (v0.4)', () => {
    const r = classify('Data destruction certified by NIST 800-88', 'data_delete_bulk', 0.5);
    assert.ok(r.triggerReason.includes('irreversibility'));
  });

  it('noun form "revocation" matches irreversibility (v0.4)', () => {
    const r = classify('token revocation completed', 'external_api_call', 0.5);
    assert.ok(r.triggerReason.includes('irreversibility'));
  });

  it('SQL DROP TABLE matches irreversibility (v0.4)', () => {
    const r = classify('DROP TABLE customers WHERE inactive', 'system_execute', 0.5);
    assert.ok(r.triggerReason.includes('irreversibility'));
  });

  it('"obsolete" does NOT match irreversibility (no "delete" substring)', () => {
    const r = classify('mark legacy field as obsolete in API docs', 'data_write', 0.5);
    assert.ok(!r.triggerReason.includes('irreversibility'),
      `obsolete should not match irreversibility, but did: ${r.triggerReason}`);
  });

  it('expanded sensitive-data: bearer matches', () => {
    const r = classify('Validate bearer token in request header', 'external_api_call', 0.5);
    assert.ok(r.triggerReason.includes('sensitive data'));
  });

  it('expanded sensitive-data: api_key matches', () => {
    const r = classify('Read api_key from environment variable', 'data_read', 0.5);
    assert.ok(r.triggerReason.includes('sensitive data'));
  });

  it('expanded sensitive-data: ssn matches', () => {
    const r = classify('Store user ssn in customer profile', 'data_write', 0.5);
    assert.ok(r.triggerReason.includes('sensitive data'));
  });

  // Regression: "Call API" must NOT trigger scale (was a bug in earlier v0.4 draft
  // where lookbehind `(?<=\w)all` matched "all" in "Call")
  it('"Call API" does NOT trigger scale signal (regression)', () => {
    const r = classify('Call API endpoint', 'external_api_call', 0.5);
    assert.ok(!r.triggerReason.includes('scale'),
      `"Call API" should not trigger scale signal, got: ${r.triggerReason}`);
  });
});
