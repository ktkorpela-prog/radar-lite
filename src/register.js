import initSqlJs from 'sql.js';
import { createHash, randomBytes } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

let db = null;
let dbPath = null;

function getDbPath() {
  const dir = join(process.cwd(), '.radar');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'register.db');
}

function persistDb() {
  if (db && dbPath) {
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
  }
}

async function ensureDb() {
  if (db) return db;

  const SQL = await initSqlJs();
  dbPath = getDbPath();

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      action_hash TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      tier INTEGER NOT NULL,
      risk_score INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      chosen_strategy TEXT,
      decided_by TEXT,
      vela_overridden INTEGER,
      created_at TEXT NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_activity ON assessments(activity_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tier ON assessments(tier)');
  db.run('CREATE INDEX IF NOT EXISTS idx_created ON assessments(created_at)');
  persistDb();

  return db;
}

export function generateCallId() {
  return 'ra_' + randomBytes(6).toString('hex');
}

export function hashAction(actionText) {
  return createHash('sha256').update(actionText).digest('hex');
}

export async function save(assessment) {
  const db = await ensureDb();
  db.run(
    `INSERT INTO assessments (id, action_hash, activity_type, tier, risk_score, verdict, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      assessment.callId,
      assessment.actionHash,
      assessment.activityType,
      assessment.tier,
      assessment.riskScore,
      assessment.verdict,
      new Date().toISOString()
    ]
  );
  persistDb();
}

function rowsToObjects(result) {
  if (!result || !result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function singleValue(result) {
  if (!result || !result.length) return null;
  return result[0].values[0][0];
}

export async function history(limit = 100) {
  const db = await ensureDb();
  const result = db.exec('SELECT * FROM assessments ORDER BY created_at DESC LIMIT ?', [limit]);
  return rowsToObjects(result);
}

export async function stats() {
  const db = await ensureDb();

  const total = singleValue(db.exec('SELECT COUNT(*) FROM assessments')) || 0;
  const holds = singleValue(db.exec("SELECT COUNT(*) FROM assessments WHERE verdict = 'HOLD'")) || 0;
  const holdRate = total > 0 ? Math.round((holds / total) * 100) : 0;

  const tierResult = db.exec('SELECT tier, COUNT(*) as count FROM assessments GROUP BY tier');
  const tiers = {};
  if (tierResult.length) {
    for (const row of tierResult[0].values) {
      tiers[`T${row[0]}`] = row[1];
    }
  }

  const actResult = db.exec(
    'SELECT activity_type, COUNT(*) as count FROM assessments GROUP BY activity_type ORDER BY count DESC LIMIT 1'
  );
  const topActivity = actResult.length ? actResult[0].values[0][0] : null;

  return {
    total,
    holdRate,
    tiers,
    topActivity
  };
}

export async function updateStrategy(callId, strategy, decidedBy, velaOverridden = false) {
  const db = await ensureDb();
  db.run(
    `UPDATE assessments SET chosen_strategy = ?, decided_by = ?, vela_overridden = ? WHERE id = ?`,
    [strategy, decidedBy, velaOverridden ? 1 : 0, callId]
  );
  const changes = db.getRowsModified();
  persistDb();
  return changes > 0;
}

export async function getAssessment(callId) {
  const db = await ensureDb();
  const result = db.exec('SELECT * FROM assessments WHERE id = ?', [callId]);
  const rows = rowsToObjects(result);
  return rows[0] || null;
}
