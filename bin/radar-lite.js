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
} else {
  console.log(`Unknown command: ${command}`);
  console.log('Usage: radar-lite [dashboard|stats|history|version]');
  process.exit(1);
}
