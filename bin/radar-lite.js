#!/usr/bin/env node

import { VelaLite } from '../src/vela-lite.js';

const command = process.argv[2];

if (!command || command === 'version') {
  console.log(`radar-lite v${VelaLite.profile.version}`);
  process.exit(0);
}

if (command === 'dashboard') {
  const { startDashboard } = await import('../src/dashboard/server.js');
  const port = parseInt(process.argv[3]) || 4040;
  startDashboard(port);
} else if (command === 'stats') {
  const { stats } = await import('../src/register.js');
  const s = await stats();
  console.log('\n  VELA LITE · stats');
  console.log(`  Total assessments: ${s.total}`);
  console.log(`  Hold rate: ${s.holdRate}%`);
  console.log(`  Tiers:`, s.tiers);
  console.log(`  Top activity: ${s.topActivity || 'none'}\n`);
} else if (command === 'history') {
  const { history } = await import('../src/register.js');
  const records = await history(10);
  console.log('\n  VELA LITE · recent assessments\n');
  if (records.length === 0) {
    console.log('  No assessments recorded yet.\n');
  } else {
    for (const r of records) {
      const strategy = r.chosen_strategy ? ` → ${r.chosen_strategy}` : '';
      console.log(`  ${r.created_at}  T${r.tier}  ${r.verdict}  ${r.activity_type}  score ${r.risk_score}${strategy}`);
    }
    console.log();
  }
} else if (command === 'backup') {
  const { existsSync, cpSync, readFileSync } = await import('fs');
  const { join } = await import('path');
  const radarDir = join(process.cwd(), '.radar');
  if (!existsSync(radarDir)) {
    console.log('\n  No .radar/ directory found — nothing to back up.\n');
    process.exit(0);
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
  const date = new Date().toISOString().slice(0, 10);
  const backupDir = join(process.cwd(), `.radar-backup-v${pkg.version}-${date}`);
  if (existsSync(backupDir)) {
    console.log(`\n  Backup already exists: ${backupDir}\n`);
    process.exit(0);
  }
  cpSync(radarDir, backupDir, { recursive: true });
  console.log(`\n  VELA LITE · backup created`);
  console.log(`  From: ${radarDir}`);
  console.log(`  To:   ${backupDir}`);
  console.log(`\n  To restore: remove .radar/ and rename the backup directory to .radar/\n`);
} else if (command === 'demo') {
  const { default: radar } = await import('../src/index.js');
  const { stats } = await import('../src/register.js');

  console.log('\n  VELA LITE · seeding demo data...\n');

  radar.configure({ activities: {} });

  const demoActions = [
    ['Read user profile from database', 'data_read'],
    ['Search for competitor pricing', 'web_search'],
    ['Send welcome email to new user', 'email_single'],
    ['Publish blog post to company website', 'publish'],
    ['Write audit log entry', 'data_write'],
    ['Call payment gateway API', 'external_api_call'],
    ['Read system config file', 'system_files'],
    ['Send newsletter to 25,000 subscribers', 'email_bulk'],
    ['Delete expired session records', 'data_delete_single'],
    ['Execute database migration on production', 'system_execute'],
    ['Process refund of $2,500 to customer credit card', 'financial'],
    ['Permanently delete all inactive user accounts', 'data_delete_bulk'],
    ['Send password reset email to user', 'email_single'],
    ['Search for flight availability', 'web_search'],
    ['Update user preferences in database', 'data_write'],
  ];

  for (const [action, type] of demoActions) {
    const result = await radar.assess(action, type, { agentId: 'demo-agent' });
    const icon = result.status === 'PROCEED' ? '  ✓' : result.status === 'HOLD' ? '  ◆' : '  ✕';
    console.log(`${icon} ${result.status.padEnd(7)} T${result.tier || 0}  score ${String(result.riskScore ?? 0).padStart(2)}  ${type}`);
  }

  const s = await stats();
  console.log(`\n  Done. ${s.total} assessments in register.`);
  console.log('  Run "npx radar-lite dashboard" to view.\n');

} else if (command === 'reset') {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\n  ⚠ This will delete ALL assessment records from the local register.\n  Type "yes" to confirm: ', async (answer) => {
    rl.close();
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('  Cancelled.\n');
      process.exit(0);
    }
    const { clear } = await import('../src/register.js');
    await clear();
    console.log('  Register cleared. All assessment records deleted.\n');
    process.exit(0);
  });
} else if (command === 'migrate') {
  // v0.4: schema migration analysis + recommended defaults preview/apply.
  // Schema migrations themselves are idempotent and run automatically on the
  // first ensureDb() call. This command is informational + applies recommended
  // conservative defaults to high-stakes activities (data_delete_bulk, financial,
  // system_execute, system_files) when --apply is passed.
  // --dry-run shows what would change without writing.

  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');

  const { previewRecommendedDefaults, applyRecommendedDefaults, listActivityConfigs, history } = await import('../src/register.js');
  const { CONSERVATIVE_DENY_DEFAULTS } = await import('../src/constants.js');

  console.log('\n  VELA LITE · v0.4 migration analysis\n');
  console.log('  Schema migrations: idempotent ALTER TABLE — applied automatically on first');
  console.log('  ensureDb() call. v0.4 adds these columns (all NULL on existing rows):');
  console.log('    + activity_config.deny_at_tier (INTEGER, default NULL)');
  console.log('    + activity_config.policy_content (TEXT, default NULL)');
  console.log('    + activity_config.policy_enabled (INTEGER, default 0)');
  console.log('    + activity_config.policy_updated_at (TEXT, default NULL)');
  console.log('    + assessments.llm1_recommended (TEXT, default NULL)');
  console.log('    + assessments.llm2_recommended (TEXT, default NULL)');
  console.log('    + assessments.agreement (INTEGER, default NULL)');
  console.log('    + assessments.policy_check_compliant (INTEGER, default NULL)');
  console.log('    + assessments.policy_violations (TEXT, default NULL)');
  console.log('');

  // Preview: what data exists, what defaults are available
  const allConfigs = await listActivityConfigs();
  const allHistory = await history(10000);
  console.log(`  Existing data:`);
  console.log(`    ${allConfigs.length} activity_config rows preserved`);
  console.log(`    ${allHistory.length} assessments rows preserved`);
  console.log('');

  const preview = await previewRecommendedDefaults();
  console.log('  Recommended conservative defaults (deny_at_tier=4 for high-stakes activities):');
  console.log('');
  for (const item of preview.wouldApply) {
    const current = item.currentDenyAtTier === null ? 'not configured' : `T${item.currentDenyAtTier}+`;
    console.log(`    ${item.activityType.padEnd(20)} current: ${current.padEnd(20)} → recommended: T${item.recommendedDenyAtTier}+`);
  }
  for (const item of preview.wouldSkip) {
    console.log(`    ${item.activityType.padEnd(20)} current: T${item.currentDenyAtTier}+ (operator-set, preserved)`);
  }
  console.log('');

  // Behavior compatibility check
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const envPath = path.join(os.homedir(), '.radar', '.env');
  let t2KeyConfigured = false;
  let t3T4Required = false;
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    t2KeyConfigured = /^T2_API_KEY\s*=\s*\S+/m.test(content);
    t3T4Required = /^T3_T4_REQUIRE_LLM2\s*=\s*true$/mi.test(content);
  }

  console.log('  Behavior compatibility:');
  console.log(`    T3_T4_REQUIRE_LLM2: ${t3T4Required ? 'true (opt-in)' : 'false (default)'}`);
  console.log(`    T2_API_KEY configured: ${t2KeyConfigured ? 'yes' : 'no'}`);
  if (t3T4Required && !t2KeyConfigured) {
    console.log(`    ⚠ T3_T4_REQUIRE_LLM2=true with no T2_API_KEY → T3/T4 actions will HOLD with`);
    console.log(`      policyDecision='llm2_required'. Configure T2_API_KEY OR set the flag to false.`);
  } else if (!t3T4Required) {
    console.log(`    → T3/T4 actions will use single-LLM (v0.3.x behavior preserved).`);
    console.log(`      Set T3_T4_REQUIRE_LLM2=true in ~/.radar/.env to enable dual-LLM review.`);
  } else {
    console.log(`    → T3/T4 actions will use dual-LLM review (LLM1 + LLM2 segregation).`);
  }
  console.log('');

  if (dryRun) {
    console.log('  This was a dry run. No changes written.');
    console.log('  To apply recommended defaults: npx radar-lite migrate --apply');
    console.log('');
    process.exit(0);
  }

  if (!apply) {
    console.log('  Schema migrations have already run (idempotent).');
    console.log('  No recommended defaults applied — operator opt-in required.');
    console.log('  To apply recommended defaults: npx radar-lite migrate --apply');
    console.log('  To preview only: npx radar-lite migrate --dry-run');
    console.log('');
    process.exit(0);
  }

  // Apply path
  console.log('  Applying recommended defaults...');
  const result = await applyRecommendedDefaults();
  console.log(`    Applied: ${result.applied.length} activities`);
  for (const a of result.applied) {
    console.log(`      ${a.activityType} → deny_at_tier=T${a.denyAtTier}+`);
  }
  if (result.skipped.length > 0) {
    console.log(`    Skipped: ${result.skipped.length} activities (operator-set values preserved)`);
    for (const s of result.skipped) {
      console.log(`      ${s.activityType}: ${s.reason}`);
    }
  }
  console.log('\n  Migration complete.\n');

} else {
  console.log(`Unknown command: ${command}`);
  console.log('Usage: radar-lite [dashboard|stats|history|demo|backup|reset|migrate|version]');
  console.log('  migrate [--dry-run|--apply]   v0.4 migration analysis + apply recommended defaults');
  process.exit(1);
}
