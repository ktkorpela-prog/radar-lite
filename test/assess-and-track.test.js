import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// B1 convenience wrapper — radar.assessAndTrack(action, activityType, workFn).
// assess → (if PROCEED) run workFn → complete() with a derived outcome.
//
// Isolated register (throwaway home) — never touches the real ~/.radar/register.db.
const TEST_HOME = mkdtempSync(join(tmpdir(), 'radar-b1-track-'));
process.env.USERPROFILE = TEST_HOME;
process.env.HOME = TEST_HOME;

let register;
let assessAndTrack;
let complete;

before(async () => {
  register = await import('../src/register.js');
  ({ assessAndTrack, complete } = await import('../src/index.js'));
  // Deterministic verdicts via trigger policies — no LLM key needed, fully offline.
  await register.savePolicy('*trackme-proceed*', 'no_assessment');
  await register.savePolicy('*trackme-hold*', 'human_required');
  await register.savePolicy('*trackme-deny*', 'deny');
});

after(() => {
  try { rmSync(TEST_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('radar.assessAndTrack()', () => {
  it('runs workFn on PROCEED and records outcome=succeeded with the return merged into metrics', async () => {
    let ran = false;
    const out = await assessAndTrack('do the trackme-proceed thing', 'data_read', async () => {
      ran = true;
      return { affected: 42 };
    });

    assert.equal(ran, true);
    assert.equal(out.ran, true);
    assert.equal(out.assessment.status, 'PROCEED');
    assert.equal(out.outcome, 'succeeded');
    assert.deepEqual(out.result, { affected: 42 });

    const row = await register.getAssessment(out.assessment.callId);
    assert.equal(row.outcome, 'succeeded');
    assert.deepEqual(JSON.parse(row.metrics_json), { affected: 42 });
  });

  it('reports outcome=failed with the error message in diff_notes when workFn throws an Error', async () => {
    const out = await assessAndTrack('do the trackme-proceed error', 'data_read', async () => {
      throw new Error('boom');
    });

    assert.equal(out.ran, true);
    assert.equal(out.outcome, 'failed');
    assert.match(out.error, /boom/);

    const row = await register.getAssessment(out.assessment.callId);
    assert.equal(row.outcome, 'failed');
    assert.match(row.diff_notes, /boom/);
  });

  it('reports outcome=aborted when workFn throws a non-Error', async () => {
    const out = await assessAndTrack('do the trackme-proceed abort', 'data_read', async () => {
      throw 'cancelled by upstream';
    });

    assert.equal(out.ran, true);
    assert.equal(out.outcome, 'aborted');
  });

  it('does NOT run workFn on HOLD and records no outcome', async () => {
    let ran = false;
    const out = await assessAndTrack('do the trackme-hold thing', 'data_read', async () => {
      ran = true;
      return 1;
    });

    assert.equal(ran, false);
    assert.equal(out.ran, false);
    assert.equal(out.outcome, null);
    assert.equal(out.assessment.status, 'HOLD');

    const row = await register.getAssessment(out.assessment.callId);
    assert.equal(row.outcome, null);
  });

  it('does NOT run workFn on DENY', async () => {
    let ran = false;
    const out = await assessAndTrack('do the trackme-deny thing', 'data_read', async () => {
      ran = true;
    });

    assert.equal(ran, false);
    assert.equal(out.ran, false);
    assert.equal(out.assessment.status, 'DENY');
  });

  it('records the outcome exactly once (a later manual complete is a no-op)', async () => {
    const out = await assessAndTrack('do the trackme-proceed once', 'data_read', async () => ({ x: 1 }));
    assert.equal(out.outcome, 'succeeded');

    const again = await complete(out.assessment.callId, { outcome: 'failed' });
    assert.equal(again.alreadyCompleted, true);
  });
});
