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
} else {
  console.log(`Unknown command: ${command}`);
  console.log('Usage: radar-lite [dashboard|stats|history|demo|backup|reset|version]');
  process.exit(1);
}
