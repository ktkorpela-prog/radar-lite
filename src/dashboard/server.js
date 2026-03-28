import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { timingSafeEqual } from 'crypto';
import * as register from '../register.js';
import { VelaLite } from '../vela-lite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VALID_PROVIDERS = ['anthropic', 'openai', 'google'];

function getEnvPath() {
  const dir = join(process.cwd(), '.radar');
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

export function startDashboard(port = 4040) {
  const app = express();
  app.use(express.json());

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

      // Convert perDayByAgent to { agent_id: [{ date, count }] }
      const perDayByAgentArr = {};
      for (const [aid, days] of Object.entries(perDayByAgent)) {
        perDayByAgentArr[aid] = Object.entries(days)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({ date, count }));
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
            total: 0,
            held: 0,
            last_seen: null,
            unregistered: aid === 'default'
          };
        }
        agentMap[aid].total++;
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

      const outcomes = { followed: 0, overridden: 0, escalated: 0, deferred: 0 };
      for (const c of withFeedback) {
        if (c.vela_overridden) outcomes.overridden++;
        else outcomes.followed++;
      }

      const total = withFeedback.length;
      const followRate = total > 0 ? outcomes.followed / total : null;

      res.json({
        total_with_feedback: total,
        follow_rate: followRate,
        vela_accuracy_rate: followRate,
        outcomes,
        vela_accuracy: { accurate: outcomes.followed, inaccurate: outcomes.overridden },
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
    res.json({
      provider,
      api_key_set: apiKey.length > 0
    });
  });

  // localhost-only — protected by server binding to 127.0.0.1 in app.listen()
  app.post('/dashboard/llm-config', (req, res) => {
    const { provider, api_key } = req.body;

    if (!provider || !VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({
        success: false,
        error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`
      });
    }

    const env = readEnv();
    env.LLM_PROVIDER = provider;
    if (api_key) {
      env.LLM_API_KEY = api_key;
    }
    writeEnv(env);

    process.env.LLM_PROVIDER = provider;
    if (api_key) {
      process.env.LLM_API_KEY = api_key;
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

  return server;
}
