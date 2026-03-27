import radar from '../src/index.js';

// --- Oneliner test — low risk internal action ---
console.log('\n--- ONELINER MODE (T1) ---');
radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic',
  activities: { external_api: 0.5 }
});
const t1 = await radar.assess(
  'Read internal config file from local disk',
  'external_api'
);
// This should score low — "internal" is a decrease signal
console.log('Result:', JSON.stringify(t1, null, 2));

// --- TL;DR test — high risk email ---
console.log('\n--- TLDR MODE (T2) ---');
radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic',
  activities: { email: 0.7, financial: 0.9 }
});
const t2 = await radar.assess(
  'Send price increase email to 50,000 users',
  'email'
);
console.log('Result:', JSON.stringify(t2, null, 2));

// Strategy recording
if (t2.callId) {
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

// History
console.log('\n--- HISTORY ---');
console.log('History:', await radar.history(5));
