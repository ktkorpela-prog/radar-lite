import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// B1 post-execution observation — radar.complete(callId, outcome).
//
// Isolation: point the register at a throwaway home dir BEFORE importing any
// src module, so these tests never read or write the user's real
// ~/.radar/register.db. os.homedir() honours USERPROFILE (Windows) / HOME.
const TEST_HOME = mkdtempSync(join(tmpdir(), 'radar-b1-complete-'));
process.env.USERPROFILE = TEST_HOME;
process.env.HOME = TEST_HOME;

let register;
let complete;

before(async () => {
  register = await import('../src/register.js');
  ({ complete } = await import('../src/index.js'));
});

after(() => {
  try { rmSync(TEST_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
});

// Helper: create a real assessment row and return its callId.
async function seedAssessment(overrides = {}) {
  const callId = register.generateCallId();
  await register.save({
    callId,
    actionHash: register.hashAction('seed action ' + callId),
    activityType: 'data_write',
    tier: 2,
    riskScore: 8,
    verdict: 'HOLD',
    policyDecision: 'assess',
    agentId: 'test-agent',
    ...overrides
  });
  return callId;
}

describe('radar.complete()', () => {
  it('records a clean succeeded outcome and does not flag divergence', async () => {
    const callId = await seedAssessment();
    const res = await complete(callId, { outcome: 'succeeded' });

    assert.equal(res.recorded, true);
    assert.equal(res.divergence_flagged, false);

    const row = await register.getAssessment(callId);
    assert.equal(row.outcome, 'succeeded');
    assert.ok(row.reported_at, 'reported_at should be set');
  });

  it('throws on an invalid outcome enum', async () => {
    const callId = await seedAssessment();
    await assert.rejects(
      () => complete(callId, { outcome: 'done' }),
      /invalid outcome/i
    );
  });

  it('throws when the callId is unknown', async () => {
    await assert.rejects(
      () => complete('ra_does_not_exist', { outcome: 'succeeded' }),
      /not found/i
    );
  });

  it('persists optional fields (actual_scope, diff_notes, metrics)', async () => {
    const callId = await seedAssessment();
    await complete(callId, {
      outcome: 'failed',
      actual_scope: 'removed lines 4-6 only',
      diff_notes: 'expected 4-10, got 4-6',
      metrics: { files_touched: 1, exit_code: 1 }
    });

    const row = await register.getAssessment(callId);
    assert.equal(row.outcome, 'failed');
    assert.equal(row.actual_scope, 'removed lines 4-6 only');
    assert.equal(row.diff_notes, 'expected 4-10, got 4-6');
    assert.deepEqual(JSON.parse(row.metrics_json), { files_touched: 1, exit_code: 1 });
  });

  it('flags divergence when succeeded is reported with diff_notes (rule 1)', async () => {
    const callId = await seedAssessment();
    const res = await complete(callId, {
      outcome: 'succeeded',
      diff_notes: 'actually only did half of it'
    });

    assert.equal(res.divergence_flagged, true);
    assert.ok(Array.isArray(res.divergence_reasons) && res.divergence_reasons.length >= 1);
    assert.match(res.divergence_reasons.join(' '), /partial/i);
  });

  it('flags divergence when partial is reported without diff_notes (rule 2)', async () => {
    const callId = await seedAssessment();
    const res = await complete(callId, { outcome: 'partial' });

    assert.equal(res.divergence_flagged, true);
    assert.match(res.divergence_reasons.join(' '), /diff_notes/i);
  });

  it('does not flag a clean partial (partial WITH diff_notes)', async () => {
    const callId = await seedAssessment();
    const res = await complete(callId, {
      outcome: 'partial',
      diff_notes: 'stopped after 3 of 5 files'
    });

    assert.equal(res.divergence_flagged, false);
  });

  it('is idempotent — a second complete on the same callId is a no-op', async () => {
    const callId = await seedAssessment();
    await complete(callId, { outcome: 'succeeded' });
    const second = await complete(callId, { outcome: 'failed' });

    assert.equal(second.recorded, false);
    assert.equal(second.alreadyCompleted, true);

    const row = await register.getAssessment(callId);
    assert.equal(row.outcome, 'succeeded', 'original outcome must not be overwritten');
  });

  it('rejects diff_notes over the 10k character cap', async () => {
    const callId = await seedAssessment();
    await assert.rejects(
      () => complete(callId, { outcome: 'failed', diff_notes: 'x'.repeat(10001) }),
      /diff_notes/i
    );
  });
});
