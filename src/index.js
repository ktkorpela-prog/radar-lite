import { classify, getThresholds } from './classifier.js';
import { VelaLite, assessVela } from './vela-lite.js';
import * as register from './register.js';
import { recordStrategy } from './strategy.js';
import { DEFAULT_SLIDER, DEFAULT_PROVIDER, T1_LABEL, DENY_SCORE_THRESHOLD, resolveActivityType } from './constants.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

let config = {
  llmKey: null,
  llmProvider: DEFAULT_PROVIDER,
  t2Provider: null,
  t2Key: null,
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

// Check if action has irreversibility signal (used for DENY threshold)
function hasIrreversibilitySignal(triggerReason) {
  return /irreversibility|scale|sensitive data/i.test(triggerReason || '');
}

// Backward compat: add verdict as alias for status
function withVerdict(startTime, result) {
  result.verdict = result.status;
  result.responseTimeMs = Date.now() - startTime;
  return result;
}

export function configure(options = {}) {
  config = {
    llmKey: options.llmKey || null,
    llmProvider: options.llmProvider || DEFAULT_PROVIDER,
    t2Provider: options.t2Provider || null,
    t2Key: options.t2Key || null,
    activities: options.activities || {},
    logLevel: options.logLevel || 'info'
  };
  log('verbose', '[radar-lite] Configured:', {
    provider: config.llmProvider,
    t2Provider: config.t2Provider || '(same as primary)',
    hasKey: !!config.llmKey,
    hasT2Key: !!config.t2Key,
    activities: Object.keys(config.activities)
  });
}

function isRadarEnabled() {
  if (process.env.RADAR_ENABLED === 'false') return false;
  const envPath = join(homedir(), '.radar', '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/^RADAR_ENABLED\s*=\s*(.+)$/m);
    if (match && match[1].trim().toLowerCase() === 'false') return false;
  }
  return true;
}

// Re-read LLM config from ~/.radar/.env on every assess() call.
// Eliminates the "added my key but RADAR keeps HOLD-ing" footgun:
// previously LLM keys were captured once at configure() time and never refreshed,
// so MCP/dashboard processes that started before keys were set in .env would stay
// stuck until restart. Same pattern as isRadarEnabled() — file read is cheap.
//
// Precedence: explicit configure() values win, .env fills in absent values,
// process.env is the last fallback. Lets developers set keys in code if they
// prefer, but defaults to honoring file-based config for HTTP/MCP scenarios.
function getEffectiveLlmConfig() {
  const fromFile = {};
  const envPath = join(homedir(), '.radar', '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    for (const m of content.matchAll(/^([A-Z_]+)\s*=\s*(.*)$/gm)) {
      fromFile[m[1]] = m[2].trim();
    }
  }
  return {
    llmKey:      config.llmKey      || fromFile.LLM_API_KEY  || process.env.LLM_API_KEY  || null,
    llmProvider: config.llmProvider || fromFile.LLM_PROVIDER || process.env.LLM_PROVIDER || DEFAULT_PROVIDER,
    t2Provider:  config.t2Provider  || fromFile.T2_PROVIDER  || process.env.T2_PROVIDER  || null,
    t2Key:       config.t2Key       || fromFile.T2_API_KEY   || process.env.T2_API_KEY   || null,
    activities:  config.activities,
    logLevel:    config.logLevel
  };
}

export async function checkPolicy(action, agentId = null) {
  return register.checkPolicy(action, agentId);
}

