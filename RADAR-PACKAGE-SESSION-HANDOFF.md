# RADAR Lite — Session Handoff

**Last session:** 2026-03-29
**Last version published:** v0.3.0 on npm
**Branch:** master (verdict-v0.3.0 merged)

---

## What is this project?

`@essentianlabs/radar-lite` is a free, open-source npm package that provides local risk assessment for AI agent actions. It ships Vela Lite — a lightweight local version of Vela, the EssentianLabs risk management Essentian.

- **Package:** `@essentianlabs/radar-lite` on npm
- **Repo:** `ktkorpela-prog/radar-lite` on GitHub (git remote: `github-radar-lite`)
- **Local path:** `C:\Users\karin\RADAR\radar-lite\`
- **Parent RADAR repo:** `C:\Users\karin\RADAR\` (private, contains Vela .md files, changelogs, landing page, server API code)

## VPS — CRITICAL RULES

- **VPS:** Hetzner, SSH: `ktkorpela@31.97.119.236`, key: `~/.ssh/id_ed25519`
- **NEVER use `sudo` for PM2 commands.** Running `sudo pm2` creates processes under root's PM2 daemon. These become orphan processes that crash-loop and consume all CPU. Root's PM2 caused a VPS incident on 2026-03-27 (192 restarts, 0% idle). All services run under user `ktkorpela`'s PM2 only.
- **NEVER use `sudo node`, `sudo pm2 start`, `sudo pm2 restart`, or any sudo process management.** If you need to check something as root, use `sudo` only for read-only commands like `sudo cat` or `sudo ls`.
- **Port 3001:** Quorum (DO NOT TOUCH)
- **Port 3002:** Kali (DO NOT TOUCH)
- **Port 3003:** RADAR API (radar-api PM2 process under ktkorpela)
- **Port 3100:** essentian-memory-api Docker container (DO NOT TOUCH)
- **API keys on VPS:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` in `/home/radar-api/.env`, `GOOGLE_API_KEY` in `~/.bashrc`
- When running one-off node commands for debugging: always use `node -e '...' ; echo done` and confirm the process exits. Never leave node processes running. After debugging: `ps aux | grep 'node -e' | grep -v grep` and kill strays.

## Current architecture (v0.3.0)

### Three-verdict model

| Status | When | Meaning | proceed |
|--------|------|---------|---------|
| PROCEED | T1 low risk | Below review threshold | true |
| HOLD | T2 elevated risk | Requires human/system review | false |
| DENY | Policy or score 20+ with irreversibility | Hard stop | false |

- T1 always PROCEED — LLM returns one-liner verdict (fast model)
- T2 always HOLD — LLM picks recommended strategy, never the verdict (reasoning model)
- DENY is deterministic — no LLM involved. Two triggers: `deny` policy, or score >= 20 with irreversibility signal
- `result.verdict` mirrors `result.status` for backward compatibility
- `result.proceed` is derived: true for PROCEED, false for HOLD/DENY

### Dual-provider architecture

- T1 uses fast models (Haiku / gpt-4o-mini / gemini-flash)
- T2 uses reasoning models (Sonnet / gpt-4o / gemini-pro)
- `t2Provider` + `t2Key` allow a different provider for T2 (segregation of duties)
- Anthropic Sonnet follows HOLD instructions reliably. OpenAI GPT-4o tends to PROCEED when it shouldn't — documented in README.

### Key files

| File | Purpose |
|------|---------|
| `src/index.js` | Main API: configure, assess, strategy, history, stats |
| `src/classifier.js` | T1 rules engine — deterministic scoring, 12 activity types |
| `src/vela-lite.js` | T2 Vela Lite — LLM prompts (oneliner + tldr), response parsing |
| `src/providers.js` | LLM adapters (Anthropic/OpenAI/Google), model tier mapping |
| `src/register.js` | SQLite (sql.js) — assessments, trigger_policy, activity_config, config_history |
| `src/strategy.js` | Strategy recording, override_deny validation |
| `src/constants.js` | Activity types, strategies, statuses, slider default, labels |
| `src/dashboard/server.js` | Local Express server on 127.0.0.1:4040, all dashboard endpoints |
| `src/dashboard/lite.html` | Full dashboard UI (copied from server, auth/webhook stripped) |
| `src/dashboard/index.html` | Legacy simple dashboard |
| `src/update-meta.json` | Per-release metadata for update notifications |
| `bin/radar-lite.js` | CLI: dashboard, stats, history, backup, version |

