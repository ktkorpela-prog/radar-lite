import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { history, stats } from '../register.js';
import { VelaLite } from '../vela-lite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function startDashboard(port = 4040) {
  const app = express();

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

  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });

  const server = app.listen(port, () => {
    console.log(`\n  VELA LITE · local risk register`);
    console.log(`  Dashboard: http://localhost:${port}`);
    console.log(`  Press Ctrl+C to stop\n`);

    const openUrl = `http://localhost:${port}`;
    import('child_process').then(({ exec }) => {
      const cmd = process.platform === 'win32' ? `start ${openUrl}`
        : process.platform === 'darwin' ? `open ${openUrl}`
        : `xdg-open ${openUrl}`;
      exec(cmd);
    }).catch(() => {});
  });

  return server;
}
