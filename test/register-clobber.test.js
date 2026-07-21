import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// Reproduce the multi-process clobber: an external edit to the register file
// (e.g. the dashboard changing a config value) must NOT be overwritten by this
// process's next assessment save.
//
// Isolate into a throwaway home BEFORE importing register.js so the real
// ~/.radar/register.db is never touched.
const TEST_HOME = mkdtempSync(join(tmpdir(), 'radar-clobber-'));
process.env.USERPROFILE = TEST_HOME;
process.env.HOME = TEST_HOME;

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const DB_PATH = join(TEST_HOME, '.radar', 'register.db');

let register;

before(async () => {
  register = await import('../src/register.js');
});

after(() => {
  try { rmSync(TEST_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
});

// Simulate a DIFFERENT process editing the register file directly, behind this
// process's back (what the dashboard does when it writes a config change).
async function externalEdit(sql) {
  const SQL = await initSqlJs();
  const dbx = new SQL.Database(readFileSync(DB_PATH));
  dbx.run(sql);
  writeFileSync(DB_PATH, Buffer.from(dbx.export()));
  dbx.close();
}

async function readDenyAtTierFromDisk(activityType) {
  const SQL = await initSqlJs();
  const dbx = new SQL.Database(readFileSync(DB_PATH));
  const r = dbx.exec(`SELECT deny_at_tier FROM activity_config WHERE activity_type='${activityType}'`);
  dbx.close();
  return r?.[0]?.values?.[0]?.[0] ?? null;
}

describe('register concurrency — external config edits survive an assessment save', () => {
  it('does not clobber a config change made by another process', async () => {
    // This process seeds deny_at_tier = 4
    await register.saveActivityConfig('data_write', { denyAtTier: 4 });
    assert.equal((await register.getActivityConfig('data_write')).deny_at_tier, 4);

    // Another process (dashboard) sets it to NULL directly in the file
    await externalEdit("UPDATE activity_config SET deny_at_tier = NULL WHERE activity_type = 'data_write'");

    // This process records an assessment — which persists the whole DB
    const callId = register.generateCallId();
    await register.save({
      callId, actionHash: register.hashAction('x'), activityType: 'data_write',
      tier: 2, riskScore: 8, verdict: 'HOLD', policyDecision: 'assess', agentId: 't'
    });

    // The external NULL must survive, both in-memory and on disk
    assert.equal((await register.getActivityConfig('data_write')).deny_at_tier, null,
      'external deny_at_tier=NULL was clobbered by the assessment save');
    assert.equal(await readDenyAtTierFromDisk('data_write'), null,
      'file on disk still shows the clobbered value');
  });
});
