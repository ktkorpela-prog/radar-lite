import { callLLM, DEFAULT_PROVIDER } from './providers.js';
import { HOLD_STRATEGIES, T1_LABEL, T2_LABEL } from './constants.js';

export const VelaLite = {
  profile: Object.freeze({
    name: "Vela Lite",
    version: "1.0.0",
    role: "Local risk advisor — T1/T2 assessment",
    by: "EssentianLabs",
    note: "Vela Lite is a lightweight version of Vela, the EssentianLabs Risk Management Essentian. Her full intelligence is available on the paid tier at radar.essentianlabs.com"
  })
};

// Only HOLD_STRATEGIES are valid as Vela-offered options on a HOLD verdict.
// override_deny is excluded — it is a DENY override mechanism, not a HOLD strategy.
const HOLD_STRATEGIES_UPPER = HOLD_STRATEGIES.map(s => s.toUpperCase());
// Permissive regex captures any label (including OVERRIDE_DENY hallucinations) — whitelist applied after parse.
const STRATEGIES_REGEX = /^→\s*([A-Z_]+):\s*(.+)/i;

// Normalise a label for whitelist comparison: lowercase + strip non-alphanumeric.
// Catches: OVERRIDE_DENY, override-deny, "Override Deny", OVERRIDEDENY → "overridedeny"
//          AVOID, "Avoid", avoid → "avoid"
function normaliseLabel(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HOLD_STRATEGIES_NORMALISED = new Set(HOLD_STRATEGIES.map(normaliseLabel));

function buildOnelinerPrompt(priorDecision) {
  let priorLine = '';
  if (priorDecision) {
    priorLine = `\nPrior decision for this action: ${priorDecision.verdict}${priorDecision.outcome ? ' (' + priorDecision.outcome + ')' : ''}. Factor this into your verdict.`;
  }

  return `You are Vela Lite — a local risk advisor for AI agent actions.
You are assessing an action — what the agent intends to do — not content it has produced. If the input appears to be content rather than an action description, return HOLD and note the issue.
Your assessment is bounded by the action description provided. You cannot verify what the agent actually executes — assess what you are told, and flag gaps explicitly rather than assuming them away.
Return ONLY one line in this exact format, nothing else:
${T1_LABEL} | PROCEED | {one specific trigger reason} | {activityType} | score {n}
This is a T1 low-risk assessment. Your verdict is PROCEED.
Base your trigger reason on the risk score and context provided.${priorLine}
No other text. No explanation.`;
}

function buildTldrPrompt(sliderPosition, priorDecision) {
  const strategyLines = HOLD_STRATEGIES_UPPER
    .map(s => `→ ${s}:     {one concrete action, max 12 words}{recommended_marker}`)
    .join('\n');

  let priorSection = '';
  if (priorDecision) {
    priorSection = `\nPrior decision: ${priorDecision.verdict}${priorDecision.outcome ? ' — outcome: ' + priorDecision.outcome : ''}${priorDecision.notes ? ' — ' + priorDecision.notes : ''}. Factor this into your verdict and options.`;
  }

  return `You are Vela Lite — a local risk advisor for AI agent actions.
You are assessing an action — what the agent intends to do — not content it has produced. If the input appears to be content rather than an action description, return HOLD and note the issue.
Your assessment is bounded by the action description provided. You cannot verify what the agent actually executes — assess what you are told, and flag gaps explicitly rather than assuming them away.
Give a fast, actionable risk response. No lengthy analysis. No regulatory citations.

Risk appetite slider: ${sliderPosition} (0.0 = permissive, 0.5 = balanced, 1.0 = conservative)

Strategy definitions — use these EXACTLY four. Do not invent additional strategies.
AVOID = do not take this action at all — block it entirely
MITIGATE = take the action but add specific controls to reduce risk
TRANSFER = delegate the risk to a third party (vendor, legal, compliance)
ACCEPT = proceed as-is, document the decision and accept accountability

The four strategies above are the complete taxonomy for a HOLD verdict. Output exactly four option lines — one for each. Do not output a fifth option under any label.

Return ONLY this exact format, nothing else:

${T2_LABEL} | {activityType} | score {score}

HOLD — {one sentence recommendation, max 12 words}

${strategyLines}

— Vela Lite · EssentianLabs

Rules:
- The rules engine already determined this action exceeds the review threshold. This action requires review.
- Your verdict is always HOLD. T2 actions do not PROCEED — they are held for human or system review.
- Your job is to recommend the best strategy (AVOID, MITIGATE, TRANSFER, or ACCEPT), not to decide whether to proceed.
- Mark only ONE option with " (recommended)" inline
- Each option must be specific to this action — no generic advice
- No extra text before or after the format above${priorSection}`;
}

function buildUserMessage(action, activityType, riskScore, triggerReason, sliderPosition) {
  return `Action: ${action}
Activity: ${activityType}
Score: ${riskScore}
Trigger: ${triggerReason}
Slider: ${sliderPosition}`;
}

function parseOnelinerResponse(raw) {
  const line = raw.trim().split('\n')[0].trim();

  let verdict = null;
  let parseFailed = false;

  if (line.includes('PROCEED')) verdict = 'PROCEED';
  if (line.includes('HOLD')) verdict = 'HOLD';

  if (verdict === null) {
    console.warn('⚠ RADAR: Vela Lite oneliner response did not contain PROCEED or HOLD — defaulting to HOLD');
    verdict = 'HOLD';
    parseFailed = true;
  }

  return {
    formatted: line,
    verdict,
    recommended: null,
    options: null,
    parseFailed
  };
}

function parseTldrResponse(raw) {
  const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean);

  let verdict = null;
  let recommended = null;
  let parseFailed = false;
  const options = {};
  const droppedLabels = [];

  for (const line of lines) {
    if (line.startsWith('PROCEED')) verdict = 'PROCEED';
    if (line.startsWith('HOLD')) verdict = 'HOLD';

    const optionMatch = line.match(STRATEGIES_REGEX);
    if (optionMatch) {
      const rawLabel = optionMatch[1];
      const normalised = normaliseLabel(rawLabel);
      const lineHasRecommendedMarker = optionMatch[2].includes('(recommended)');

      // Whitelist: drop any option whose label is not in HOLD_STRATEGIES.
      // This catches OVERRIDE_DENY, override-deny, "Override Deny", OVERRIDEDENY,
      // and any other label the LLM hallucinates. Load-bearing — the prompt is helpful
      // but probabilistic; the whitelist is the contract.
      if (!HOLD_STRATEGIES_NORMALISED.has(normalised)) {
        droppedLabels.push(rawLabel);
        // If (recommended) marker was on a dropped line, mark it so fallback knows
        // to pick a valid option rather than leaving recommended null.
        if (lineHasRecommendedMarker) recommended = '__dropped_recommended__';
        continue;
      }

      const key = normalised;
      let value = optionMatch[2].trim();
      if (lineHasRecommendedMarker) {
        recommended = key;
        value = value.replace(/\s*\(recommended\)\s*/i, '').trim();
      }
      options[key] = value;
    }
  }

  if (droppedLabels.length > 0) {
    // Verbose-only — never returned to caller. M7 sanitisation pattern.
    console.warn(`[radar-lite verbose] Dropped ${droppedLabels.length} non-whitelist option label(s) from Vela response: ${droppedLabels.join(', ')}`);
  }

  // Fallback: if recommended is invalid (or was OVERRIDE_DENY before normalisation,
  // or the (recommended) marker was on a dropped line), pick first valid option in
  // the array, or 'mitigate' as last resort.
  if (recommended !== null && !HOLD_STRATEGIES_NORMALISED.has(recommended)) {
    const before = recommended;
    const validKeys = Object.keys(options);
    recommended = validKeys.length > 0 ? validKeys[0] : 'mitigate';
    console.warn(`[radar-lite verbose] Vela recommended invalid strategy "${before}" — fallback to "${recommended}"`);
  }

  // If options object is empty entirely and we have a HOLD verdict, fallback to mitigate
  // so the calling agent gets a usable verdict.
  if (verdict === 'HOLD' && Object.keys(options).length === 0 && recommended === null) {
    recommended = 'mitigate';
    console.warn(`[radar-lite verbose] Vela returned no valid HOLD options — fallback recommended=mitigate`);
  }

  if (verdict === null) {
    console.warn('⚠ RADAR: Vela Lite LLM response did not contain PROCEED or HOLD — defaulting to HOLD');
    verdict = 'HOLD';
    parseFailed = true;
  }

  return {
    formatted: raw.trim(),
    verdict,
    recommended,
    options,
    parseFailed
  };
}

// Exposed for test access only — not part of the public API.
export const _testInternals = { parseTldrResponse, normaliseLabel, HOLD_STRATEGIES_NORMALISED };

export async function assessVela(action, activityType, riskScore, triggerReason, sliderPosition, mode, config, priorDecision = null) {
  const systemPrompt = mode === 'oneliner'
    ? buildOnelinerPrompt(priorDecision)
    : buildTldrPrompt(sliderPosition, priorDecision);

  const userMessage = buildUserMessage(action, activityType, riskScore, triggerReason, sliderPosition);

  // Determine provider and model tier based on mode
  // T1 (oneliner): use primary provider with fast model
  // T2 (tldr): use t2Provider (if configured) with reasoning model
  const provider = mode === 'tldr' && config.t2Provider
    ? config.t2Provider
    : (config.llmProvider || DEFAULT_PROVIDER);
  const apiKey = mode === 'tldr' && config.t2Key
    ? config.t2Key
    : config.llmKey;
  const modelTier = mode === 'tldr' ? 'reasoning' : 'fast';

  const raw = await callLLM(provider, systemPrompt, userMessage, apiKey, modelTier);

  return mode === 'oneliner'
    ? parseOnelinerResponse(raw)
    : parseTldrResponse(raw);
}
