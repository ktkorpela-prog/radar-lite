// experiments/verb-regex-validation.mjs
//
// Validate the proposed v0.4 destructive-verb regex against representative
// action samples. Compares current v0.3.x pattern (which has the camelCase
// word-boundary bug) to the proposed v0.4 pattern (which fixes it).
//
// Output:
// - For each sample: which patterns match
// - Summary: false negatives (current misses), false positives (over-matches)

const CURRENT_IRREVERSIBILITY = /\bdelete\b|\bremove\b|\beirreversible\b/i;

// Proposed v0.4 pattern (stem-based — catches verb + noun forms).
// 1. Standalone stem at word boundary — catches:
//    "delete/deletes/deleted/deletion" via stem "delet"
//    "remove/removed/removal" via stem "remov"
//    "destroy/destroyed/destruction/destructive" via stem "destr"
//    "terminate/terminated/termination" via stem "terminat"
//    etc.
// 2. CamelCase compound (catches "volumeDelete", "dropTable") via lookbehind.
// 3. Includes typo fix: stem "irreversib" replaces 'eirreversible'.
// Note: "revoke/revoked" use stem "revok"; "revocation" uses stem "revoc".
const PROPOSED_IRREVERSIBILITY = /\b(?:delet|remov|drop|destr|terminat|purg|wip|eradicat|revok|revoc|truncat|irreversib)|(?<=\w)(?:delet|remov|drop|destr|terminat|purg|wip|eradicat|revok|revoc|truncat)/i;

// Test cases — split into:
// - destructive: should match (current may miss these)
// - benign: should NOT match (false positive risk)

const DESTRUCTIVE = [
  // Standalone verbs (current matches these — sanity check)
  ['delete the user record', 'standalone "delete"'],
  ['DELETE FROM users WHERE id=42', 'SQL DELETE (uppercase)'],
  ['remove old comments', 'standalone "remove"'],
  ['deletes are processed nightly', 'verb form "deletes"'],
  ['user deletion in progress', 'noun form "deletion"'],
  ['scheduled removal of stale records', 'noun form "removal"'],
  ['fleet termination order issued', 'noun form "termination"'],
  ['data destruction certified by NIST 800-88', 'noun form "destruction"'],
  ['token revocation completed', 'noun form "revocation"'],

  // CamelCase API mutations (current MISSES these — the bug)
  ['curl -X POST -d \'{"query":"mutation { volumeDelete(volumeId: \\"vol-1\\") }"}\'', 'GraphQL volumeDelete'],
  ['call userDelete API endpoint with userId 123', 'camelCase userDelete'],
  ['Run dropTable(\'audit_logs\') in production migration', 'camelCase dropTable'],
  ['terminateInstance(i-abc123) on AWS EC2', 'camelCase terminateInstance'],
  ['cachePurge for staging environment', 'camelCase cachePurge'],
  ['wipeDevice command issued via MDM', 'camelCase wipeDevice'],
  ['revokeToken on session 5f2a', 'camelCase revokeToken'],
  ['truncateTable on customers in production', 'camelCase truncateTable'],
  ['destroyResource called from Terraform', 'camelCase destroyResource'],

  // SQL keywords (current may miss DROP, TRUNCATE)
  ['DROP TABLE customers', 'SQL DROP TABLE'],
  ['TRUNCATE TABLE audit_log', 'SQL TRUNCATE'],

  // Variant verb forms
  ['Force-delete all stale records', 'hyphenated form "Force-delete"'],
  ['removeUserPermissions across all tenants', 'compound camelCase'],
  ['Permanently destroy backups older than 90d', 'standalone "destroy"'],

  // Other destructive verbs (in proposed list)
  ['terminate the contract immediately', 'standalone "terminate"'],
  ['purge all expired tokens', 'standalone "purge"'],
  ['wipe the production environment', 'standalone "wipe"'],
  ['revoke API access for user X', 'standalone "revoke"'],
];

const BENIGN = [
  // Common false-positive risks for "drop"
  ['drop down menu animation', '"drop" in UI context'],
  ['drop us a line at support@', '"drop" in casual phrasing'],
  ['box-shadow with drop effect', '"drop" in CSS context'],
  ['frame rate drop detected', '"drop" in performance context'],

  // Common false-positive risks for "remove"
  ['remove this todo from list', '"remove" in trivial UI'],
  ['remove yourself from this thread', '"remove" in social context'],

  // Common false-positive risks for "kill" (not in proposed list — left out for this reason)
  ['kill the build process', '(intentionally not in list)'],

  // Words that contain destructive verb substrings (should NOT match)
  ['the meeting was obsolete', '"obsolete" — no "delete" substring'],
  ['inventory was depleted', '"depleted" — no "delete" substring'],
  ['compatibility check completed', '"completed" — no "delete" substring'],
  ['address book updated', '"updated" — no destructive verb'],

  // Reset and clear (intentionally not in proposed list)
  ['reset password for user', '"reset" — not in proposed list'],
  ['clear filter in dashboard', '"clear" — not in proposed list'],
  // Words containing verb stems but unrelated meaning
  ['this is reversible', '"reversible" — should not match (irreversib stem)'],
  ['Wipro consulting partnership', '"Wipro" — contains "wip" stem, brand name'],
  ['the package is wrapped securely', '"wrap" — no verb stem (false positive sanity check)'],
];

