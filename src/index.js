import { classify, getThresholds } from './classifier.js';
import { VelaLite, assessVela } from './vela-lite.js';
import * as register from './register.js';
import { recordStrategy } from './strategy.js';
import { DEFAULT_SLIDER, DEFAULT_PROVIDER, T1_LABEL, resolveActivityType } from './constants.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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

function isRadarEnabled() {
  // Check process.env first (set by dashboard toggle)
  if (process.env.RADAR_ENABLED === 'false') return false;
  // Check .radar/.env file
  const envPath = join(process.cwd(), '.radar', '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/^RADAR_ENABLED\s*=\s*(.+)$/m);
    if (match && match[1].trim().toLowerCase() === 'false') return false;
  }
  return true;
}

export async function checkPolicy(action, agentId = null) {
  return register.checkPolicy(action, agentId);
}

export async function assess(action, activityType, options = {}) {
  const agentId = options.agentId || null;

  // Check if RADAR is enabled
  if (!isRadarEnabled()) {
    const resolvedType = resolveActivityType(activityType);
    const callId = register.generateCallId();
    const actionHash = register.hashAction(action);
    await register.save({
      callId, actionHash, activityType: resolvedType,
      tier: null, riskScore: null, verdict: 'PROCEED',
      policyDecision: null, radarEnabled: false
    });
    log('info', `${T1_LABEL} | PROCEED | RADAR disabled by configuration | ${resolvedType}`);
    return {
      proceed: true, verdict: 'PROCEED', tier: null,
      riskScore: null, triggerReason: null,
      activityType: resolvedType, callId,
      vela: null, options: null, recommended: null,
      promptMode: null, t2Attempted: false,
      wouldEscalate: false, escalateTier: null,
      parseFailed: false, policyDecision: null,
      radarEnabled: false,
      reason: 'RADAR disabled by configuration'
    };
  }

  // Resolve deprecated types
  const resolvedType = resolveActivityType(activityType);

  // Load activity config early — needed for holdAction on all HOLD paths
  const activityConfig = await register.getActivityConfig(resolvedType);
  const holdAction = activityConfig?.hold_action || 'halt';
  const notifyUrl = holdAction === 'notify' ? (activityConfig?.notify_url || null) : null;

  // Check trigger policy first
  const policyDecision = await register.checkPolicy(action, agentId);

  if (policyDecision === 'human_required') {
    const callId = register.generateCallId();
    const actionHash = register.hashAction(action);
    await register.save({
      callId, actionHash, activityType: resolvedType,
      tier: 0, riskScore: 0, verdict: 'HOLD', policyDecision: 'human_required'
    });
    log('info', `${T1_LABEL} | HOLD | Trigger policy requires human approval | ${resolvedType}`);
    return {
      proceed: false, tier: 0, verdict: 'HOLD',
      riskScore: 0, triggerReason: 'Trigger policy requires human approval',
      activityType: resolvedType, callId,
      vela: null, options: null, recommended: null,
      promptMode: null, t2Attempted: false,
      wouldEscalate: false, escalateTier: null,
      parseFailed: false, policyDecision: 'human_required',
      radarEnabled: true, reason: 'Trigger policy requires human approval',
      holdAction, notifyUrl
    };
  }

  if (policyDecision === 'no_assessment') {
    const callId = register.generateCallId();
    const actionHash = register.hashAction(action);
    await register.save({
      callId, actionHash, activityType: resolvedType,
      tier: 0, riskScore: 0, verdict: 'PROCEED', policyDecision: 'no_assessment'
    });
    log('info', `${T1_LABEL} | PROCEED | Trigger policy: no assessment needed | ${resolvedType}`);
    return {
      proceed: true, tier: 0, verdict: 'PROCEED',
      riskScore: 0, triggerReason: 'Trigger policy: no assessment needed',
      activityType: resolvedType, callId,
      vela: null, options: null, recommended: null,
      promptMode: null, t2Attempted: false,
      wouldEscalate: false, escalateTier: null,
      parseFailed: false, policyDecision: 'no_assessment',
      radarEnabled: true, reason: 'Trigger policy: no assessment needed'
    };
  }

  // Check activity-level human review requirement
  if (activityConfig && activityConfig.requires_human_review) {
    const callId = register.generateCallId();
    const actionHash = register.hashAction(action);
    await register.save({
      callId, actionHash, activityType: resolvedType,
      tier: 0, riskScore: 0, verdict: 'HOLD', policyDecision: 'human_required'
    });
    log('info', `${T1_LABEL} | HOLD | Activity type requires human review | ${resolvedType}`);
    return {
      proceed: false, tier: 0, verdict: 'HOLD',
      riskScore: 0, triggerReason: 'Activity type requires human review',
      activityType: resolvedType, callId,
      vela: null, options: null, recommended: null,
      promptMode: null, t2Attempted: false,
      wouldEscalate: false, escalateTier: null,
      parseFailed: false, policyDecision: 'human_required',
      radarEnabled: true, reason: 'Activity type requires human review',
      holdAction, notifyUrl
    };
  }

  // Get slider — activity_config DB overrides JS config
  const sliderPosition = activityConfig?.slider_position
    ?? config.activities[resolvedType]
    ?? config.activities[activityType]  // fallback to original (deprecated) key
    ?? DEFAULT_SLIDER;

  // Run classifier
  const scored = classify(action, resolvedType, sliderPosition);
  const callId = register.generateCallId();
  const actionHash = register.hashAction(action);

  const wouldEscalate = scored.wouldEscalate;
  const escalateTier = scored.escalateTier;

  // Look up prior decision for this action hash
  const priorDecision = await register.findPriorDecision(actionHash);

  // Determine prompt mode from threshold
  const thresholds = getThresholds(sliderPosition);
  const promptMode = scored.riskScore < thresholds.t2 ? 'oneliner' : 'tldr';
  const tier = promptMode === 'oneliner' ? 1 : 2;

  // Save to register with pending verdict
  await register.save({
    callId, actionHash, activityType: scored.activityType,
    tier, riskScore: scored.riskScore, verdict: 'PENDING', policyDecision: 'assess'
  });

  // No LLM key — fall back to rules engine formatted one-liner
  if (!config.llmKey) {
    const formatted = formatRulesOneliner(scored);
    log('info', `${formatted} (No LLM key — rules engine only)`);
    await register.updateVerdict(callId, 'PROCEED');

    return {
      proceed: true, tier, verdict: 'PROCEED',
      riskScore: scored.riskScore, triggerReason: scored.triggerReason,
      activityType: scored.activityType, callId,
      vela: formatted + '\n(No LLM key configured — Vela Lite assessment unavailable)',
      options: null, recommended: null,
      promptMode, t2Attempted: false,
      wouldEscalate, escalateTier,
      parseFailed: false, policyDecision: 'assess',
      radarEnabled: true
    };
  }

  // Vela Lite always runs when key is configured
  try {
    const vela = await assessVela(
      action, scored.activityType, scored.riskScore, scored.triggerReason,
      sliderPosition, promptMode, config, priorDecision
    );

    log('info', vela.formatted);
    await register.updateVerdict(callId, vela.verdict);

    const result = {
      proceed: vela.verdict === 'PROCEED', tier, verdict: vela.verdict,
      riskScore: scored.riskScore, triggerReason: scored.triggerReason,
      activityType: scored.activityType, callId,
      vela: vela.formatted, options: vela.options, recommended: vela.recommended,
      promptMode, t2Attempted: true,
      wouldEscalate, escalateTier,
      parseFailed: vela.parseFailed, policyDecision: 'assess',
      radarEnabled: true
    };
    if (vela.verdict === 'HOLD') {
      result.holdAction = holdAction;
      result.notifyUrl = notifyUrl;
    }
    return result;
  } catch (err) {
    const formatted = formatRulesOneliner(scored);
    log('info', `${formatted} (Vela Lite call failed: ${err.message})`);
    await register.updateVerdict(callId, 'PROCEED');

    return {
      proceed: true, tier, verdict: 'PROCEED',
      riskScore: scored.riskScore, triggerReason: scored.triggerReason,
      activityType: scored.activityType, callId,
      vela: formatted + `\n(Vela Lite call failed: ${err.message})`,
      options: null, recommended: null,
      promptMode, t2Attempted: false,
      wouldEscalate, escalateTier,
      parseFailed: false, policyDecision: 'assess',
      radarEnabled: true
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

// Re-export register config methods for direct use
export async function saveActivityConfig(activityType, actConfig) {
  return register.saveActivityConfig(activityType, actConfig);
}

export async function savePolicy(actionPattern, policy, agentId = null) {
  return register.savePolicy(actionPattern, policy, agentId);
}

export const radar = {
  configure, assess, strategy, history, stats,
  checkPolicy, saveActivityConfig, savePolicy
};

export { VelaLite };

export default radar;
