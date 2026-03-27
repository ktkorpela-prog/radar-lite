import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export async function callAnthropic(systemPrompt, userMessage, apiKey) {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });
  return response.content[0].text;
}

export async function callOpenAI(systemPrompt, userMessage, apiKey) {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 400,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]
  });
  return response.choices[0].message.content;
}

export async function callGoogle(systemPrompt, userMessage, apiKey) {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai'
  });
  const response = await client.chat.completions.create({
    model: 'gemini-2.0-flash',
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

export async function callLLM(provider, systemPrompt, userMessage, apiKey) {
  const fn = providers[provider];
  if (!fn) throw new Error(`Unknown LLM provider: ${provider}`);
  return fn(systemPrompt, userMessage, apiKey);
}
