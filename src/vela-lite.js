import { callLLM, DEFAULT_PROVIDER } from './providers.js';
import { VALID_STRATEGIES } from './constants.js';

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

function buildSystemPrompt(sliderPosition) {
  const strategyLines = STRATEGIES_UPPER
    .map(s => `→ ${s}:     {one concrete action, max 12 words}{recommended_marker}`)
    .join('\n');

  return `You are Vela Lite — a local risk advisor for AI agent actions.
Give a fast, actionable risk response. No lengthy analysis. No regulatory citations.

Risk appetite slider: ${sliderPosition} (0.0 = permissive, 0.5 = balanced, 1.0 = conservative)

Return ONLY this exact format, nothing else:

VELA LITE (T2) | {activityType} | score {score}

{PROCEED or HOLD} — {one sentence recommendation, max 12 words}

${strategyLines}

— Vela Lite · EssentianLabs

Rules:
- Mark only ONE option with " (recommended)" inline
- Each option must be specific to this action — no generic advice
- No extra text before or after the format above`;
}

function buildUserMessage(action, activityType, riskScore, triggerReason, sliderPosition) {
  return `Action: ${action}
Activity: ${activityType}
Score: ${riskScore}
Trigger: ${triggerReason}
Slider: ${sliderPosition}`;
}

function parseVelaResponse(raw) {
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

export async function assessT2(action, activityType, riskScore, triggerReason, sliderPosition, config) {
  const systemPrompt = buildSystemPrompt(sliderPosition);
  const userMessage = buildUserMessage(action, activityType, riskScore, triggerReason, sliderPosition);

  const raw = await callLLM(
    config.llmProvider || DEFAULT_PROVIDER,
    systemPrompt,
    userMessage,
    config.llmKey
  );

  return parseVelaResponse(raw);
}
