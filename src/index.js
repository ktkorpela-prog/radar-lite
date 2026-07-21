import { classify, getThresholds } from './classifier.js';
import { VelaLite, assessVela, assessVelaT3T4Review } from './vela-lite.js';
import * as register from './register.js';
import { recordStrategy } from './strategy.js';
import { recordComplete } from './complete.js';
import { DEFAULT_SLIDER, DEFAULT_PROVIDER, T1_LABEL, DENY_SCORE_THRESHOLD, resolveActivityType } from './constants.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
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
  // v0.4.4: fire-and-forget update check. Runs at most once per process
  // (session-scoped `updateWarned` flag), 24h TTL cache in ~/.radar/.update-check,
  // 3s network timeout, silent on any failure. Opt out via UPDATE_CHECK=false
  // in ~/.radar/.env or process.env. Matches the radar-mcp / radar-openclaw
  // notification pattern — closes the gap for direct-import radar-lite users.
  checkForUpdatesInBackground().catch(() => {});
}

// --- v0.4.4 update-check (self-check for direct-import users) ---

const UPDATE_CHECK_CACHE_PATH = join(homedir(), '.radar', '.update-check');
const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
let updateWarned = false;

function isUpdateCheckEnabled() {
  if (process.env.UPDATE_CHECK && process.env.UPDATE_CHECK.toLowerCase() === 'false') return false;
  const envPath = join(homedir(), '.radar', '.env');
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      const match = content.match(/^UPDATE_CHECK\s*=\s*(.+)$/m);
      if (match && match[1].trim().toLowerCase() === 'false') return false;
    } catch (e) { /* fall through — default enabled */ }
  }
  return true;
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function checkForUpdatesInBackground() {
  if (updateWarned || !isUpdateCheckEnabled()) return;
  const installed = VelaLite.profile.version;

  let cache = null;
  try {
    cache = JSON.parse(readFileSync(UPDATE_CHECK_CACHE_PATH, 'utf-8'));
  } catch (e) { /* no cache */ }

  const now = Date.now();
  let latest = cache?.latest;

  if (!cache || (now - cache.checkedAt) > UPDATE_CHECK_TTL_MS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('https://registry.npmjs.org/@essentianlabs%2fradar-lite/latest', {
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!res.ok) return;
      const data = await res.json();
      latest = data.version;
      try {
        mkdirSync(join(homedir(), '.radar'), { recursive: true });
        writeFileSync(UPDATE_CHECK_CACHE_PATH, JSON.stringify({ checkedAt: now, latest }));
      } catch (e) { /* cache write failure — non-fatal */ }
    } catch (e) {
      return; // network failure, timeout, DNS issue — silent
    }
  }

  if (latest && compareVersions(latest, installed) > 0) {
    updateWarned = true;
    console.warn(
      `[radar-lite] v${latest} is available (installed: v${installed}). ` +
      `Run \`npm install @essentianlabs/radar-lite@latest\` to update.`
    );
  }
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

// v0.4: T3_T4_REQUIRE_LLM2 — opt-in flag for the strict dual-LLM gate at T3/T4.
// Default: false (v0.3.x behavior preserved — T3/T4 actions use single-LLM
// with T2 prompt). When true: T3/T4 actions HOLD with policyDecision='llm2_required'
// if t2Key is not configured.
// Planned: default flips to TRUE in v0.5.0 after one release of opt-in.
// Same per-call .env re-read pattern as isRadarEnabled().
function isT3T4Llm2Required() {
  if (process.env.T3_T4_REQUIRE_LLM2 === 'true') return true;
  const envPath = join(homedir(), '.radar', '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/^T3_T4_REQUIRE_LLM2\s*=\s*(.+)$/m);
    if (match && match[1].trim().toLowerCase() === 'true') return true;
  }
  return false;  // default: opt-in for v0.4.0; will flip in v0.5.0
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
    // Match standard env var names: must start with letter/underscore, then
    // can contain digits. Previously [A-Z_]+ silently dropped T2_PROVIDER /
    // T2_API_KEY because of the digit — broke dual-provider config.
    for (const m of content.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/gm)) {
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

  // === v0.4: DENY by activity-configured deny_at_tier ===
  // Operator can configure per-activity deny_at_tier (NULL/3/4) on activity_config.
  // Fires BEFORE score-20+irreversibility check (per locked DENY ordering in V04-PLAN.md):
  //   1. Trigger policy 'deny' (already handled above)
  //   2. activity_severity_deny (this check)
  //   3. score-20-irreversibility (next check)
  // Each path produces a distinct policyDecision value for audit.
  // Override available via radar.strategy(callId, 'override_deny', {reason, decidedBy})
  // — same mechanism as all other DENY paths.
  const denyAtTier = activityConfig?.deny_at_tier;
  if (denyAtTier !== null && denyAtTier !== undefined && scored.rawTier >= denyAtTier) {
    await register.save({
      callId, actionHash, activityType: scored.activityType,
      tier: scored.rawTier, riskScore: scored.riskScore,
      verdict: 'DENY', policyDecision: 'activity_severity_deny', agentId
    });
    log('info', `RADAR | DENY | Activity '${scored.activityType}' configured deny_at_tier=${denyAtTier}, action reached T${scored.rawTier}`);
    return withVerdict(_startTime, {
      status: 'DENY', proceed: false, tier: scored.rawTier,
      reviewRequired: false, riskScore: scored.riskScore,
      triggerReason: scored.triggerReason,
      activityType: scored.activityType, callId,
      vela: null, options: null, recommended: null,
      reason: `Activity '${scored.activityType}' configured to DENY at T${denyAtTier}+. Action scored T${scored.rawTier} (score ${scored.riskScore}/25). Override requires radar.strategy(callId, 'override_deny', { reason, decidedBy })`,
      wouldEscalate, escalateTier,
      policyDecision: 'activity_severity_deny', radarEnabled: true
    });
  }

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

  // === T3/T4 LLM2 GATE (v0.4) ===
  // When T3_T4_REQUIRE_LLM2=true (opt-in for v0.4.0; default in v0.5.0+) AND
  // the user has not configured an LLM2 key, T3/T4 actions HOLD with a clear
  // 'llm2_required' policyDecision instead of running on a single LLM.
  // Override path: configure T2 keys, OR set T3_T4_REQUIRE_LLM2=false to
  // restore v0.3.x single-LLM behavior, OR set the activity slider to permissive.
  if (tier >= 3 && isT3T4Llm2Required() && !effectiveConfig.t2Key) {
    log('info', `RADAR | HOLD | T${tier} requires LLM2 review but T2_API_KEY not configured | ${scored.activityType}`);
    await register.updateVerdict(callId, 'HOLD');
    return withVerdict(_startTime, {
      status: 'HOLD', proceed: false, tier,
      reviewRequired: true,
      riskScore: scored.riskScore, triggerReason: scored.triggerReason,
      activityType: scored.activityType, callId,
      vela: null, options: null, recommended: null,
      reason: `Score ${scored.riskScore}/25 reached T${tier} threshold. Dual LLM required for high-risk assessment. Configure T2_PROVIDER and T2_API_KEY in ~/.radar/.env to enable T3/T4 review, or set T3_T4_REQUIRE_LLM2=false to keep v0.3.x single-LLM behavior, or set this activity's slider to permissive if intentional.`,
      promptMode: null, t2Attempted: false,
      wouldEscalate, escalateTier,
      parseFailed: false, policyDecision: 'llm2_required',
      radarEnabled: true,
      holdAction, notifyUrl
    });
  }

  // === VELA LITE ===
  // Dispatch:
  //   tier >= 3 AND has t2Key → v0.4 dual-LLM review (LLM1 tldr, then LLM2 review)
  //   tier <= 2 OR no t2Key → existing single-LLM path (preserves v0.3.x behavior)
  const useT3T4Review = tier >= 3 && effectiveConfig.t2Key;
  try {
    let vela, llm1Tldr;

    if (useT3T4Review) {
      // Step 1: LLM1 produces T2-shaped tldr assessment (uses primary llmKey).
      // We force tldr mode here regardless of the threshold-based promptMode
      // because LLM2's review prompt expects four strategy options as input.
      const llm1Config = { ...effectiveConfig, t2Provider: null, t2Key: null };  // Force LLM1 routing
      // LLM1 produces a T2-shaped tldr assessment that feeds LLM2's review.
      // LLM1's formatted string is discarded (only .recommended and .options are
      // consumed downstream), so we pin its label to T2 rather than surfacing
      // the real tier in a string that never reaches the caller.
      llm1Tldr = await assessVela(
        action, scored.activityType, scored.riskScore, scored.triggerReason,
        sliderPosition, 'tldr', llm1Config, priorDecision, 2
      );

      // Step 2: LLM2 reviews LLM1's output (routes to t2Provider/t2Key — segregation of duties).
      const ctx = {
        activityType: scored.activityType,
        riskScore: scored.riskScore,
        triggerReason: scored.triggerReason,
        tier
      };
      const opCfg = {
        sliderPosition,
        holdAction,
        requiresHumanReview: false,  // would have short-circuited earlier
        denyAtTier: activityConfig?.deny_at_tier ?? null,
        matchedPolicies: 'none',
        // v0.4 Phase B wire: feed operator-uploaded policy into LLM2's review prompt
        // when policy_enabled. Drafts saved-but-not-enabled are intentionally skipped
        // so operators can park work-in-progress policies without affecting assessments.
        policyContent: activityConfig?.policy_enabled ? (activityConfig?.policy_content ?? null) : null
      };
      const llm1Out = {
        recommended: llm1Tldr.recommended,
        reasoning: scored.triggerReason,
        options: llm1Tldr.options || {}
      };

      vela = await assessVelaT3T4Review(action, ctx, opCfg, llm1Out, effectiveConfig, priorDecision);
      log('info', `${vela.formatted}`);
    } else {
      // v0.4.2 tier-label fix: pass the actual tier so single-LLM T3/T4
      // assessments emit "VELA LITE (T3)" / "(T4)" instead of always echoing
      // "VELA LITE (T2)". result.vela and dashboard logs now agree with .tier.
      vela = await assessVela(
        action, scored.activityType, scored.riskScore, scored.triggerReason,
        sliderPosition, promptMode, effectiveConfig, priorDecision, tier
      );
      log('info', vela.formatted);
    }

    // T1: always PROCEED. T2/T3/T4: always HOLD (LLM2 cannot escalate to DENY).
    const status = tier === 1 ? 'PROCEED' : 'HOLD';

    // Update verdict + persist new T3/T4 fields (llm1_recommended, llm2_recommended, agreement)
    if (useT3T4Review) {
      await register.updateVerdict(callId, status);
      // Note: register.updateVerdict only updates verdict. Save-time persisted llm1/llm2/
      // agreement requires a richer update. For now, the audit trail in `result.review`
      // is returned to the caller; SQLite-side persistence of these fields is added in a
      // future patch when the dashboard surfaces them.
    } else {
      await register.updateVerdict(callId, status);
    }

    const result = {
      status, proceed: status === 'PROCEED', tier,
      reviewRequired: status === 'HOLD',
      riskScore: scored.riskScore, triggerReason: scored.triggerReason,
      activityType: scored.activityType, callId,
      vela: vela.formatted, options: vela.options, recommended: vela.recommended,
      promptMode: useT3T4Review ? 't3_t4_review' : promptMode,
      t2Attempted: true,
      wouldEscalate, escalateTier,
      parseFailed: vela.parseFailed, policyDecision: 'assess',
      radarEnabled: true
    };

    // v0.4: T3/T4 review adds three new return fields
    if (useT3T4Review) {
      result.review = vela.review;
      result.scopeHygiene = vela.scopeHygiene;
      result.riskBenefit = vela.riskBenefit;
    }

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

// v0.5.0 B1 — post-execution observation. Attach what actually happened to a
// prior assess() call. Additive audit; never blocks. See src/complete.js.
export async function complete(callId, outcome = {}) {
  return recordComplete(callId, outcome);
}

// v0.5.0 B1 — assess + run + complete in one call.
// Safety-critical contract: workFn runs ONLY on PROCEED. On HOLD/DENY the work
// is NOT executed — the assessment is returned for the caller to handle.
// On PROCEED: a normal return → 'succeeded' (return value merged into metrics),
// an Error throw → 'failed' (message in diff_notes), a non-Error throw → 'aborted'.
// Errors are captured, not re-thrown, so the outcome is always recorded.
export async function assessAndTrack(action, activityType, workFn, options = {}) {
  const assessment = await assess(action, activityType, options);

  if (assessment.status !== 'PROCEED') {
    return { assessment, ran: false, outcome: null, result: null, completion: null };
  }

  let outcome;
  let result = null;
  let error;
  try {
    result = await workFn();
    outcome = 'succeeded';
  } catch (err) {
    if (err instanceof Error) {
      outcome = 'failed';
      error = err.message;
    } else {
      outcome = 'aborted';
      error = String(err);
    }
  }

  // On success, surface the return value as metrics (objects as-is, scalars wrapped).
  let metrics = null;
  if (outcome === 'succeeded') {
    if (result && typeof result === 'object') metrics = result;
    else if (result !== undefined && result !== null) metrics = { value: result };
  }

  const completion = await complete(assessment.callId, {
    outcome,
    diff_notes: error,               // undefined on success → persisted as null
    metrics,
    reported_by_agent: options.agentId ?? null
  });

  const out = {
    assessment,
    ran: true,
    outcome,
    result: outcome === 'succeeded' ? result : null,
    completion
  };
  if (error !== undefined) out.error = error;
  return out;
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
  configure, assess, strategy, complete, assessAndTrack, history, stats,
  checkPolicy, saveActivityConfig, savePolicy, reload, clear
};

export { VelaLite };

export default radar;
