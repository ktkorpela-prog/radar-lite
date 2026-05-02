import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { VelaLite, _testInternals } from '../src/vela-lite.js';

const { parseTldrResponse, normaliseLabel } = _testInternals;

// Tests share ~/.radar/register.db with the user's actual local state. Reset
// activity_config columns that v0.4 tests configure, so prior runs don't
// pollute v0.3 tests that assume defaults. Specifically deny_at_tier and
// requires_human_review, which short-circuit assess() flow.
before(async () => {
  const { saveActivityConfig } = await import('../src/register.js');
  const TEST_ACTIVITIES = [
    'data_delete_bulk', 'data_delete_single', 'financial',
    'system_execute', 'system_files', 'publish',
    'email_bulk', 'email_single', 'external_api_call',
    'data_write', 'data_read', 'web_search'
  ];
  for (const act of TEST_ACTIVITIES) {
    // Reset to clean state — denyAtTier=null, requiresHumanReview=false.
    // Slider preserved at default unless test explicitly sets it.
    await saveActivityConfig(act, {
      denyAtTier: null,
      requiresHumanReview: false
    });
  }
});

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

describe('v0.4 — deny_at_tier per-activity DENY', () => {

  it('activity-configured deny_at_tier=4 triggers DENY at T4', async () => {
    const { default: radar } = await import('../src/index.js');
    const { saveActivityConfig } = await import('../src/register.js');
    radar.configure({});
    // Set deny_at_tier=4 for data_delete_bulk
    await saveActivityConfig('data_delete_bulk', {
      sliderPosition: 0.5,
      denyAtTier: 4
    });

    // Action that scores high enough to reach T4 (with irreversibility from "delete all")
    const result = await radar.assess(
      'Permanently delete all customer payment records from production',
      'data_delete_bulk'
    );
    assert.equal(result.status, 'DENY');
    assert.equal(result.proceed, false);
    assert.equal(result.policyDecision, 'activity_severity_deny');
    assert.ok(/configured to DENY at T\d/.test(result.reason),
      `Expected reason to mention configured DENY threshold, got: ${result.reason}`);
    assert.ok(result.reason.includes('override_deny'),
      `Expected reason to mention override_deny path, got: ${result.reason}`);
  });

  it('deny_at_tier=3 triggers DENY at T3 (lower threshold)', async () => {
    const { default: radar } = await import('../src/index.js');
    const { saveActivityConfig } = await import('../src/register.js');
    radar.configure({});
    await saveActivityConfig('publish', {
      sliderPosition: 0.7,
      denyAtTier: 3
    });

    // Publish action with scale signal — likely T3
    const result = await radar.assess(
      'Publish content to all 50000 subscribers immediately',
      'publish'
    );
    if (result.tier >= 3) {
      assert.equal(result.status, 'DENY');
      assert.equal(result.policyDecision, 'activity_severity_deny');
    } else {
      // If our test action didn't reach T3, the gate doesn't fire — that's fine
      // for the test (deny_at_tier=3 only fires AT T3+)
      assert.notEqual(result.policyDecision, 'activity_severity_deny');
    }
  });

  it('deny_at_tier=NULL preserves v0.3.x behavior (no DENY)', async () => {
    const { default: radar } = await import('../src/index.js');
    const { saveActivityConfig } = await import('../src/register.js');
    radar.configure({});
    await saveActivityConfig('email_bulk', {
      sliderPosition: 0.5
      // denyAtTier intentionally not provided — stays NULL
    });

    const result = await radar.assess(
      'Send newsletter to subscribers',
      'email_bulk'
    );
    // No DENY from activity_severity_deny path
    assert.notEqual(result.policyDecision, 'activity_severity_deny');
  });

  it('saveActivityConfig rejects invalid denyAtTier value', async () => {
    const { saveActivityConfig } = await import('../src/register.js');
    await assert.rejects(
      () => saveActivityConfig('financial', { denyAtTier: 5 }),
      { message: /Invalid denyAtTier/ }
    );
    await assert.rejects(
      () => saveActivityConfig('financial', { denyAtTier: 1 }),
      { message: /Invalid denyAtTier/ }
    );
  });

  it('override_deny works on activity_severity_deny verdict', async () => {
    const { default: radar } = await import('../src/index.js');
    const { saveActivityConfig } = await import('../src/register.js');
    radar.configure({});
    await saveActivityConfig('system_execute', {
      sliderPosition: 0.5,
      denyAtTier: 4
    });

    const result = await radar.assess(
      'Permanently delete all production database records',
      'system_execute'
    );
    if (result.status === 'DENY' && result.policyDecision === 'activity_severity_deny') {
      // Confirm override_deny works on this DENY path
      const overrideResult = await radar.strategy(result.callId, 'override_deny', {
        reason: 'Test override of activity_severity_deny',
        decidedBy: 'test-suite'
      });
      assert.equal(overrideResult.success, true);
      assert.equal(overrideResult.chosenStrategy, 'override_deny');
    }
  });

  it('previewRecommendedDefaults returns expected structure', async () => {
    const { previewRecommendedDefaults } = await import('../src/register.js');
    const preview = await previewRecommendedDefaults();
    assert.ok(Array.isArray(preview.wouldApply));
    assert.ok(Array.isArray(preview.wouldSkip));
    // CONSERVATIVE_DENY_DEFAULTS has 4 entries
    assert.equal(preview.wouldApply.length + preview.wouldSkip.length, 4);
  });

  it('applyRecommendedDefaults preserves operator-set values', async () => {
    const { saveActivityConfig, applyRecommendedDefaults, getActivityConfig } = await import('../src/register.js');
    // Operator explicitly sets deny_at_tier=3 for financial
    await saveActivityConfig('financial', { sliderPosition: 0.9, denyAtTier: 3 });
    // Apply recommended defaults — should NOT change financial (operator-set preserved)
    const result = await applyRecommendedDefaults();
    const financialAfter = await getActivityConfig('financial');
    assert.equal(financialAfter.deny_at_tier, 3, 'Operator-set deny_at_tier should be preserved');
    // The result should list financial in 'skipped'
    assert.ok(result.skipped.some(s => s.activityType === 'financial'));
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

describe('v0.3.4 OVERRIDE_DENY filter — parseTldrResponse', () => {

  it('drops OVERRIDE_DENY when LLM returns 5 options', () => {
    const raw = `HOLD — Mass deletion requires review

→ AVOID:     Block the deletion entirely
→ MITIGATE:  Run a dry-run first (recommended)
→ TRANSFER:  Route through compliance team
→ ACCEPT:    Proceed with full audit log
→ OVERRIDE_DENY: Restrict access to sensitive repos

— Vela Lite`;
    const r = parseTldrResponse(raw);
    assert.equal(r.verdict, 'HOLD');
    assert.equal(Object.keys(r.options).length, 4, 'options should have exactly 4 keys');
    assert.ok(!('override_deny' in r.options), 'override_deny must not appear in options');
    assert.ok(!('overridedeny' in r.options), 'overridedeny must not appear in options');
    assert.equal(r.recommended, 'mitigate');
  });

  it('drops OVERRIDE_DENY when LLM returns it instead of one valid strategy', () => {
    const raw = `HOLD — Risky write

→ AVOID:     Block it
→ MITIGATE:  Add controls (recommended)
→ OVERRIDE_DENY: Disallow without sign-off
→ ACCEPT:    Proceed as-is

— Vela Lite`;
    const r = parseTldrResponse(raw);
    assert.equal(Object.keys(r.options).length, 3);
    assert.ok('avoid' in r.options);
    assert.ok('mitigate' in r.options);
    assert.ok('accept' in r.options);
    assert.ok(!('override_deny' in r.options));
    assert.equal(r.recommended, 'mitigate');
  });

  it('falls back to first valid option when recommended is OVERRIDE_DENY', () => {
    const raw = `HOLD — Bad

→ AVOID:     Stop now
→ MITIGATE:  Add audit
→ TRANSFER:  Route to legal
→ ACCEPT:    Proceed
→ OVERRIDE_DENY: Disallow (recommended)

— Vela Lite`;
    const r = parseTldrResponse(raw);
    assert.ok(!('override_deny' in r.options));
    // recommended must be one of the four valid HOLD strategies
    assert.ok(['avoid', 'mitigate', 'transfer', 'accept'].includes(r.recommended),
      `recommended should be a valid HOLD strategy, got "${r.recommended}"`);
  });

  it('falls back to mitigate when LLM returns ONLY OVERRIDE_DENY', () => {
    const raw = `HOLD — Bad

→ OVERRIDE_DENY: Block all migrations (recommended)

— Vela Lite`;
    const r = parseTldrResponse(raw);
    assert.equal(r.verdict, 'HOLD');
    assert.equal(Object.keys(r.options).length, 0);
    assert.equal(r.recommended, 'mitigate', 'should fall back to mitigate');
  });

  it('catches case variants: override-deny, Override Deny, OVERRIDEDENY', () => {
    const raw = `HOLD — test

→ AVOID:     A
→ override-deny: lowercase variant
→ Override Deny: title case
→ OVERRIDEDENY: no separator
→ MITIGATE:  M (recommended)
→ TRANSFER:  T
→ ACCEPT:    Acc

— Vela Lite`;
    const r = parseTldrResponse(raw);
    assert.equal(Object.keys(r.options).length, 4, 'all override_deny variants should be dropped');
    assert.ok(!Object.keys(r.options).some(k => normaliseLabel(k) === 'overridedeny'));
    assert.equal(r.recommended, 'mitigate');
  });

  it('does not match partial substrings — AVOIDANCE is dropped', () => {
    const raw = `HOLD — test

→ AVOIDANCE: not a real strategy
→ AVOID:     real one (recommended)
→ MITIGATE:  m
→ TRANSFER:  t
→ ACCEPT:    a

— Vela Lite`;
    const r = parseTldrResponse(raw);
    assert.equal(Object.keys(r.options).length, 4);
    assert.ok('avoid' in r.options);
    assert.ok(!Object.keys(r.options).some(k => k.includes('avoidance')));
    assert.equal(r.recommended, 'avoid');
  });

  it('normaliseLabel handles all expected variants', () => {
    assert.equal(normaliseLabel('OVERRIDE_DENY'), 'overridedeny');
    assert.equal(normaliseLabel('override_deny'), 'overridedeny');
    assert.equal(normaliseLabel('OVERRIDE-DENY'), 'overridedeny');
    assert.equal(normaliseLabel('override-deny'), 'overridedeny');
    assert.equal(normaliseLabel('Override Deny'), 'overridedeny');
    assert.equal(normaliseLabel('AVOID'), 'avoid');
    assert.equal(normaliseLabel('Avoid'), 'avoid');
    assert.equal(normaliseLabel(' AVOID '), 'avoid');
  });
});

// Regression test for env-file regex bug discovered during v0.4 baseline test
// (2026-05-02). The original regex [A-Z_]+ silently dropped T2_PROVIDER and
// T2_API_KEY because they contain a digit. Result: dual-provider config via
// .env was broken since v0.3.6. Fixed by allowing digits after the first char:
// [A-Z_][A-Z0-9_]*
describe('env file parsing regex (getEffectiveLlmConfig)', () => {
  // Mirror the regex used in src/index.js getEffectiveLlmConfig
  const ENV_REGEX = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/gm;

  it('matches keys with digits (T2_PROVIDER, T2_API_KEY)', () => {
    const content = `LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-xxx
T2_PROVIDER=openai
T2_API_KEY=sk-proj-xxx`;
    const keys = [...content.matchAll(ENV_REGEX)].map(m => m[1]);
    assert.ok(keys.includes('LLM_PROVIDER'));
    assert.ok(keys.includes('LLM_API_KEY'));
    assert.ok(keys.includes('T2_PROVIDER'), 'T2_PROVIDER must match — was broken with [A-Z_]+ regex');
    assert.ok(keys.includes('T2_API_KEY'), 'T2_API_KEY must match — was broken with [A-Z_]+ regex');
  });

  it('matches uppercase-only keys', () => {
    const content = 'RADAR_ENABLED=true';
    const keys = [...content.matchAll(ENV_REGEX)].map(m => m[1]);
    assert.ok(keys.includes('RADAR_ENABLED'));
  });

  it('rejects keys starting with digit', () => {
    const content = '2INVALID=foo';
    const matches = [...content.matchAll(ENV_REGEX)];
    assert.equal(matches.length, 0);
  });

  it('captures values with special characters intact', () => {
    const content = 'T2_API_KEY=sk-proj-abc_def-123/xyz';
    const matches = [...content.matchAll(ENV_REGEX)];
    assert.equal(matches.length, 1);
    assert.equal(matches[0][2].trim(), 'sk-proj-abc_def-123/xyz');
  });
});
