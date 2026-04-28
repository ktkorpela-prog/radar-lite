import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { timingSafeEqual } from 'crypto';
import * as register from '../register.js';
import { assess, strategy as recordStrat, reload, configure } from '../index.js';
import { VelaLite } from '../vela-lite.js';
import { getModelName } from '../providers.js';
import { ACTIVITY_TYPES, VALID_STRATEGIES } from '../constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VALID_PROVIDERS = ['anthropic', 'openai', 'google'];

function getEnvPath() {
  const dir = join(homedir(), '.radar');
  mkdirSync(dir, { recursive: true });
  return join(dir, '.env');
}

function readEnv() {
  const envPath = getEnvPath();
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    env[key] = val;
  }
  return env;
}

function writeEnv(env) {
  const envPath = getEnvPath();
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
}

// Simple in-memory rate limiter — prevents runaway loops from racking up LLM costs
function createRateLimiter(maxPerMinute = 100) {
  let count = 0;
  let resetTime = Date.now() + 60000;
  return (req, res, next) => {
    const now = Date.now();
    if (now > resetTime) { count = 0; resetTime = now + 60000; }
    count++;
    if (count > maxPerMinute) {
      return res.status(429).json({ error: `Rate limit exceeded — max ${maxPerMinute} requests per minute` });
    }
    next();
  };
}

