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
} else {
  console.log(`Unknown command: ${command}`);
  console.log('Usage: radar-lite [dashboard|stats|history|backup|version]');
  process.exit(1);
}
