import radar from '../src/index.js';

// --- Oneliner test — low risk internal action ---
console.log('\n--- ONELINER MODE (T1) ---');
radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic',
  activities: { external_api_call: 0.5 }
});
const t1 = await radar.assess(
  'Read internal config file from local disk',
  'external_api_call'
);
console.log('Result:', JSON.stringify(t1, null, 2));

// --- TL;DR test — high risk bulk email ---
console.log('\n--- TLDR MODE (T2) ---');
radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic',
  activities: { email_bulk: 0.7, financial: 0.9, system_execute: 0.8 }
});
const t2 = await radar.assess(
  'Send price increase email to 50,000 users',
  'email_bulk'
);
console.log('Result:', JSON.stringify(t2, null, 2));

// --- Deprecated type test ---
console.log('\n--- DEPRECATED TYPE ---');
const dep = await radar.assess('Send notification', 'email');
console.log('Resolved to:', dep.activityType, 'policyDecision:', dep.policyDecision);

// --- Policy test ---
console.log('\n--- POLICY: human_required ---');
await radar.savePolicy('*deploy*', 'human_required');
const pol = await radar.assess('deploy to production', 'system_execute');
console.log('Policy result:', JSON.stringify(pol, null, 2));

// --- Human review toggle ---
console.log('\n--- HUMAN REVIEW TOGGLE ---');
await radar.saveActivityConfig('financial', { requiresHumanReview: true });
const hr = await radar.assess('Process refund', 'financial');
console.log('Human review result:', JSON.stringify(hr, null, 2));

// Strategy recording
if (t2.callId && t2.options) {
  console.log('\n--- STRATEGY TEST ---');
  const strat = await radar.strategy(t2.callId, 'mitigate', {
    justification: 'staged rollout approved',
    decidedBy: 'human',
    velaRecommended: t2.recommended
  });
  console.log('Strategy result:', strat);
}

// Stats
console.log('\n--- STATS ---');
console.log('Stats:', await radar.stats());