export function startDashboard(port = 4040) {
  const app = express();
  app.use(express.json());

  const assessRateLimiter = createRateLimiter(100);

  // Configure radar once on server start — not per-request (prevents race conditions)
  const env = readEnv();
  configure({
    llmProvider: env.LLM_PROVIDER || process.env.LLM_PROVIDER || 'anthropic',
    llmKey: env.LLM_API_KEY || process.env.LLM_API_KEY || null,
    t2Provider: env.T2_PROVIDER || process.env.T2_PROVIDER || null,
    t2Key: env.T2_API_KEY || process.env.T2_API_KEY || null
  });

  // --- Core API endpoints ---

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: VelaLite.profile.version });
  });

  app.get('/api/stats', async (req, res) => {
    try {
      res.json(await register.stats());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/history', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      res.json(await register.history(limit));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- HTTP API for external integrations (n8n, Python, etc.) ---

  // localhost-only — protected by server binding to 127.0.0.1 in app.listen()
  app.post('/assess', assessRateLimiter, async (req, res) => {
    try {
      const { action, activityType, agentId } = req.body;

      // Validate action
      if (!action || typeof action !== 'string' || action.trim().length === 0) {
        return res.status(400).json({ error: 'action is required and must be a non-empty string' });
      }
      if (action.length > 4000) {
        return res.status(400).json({ error: 'action must not exceed 4000 characters' });
      }

      // Validate activityType
      if (!activityType || typeof activityType !== 'string') {
        return res.status(400).json({ error: 'activityType is required and must be a string' });
      }
      if (!ACTIVITY_TYPES.includes(activityType)) {
        return res.status(400).json({
          error: `Invalid activityType "${activityType}". Valid types: ${ACTIVITY_TYPES.join(', ')}`
        });
      }

      await reload();
      const result = await assess(action, activityType, { agentId: agentId || null });
      res.json(result);
    } catch (err) {
      // M7: never expose raw LLM errors
      res.status(500).json({ error: 'Assessment failed', t2Attempted: false });
    }
  });

  // localhost-only — protected by server binding to 127.0.0.1 in app.listen()
  app.post('/strategy', assessRateLimiter, async (req, res) => {
    try {
      const { callId, strategy, justification, decidedBy, scope } = req.body;

      if (!callId || typeof callId !== 'string') {
        return res.status(400).json({ error: 'callId is required' });
      }
      if (!strategy || !VALID_STRATEGIES.includes(strategy)) {
        return res.status(400).json({
          error: `Invalid strategy. Valid: ${VALID_STRATEGIES.join(', ')}`
        });
      }

      const result = await recordStrat(callId, strategy, {
        justification: justification || undefined,
        decidedBy: decidedBy || undefined,
        scope: scope || 'single'
      });
      res.json({ success: true, callId, ...result });
    } catch (err) {
      res.status(500).json({ error: 'Strategy recording failed' });
    }
  });

  // --- Dashboard data endpoints (matches lite.html expectations) ---

  app.get('/dashboard/stats', async (req, res) => {
    try {
      const agentId = req.query.agent_id || null;
      const allCalls = await register.history(10000);

      const filtered = agentId
        ? allCalls.filter(c => c.agent_id === agentId)
        : allCalls;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const callsThisMonth = filtered.filter(c => c.created_at >= monthStart).length;

      const byTier = {};
      for (const c of filtered) {
        const t = c.tier || 0;
        byTier[t] = (byTier[t] || 0) + 1;
      }

      // Per-day counts for line chart
      const perDay = {};
      const perDayByAgent = {};
      for (const c of filtered) {
        const day = c.created_at ? c.created_at.slice(0, 10) : 'unknown';
        perDay[day] = (perDay[day] || 0) + 1;
        const aid = c.agent_id || 'default';
        if (!perDayByAgent[aid]) perDayByAgent[aid] = {};
        perDayByAgent[aid][day] = (perDayByAgent[aid][day] || 0) + 1;
      }

      // Convert perDay to sorted array
      const perDayArr = Object.entries(perDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));

      // Convert perDayByAgent to { agent_id: [{ _id, count }] }
      const perDayByAgentArr = {};
      for (const [aid, days] of Object.entries(perDayByAgent)) {
        perDayByAgentArr[aid] = Object.entries(days)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({ _id: date, count }));
      }

      // Recent calls (last 20)
      const recent = filtered.slice(0, 20).map(c => ({
        ...c,
        agent_id: c.agent_id || 'default',
        response_time_ms: c.response_time_ms || 0
      }));

      // Agents list
      const agentMap = {};
      for (const c of allCalls) {
        const aid = c.agent_id || 'default';
        if (!agentMap[aid]) agentMap[aid] = { agent_id: aid, count: 0 };
        agentMap[aid].count++;
      }

      // Activity config from SQLite
      const configs = await register.listActivityConfigs();
      const activityConfig = {};
      for (const c of configs) {
        activityConfig[c.activity_type] = {
          slider: c.slider_position ?? 0.5,
          human_review: !!c.requires_human_review,
          hold_action: c.hold_action || 'halt',
          notify_url: c.notify_url || null
        };
      }

      // Disabled count
      const disabled = filtered.filter(c => c.radar_enabled === 0).length;

      res.json({
        total_calls: filtered.length,
        by_tier: byTier,
        calls_this_month: callsThisMonth,
        per_day: perDayArr,
        per_day_by_agent: perDayByAgentArr,
        recent,
        agents: Object.values(agentMap),
        activity_config: activityConfig,
        disabled
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/dashboard/calls', async (req, res) => {
    try {
      const agentId = req.query.agent_id || null;
      const allCalls = await register.history(1000);

      const filtered = agentId
        ? allCalls.filter(c => c.agent_id === agentId)
        : allCalls;

      const calls = filtered.map(c => ({
        ...c,
        call_id: c.id,
        agent_id: c.agent_id || 'default',
        models_consulted: [],
        vela_consulted: c.tier !== null && c.tier > 0,
        response_time_ms: c.response_time_ms || 0,
        tldr: c.trigger_reason ? { action: c.trigger_reason } : null,
        feedback: c.chosen_strategy ? {
          outcome: c.vela_overridden ? 'overridden' : 'followed',
          chosen_strategy: c.chosen_strategy
        } : null
      }));

      res.json({ calls });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/dashboard/agents', async (req, res) => {
    try {
      const allCalls = await register.history(10000);

      const agentMap = {};
      for (const c of allCalls) {
        const aid = c.agent_id || 'default';
        if (!agentMap[aid]) {
          agentMap[aid] = {
            agent_id: aid,
            display_name: aid,
            description: '',
            count: 0,
            held: 0,
            last_seen: null,
            unregistered: aid === 'default'
          };
        }
        agentMap[aid].count++;
        if (c.verdict === 'HOLD') agentMap[aid].held++;
        if (!agentMap[aid].last_seen || c.created_at > agentMap[aid].last_seen) {
          agentMap[aid].last_seen = c.created_at;
        }
      }

      res.json({ agents: Object.values(agentMap) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // localhost-only — protected by server binding to 127.0.0.1 in app.listen()
  app.post('/dashboard/agents/update', async (req, res) => {
    // Agent registration is stored in-memory for Lite — no persistent agent config table
    res.json({ success: true });
  });

  app.get('/dashboard/sankey', async (req, res) => {
    try {
      const agentId = req.query.agent_id || null;
      const allCalls = await register.history(10000);
      const filtered = agentId
        ? allCalls.filter(c => c.agent_id === agentId)
        : allCalls;

      // Build Sankey: activity_type → tier → verdict
      const nodeSet = new Set();
      const linkMap = {};

      for (const c of filtered) {
        if (c.radar_enabled === 0) continue;
        const activity = c.activity_type || 'unknown';
        const tier = `T${c.tier || 0}`;
        const verdict = c.verdict || 'PROCEED';

        nodeSet.add(activity);
        nodeSet.add(tier);
        nodeSet.add(verdict);

        const key1 = `${activity}→${tier}`;
        linkMap[key1] = (linkMap[key1] || 0) + 1;

        const key2 = `${tier}→${verdict}`;
        linkMap[key2] = (linkMap[key2] || 0) + 1;
      }

      const nodes = [...nodeSet].map(name => ({ name }));
      const nodeIndex = {};
      nodes.forEach((n, i) => { nodeIndex[n.name] = i; });

      const links = Object.entries(linkMap).map(([key, value]) => {
        const [source, target] = key.split('→');
        return { source: nodeIndex[source], target: nodeIndex[target], value };
      });

      res.json({ nodes, links });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/dashboard/accuracy', async (req, res) => {
    try {
      const allCalls = await register.history(10000);
      const withFeedback = allCalls.filter(c => c.chosen_strategy);

      // outcomes drives follow_rate (a behavioural metric, not an accuracy claim).
      // vela_overridden=1 means the operator chose a different strategy than Vela
      // recommended — including legitimate override_deny actions on DENY verdicts.
      const outcomes = { followed: 0, overridden: 0, escalated: 0, deferred: 0 };
      for (const c of withFeedback) {
        if (c.vela_overridden) outcomes.overridden++;
        else outcomes.followed++;
      }

      const total = withFeedback.length;
      const followRate = total > 0 ? outcomes.followed / total : null;

      // The package has no mechanism to collect vela_accuracy ratings.
      // breakdown is intentionally null — honest empty state, not a derived rate.
      // The previous vela_accuracy_rate was an alias of follow_rate, which conflated
      // "operator overrode Vela" with "Vela was wrong" and was misleading at any
      // sample size. Removed in v0.3.5 (see CHANGELOG-RADAR-PACKAGE.md).
      res.json({
        total,
        breakdown: null,
        total_with_feedback: total,
        follow_rate: followRate,
        outcomes,
        by_tier: {}
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // localhost-only — protected by server binding to 127.0.0.1 in app.listen()
  app.post('/radar/feedback', async (req, res) => {
    try {
      const { call_id, outcome, chosen_strategy } = req.body;
      if (call_id && chosen_strategy) {
        await register.updateStrategy(call_id, chosen_strategy, 'dashboard', outcome === 'overridden');
      }
      res.json({ success: true, feedback: { outcome, chosen_strategy } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // localhost-only — protected by server binding to 127.0.0.1 in app.listen()
  app.post('/radar/config', async (req, res) => {
    try {
      const { activities, human_review, hold_actions, notify_urls } = req.body;
      if (activities) {
        for (const [type, value] of Object.entries(activities)) {
          const slider = typeof value === 'number' ? value : 0.5;
          const hr = human_review && human_review[type] ? true : false;
          const ha = hold_actions && hold_actions[type] ? hold_actions[type] : undefined;
          const nu = notify_urls && notify_urls[type] ? notify_urls[type] : undefined;
          await register.saveActivityConfig(type, {
            sliderPosition: slider,
            requiresHumanReview: hr,
            holdAction: ha,
            notifyUrl: nu
          });
        }
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/dashboard/config-history', async (req, res) => {
    try {
      const activityType = req.query.activity_type;
      if (!activityType) return res.json({ history: [] });
      const history = await register.getConfigHistory(activityType);
      res.json({ history });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Dashboard auth & config endpoints ---

  app.get('/dashboard/auth-mode', (req, res) => {
    const env = readEnv();
    const password = env.DASHBOARD_PASSWORD || process.env.DASHBOARD_PASSWORD || '';
    res.json({ password_required: password.length > 0 });
  });

  app.post('/dashboard/verify-password', (req, res) => {
    const env = readEnv();
    const stored = env.DASHBOARD_PASSWORD || process.env.DASHBOARD_PASSWORD || '';

    if (!stored) {
      return res.json({ valid: true });
    }

    const submitted = String(req.body.password || '');

    // Timing-safe comparison — pad to equal length
    const storedBuf = Buffer.from(stored, 'utf-8');
    const submittedBuf = Buffer.from(submitted, 'utf-8');

    if (storedBuf.length !== submittedBuf.length) {
      const padded = Buffer.alloc(storedBuf.length);
      submittedBuf.copy(padded);
      timingSafeEqual(storedBuf, padded);
      return res.json({ valid: false });
    }

    const valid = timingSafeEqual(storedBuf, submittedBuf);
    res.json({ valid });
  });

  app.get('/dashboard/llm-config', (req, res) => {
    const env = readEnv();
    const provider = env.LLM_PROVIDER || process.env.LLM_PROVIDER || 'anthropic';
    const apiKey = env.LLM_API_KEY || process.env.LLM_API_KEY || '';
    const t2Provider = env.T2_PROVIDER || process.env.T2_PROVIDER || '';
    const t2Key = env.T2_API_KEY || process.env.T2_API_KEY || '';
    res.json({
      provider,
      api_key_set: apiKey.length > 0,
      t1_model: getModelName(provider, 'fast'),
      t2_provider: t2Provider || provider,
      t2_api_key_set: t2Provider ? t2Key.length > 0 : apiKey.length > 0,
      t2_model: getModelName(t2Provider || provider, 'reasoning'),
      t2_same_as_t1: !t2Provider
    });
  });

  // localhost-only — protected by server binding to 127.0.0.1 in app.listen()
  app.post('/dashboard/llm-config', (req, res) => {
    const { provider, api_key, t2_provider, t2_api_key } = req.body;

    if (!provider || !VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({
        success: false,
        error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`
      });
    }

    if (t2_provider && !VALID_PROVIDERS.includes(t2_provider)) {
      return res.status(400).json({
        success: false,
        error: `Invalid T2 provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`
      });
    }

    const env = readEnv();
    env.LLM_PROVIDER = provider;
    if (api_key) env.LLM_API_KEY = api_key;

    if (t2_provider) {
      env.T2_PROVIDER = t2_provider;
      if (t2_api_key) env.T2_API_KEY = t2_api_key;
    } else {
      delete env.T2_PROVIDER;
      delete env.T2_API_KEY;
    }

    writeEnv(env);

    // Update running process env vars
    process.env.LLM_PROVIDER = provider;
    if (api_key) process.env.LLM_API_KEY = api_key;
    if (t2_provider) {
      process.env.T2_PROVIDER = t2_provider;
      if (t2_api_key) process.env.T2_API_KEY = t2_api_key;
    } else {
      delete process.env.T2_PROVIDER;
      delete process.env.T2_API_KEY;
    }

    res.json({ success: true });
  });

  // --- RADAR enabled toggle ---

  app.get('/dashboard/radar-enabled', (req, res) => {
    const env = readEnv();
    const enabled = (env.RADAR_ENABLED || process.env.RADAR_ENABLED || 'true').toLowerCase() !== 'false';
    res.json({ enabled });
  });

  // localhost-only — protected by server binding to 127.0.0.1 in app.listen()
  app.post('/dashboard/radar-enabled', (req, res) => {
    const { enabled } = req.body;
    const env = readEnv();
    env.RADAR_ENABLED = enabled ? 'true' : 'false';
    writeEnv(env);
    process.env.RADAR_ENABLED = enabled ? 'true' : 'false';
    res.json({ success: true, enabled: !!enabled });
  });

  // --- Update check (enabled by default since v0.3.6 — opt-out via UPDATE_CHECK=false) ---
  // Reasoning: testers who installed weeks ago and hit fixed bugs need to be told
  // updates are available. Silent staleness produced the env-staleness footgun
  // (Jeremy 2026-04-28). Default flipped to surface available updates by default.
  // Privacy: only contacts npm registry (no telemetry to EssentianLabs); user can
  // opt out by setting UPDATE_CHECK=false in ~/.radar/.env.

  app.get('/dashboard/update-check-enabled', (req, res) => {
    const env = readEnv();
    const raw = (env.UPDATE_CHECK || process.env.UPDATE_CHECK || 'true').toLowerCase();
    const enabled = raw !== 'false';
    res.json({ enabled });
  });

  // localhost-only — protected by server binding to 127.0.0.1 in app.listen()
  app.post('/dashboard/update-check-enabled', (req, res) => {
    const { enabled } = req.body;
    const env = readEnv();
    env.UPDATE_CHECK = enabled ? 'true' : 'false';
    writeEnv(env);
    process.env.UPDATE_CHECK = enabled ? 'true' : 'false';
    res.json({ success: true, enabled: !!enabled });
  });

  app.get('/dashboard/update-check', async (req, res) => {
    const env = readEnv();
    const checkEnabled = (env.UPDATE_CHECK || process.env.UPDATE_CHECK || 'true').toLowerCase() !== 'false';

    // Read local update metadata
    const metaPath = join(__dirname, '..', 'update-meta.json');
    let localMeta = {};
    try { localMeta = JSON.parse(readFileSync(metaPath, 'utf-8')); } catch (e) {}

    if (!checkEnabled) {
      return res.json({
        check_enabled: false,
        current_version: localMeta.version || VelaLite.profile.version,
        current_classification: localMeta.classification || 'Unknown',
        current_advisory: localMeta.advisory || null,
        latest_version: null,
        update_available: false
      });
    }

    // Fetch latest version from npm registry
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const r = await fetch('https://registry.npmjs.org/@essentianlabs/radar-lite/latest', {
        signal: controller.signal
      });
      clearTimeout(timeout);
      const d = await r.json();

      const currentVersion = localMeta.version || VelaLite.profile.version;
      const latestVersion = d.version;
      const updateAvailable = latestVersion !== currentVersion;

      res.json({
        check_enabled: true,
        current_version: currentVersion,
        current_classification: localMeta.classification || 'Unknown',
        current_advisory: localMeta.advisory || null,
        latest_version: latestVersion,
        update_available: updateAvailable,
        revert: localMeta.revert || null
      });
    } catch (e) {
      res.json({
        check_enabled: true,
        current_version: localMeta.version || VelaLite.profile.version,
        current_classification: localMeta.classification || 'Unknown',
        latest_version: null,
        update_available: false,
        error: 'Could not reach npm registry'
      });
    }
  });

  // --- Serve dashboard pages ---

  app.get('/lite', (req, res) => {
    res.sendFile(join(__dirname, 'lite.html'));
  });

  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });

  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`\n  VELA LITE · local risk register`);
    console.log(`  Dashboard: http://localhost:${port}/lite`);
    console.log(`  Press Ctrl+C to stop\n`);

    const openUrl = `http://localhost:${port}/lite`;
    import('child_process').then(({ exec }) => {
      const cmd = process.platform === 'win32' ? `start ${openUrl}`
        : process.platform === 'darwin' ? `open ${openUrl}`
        : `xdg-open ${openUrl}`;
      exec(cmd);
    }).catch(() => {});
  });

  // Graceful shutdown — release port on SIGINT/SIGTERM
  const shutdown = () => {
    console.log('\n  Shutting down dashboard server...');
    server.close(() => {
      console.log('  Server closed.\n');
      process.exit(0);
    });
    // Force exit if close takes too long
    setTimeout(() => process.exit(1), 3000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