### SQLite tables

- `assessments` — all assess() calls logged (action hash only, never text)
- `trigger_policy` — glob pattern policies (assess/human_required/no_assessment/deny)
- `activity_config` — per-type slider, human review toggle, holdAction, notifyUrl
- `activity_config_history` — audit trail for holdAction/notifyUrl changes (trimmed to 5)

## Known issues / TODO for v0.3.1

1. **override_deny appears in LLM options** — The LLM invents `override_deny` as a 5th strategy option because it's in `VALID_STRATEGIES` which feeds the prompt regex. Fix: exclude `override_deny` from the strategies used in prompt template and parser regex in `vela-lite.js`. `VALID_STRATEGIES` stays as-is for strategy.js validation — just don't use the full list in prompt construction.

2. **Pattern acceptance** — `scope: 'pattern'` field exists in strategy recording but matching logic isn't built. Data is being collected. Planned for future version.

## Changelog

Full changelog at `C:\Users\karin\RADAR\CHANGELOG-RADAR-PACKAGE.md`. All versions from v0.1.0 through v0.3.0 documented.

## Publishing

- npm org: `@essentianlabs` (owner: ktkorpela)
- Requires browser auth (OTP) on each publish
- Always bump version in `package.json` AND `src/update-meta.json`
- Run tests before publish: `node --test test/classifier.test.js test/vela-lite.test.js`
- Publish: `npm publish --access public` (from `C:\Users\karin\RADAR\radar-lite\`)
- npm doesn't allow republishing same version — must bump

## Git

- Branch: `master` (not main)
- Remote: `origin` → `github-radar-lite:ktkorpela-prog/radar-lite.git`
- SSH key for GitHub: deploy key configured
- `verdict-v0.3.0` branch exists but is merged — can be deleted
- `.npmignore` excludes: test/, .env, .radar/, *.db, node_modules/

## Dashboard endpoints

All on localhost:4040, bound to 127.0.0.1:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/stats | GET | Basic stats |
| /api/history | GET | Recent assessments |
| /api/health | GET | Version check |
| /dashboard/stats | GET | Full stats for dashboard |
| /dashboard/calls | GET | Call log with filters |
| /dashboard/agents | GET | Agent list |
| /dashboard/sankey | GET | Sankey chart data |
| /dashboard/accuracy | GET | Follow rate, outcomes |
| /dashboard/auth-mode | GET | Password required? |
| /dashboard/verify-password | POST | Timing-safe password check |
| /dashboard/llm-config | GET/POST | Dual LLM provider config |
| /dashboard/radar-enabled | GET/POST | RADAR on/off toggle |
| /dashboard/update-check | GET | Version comparison with npm |
| /dashboard/update-check-enabled | GET/POST | Opt-in toggle |
| /dashboard/config-history | GET | Activity config change history |
| /radar/feedback | POST | Record feedback on calls |
| /radar/config | POST | Save activity sliders + holdAction |

## Vela .md files

Located at `C:\Users\karin\RADAR\Vela\`:
- `VELA_identity_v3.md`, `VELA_skills_v3.md`, `VELA_system_prompt_T1T2_v3.md`, `VELA_system_prompt_T3T4_v3.md`
- These are spec documents — the actual prompts are JS strings in `vela-lite.js`
- All four have implementation notes stating this
- Old v2 and unversioned files still exist in directory (not in radar-lite package)

## Tests

- 36 unit tests across `test/classifier.test.js` and `test/vela-lite.test.js`
- 8 edge case tests (null, undefined, SQL injection, XSS, concurrent, invalid strategy)
- Live LLM e2e tested on VPS with Anthropic + OpenAI
- Run: `cd ~/RADAR/radar-lite && rm -rf .radar && node --test test/classifier.test.js test/vela-lite.test.js`

## Security

- Server bound to 127.0.0.1 only
- All SQL parameterized (sql.js)
- HTML escaping on all innerHTML data values
- Action text never stored — SHA256 hash only
- No telemetry, no phone-home
- Dashboard password uses timing-safe comparison
- API key never exposed in GET responses
- Update check disabled by default (opt-in)
- Graceful shutdown handlers on SIGINT/SIGTERM
