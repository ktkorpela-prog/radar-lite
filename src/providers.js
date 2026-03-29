import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const DEFAULT_PROVIDER = 'anthropic';

const MODELS = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', reasoning: 'claude-sonnet-4-6-20250514' },
  openai:    { fast: 'gpt-4o-mini',               reasoning: 'gpt-4o' },
  google:    { fast: 'gemini-2.0-flash',           reasoning: 'gemini-2.0-pro' }
};

export function getModelName(provider, tier) {
  const models = MODELS[provider];
  if (!models) return null;
  return tier === 'reasoning' ? models.reasoning : models.fast;
}

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
