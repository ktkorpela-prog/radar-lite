import { callLLM } from './providers.js';

export const VelaLite = {
  profile: Object.freeze({
    name: "Vela Lite",
    version: "1.0.0",
    role: "Local risk advisor — T1/T2 assessment",
    by: "EssentianLabs",
    note: "Vela Lite is a lightweight version of Vela, the EssentianLabs Risk Management Essentian. Her full intelligence is available on the paid tier at radar.essentianlabs.com"
  })
};

function getAppetiteLabel(sliderPosition) {
  if (sliderPosition <= 0.3) return 'permissive';
  if (sliderPosition <= 0.6) return 'balanced';
  return 'conservative';
}

function buildSystemPrompt(sliderPosition) {
  const appetite = getAppetiteLabel(sliderPosition);
  return `You are Vela Lite — a local risk advisor for AI agent actions.
Give a fast, actionable risk response. No lengthy analysis. No regulatory citations.

Risk appetite: ${appetite} (${sliderPosition})
- permissive (0.0-0.3): lean toward mitigate or accept
- balanced (0.4-0.6): recommend what is genuinely proportionate
- conservative (0.7-1.0): lean toward avoid or transfer

Return ONLY this exact format, nothing else:

VELA LITE (T2) | {activityType} | score {score}

{PROCEED or HOLD} — {one sentence recommendation, max 12 words}

→ AVOID:     {one concrete action, max 12 words}
→ MITIGATE:  {one concrete action, max 12 words}{recommended_marker}
→ TRANSFER:  {one concrete action, max 12 words}{recommended_marker}
→ ACCEPT:    {one concrete action, max 12 words}{recommended_marker}

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

  let verdict = 'HOLD';
  let recommended = null;
  const options = {};

  for (const line of lines) {
    if (line.startsWith('PROCEED')) verdict = 'PROCEED';
    if (line.startsWith('HOLD')) verdict = 'HOLD';

    const optionMatch = line.match(/^→\s*(AVOID|MITIGATE|TRANSFER|ACCEPT):\s*(.+)/i);
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

  return {
    formatted: raw.trim(),
    verdict,
    recommended,
    options
  };
}

export async function assessT2(action, activityType, riskScore, triggerReason, sliderPosition, config) {
  const systemPrompt = buildSystemPrompt(sliderPosition);
  const userMessage = buildUserMessage(action, activityType, riskScore, triggerReason, sliderPosition);

  const raw = await callLLM(
    config.llmProvider || 'anthropic',
    systemPrompt,
    userMessage,
    config.llmKey
  );

  return parseVelaResponse(raw);
}
