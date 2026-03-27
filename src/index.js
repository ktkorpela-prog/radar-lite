import { classify, getThresholds } from './classifier.js';
import { VelaLite, assessVela } from './vela-lite.js';
import * as register from './register.js';
import { recordStrategy } from './strategy.js';
import { DEFAULT_SLIDER, DEFAULT_PROVIDER, T1_LABEL } from './constants.js';

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

function formatRulesOneliner(scored) {
  return `${T1_LABEL} | PROCEED | ${scored.triggerReason} | ${scored.activityType} | score ${scored.riskScore}`;
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
  const scored = classify(action, activityType, sliderPosition);
  const callId = register.generateCallId();
  const actionHash = register.hashAction(action);

  // Determine prompt mode from threshold
  const thresholds = getThresholds(sliderPosition);
  const promptMode = scored.riskScore < thresholds.t2 ? 'oneliner' : 'tldr';
  const tier = promptMode === 'oneliner' ? 1 : 2;

  // Save to register — verdict will be determined by Vela Lite
  // Save tier from threshold determination
  await register.save({
    callId,
    actionHash,
    activityType: scored.activityType,
    tier,
    riskScore: scored.riskScore,
    verdict: 'PENDING'
  });

  // No LLM key — fall back to rules engine formatted one-liner
  if (!config.llmKey) {
    const formatted = formatRulesOneliner(scored);
    log('info', `${formatted} (No LLM key — rules engine only)`);

    // Update verdict in register
    await register.updateVerdict(callId, 'PROCEED');

    return {
      proceed: true,
      tier,
      verdict: 'PROCEED',
      riskScore: scored.riskScore,
      triggerReason: scored.triggerReason,
      activityType: scored.activityType,
      callId,
      vela: formatted + '\n(No LLM key configured — Vela Lite assessment unavailable)',
      options: null,
      recommended: null,
      promptMode,
      t2Attempted: false,
      wouldEscalate: scored.wouldEscalate,
      escalateTier: scored.escalateTier,
      parseFailed: false
    };
  }

  // Vela Lite always runs when key is configured
  try {
    const vela = await assessVela(
      action, scored.activityType, scored.riskScore, scored.triggerReason,
      sliderPosition, promptMode, config
    );

    log('info', vela.formatted);

    // Update verdict in register
    await register.updateVerdict(callId, vela.verdict);

    return {
      proceed: vela.verdict === 'PROCEED',
      tier,
      verdict: vela.verdict,
      riskScore: scored.riskScore,
      triggerReason: scored.triggerReason,
      activityType: scored.activityType,
      callId,
      vela: vela.formatted,
      options: vela.options,
      recommended: vela.recommended,
      promptMode,
      t2Attempted: true,
      wouldEscalate: scored.wouldEscalate,
      escalateTier: scored.escalateTier,
      parseFailed: vela.parseFailed
    };
  } catch (err) {
    const formatted = formatRulesOneliner(scored);
    log('info', `${formatted} (Vela Lite call failed: ${err.message})`);

    // Update verdict in register
    await register.updateVerdict(callId, 'PROCEED');

    return {
      proceed: true,
      tier,
      verdict: 'PROCEED',
      riskScore: scored.riskScore,
      triggerReason: scored.triggerReason,
      activityType: scored.activityType,
      callId,
      vela: formatted + `\n(Vela Lite call failed: ${err.message})`,
      options: null,
      recommended: null,
      promptMode,
      t2Attempted: false,
      wouldEscalate: scored.wouldEscalate,
      escalateTier: scored.escalateTier,
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
