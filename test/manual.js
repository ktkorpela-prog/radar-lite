import radar from '../src/index.js';

radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic',
  activities: { email: 0.7, financial: 0.9 }
});

// T1 test — should route to T1, no LLM needed
console.log('\n--- T1 TEST ---');
const t1 = await radar.assess('Send internal test email to 5 people', 'email');
console.log('T1 result:', JSON.stringify(t1, null, 2));

// T2 test — should route to T2, LLM call
console.log('\n--- T2 TEST ---');
const t2 = await radar.assess(
  'Send price increase email to 50,000 users',
  'email'
);
console.log('T2 result:', JSON.stringify(t2, null, 2));

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
