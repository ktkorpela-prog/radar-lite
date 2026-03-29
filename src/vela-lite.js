import { callLLM, DEFAULT_PROVIDER } from './providers.js';
import { VALID_STRATEGIES, T1_LABEL, T2_LABEL } from './constants.js';

export const VelaLite = {
  profile: Object.freeze({
    name: "Vela Lite",
    version: "1.0.0",
    role: "Local risk advisor — T1/T2 assessment",
    by: "EssentianLabs",
    note: "Vela Lite is a lightweight version of Vela, the EssentianLabs Risk Management Essentian. Her full intelligence is available on the paid tier at radar.essentianlabs.com"
  })
};

const STRATEGIES_UPPER = VALID_STRATEGIES.map(s => s.toUpperCase());
const STRATEGIES_REGEX = new RegExp(`^→\\s*(${STRATEGIES_UPPER.join('|')}):\\s*(.+)`, 'i');

function buildOnelinerPrompt(priorDecision) {
  let priorLine = '';
  if (priorDecision) {
    priorLine = `\nPrior decision for this action: ${priorDecision.verdict}${priorDecision.outcome ? ' (' + priorDecision.outcome + ')' : ''}. Factor this into your verdict.`;
  }

  return `You are Vela Lite — a local risk advisor for AI agent actions.
You are assessing an action — what the agent intends to do — not content it has produced. If the input appears to be content rather than an action description, return HOLD and note the issue.
Your assessment is bounded by the action description provided. You cannot verify what the agent actually executes — assess what you are told, and flag gaps explicitly rather than assuming them away.
Return ONLY one line in this exact format, nothing else:
${T1_LABEL} | PROCEED or HOLD | {one specific trigger reason} | {activityType} | score {n}
Base your verdict on the risk score and trigger reason provided.
HOLD if riskScore >= 8, or if the action is irreversible, affects many people, or has meaningful consequence if wrong.
PROCEED if the action is routine, reversible, low consequence, or internal only.${priorLine}
No other text. No explanation.`;
}

function buildTldrPrompt(sliderPosition, priorDecision) {
  const strategyLines = STRATEGIES_UPPER
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

Strategy definitions — use these exactly:
AVOID = do not take this action at all — block it entirely
MITIGATE = take the action but add specific controls to reduce risk
TRANSFER = delegate the risk to a third party (vendor, legal, compliance)
ACCEPT = proceed as-is, document the decision and accept accountability

Return ONLY this exact format, nothing else:

${T2_LABEL} | {activityType} | score {score}

{PROCEED or HOLD} — {one sentence recommendation, max 12 words}

${strategyLines}

— Vela Lite · EssentianLabs

Rules:
- The rules engine already determined this action exceeds the review threshold.
- If evidence is genuinely ambiguous and you cannot resolve it, err toward HOLD. Name the specific uncertainty in your verdict. Do not default to HOLD as a habit — apply it only when the ambiguity is genuinely unresolvable.
- A PROCEED at T2 must be explicitly justified by low consequence or high reversibility.
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

  for (const line of lines) {
    if (line.startsWith('PROCEED')) verdict = 'PROCEED';
    if (line.startsWith('HOLD')) verdict = 'HOLD';

    const optionMatch = line.match(STRATEGIES_REGEX);
    if (optionMatch) {
      const key = optionMatch[1].toLowerCase();
      let value = optionMatch[2].trim();
      if (value.includes('(recommended)')) {
        recommended = key;
        value = value.replace(/\s*\(recommended\)\s*/i, '').trim();
      }
      options[key] = value;
    }
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
