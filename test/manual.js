import radar from '../src/index.js';

// === v0.3 MANUAL TEST ===
// Run with: ANTHROPIC_API_KEY=... node test/manual.js

const hasKey = !!process.env.ANTHROPIC_API_KEY;
console.log('\n=== RADAR Lite v0.3 Manual Test ===');
console.log('LLM key:', hasKey ? 'configured' : 'NOT SET (rules engine only)');

// --- TEST 1: Low risk → PROCEED ---
console.log('\n--- TEST 1: Low risk → expect PROCEED ---');
radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic',
  activities: { external_api_call: 0.5 }
});
const t1 = await radar.assess('Read internal config file from local disk', 'external_api_call');
console.log('status:', t1.status, 'proceed:', t1.proceed, 'reviewRequired:', t1.reviewRequired);
console.log('tier:', t1.tier, 'score:', t1.riskScore, 'mode:', t1.promptMode);
console.log('vela:', t1.vela);
console.log('RESULT:', t1.status === 'PROCEED' && t1.proceed === true && t1.reviewRequired === false ? 'PASS' : 'FAIL');

// --- TEST 2: Moderate risk → HOLD ---
console.log('\n--- TEST 2: Moderate risk → expect HOLD ---');
radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic',
  activities: { email_bulk: 0.7 }
});
const t2 = await radar.assess('Send price increase email to 50,000 users', 'email_bulk');
console.log('status:', t2.status, 'proceed:', t2.proceed, 'reviewRequired:', t2.reviewRequired);
console.log('tier:', t2.tier, 'score:', t2.riskScore, 'holdAction:', t2.holdAction);
console.log('options:', JSON.stringify(t2.options));
console.log('recommended:', t2.recommended);
console.log('vela:', t2.vela);
console.log('RESULT:', t2.status === 'HOLD' && t2.proceed === false && t2.reviewRequired === true && t2.options !== null ? 'PASS' : 'FAIL');

// --- TEST 3: Extreme risk → DENY ---
console.log('\n--- TEST 3: Score 20+ with irreversibility → expect DENY ---');
radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic',
  activities: { data_delete_bulk: 0.9 }
});
const t3 = await radar.assess('Delete all credit card payment records for everyone permanently', 'data_delete_bulk');
console.log('status:', t3.status, 'proceed:', t3.proceed, 'reviewRequired:', t3.reviewRequired);
console.log('score:', t3.riskScore, 'reason:', t3.reason);
console.log('options:', t3.options, 'holdAction:', t3.holdAction);
console.log('RESULT:', t3.status === 'DENY' && t3.proceed === false && t3.options === null ? 'PASS' : 'FAIL');

// --- TEST 4: DENY via policy ---
console.log('\n--- TEST 4: Deny policy → expect DENY ---');
await radar.savePolicy('*drop database*', 'deny');
const t4 = await radar.assess('drop database production', 'system_execute');
console.log('status:', t4.status, 'proceed:', t4.proceed, 'policyDecision:', t4.policyDecision);
console.log('reason:', t4.reason);
console.log('RESULT:', t4.status === 'DENY' && t4.policyDecision === 'deny' ? 'PASS' : 'FAIL');

// --- TEST 5: Override DENY ---
console.log('\n--- TEST 5: Override DENY ---');
try {
  const strat = await radar.strategy(t4.callId, 'override_deny', {
    reason: 'Approved by CTO — test environment confirmed',
    decidedBy: 'admin@essentianlabs.com'
  });
  console.log('override:', strat.success, 'strategy:', strat.chosenStrategy);
  console.log('RESULT:', strat.success ? 'PASS' : 'FAIL');
} catch (e) {
  console.log('RESULT: FAIL —', e.message);
}

// --- TEST 6: Backward compatibility ---
console.log('\n--- TEST 6: Backward compatibility (old API) ---');
radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic',
  activities: { web_search: 0.3, financial: 0.9 }
});

// Old code: if (!result.proceed) { ... }
const bc1 = await radar.assess('Search for weather', 'web_search');
const bc2 = await radar.assess('Transfer funds to vendor', 'financial');
const bc3 = t3; // reuse DENY result

console.log('PROCEED → proceed:', bc1.proceed, '(expect true)');
console.log('HOLD → proceed:', bc2.proceed, '(expect false)');
console.log('DENY → proceed:', bc3.proceed, '(expect false)');
console.log('PROCEED → verdict:', bc1.verdict || bc1.status);
console.log('HOLD → verdict:', bc2.verdict || bc2.status);
console.log('DENY → verdict:', bc3.verdict || bc3.status);

const bcPass = bc1.proceed === true && bc2.proceed === false && bc3.proceed === false;
console.log('RESULT:', bcPass ? 'PASS — old API still works' : 'FAIL');

// --- SUMMARY ---
console.log('\n=== SUMMARY ===');
console.log('Test 1 (PROCEED):', t1.status === 'PROCEED' ? 'PASS' : 'FAIL');
console.log('Test 2 (HOLD):', t2.status === 'HOLD' ? 'PASS' : 'FAIL');
console.log('Test 3 (DENY score):', t3.status === 'DENY' ? 'PASS' : 'FAIL');
console.log('Test 4 (DENY policy):', t4.status === 'DENY' ? 'PASS' : 'FAIL');
console.log('Test 5 (override):', 'see above');
console.log('Test 6 (backward compat):', bcPass ? 'PASS' : 'FAIL');