export async function assess(action, activityType, options = {}) {
  const _startTime = Date.now();

  // Input validation
  if (action == null || typeof action !== 'string') {
    throw new Error('radar.assess() requires a string action description as the first argument');
  }
  if (activityType == null || typeof activityType !== 'string') {
    throw new Error('radar.assess() requires a string activity type as the second argument');
  }

  const agentId = options.agentId || null;

  // === RADAR DISABLED ===
  if (!isRadarEnabled()) {
    const resolvedType = resolveActivityType(activityType);
    const callId = register.generateCallId();
    const actionHash = register.hashAction(action);
    await register.save({
      callId, actionHash, activityType: resolvedType,
      tier: null, riskScore: null, verdict: 'PROCEED',
      policyDecision: null, radarEnabled: false, agentId
    });
    log('info', `${T1_LABEL} | PROCEED | RADAR disabled by configuration | ${resolvedType}`);
    return withVerdict(_startTime, {
      status: 'PROCEED', proceed: true, tier: null,
      reviewRequired: false, riskScore: null, triggerReason: null,
      activityType: resolvedType, callId,
      vela: null, options: null, recommended: null,
      promptMode: null, t2Attempted: false,
      wouldEscalate: false, escalateTier: null,
      parseFailed: false, policyDecision: null,
      radarEnabled: false,
      reason: 'RADAR disabled by configuration'
    });
  }

  // Resolve deprecated types
  const resolvedType = resolveActivityType(activityType);

  // Load activity config early — needed for holdAction on HOLD paths
  const activityConfig = await register.getActivityConfig(resolvedType);
  const holdAction = activityConfig?.hold_action || 'halt';
  const notifyUrl = holdAction === 'notify' ? (activityConfig?.notify_url || null) : null;

  // === POLICY CHECK ===
  const policyDecision = await register.checkPolicy(action, agentId);

  // DENY policy — hard stop
  if (policyDecision === 'deny') {
    const callId = register.generateCallId();
    const actionHash = register.hashAction(action);
    await register.save({
      callId, actionHash, activityType: resolvedType,
      tier: null, riskScore: null, verdict: 'DENY', policyDecision: 'deny', agentId
    });
    log('info', `RADAR | DENY | Blocked by trigger policy | ${resolvedType}`);
    return withVerdict(_startTime, {
      status: 'DENY', proceed: false, tier: null,
      reviewRequired: false, riskScore: null,
      triggerReason: 'Blocked by trigger policy',
      activityType: resolvedType, callId,
      vela: null, options: null, recommended: null,
      reason: 'Blocked by trigger policy — override requires radar.strategy(callId, \'override_deny\', { reason, decidedBy })',
      policyDecision: 'deny', radarEnabled: true
    });
  }

  // human_required policy — HOLD with review
  if (policyDecision === 'human_required') {
    const callId = register.generateCallId();
    const actionHash = register.hashAction(action);
    await register.save({
      callId, actionHash, activityType: resolvedType,
      tier: 0, riskScore: 0, verdict: 'HOLD', policyDecision: 'human_required', agentId
    });
    log('info', `${T1_LABEL} | HOLD | Trigger policy requires human approval | ${resolvedType}`);
    return withVerdict(_startTime, {
      status: 'HOLD', proceed: false, tier: 0,
      reviewRequired: true, riskScore: 0,
      triggerReason: 'Trigger policy requires human approval',
      activityType: resolvedType, callId,
      vela: null, options: null, recommended: null,
      promptMode: null, t2Attempted: false,
      wouldEscalate: false, escalateTier: null,
      parseFailed: false, policyDecision: 'human_required',
      radarEnabled: true, reason: 'Trigger policy requires human approval',
      holdAction, notifyUrl
    });
  }

  // no_assessment policy — PROCEED
  if (policyDecision === 'no_assessment') {
    const callId = register.generateCallId();
    const actionHash = register.hashAction(action);
    await register.save({
      callId, actionHash, activityType: resolvedType,
      tier: 0, riskScore: 0, verdict: 'PROCEED', policyDecision: 'no_assessment', agentId
    });
    log('info', `${T1_LABEL} | PROCEED | Trigger policy: no assessment needed | ${resolvedType}`);
    return withVerdict(_startTime, {
      status: 'PROCEED', proceed: true, tier: 0,
      reviewRequired: false, riskScore: 0,
      triggerReason: 'Trigger policy: no assessment needed',
      activityType: resolvedType, callId,
      vela: null, options: null, recommended: null,
      promptMode: null, t2Attempted: false,
      wouldEscalate: false, escalateTier: null,
      parseFailed: false, policyDecision: 'no_assessment',
      radarEnabled: true, reason: 'Trigger policy: no assessment needed'
    });
  }

  // === ACTIVITY CONFIG: HUMAN REVIEW === (HOLD, not DENY)
  if (activityConfig && activityConfig.requires_human_review) {
    const callId = register.generateCallId();
    const actionHash = register.hashAction(action);
    await register.save({
      callId, actionHash, activityType: resolvedType,
      tier: 0, riskScore: 0, verdict: 'HOLD', policyDecision: 'human_required', agentId
    });
    log('info', `${T1_LABEL} | HOLD | Activity type requires human review | ${resolvedType}`);
    return withVerdict(_startTime, {
      status: 'HOLD', proceed: false, tier: 0,
      reviewRequired: true, riskScore: 0,
      triggerReason: 'Activity type requires human review',
      activityType: resolvedType, callId,
      vela: null, options: null, recommended: null,
      promptMode: null, t2Attempted: false,
      wouldEscalate: false, escalateTier: null,
      parseFailed: false, policyDecision: 'human_required',
      radarEnabled: true, reason: 'Activity type requires human review',
      holdAction, notifyUrl
    });
  }

  // === CLASSIFIER ===
  const sliderPosition = activityConfig?.slider_position
    ?? config.activities[resolvedType]
    ?? config.activities[activityType]
    ?? DEFAULT_SLIDER;

  const scored = classify(action, resolvedType, sliderPosition);
  const callId = register.generateCallId();
  const actionHash = register.hashAction(action);

  const wouldEscalate = scored.wouldEscalate;
  const escalateTier = scored.escalateTier;

  // === DENY: Score 20+ with irreversibility signal ===
  if (scored.riskScore >= DENY_SCORE_THRESHOLD && hasIrreversibilitySignal(scored.triggerReason)) {
    await register.save({
      callId, actionHash, activityType: scored.activityType,
      tier: scored.rawTier, riskScore: scored.riskScore, verdict: 'DENY', policyDecision: 'assess', agentId
    });
    log('info', `RADAR | DENY | Score ${scored.riskScore} with irreversibility — hard stop | ${scored.activityType}`);
    return withVerdict(_startTime, {
      status: 'DENY', proceed: false, tier: scored.rawTier,
      reviewRequired: false, riskScore: scored.riskScore,
      triggerReason: scored.triggerReason,
      activityType: scored.activityType, callId,
      vela: null, options: null, recommended: null,
      reason: `Score ${scored.riskScore}/25 with irreversibility signal — hard stop. Override requires radar.strategy(callId, 'override_deny', { reason, decidedBy })`,
      wouldEscalate, escalateTier,
      policyDecision: 'assess', radarEnabled: true
    });
  }

  // Prior decision lookup
  const priorDecision = await register.findPriorDecision(actionHash);

  // Determine tier from threshold — store rawTier for accurate reporting
  const thresholds = getThresholds(sliderPosition);
  const promptMode = scored.riskScore < thresholds.t2 ? 'oneliner' : 'tldr';
  const tier = scored.rawTier;

  // Save pending
  await register.save({
    callId, actionHash, activityType: scored.activityType,
    tier, riskScore: scored.riskScore, verdict: 'PENDING', policyDecision: 'assess', agentId
  });

  // Re-read LLM config from .env every call — prevents stale-key footgun
  // where keys added to .env after MCP/dashboard launch would never be picked up.
  const effectiveConfig = getEffectiveLlmConfig();

  // === NO LLM KEY — rules engine fallback ===
  if (!effectiveConfig.llmKey) {
    const formatted = formatRulesOneliner(scored);
    log('info', `${formatted} (No LLM key — rules engine only)`);

    // Without LLM: T1 = PROCEED, T2 = HOLD (can't assess without Vela)
    const status = tier === 1 ? 'PROCEED' : 'HOLD';
    await register.updateVerdict(callId, status);

    const result = {
      status, proceed: status === 'PROCEED', tier,
      reviewRequired: status === 'HOLD',
      riskScore: scored.riskScore, triggerReason: scored.triggerReason,
      activityType: scored.activityType, callId,
      vela: formatted + '\n(No LLM key configured — Vela Lite assessment unavailable)',
      options: null, recommended: null,
      promptMode, t2Attempted: false,
      wouldEscalate, escalateTier,
      parseFailed: false, policyDecision: 'assess',
      radarEnabled: true
    };
    if (status === 'HOLD') {
      result.holdAction = holdAction;
      result.notifyUrl = notifyUrl;
    }
    return withVerdict(_startTime, result);
  }

  // === VELA LITE ===
  try {
    const vela = await assessVela(
      action, scored.activityType, scored.riskScore, scored.triggerReason,
      sliderPosition, promptMode, effectiveConfig, priorDecision
    );

    log('info', vela.formatted);

    // T1: always PROCEED. T2: always HOLD.
    // The LLM picks the recommended strategy at T2, not the verdict.
    const status = tier === 1 ? 'PROCEED' : 'HOLD';
    await register.updateVerdict(callId, status);

    const result = {
      status, proceed: status === 'PROCEED', tier,
      reviewRequired: status === 'HOLD',
      riskScore: scored.riskScore, triggerReason: scored.triggerReason,
      activityType: scored.activityType, callId,
      vela: vela.formatted, options: vela.options, recommended: vela.recommended,
      promptMode, t2Attempted: true,
      wouldEscalate, escalateTier,
      parseFailed: vela.parseFailed, policyDecision: 'assess',
      radarEnabled: true
    };
    if (status === 'HOLD') {
      result.holdAction = holdAction;
      result.notifyUrl = notifyUrl;
    }
    return withVerdict(_startTime, result);
  } catch (err) {
    const formatted = formatRulesOneliner(scored);
    // Log full error internally — never expose provider error details in return object
    log('verbose', `[radar-lite] Vela Lite call failed: ${err.message}`);
    log('info', `${formatted} (Vela Lite assessment unavailable — rules engine fallback)`);

    // LLM failed: T1 = PROCEED, T2 = HOLD (can't clear without Vela)
    const status = tier === 1 ? 'PROCEED' : 'HOLD';
    await register.updateVerdict(callId, status);

    const result = {
      status, proceed: status === 'PROCEED', tier,
      reviewRequired: status === 'HOLD',
      riskScore: scored.riskScore, triggerReason: scored.triggerReason,
      activityType: scored.activityType, callId,
      vela: formatted + '\n(Vela Lite assessment unavailable — rules engine fallback)',
      options: null, recommended: null,
      promptMode, t2Attempted: false,
      wouldEscalate, escalateTier,
      parseFailed: false, policyDecision: 'assess',
      radarEnabled: true
    };
    if (status === 'HOLD') {
      result.holdAction = holdAction;
      result.notifyUrl = notifyUrl;
    }
    return withVerdict(_startTime, result);
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

export async function saveActivityConfig(activityType, actConfig) {
  return register.saveActivityConfig(activityType, actConfig);
}

export async function savePolicy(actionPattern, policy, agentId = null) {
  return register.savePolicy(actionPattern, policy, agentId);
}

export async function reload() {
  return register.reload();
}

export async function clear() {
  return register.clear();
}

export const radar = {
  configure, assess, strategy, history, stats,
  checkPolicy, saveActivityConfig, savePolicy, reload, clear
};

export { VelaLite };

export default radar;
