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
      policy_decision TEXT,
      created_at TEXT NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_activity ON assessments(activity_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tier ON assessments(tier)');
  db.run('CREATE INDEX IF NOT EXISTS idx_created ON assessments(created_at)');

  db.run(`
    CREATE TABLE IF NOT EXISTS trigger_policy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_pattern TEXT NOT NULL,
      policy TEXT NOT NULL CHECK(policy IN ('assess', 'human_required', 'no_assessment')),
      agent_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_config (
      activity_type TEXT PRIMARY KEY,
      slider_position REAL,
      requires_human_review INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  persistDb();

  return db;
}

// --- Helpers ---

export function generateCallId() {
  return 'ra_' + randomBytes(6).toString('hex');
}

export function hashAction(actionText) {
  return createHash('sha256').update(actionText).digest('hex');
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

// --- Assessments ---

export async function save(assessment) {
  const db = await ensureDb();
  db.run(
    `INSERT INTO assessments (id, action_hash, activity_type, tier, risk_score, verdict, policy_decision, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      assessment.callId,
      assessment.actionHash,
      assessment.activityType,
      assessment.tier,
      assessment.riskScore,
      assessment.verdict,
      assessment.policyDecision || 'assess',
      new Date().toISOString()
    ]
  );
  persistDb();
}

export async function history(limit = 100) {
  const db = await ensureDb();
  const result = db.exec('SELECT * FROM assessments ORDER BY created_at DESC LIMIT ?', [limit]);
  return rowsToObjects(result);
}

export async function stats() {
  const db = await ensureDb();

  const total = singleValue(db.exec('SELECT COUNT(*) FROM assessments')) || 0;
  // NOTE: If verdict values expand beyond PROCEED/HOLD, this query needs updating
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

export async function updateVerdict(callId, verdict) {
  const db = await ensureDb();
  db.run('UPDATE assessments SET verdict = ? WHERE id = ?', [verdict, callId]);
  persistDb();
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

// --- Trigger Policy ---

function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${withWildcards}$`, 'i');
}

export async function checkPolicy(action, agentId = null) {
  const db = await ensureDb();

  // Agent-specific rules first, then global (agent_id IS NULL)
  const result = db.exec(
    `SELECT action_pattern, policy, agent_id FROM trigger_policy
     ORDER BY CASE WHEN agent_id IS NOT NULL THEN 0 ELSE 1 END, id ASC`
  );
  const rows = rowsToObjects(result);

  for (const row of rows) {
    // If rule is agent-specific and doesn't match this agent, skip
    if (row.agent_id && row.agent_id !== agentId) continue;

    const regex = globToRegex(row.action_pattern);
    if (regex.test(action)) {
      return row.policy; // 'assess' | 'human_required' | 'no_assessment'
    }
  }

  return 'assess'; // default
}

export async function savePolicy(actionPattern, policy, agentId = null) {
  const db = await ensureDb();
  db.run(
    `INSERT INTO trigger_policy (action_pattern, policy, agent_id) VALUES (?, ?, ?)`,
    [actionPattern, policy, agentId]
  );
  persistDb();
}

export async function listPolicies() {
  const db = await ensureDb();
  const result = db.exec('SELECT * FROM trigger_policy ORDER BY id ASC');
  return rowsToObjects(result);
}

export async function deletePolicy(id) {
  const db = await ensureDb();
  db.run('DELETE FROM trigger_policy WHERE id = ?', [id]);
  persistDb();
}

// --- Activity Config ---

export async function getActivityConfig(activityType) {
  const db = await ensureDb();
  const result = db.exec('SELECT * FROM activity_config WHERE activity_type = ?', [activityType]);
  const rows = rowsToObjects(result);
  return rows[0] || null;
}

export async function saveActivityConfig(activityType, config) {
  const db = await ensureDb();
  const now = new Date().toISOString();
  const existing = await getActivityConfig(activityType);

  if (existing) {
    db.run(
      `UPDATE activity_config SET slider_position = ?, requires_human_review = ?, updated_at = ? WHERE activity_type = ?`,
      [config.sliderPosition ?? existing.slider_position, config.requiresHumanReview ? 1 : 0, now, activityType]
    );
  } else {
    db.run(
      `INSERT INTO activity_config (activity_type, slider_position, requires_human_review, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [activityType, config.sliderPosition ?? null, config.requiresHumanReview ? 1 : 0, now, now]
    );
  }
  persistDb();
}

export async function listActivityConfigs() {
  const db = await ensureDb();
  const result = db.exec('SELECT * FROM activity_config ORDER BY activity_type ASC');
  return rowsToObjects(result);
}
