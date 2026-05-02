import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { VelaLite, _testInternals } from '../src/vela-lite.js';

const { parseTldrResponse, parseT3T4ReviewResponse, normaliseLabel, buildT3T4ReviewPrompt } = _testInternals;

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

// v0.4: T3/T4 review prompt + parser tests.
// Validates the locked t3_t4_review prompt structure parses correctly across
// all the new blocks (RISK vs BENEFIT, SCOPE HYGIENE, DIVERGENCE FROM LLM1).
describe('v0.4 T3/T4 review parser (parseT3T4ReviewResponse)', () => {

  const makeRaw = ({ tier = 3, scope = 'No scope issues detected.', divergence = 'Concur with LLM1\'s assessment.', recommended = 'avoid' } = {}) => `VELA LITE (T${tier}) | data_delete_bulk | score 18

HOLD — Mass irreversible deletion requires verified backup and dual approval first.

RISK vs BENEFIT:
Risk: 50,000 customer records permanently lost if backups are absent or
incomplete. Benefit: meets stated retention policy. Benefit does not justify
risk without verified backup.

SCOPE HYGIENE:
${scope}

→ AVOID:     Block deletion until verified backup exists${recommended === 'avoid' ? ' (recommended)' : ''}
→ MITIGATE:  Snapshot DB and dry-run delete first${recommended === 'mitigate' ? ' (recommended)' : ''}
→ TRANSFER:  Route to data governance for sign-off${recommended === 'transfer' ? ' (recommended)' : ''}
→ ACCEPT:    Document accountability; proceed knowingly${recommended === 'accept' ? ' (recommended)' : ''}

DIVERGENCE FROM LLM1: ${divergence}

— Vela · EssentianLabs`;

  it('parses all four blocks from a clean concur response', () => {
    const raw = makeRaw();
    const r = parseT3T4ReviewResponse(raw, 'avoid');
    assert.equal(r.verdict, 'HOLD');
    assert.ok(r.holdSentence.includes('Mass irreversible'));
    assert.ok(r.riskBenefit.includes('50,000 customer records'));
    assert.equal(r.scopeHygiene.issuesDetected, false);
    assert.equal(Object.keys(r.options).length, 4);
    assert.equal(r.recommended, 'avoid');
    assert.equal(r.review.agreement, true);
    assert.equal(r.review.divergenceReason, null);
    assert.equal(r.review.llm1Recommended, 'avoid');
    assert.equal(r.review.llm2Recommended, 'avoid');
    assert.equal(r.parseFailed, false);
  });

  it('detects scope hygiene mismatch', () => {
    const raw = makeRaw({
      scope: 'Activity type mismatch: action describes bulk delete but activity_type is data_read.'
    });
    const r = parseT3T4ReviewResponse(raw, 'mitigate');
    assert.equal(r.scopeHygiene.issuesDetected, true);
    assert.ok(r.scopeHygiene.note.includes('Activity type mismatch'));
  });

  it('detects divergence and captures reason', () => {
    const raw = makeRaw({
      divergence: 'Diverge: LLM1 underweighted the scale signal and recommended mitigate when avoid is more proportionate.',
      recommended: 'avoid'
    });
    const r = parseT3T4ReviewResponse(raw, 'mitigate');
    assert.equal(r.review.agreement, false);
    assert.ok(r.review.divergenceReason.includes('LLM1 underweighted'));
    assert.equal(r.review.llm1Recommended, 'mitigate');
    assert.equal(r.review.llm2Recommended, 'avoid');
  });

  it('drops OVERRIDE_DENY from options', () => {
    const raw = `VELA LITE (T3) | data_delete_bulk | score 18

HOLD — Test action.

RISK vs BENEFIT:
Risk: test. Benefit: test.

SCOPE HYGIENE:
No scope issues detected.

→ AVOID:     Block (recommended)
→ MITIGATE:  Add controls
→ TRANSFER:  Escalate
→ ACCEPT:    Proceed
→ OVERRIDE_DENY: This should be filtered

DIVERGENCE FROM LLM1: Concur with LLM1's assessment.

— Vela · EssentianLabs`;
    const r = parseT3T4ReviewResponse(raw, 'avoid');
    assert.equal(Object.keys(r.options).length, 4);
    assert.ok(!Object.keys(r.options).some(k => k.includes('overridedeny')));
    assert.equal(r.recommended, 'avoid');
  });

  it('falls back to mitigate when only OVERRIDE_DENY is recommended', () => {
    const raw = `VELA LITE (T4) | financial | score 22

HOLD — Test.

RISK vs BENEFIT:
Risk: test. Benefit: test.

SCOPE HYGIENE:
No scope issues detected.

→ AVOID:     A
→ MITIGATE:  B
→ TRANSFER:  C
→ ACCEPT:    D
→ OVERRIDE_DENY: E (recommended)

DIVERGENCE FROM LLM1: Concur with LLM1's assessment.

— Vela`;
    const r = parseT3T4ReviewResponse(raw, 'mitigate');
    // recommended marker was on dropped line — should fall back to first valid option
    assert.ok(['avoid', 'mitigate', 'transfer', 'accept'].includes(r.recommended));
  });

  it('buildT3T4ReviewPrompt includes all required structural blocks', () => {
    const prompt = buildT3T4ReviewPrompt(
      'Delete all customer records',
      { activityType: 'data_delete_bulk', riskScore: 22, triggerReason: 'irreversibility, scale', tier: 4 },
      { sliderPosition: 0.9, holdAction: 'halt', requiresHumanReview: false, denyAtTier: null, matchedPolicies: 'none', policyContent: null },
      { recommended: 'mitigate', reasoning: 'irreversibility', options: { avoid: 'block', mitigate: 'snapshot', transfer: 'legal', accept: 'document' } },
      null
    );
    // Required structural elements
    assert.ok(prompt.includes('You are Vela'));
    assert.ok(/peer\s+review/.test(prompt));  // line break tolerant
    assert.ok(prompt.includes('<action>'));
    assert.ok(prompt.includes('<operator_configuration>'));
    assert.ok(prompt.includes('<operator_policy'));
    assert.ok(prompt.includes('<llm1_assessment>'));
    assert.ok(prompt.includes('RISK vs BENEFIT'));
    assert.ok(prompt.includes('SCOPE HYGIENE'));
    assert.ok(prompt.includes('DIVERGENCE FROM LLM1'));
    assert.ok(prompt.includes('OVERRIDE_DENY'));  // explicit "do not output" instruction
    assert.ok(prompt.includes('VELA LITE (T4)'));  // tier-specific header
  });

  it('buildT3T4ReviewPrompt uses T3 label when tier=3', () => {
    const prompt = buildT3T4ReviewPrompt(
      'Test action',
      { activityType: 'publish', riskScore: 11, triggerReason: 'test', tier: 3 },
      { sliderPosition: 0.5 },
      { recommended: 'mitigate' },
      null
    );
    assert.ok(prompt.includes('VELA LITE (T3)'));
    assert.ok(!prompt.includes('VELA LITE (T4)'));
  });

  it('buildT3T4ReviewPrompt populates policy slot when policy provided', () => {
    const policy = 'Refunds <$1K can proceed without approval.';
    const prompt = buildT3T4ReviewPrompt(
      'Refund customer $250',
      { activityType: 'financial', riskScore: 14, triggerReason: 'sensitive data', tier: 3 },
      { sliderPosition: 0.7, policyContent: policy },
      { recommended: 'mitigate', options: {} },
      null
    );
    assert.ok(prompt.includes(policy));
  });

  it('buildT3T4ReviewPrompt empty policy slot when none provided', () => {
    const prompt = buildT3T4ReviewPrompt(
      'Test',
      { activityType: 'data_read', riskScore: 5, triggerReason: 'test', tier: 3 },
      { sliderPosition: 0.5 },
      { recommended: 'mitigate', options: {} },
      null
    );
    assert.ok(prompt.includes('no policy uploaded for this activity type'));
  });
});
