import radar from '../src/index.js';

radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic',
  activities: { email: 0.7, financial: 0.9, external_api: 0.3 }
});

// Oneliner mode — low risk, Vela Lite returns one-liner
console.log('\n--- ONELINER MODE (T1) ---');
const t1 = await radar.assess('Check weather API for forecast data', 'external_api');
console.log('Result:', JSON.stringify(t1, null, 2));

// TL;DR mode — high risk, Vela Lite returns full assessment
console.log('\n--- TLDR MODE (T2) ---');
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
