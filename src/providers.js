import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const DEFAULT_PROVIDER = 'anthropic';

// v0.4.1: model names are resolved on every call, so operators can override
// a stale default via ~/.radar/.env (or process.env) without waiting for a
// package publish. Env-var pattern: RADAR_<PROVIDER>_<TIER>_MODEL.
// Example: RADAR_GOOGLE_FAST_MODEL=gemini-3.5-flash-latest
//
// Baked-in defaults, verified 2026-06-24:
//   anthropic — current stable per Anthropic
//   openai    — 4o family (stable). Set RADAR_OPENAI_REASONING_MODEL=o4-mini
//               to opt in to the o-series reasoning tier.
//   google    — gemini-3.5-flash is Google's current stable. gemini-3.1-pro-preview
//               is Google's current pro tier (preview; no stable pro at this cut).
//               gemini-2.0-* was deprecated by Google before this release —
//               operators pinning 2.x will get 404s from the vendor.
const DEFAULT_MODELS = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', reasoning: 'claude-sonnet-4-6' },
  openai:    { fast: 'gpt-4o-mini',               reasoning: 'gpt-4o' },
  google:    { fast: 'gemini-3.5-flash',          reasoning: 'gemini-3.1-pro-preview' }
};

// Env-var override key for (provider, tier) — reads on every call so
// radar.reload() picks up ~/.radar/.env edits without a process restart.
function envVarKey(provider, tier) {
  return `RADAR_${provider.toUpperCase()}_${tier.toUpperCase()}_MODEL`;
}

export function getModelName(provider, tier) {
  const defaults = DEFAULT_MODELS[provider];
  if (!defaults) return null;
  const resolvedTier = tier === 'reasoning' ? 'reasoning' : 'fast';
  const override = process.env[envVarKey(provider, resolvedTier)];
  return override || defaults[resolvedTier];
}

// Exposed for tests + operator introspection. Callers should not depend on
// this for wiring — always route through getModelName so env-var overrides
// are honoured.
export const _defaults = DEFAULT_MODELS;
export { envVarKey as _envVarKey };

export async function callAnthropic(systemPrompt, userMessage, apiKey, modelTier = 'fast') {
  const model = getModelName('anthropic', modelTier);
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });
  return response.content[0].text;
}

export async function callOpenAI(systemPrompt, userMessage, apiKey, modelTier = 'fast') {
  const model = getModelName('openai', modelTier);
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model,
    max_tokens: 400,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]
  });
  return response.choices[0].message.content;
}

export async function callGoogle(systemPrompt, userMessage, apiKey, modelTier = 'fast') {
  const model = getModelName('google', modelTier);
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai'
  });
  const response = await client.chat.completions.create({
    model,
    max_tokens: 400,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]
  });
  return response.choices[0].message.content;
}

const providers = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  google: callGoogle
};

export async function callLLM(provider, systemPrompt, userMessage, apiKey, modelTier = 'fast') {
  const fn = providers[provider];
  if (!fn) throw new Error(`Unknown LLM provider: ${provider}`);
  return fn(systemPrompt, userMessage, apiKey, modelTier);
}