function testSample(text, desc, expectedMatch) {
  const currentMatch = CURRENT_IRREVERSIBILITY.test(text);
  const proposedMatch = PROPOSED_IRREVERSIBILITY.test(text);
  const ok = (proposedMatch === expectedMatch);
  return { text, desc, currentMatch, proposedMatch, expectedMatch, ok };
}

function runSection(label, samples, expectedMatch) {
  console.log(`\n=== ${label} (expected: ${expectedMatch ? 'MATCH' : 'NO MATCH'}) ===\n`);
  const results = samples.map(([text, desc]) => testSample(text, desc, expectedMatch));

  // Header
  console.log('cur  prop  desc');
  console.log('---  ----  ----');
  for (const r of results) {
    const cur = r.currentMatch ? ' ✓ ' : ' . ';
    const prop = r.proposedMatch ? ' ✓ ' : ' . ';
    const flag = r.ok ? '   ' : ' ⚠ ';
    console.log(`${cur}  ${prop} ${flag}${r.desc}`);
  }

  return results;
}

console.log('='.repeat(72));
console.log('v0.4 destructive verb regex validation');
console.log('='.repeat(72));
console.log('');
console.log('Current pattern (v0.3.x):');
console.log(`  ${CURRENT_IRREVERSIBILITY}`);
console.log('');
console.log('Proposed pattern (v0.4):');
console.log(`  ${PROPOSED_IRREVERSIBILITY}`);
console.log('');
console.log('Verbs included in proposed list:');
console.log('  delete, remove, drop, destroy, terminate, purge, wipe,');
console.log('  eradicate, revoke, truncate, irreversible');

const destructiveResults = runSection('DESTRUCTIVE actions', DESTRUCTIVE, true);
const benignResults = runSection('BENIGN actions', BENIGN, false);

// Summary
console.log('\n' + '='.repeat(72));
console.log('Summary');
console.log('='.repeat(72));

const currentDestructiveHits = destructiveResults.filter(r => r.currentMatch).length;
const proposedDestructiveHits = destructiveResults.filter(r => r.proposedMatch).length;
const currentBenignHits = benignResults.filter(r => r.currentMatch).length;
const proposedBenignHits = benignResults.filter(r => r.proposedMatch).length;

console.log(`Destructive actions caught:`);
console.log(`  Current (v0.3.x):  ${currentDestructiveHits} / ${destructiveResults.length}`);
console.log(`  Proposed (v0.4):   ${proposedDestructiveHits} / ${destructiveResults.length}`);
console.log(`  False negatives FIXED: ${proposedDestructiveHits - currentDestructiveHits}`);
console.log('');
console.log(`Benign actions over-matched (false positives):`);
console.log(`  Current (v0.3.x):  ${currentBenignHits} / ${benignResults.length}`);
console.log(`  Proposed (v0.4):   ${proposedBenignHits} / ${benignResults.length}`);
console.log('');

// Critical missed cases
const stillMissed = destructiveResults.filter(r => !r.proposedMatch);
if (stillMissed.length > 0) {
  console.log(`⚠ Destructive actions still NOT matched by proposed pattern:`);
  for (const r of stillMissed) {
    console.log(`   - ${r.desc}: "${r.text}"`);
  }
  console.log('');
}

const newFalsePositives = benignResults.filter(r => r.proposedMatch && !r.currentMatch);
if (newFalsePositives.length > 0) {
  console.log(`⚠ NEW false positives introduced by proposed pattern (not in v0.3.x):`);
  for (const r of newFalsePositives) {
    console.log(`   - ${r.desc}: "${r.text}"`);
  }
  console.log('');
}

const allFalsePositives = benignResults.filter(r => r.proposedMatch);
if (allFalsePositives.length > 0) {
  console.log(`Note: total false positives in proposed pattern (acceptable trade-offs):`);
  for (const r of allFalsePositives) {
    console.log(`   - ${r.desc}: "${r.text}"`);
  }
  console.log('');
}

console.log('Decision criteria:');
console.log('  ✓ Recommend ship if: false negatives substantially reduced AND new false positives are tolerable');
console.log('  ✗ Reject if: any DESTRUCTIVE case still unmatched, OR new FPs are catastrophic');
