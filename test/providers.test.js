import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getModelName, _defaults, _envVarKey } from '../src/providers.js';

// v0.4.1 — env-var override tests.
// Anchor: Jeremy Korpela (radar-lite user, 2026-06-24) hit stale Google
// gemini-2.0-flash/pro 404s. Fix ships new defaults + env-var scheme so future
// stale-default bugs are operator-fixable without a package publish.

describe('v0.4.1 providers — baked-in defaults', () => {
  it('anthropic fast/reasoning defaults match current stable', () => {
    assert.equal(_defaults.anthropic.fast, 'claude-haiku-4-5-20251001');
    assert.equal(_defaults.anthropic.reasoning, 'claude-sonnet-4-6');
  });

  it('google defaults migrated off gemini-2.0-* (fixes Jeremy 404)', () => {
    assert.equal(_defaults.google.fast, 'gemini-3.5-flash');
    assert.equal(_defaults.google.reasoning, 'gemini-3.1-pro-preview');
    assert.ok(!_defaults.google.fast.startsWith('gemini-2.'),
      'gemini-2.x is deprecated by Google — do not regress the default');
    assert.ok(!_defaults.google.reasoning.startsWith('gemini-2.'));
  });

  it('unknown provider returns null (unchanged from v0.4.0)', () => {
    assert.equal(getModelName('nosuchprovider', 'fast'), null);
    assert.equal(getModelName('nosuchprovider', 'reasoning'), null);
  });
});

describe('v0.4.1 providers — env-var override scheme', () => {
  const KEYS = [
    'RADAR_ANTHROPIC_FAST_MODEL', 'RADAR_ANTHROPIC_REASONING_MODEL',
    'RADAR_OPENAI_FAST_MODEL',    'RADAR_OPENAI_REASONING_MODEL',
    'RADAR_GOOGLE_FAST_MODEL',    'RADAR_GOOGLE_REASONING_MODEL'
  ];

  // Snapshot + restore any pre-existing env values so we don't pollute
  // the operator's real config between test runs.
  const snapshot = {};
  before(() => {
    for (const k of KEYS) snapshot[k] = process.env[k];
  });
  after(() => {
    for (const k of KEYS) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  it('_envVarKey follows RADAR_<PROVIDER>_<TIER>_MODEL shape', () => {
    assert.equal(_envVarKey('google', 'fast'),      'RADAR_GOOGLE_FAST_MODEL');
    assert.equal(_envVarKey('anthropic', 'reasoning'), 'RADAR_ANTHROPIC_REASONING_MODEL');
  });

  it('no env-var set → returns baked-in default', () => {
    for (const k of KEYS) delete process.env[k];
    assert.equal(getModelName('google', 'fast'), 'gemini-3.5-flash');
    assert.equal(getModelName('google', 'reasoning'), 'gemini-3.1-pro-preview');
  });

  it('env-var override wins over baked-in default', () => {
    process.env.RADAR_GOOGLE_FAST_MODEL = 'gemini-3.5-flash-latest';
    process.env.RADAR_GOOGLE_REASONING_MODEL = 'gemini-4-pro-hypothetical';
    assert.equal(getModelName('google', 'fast'), 'gemini-3.5-flash-latest');
    assert.equal(getModelName('google', 'reasoning'), 'gemini-4-pro-hypothetical');
  });

  it('override is resolved per-call (radar.reload() picks up ~/.radar/.env edits)', () => {
    delete process.env.RADAR_ANTHROPIC_FAST_MODEL;
    assert.equal(getModelName('anthropic', 'fast'), 'claude-haiku-4-5-20251001');
    process.env.RADAR_ANTHROPIC_FAST_MODEL = 'claude-opus-4-8';
    assert.equal(getModelName('anthropic', 'fast'), 'claude-opus-4-8');
    delete process.env.RADAR_ANTHROPIC_FAST_MODEL;
    assert.equal(getModelName('anthropic', 'fast'), 'claude-haiku-4-5-20251001');
  });

  it('empty-string override falls back to default (not an accidental blank)', () => {
    process.env.RADAR_OPENAI_FAST_MODEL = '';
    assert.equal(getModelName('openai', 'fast'), 'gpt-4o-mini',
      'empty string should not silently pin an empty model name');
  });

  it('overrides are independent — one provider does not leak to another', () => {
    delete process.env.RADAR_GOOGLE_FAST_MODEL;
    process.env.RADAR_ANTHROPIC_FAST_MODEL = 'claude-something-else';
    assert.equal(getModelName('google', 'fast'), 'gemini-3.5-flash');
    assert.equal(getModelName('anthropic', 'fast'), 'claude-something-else');
  });
});
