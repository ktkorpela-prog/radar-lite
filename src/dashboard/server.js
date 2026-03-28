import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { timingSafeEqual } from 'crypto';
import { history, stats } from '../register.js';
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

  // --- Existing API endpoints ---

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: VelaLite.profile.version });
  });

  app.get('/api/stats', async (req, res) => {
    try {
      res.json(await stats());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/history', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      res.json(await history(limit));
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
      // Still do a comparison to avoid timing leak on length difference
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

    // Update running process env vars
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

  const server = app.listen(port, () => {
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
