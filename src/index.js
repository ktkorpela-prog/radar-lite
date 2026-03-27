import { classify, formatT1 } from './classifier.js';
import { VelaLite, assessT2 } from './vela-lite.js';
import * as register from './register.js';
import { recordStrategy } from './strategy.js';
import { DEFAULT_SLIDER, DEFAULT_PROVIDER } from './constants.js';

let config = {
  llmKey: null,
  llmProvider: DEFAULT_PROVIDER,
  activities: {},
  logLevel: 'info'
};

function log(level, ...args) {
  if (config.logLevel === 'silent') return;
  if (level === 'verbose' && config.logLevel !== 'verbose') return;
  console.log(...args);
}

export function configure(options = {}) {
  config = {
    llmKey: options.llmKey || null,
    llmProvider: options.llmProvider || DEFAULT_PROVIDER,
    activities: options.activities || {},
    logLevel: options.logLevel || 'info'
  };
  log('verbose', '[radar-lite] Configured:', {
    provider: config.llmProvider,
    hasKey: !!config.llmKey,
    activities: Object.keys(config.activities)
  });
}

export async function assess(action, activityType) {
  const sliderPosition = config.activities[activityType] ?? DEFAULT_SLIDER;
  const t1 = classify(action, activityType, sliderPosition);
  const callId = register.generateCallId();
  const actionHash = register.hashAction(action);

  const wouldEscalate = t1.rawTier > 2;
  const escalateTier = wouldEscalate ? t1.rawTier : null;

  // Save to register
  await register.save({
    callId,
    actionHash,
    activityType: t1.activityType,
    tier: t1.tier,
    riskScore: t1.riskScore,
    verdict: t1.verdict
  });

  // T1 — no LLM needed
  if (t1.tier === 1) {
    const formatted = formatT1(t1);
    log('info', formatted);
    return {
      proceed: t1.verdict === 'PROCEED',
      tier: 1,
      verdict: t1.verdict,
      riskScore: t1.riskScore,
      triggerReason: t1.triggerReason,
      activityType: t1.activityType,
      callId,
      vela: formatted,
      options: null,
      recommended: null,
      t2Attempted: false,
      wouldEscalate,
      escalateTier,
      parseFailed: false
    };
  }

  // T2 — needs LLM key
  if (!config.llmKey) {
    const formatted = formatT1(t1);
    log('info', `${formatted} (T2 triggered but no LLM key — falling back to T1)`);
    return {
      proceed: t1.verdict === 'PROCEED',
      tier: 1,
      verdict: t1.verdict,
      riskScore: t1.riskScore,
      triggerReason: t1.triggerReason,
      activityType: t1.activityType,
      callId,
      vela: formatted + '\n(No LLM key configured — T2 Vela Lite assessment unavailable)',
      options: null,
      recommended: null,
      t2Attempted: false,
      wouldEscalate,
      escalateTier,
      parseFailed: false
    };
  }

  try {
    const t2 = await assessT2(
      action, activityType, t1.riskScore, t1.triggerReason, sliderPosition, config
    );

    log('info', t2.formatted);

    return {
      proceed: t2.verdict === 'PROCEED',
      tier: 2,
      verdict: t2.verdict,
      riskScore: t1.riskScore,
      triggerReason: t1.triggerReason,
      activityType: t1.activityType,
      callId,
      vela: t2.formatted,
      options: t2.options,
      recommended: t2.recommended,
      t2Attempted: true,
      wouldEscalate,
      escalateTier,
      parseFailed: t2.parseFailed
    };
  } catch (err) {
    const formatted = formatT1(t1);
    log('info', `${formatted} (T2 LLM call failed: ${err.message})`);
    return {
      proceed: t1.verdict === 'PROCEED',
      tier: 1,
      verdict: t1.verdict,
      riskScore: t1.riskScore,
      triggerReason: t1.triggerReason,
      activityType: t1.activityType,
      callId,
      vela: formatted + `\n(T2 LLM call failed: ${err.message})`,
      options: null,
      recommended: null,
      t2Attempted: false,
      wouldEscalate,
      escalateTier,
      parseFailed: false
    };
  }
}

export async function strategy(callId, chosenStrategy, options = {}) {
  return recordStrategy(callId, chosenStrategy, options);
}

export async function history(limit = 100) {
  return register.history(limit);
}

export async function stats() {
  return register.stats();
}

export const radar = { configure, assess, strategy, history, stats };

export { VelaLite };

export default radar;
