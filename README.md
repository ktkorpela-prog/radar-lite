# @essentianlabs/radar-lite

Early beta for evaluation only.

RADAR Lite is in active evaluation. I'm testing both the framework and how people interpret it. If you try it, assume it's experimental and tell me where it breaks — technically or conceptually.

Local risk assessment for AI agents. Vela Lite structures reasoning about agent actions before they execute.

## Advisory notice

RADAR produces risk intelligence, not safety assurance. It structures reasoning — it does not validate decisions.

- RADAR assesses the **action description** supplied by the developer or agent. It does not verify, monitor, or control the real-world action that is actually executed.
- A **PROCEED** verdict means "not held by this assessment." It is not authorization, approval, certification, legal advice, or safety validation.
- RADAR can produce a PROCEED verdict for actions that later prove harmful, incorrect, unethical, or non-compliant. The assessment reflects what was described, not what occurs.
- **Liability remains with the developer, operator, and end user.** RADAR does not transfer, reduce, or share liability for actions taken.
- If an external LLM provider is configured, action text leaves the local machine and is sent to that provider under your own account and API terms.

This is a beta release. Not recommended for enterprise or production use without independent legal and compliance review. By installing this package you agree to the [Beta Terms of Use](https://radar.essentianlabs.com/terms.html).

## Intended use boundaries

RADAR Lite is designed as a reasoning layer for AI agent developers — a checkpoint that surfaces risk signals before an action executes. It should not be relied on as the sole control for high-stakes domains including:

- Medical decisions or patient care
- Legal advice or legal document generation
- Employment, hiring, or termination decisions
- Regulated financial advice or transactions
- Safety-critical systems or irreversible physical-world actions

In these domains, RADAR should be one input among several — combined with independent human review, domain-specific compliance controls, and professional oversight.

## Runtime meaning of the verdict (v0.3)

| Status | When | Meaning | `proceed` | `reviewRequired` |
|--------|------|---------|-----------|-------------------|
| `PROCEED` | T1 low risk | Below review threshold. Go ahead. | `true` | `false` |
| `HOLD` | T2 elevated risk | Requires explicit human/system review before continuing | `false` | `true` |
| `DENY` | Policy or extreme risk | Blocked by configuration. Should not continue through normal execution. | `false` | `false` |

**HOLD** includes `holdAction`, `notifyUrl`, `options`, and `recommended`. The developer reviews the options and records a strategy.

**DENY** includes only `reason` and `callId`. No options, no holdAction. Override requires:
```javascript
await radar.strategy(callId, 'override_deny', {
  reason: 'Approved by CTO after compliance review',  // required
  decidedBy: 'admin@company.com'                       // required
});
```

DENY triggers (deterministic — no LLM):
- Trigger policy set to `'deny'`: `await radar.savePolicy('*drop database*', 'deny')`
- Score 20+ with irreversibility signal (rules engine)

Neither verdict is a substitute for human accountability. RADAR advises — it does not enforce.

### Backward compatibility

`result.verdict` and `result.proceed` still work as before:
- `result.verdict` mirrors `result.status` (`'PROCEED'`, `'HOLD'`, or `'DENY'`)
- `result.proceed` is `true` for PROCEED, `false` for HOLD and DENY
- Existing code using `if (!result.proceed)` continues to work unchanged

## Prerequisites

- Node.js 18 or higher — https://nodejs.org
- npm (included with Node.js)

**Windows users:** If you see "running scripts is disabled" in PowerShell, run this once:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Then retry the install.

## Install

```bash
npm install @essentianlabs/radar-lite
```

## Quick start

```javascript
import radar from '@essentianlabs/radar-lite';

radar.configure({
  llmProvider: 'anthropic',                  // T1 scorer
  llmKey: process.env.ANTHROPIC_API_KEY,     // optional — without it, rules engine only
  t2Provider: 'openai',                      // T2 reviewer (optional — different provider)
  t2Key: process.env.OPENAI_API_KEY,         // optional — falls back to llmKey
  activities: {
    email_single: 0.5,
    email_bulk: 0.8,
    financial: 0.9,
    data_delete_bulk: 0.9,
    system_execute: 0.8,
    web_search: 0.2
  }
});

const result = await radar.assess(
  'Send price increase email to 50,000 users',
  'email_bulk'
);

if (!result.proceed) {
  console.log(result.verdict);    // "HOLD"
  console.log(result.options);    // { avoid, mitigate, transfer, accept }
  console.log(result.recommended); // "mitigate"
}

// Record chosen strategy
await radar.strategy(result.callId, 'mitigate', {
  justification: 'staged rollout approved',
  decidedBy: 'human',
  scope: 'single'  // 'single' (default) | 'pattern'
                    // pattern matching coming in future version
});
```

## Activity Types (v0.2)

| Type | Base risk | Use for |
|------|-----------|---------|
| `email_single` | Medium | Single email send |
| `email_bulk` | High | Bulk/mass email send |
| `publish` | Medium | Publishing content to web |
| `data_read` | Low | Reading data |
| `data_write` | Medium | Writing/updating data |
| `data_delete_single` | High | Deleting a single record |
| `data_delete_bulk` | Very high | Bulk deletion |
| `web_search` | Very low | Web searches |
| `external_api_call` | Medium | External API calls |
| `system_execute` | High | Running system commands |
| `system_files` | High | Modifying system files |
| `financial` | Very high | Financial transactions |

### Deprecated types

The following v0.1 types still work but log a deprecation warning:

| Old type | Maps to |
|----------|---------|
| `email` | `email_single` |
| `publishing` | `publish` |
| `data_deletion` | `data_delete_single` |
| `external_api` | `external_api_call` |

`financial` is unchanged.

## How it works

Every call to `radar.assess()` follows this flow:

1. **Check trigger policy** — if a matching pattern exists, short-circuit with `human_required` or `no_assessment`
2. **Check activity config** — if `requiresHumanReview` is on for this type, return HOLD immediately
3. **Rules engine scores** — deterministic scoring based on activity type, action text signals, and slider position. Produces riskScore, triggerReason, activityType, rawTier
4. **Prior decision lookup** — if the action hash has been assessed before, the prior verdict is passed to Vela Lite as context
5. **Vela Lite called** with that context (when LLM key is configured). Every assessment makes an LLM call — your key, your cost
6. **Slider threshold determines output depth and model:**
   - Score below T2 threshold → **T1 oneliner** — fast model, one-line verdict, no strategy options (`options: null`)
   - Score at or above T2 threshold → **T2 TL;DR** — reasoning model (or different provider), verdict + four strategy options (avoid/mitigate/transfer/accept)

**Without an LLM key:** Both T1 and T2 fall back to a rules-engine-only formatted one-liner with PROCEED. No LLM call is made. You get scoring but no Vela verdict.

## Prior Decision Matching

When the same action string is submitted more than once, Vela Lite receives the prior verdict as context and factors it into the current assessment. This reduces unnecessary re-flagging of actions you have already reviewed.

Matching is exact — based on a SHA256 hash of the action string. One character different = no match.

If you want to pre-approve a class of similar actions without exact matching, use Trigger Policy instead:

```javascript
await radar.savePolicy(
  'Send newsletter to * subscribers',
  'no_assessment'
);
```

Pattern-level acceptance (marking a reviewed decision as applicable to similar future actions) is planned for a future version.

## Return object

`radar.assess()` returns:

```javascript
{
  status: "PROCEED" | "HOLD" | "DENY",  // primary verdict (v0.3)
  proceed: false,                // derived: true for PROCEED, false for HOLD/DENY
  verdict: "PROCEED" | "HOLD" | "DENY", // alias for status (backward compat)
  reviewRequired: true | false,  // true only on HOLD
  tier: 1 | 2,                  // null for policy/DENY short-circuits
  riskScore: 1-25,              // null for policy short-circuits
  triggerReason: "string",
  activityType: "email_bulk",
  callId: "ra_xxxxxxxxxxxx",
  vela: "formatted string",     // null for DENY and policy short-circuits
  options: null | { avoid, mitigate, transfer, accept }, // HOLD only
  recommended: null | "mitigate",  // HOLD only
  promptMode: "oneliner" | "tldr", // null for policy/DENY
  holdAction: "halt",            // HOLD only — configured response
  notifyUrl: null,               // HOLD only, when holdAction is 'notify'
  reason: "string",             // DENY only — why it was denied
  t2Attempted: true | false,
  wouldEscalate: true | false,
  escalateTier: null | 3 | 4,
  parseFailed: true | false,
  policyDecision: "assess" | "human_required" | "no_assessment" | "deny",
  radarEnabled: true | false
}
```

## Trigger Policy

Action-level rules that short-circuit assessment. Patterns use glob matching (`*` matches anything).

```javascript
// Any action containing "delete" requires human approval
await radar.savePolicy('*delete*', 'human_required');

// Searches never need assessment
await radar.savePolicy('*search*', 'no_assessment');

// Agent-specific rule
await radar.savePolicy('*deploy*', 'human_required', 'agent-deploy-bot');

// Check policy without running full assessment
const policy = await radar.checkPolicy('delete all records');
// Returns: 'assess' | 'human_required' | 'no_assessment'
```

Policies are stored in local SQLite. Agent-specific rules are checked before global rules.

## Human Review Toggle

Per-activity-type toggle that forces HOLD on all actions of that type, bypassing Vela Lite entirely.

```javascript
// All system_execute actions require human review
await radar.saveActivityConfig('system_execute', {
  requiresHumanReview: true
});

// Set slider position via DB (overrides JS config)
await radar.saveActivityConfig('financial', {
  sliderPosition: 0.95,
  requiresHumanReview: false
});
```

## Hold Actions

When `verdict` is `HOLD`, the return object includes `holdAction` telling your code what the configured response is:

| holdAction | Meaning | Your code should |
|------------|---------|-----------------|
| `halt` | Agent stops (default) | Stop execution, wait for manual handling |
| `queue` | Queue for review | Add to your review queue — no queue is built into RADAR |
| `log_only` | Log and proceed | Log the HOLD, continue execution — you accept the risk |
| `notify` | Send notification + halt | Send to `result.notifyUrl`, then halt |

```javascript
const result = await radar.assess('Delete all records', 'data_delete_bulk');

if (!result.proceed) {
  if (result.holdAction === 'notify' && result.notifyUrl) {
    await fetch(result.notifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId: result.callId, verdict: result.verdict })
    });
  }
  if (result.holdAction !== 'log_only') return; // halt or queue
}
```

`holdAction: 'notify'` returns the configured `notifyUrl` in the assess result. The package does not make outbound calls — your code sends the notification.

All activity types default to `holdAction: 'halt'` until configured. Changes to holdAction are logged with timestamps. The last 5 changes per activity type are retained in the local risk register.

Configure via dashboard Settings tab or programmatically:

```javascript
await radar.saveActivityConfig('data_delete_bulk', {
  holdAction: 'notify',
  notifyUrl: 'https://your-app.com/escalation'
});
```

## Disabling RADAR

You can disable RADAR assessment by setting `RADAR_ENABLED=false` in your `.radar/.env` file, or via the dashboard Settings tab. When disabled, `radar.assess()` returns PROCEED immediately without calling Vela. All bypass events are recorded in the local risk register regardless of this setting.

```bash
# In .radar/.env
RADAR_ENABLED=false
```

The return object includes `radarEnabled: false` when assessment is bypassed.

## Slider positions

Each activity type has a slider from `0.0` (permissive) to `1.0` (conservative):

- **0.0-0.3 permissive**: T2 triggers at score 7
- **0.4-0.6 balanced**: T2 triggers at score 5
- **0.7-1.0 conservative**: T2 triggers at score 3

These thresholds are documented because the package is local and inspectable. The full RADAR API uses different calibration and is not directly comparable.

Slider position is resolved in order: SQLite `activity_config` → JS `config.activities` → default 0.5.

**Note:** Vela Lite uses slider-interpolated thresholds that adapt to developer risk appetite. The full RADAR API (paid tier) uses fixed tier boundaries calibrated for standardised risk assessment, distinct from Lite's slider-driven thresholds.

## Privacy and data flow

RADAR Lite is designed for local operation. No data is sent to EssentianLabs servers.

- **Rules engine only** (no LLM key configured): All scoring runs locally. No network calls. No action text leaves your machine.
- **With LLM key configured**: The action description, activity type, risk score, and trigger reason are sent to the configured LLM provider (Anthropic, OpenAI, or Google) under your own API account and terms. This is necessary for Vela Lite to generate verdicts and strategy options.
- **With dual-provider configured**: Action context is sent to both the T1 provider and the T2 provider (if different).
- **SQLite storage**: The local register stores SHA256 hashes of action text, never the text itself. No PII is written to the database.
- **No telemetry**: The package does not phone home, collect usage data, or communicate with EssentianLabs infrastructure.

If you require fully offline operation with no external network calls, do not configure an LLM key. The rules engine will provide deterministic scoring without Vela verdicts.

## Determinism and gameability

The T1 rules engine is intentionally transparent and deterministic. The scoring weights, signal patterns, and threshold calculations are visible in the source code. Given the same input, slider position, and version, the rules engine will always produce the same score.

This means the rules engine is gameable. An agent or developer who reads the source code can craft action descriptions that avoid trigger patterns or manipulate scores. **The rules engine should not be treated as a security mechanism or anti-abuse control.**

For higher-stakes use, combine the rules engine with:
- LLM-based assessment (Vela Lite or Vela Essentian) which is harder to game
- Independent human review
- Additional domain-specific controls

## Versioning and decision-impacting changes

This package follows semantic versioning for API and package behaviour.

**Decision-impacting changes** — changes to scoring thresholds, risk weights, activity type mappings, signal patterns, prompt wording, or verdict semantics — are flagged explicitly in the changelog. These changes can cause the same input to produce a different verdict across versions.

If your application depends on stable, reproducible verdicts, pin to a specific version. Review the changelog for entries marked as decision-impacting before upgrading.

Update classifications:
- **Maintenance update** — bug fixes, documentation, no verdict changes
- **Decision logic changed** — scoring weights, thresholds, or prompt changes that may produce different verdicts for the same input
- **API migration required** — breaking changes to the public API

## Updates and rollback

Updates are never forced. The dashboard can optionally check the npm registry for new versions — **this is disabled by default** and must be explicitly enabled via Settings or by setting `UPDATE_CHECK=true` in `.radar/.env`.

### Backup before upgrading

```bash
npx radar-lite backup
```

Creates a timestamped copy of `.radar/` (database, config, .env) before you upgrade.

### Two rollback paths

**Quick revert** — reinstall the previous version:
```bash
npm install @essentianlabs/radar-lite@0.2.4
```

**Safe revert** — restore from backup:
```bash
rm -rf .radar
mv .radar-backup-v0.2.4-2026-03-29 .radar
npm install @essentianlabs/radar-lite@0.2.4
```

For decision-impacting releases: test against representative actions before upgrading to production.

## Integration patterns and enforcement model

RADAR Lite is a pre-action assessment layer. It evaluates a described action and returns a verdict — it does not intercept, block, or prevent execution by itself. How strongly that verdict is enforced depends entirely on the host application. Integration and governance are not the same thing. Developers must decide how to act on the verdict and implement enforcement in their own code.

| Platform / Environment | Integration approach | Ease | Enforceability | Status | Notes |
|------------------------|---------------------|------|----------------|--------|-------|
| Custom Node.js agents | Native `import` — call `assess()` before actions | High | High | Supported | Developer controls execution flow directly. `if (!result.proceed) return` is real enforcement. |
| LangChain (JavaScript) | Wrap `assess()` as middleware or custom tool in the chain | Medium | Medium–High | Supported | Enforceability depends on chain design. If `assess()` gates tool execution, enforcement is strong. If it's a parallel step, it's advisory. |
| N8N | Use Code node to call `assess()`, or wrap as HTTP endpoint | Medium | Medium–High | Partial | Low-code friction — requires Code node or a local HTTP wrapper. If wired as a conditional branch (HOLD → stop), enforcement is strong. |
| Python agents (CrewAI, AutoGen, etc.) | Not supported natively (JS package). Requires HTTP service wrapper or Python port. | Low | Depends on implementation | Not supported | Would need `radar-lite` running as a local HTTP service that Python calls. Enforceability depends on how the wrapper is integrated. |
| Claude Code (via MCP) | MCP server wrapping `assess()` as a tool Claude calls before actions | Medium | Low | Experimental | See below. |
| OpenClaw | [`@essentianlabs/openclaw-radar`](https://www.npmjs.com/package/@essentianlabs/openclaw-radar) — RADAR plugin for OpenClaw agents | Easy | High | Supported | Native integration. |

### Claude Code and MCP

An MCP server for RADAR would expose `assess()` as a tool that Claude calls before taking actions. The verdict is returned to Claude, which then decides whether to proceed or stop.

This is advisory, not enforced. Claude seeing `HOLD` does not prevent Claude from acting — it relies on the model's instruction-following to respect the verdict. The developer's system prompt must instruct Claude to check RADAR and respect the result. There is no technical gate that blocks execution on HOLD.

Segregation of duties matters here: if Claude is the agent being assessed, the LLM evaluating the risk should not be Claude (or any Anthropic model). Configure `llmProvider: 'openai'` or `llmProvider: 'google'` so the assessor is independent of the actor. The dual-provider architecture supports this — set a different provider for T2 review than the model performing the action.

### Advisory vs enforcement

RADAR does not intercept or block actions by itself. It returns a verdict. Enforcement only exists when the host application enforces that verdict — by checking `result.proceed` and halting execution when it is `false`.

In MCP and tool-based integrations, enforcement relies on model behaviour and prompt design, not on technical controls. A model that ignores a HOLD verdict will proceed regardless. For stronger guarantees, enforcement must be implemented outside the model — in the orchestration layer, the tool execution framework, or the application code that wraps the agent.

## HTTP API (local)

The dashboard server exposes a local HTTP API for integrations that cannot import the npm package directly (n8n, Python agents, curl, etc.).

Start the server first:

```bash
npx radar-lite dashboard
```

**POST http://localhost:4040/assess**

```json
{
  "action": "Send price increase email to 50,000 users",
  "activityType": "email_bulk",
  "agentId": "my-agent"
}
```

Returns the full assessment result object (status, verdict, riskScore, options, etc.).

**POST http://localhost:4040/strategy**

```json
{
  "callId": "ra_xxxxxxxxxxxx",
  "strategy": "mitigate",
  "justification": "staged rollout approved",
  "decidedBy": "human"
}
```

Returns `{ success: true, callId }`.

The server is bound to `127.0.0.1` only — not accessible from the network. Start the dashboard server before calling these endpoints. The server does not auto-start when radar-lite is installed as a package dependency.

### Setting up LLM keys for HTTP users

If you're using the HTTP API (Python, n8n, curl) rather than importing the package directly, configure your LLM keys in `~/.radar/.env`:

```
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-your-key-here
T2_PROVIDER=openai
T2_API_KEY=sk-your-openai-key-here
```

Or configure via the dashboard Settings tab after starting the server.

### Running the server persistently

For production use, run the dashboard server as a background process so HTTP integrations can reach it reliably:

```bash
# Using pm2
pm2 start npx --name radar-lite -- radar-lite dashboard

# Or using nohup
nohup npx radar-lite dashboard > /dev/null 2>&1 &
```

### Health check

Before making HTTP calls, verify the server is running:

```bash
curl http://localhost:4040/api/health
# Returns: {"status":"ok","version":"1.0.0"}
```

In Python:

```python
import requests

try:
    requests.get('http://localhost:4040/api/health', timeout=2)
except requests.ConnectionError:
    print("Start the server first: npx radar-lite dashboard")
```

## Dashboard

```bash
npx radar-lite dashboard
```

Opens a local dashboard at `http://localhost:4040` showing your risk register.

## CLI

```bash
npx radar-lite dashboard  # open local dashboard
npx radar-lite demo       # seed sample data and view
npx radar-lite stats      # tier counts, hold rate
npx radar-lite history    # last 10 assessments
npx radar-lite reset      # clear all assessment records
npx radar-lite backup     # backup .radar/ directory
npx radar-lite version    # package version
```

## Integration cookbook

### Node.js agent (native)

```javascript
import radar from '@essentianlabs/radar-lite';

radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic'
});

async function executeAction(action, type) {
  const result = await radar.assess(action, type);

  if (result.status === 'DENY') {
    console.log('Blocked:', result.reason);
    return;
  }

  if (result.status === 'HOLD') {
    console.log('Held:', result.triggerReason);
    console.log('Options:', result.options);
    console.log('Recommended:', result.recommended);
    // Wait for human decision before proceeding
    return;
  }

  // PROCEED — execute the action
  await doTheAction(action);
}
```

### LangChain (JavaScript)

```javascript
import { DynamicTool } from '@langchain/core/tools';
import radar from '@essentianlabs/radar-lite';

radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,
  llmProvider: 'anthropic'
});

// Create a RADAR gate tool
const radarTool = new DynamicTool({
  name: 'radar_assess',
  description: 'Assess risk before taking any action',
  func: async (input) => {
    const { action, activityType } = JSON.parse(input);
    const result = await radar.assess(action, activityType);
    return JSON.stringify(result);
  }
});

// Add radarTool to your agent's tool list
```

### Python (via HTTP API)

Start the dashboard server first: `npx radar-lite dashboard`

```python
import requests

def assess_action(action: str, activity_type: str, agent_id: str = None):
    response = requests.post('http://localhost:4040/assess', json={
        'action': action,
        'activityType': activity_type,
        'agentId': agent_id
    })
    result = response.json()

    if not result['proceed']:
        print(f"RADAR: {result['status']} — {result.get('triggerReason')}")
        if result.get('options'):
            print(f"Recommended: {result['recommended']}")
        return None

    return result

# Usage
result = assess_action(
    'Send newsletter to 50,000 subscribers',
    'email_bulk',
    'my-python-agent'
)
```

### Python LangChain (via HTTP API)

```python
from langchain.tools import tool
import requests

@tool
def radar_assess(action: str, activity_type: str) -> str:
    """Assess risk of an action before executing it."""
    response = requests.post('http://localhost:4040/assess', json={
        'action': action,
        'activityType': activity_type
    })
    return str(response.json())

# Add radar_assess to your agent's tools list
```

### n8n (HTTP Request node)

1. Start the server: `npx radar-lite dashboard`
2. Add an **HTTP Request** node:
   - Method: POST
   - URL: `http://localhost:4040/assess`
   - Body: `{ "action": "{{$json.action}}", "activityType": "email_bulk" }`
3. Add an **IF** node after it:
   - Condition: `{{$json.proceed}}` equals `true`
   - True branch → execute the action
   - False branch → send to human review

### curl

```bash
curl -X POST http://localhost:4040/assess \
  -H "Content-Type: application/json" \
  -d '{"action": "Delete all user records", "activityType": "data_delete_bulk"}'
```

## LLM providers

Vela Lite uses your own LLM key. Your key, your infrastructure, your cost. No data is sent to EssentianLabs.

### Dual-provider architecture

T1 and T2 use different model tiers by default — fast models for T1 routing, reasoning models for T2 assessment. You can also use a different provider for T2 to ensure segregation of duties (the model that scores is not the same model that reviews).

```javascript
radar.configure({
  llmProvider: 'anthropic',              // T1 scorer — fast model
  llmKey: process.env.ANTHROPIC_API_KEY,
  t2Provider: 'openai',                  // T2 reviewer — different provider
  t2Key: process.env.OPENAI_API_KEY
});
```

If `t2Provider` is not set, T2 uses the same provider as T1 but with the reasoning model.

### Models by tier

T1 uses your provider's fast model. T2 uses your provider's reasoning model. See `src/providers.js` for currently pinned versions.

### Cost

Every `assess()` call with an LLM key makes one LLM call. T1 uses fast/cheap models. T2 uses reasoning models — higher cost but T2 only fires when risk exceeds the threshold, so the majority of calls are T1-priced.

### Provider verdict behaviour

Different LLM providers follow the T2 prompt instructions with different levels of strictness. In end-to-end testing:

- **Anthropic (Sonnet)** follows the "default to HOLD at T2" instruction reliably. High-risk actions consistently return HOLD with proportionate strategy options.
- **OpenAI (GPT-4o)** tends to return PROCEED even when recommending AVOID or MITIGATE as the strategy. It does not apply the uncertainty tiebreaker as strongly.
- **Google (Gemini)** — not yet tested at T2 with reasoning model.

This is a model behaviour difference, not a code issue. If your use case requires stricter verdict discipline at T2, Anthropic is currently the more conservative reviewer. The dual-provider architecture lets you choose: use a permissive model for T1 routing and a stricter model for T2 review.

## Ecosystem

**Pixel Agents — visual governance for Claude Code** ([PR #258](https://github.com/pablodelucca/pixel-agents/pull/258), [preview build](https://github.com/ktkorpela-prog/pixel-agents/releases))

Pixel Agents is a VS Code extension that turns Claude Code terminals into animated pixel-art characters in a virtual office. The contribution adds a **Risk Assessment desk** with **Vela** (the first NPC) — when a Claude Code agent calls `radar_assess`, the agent character walks to Vela's desk for a verdict.

- 🟢 PROCEED → green stamp, agent continues
- 🟡 HOLD → amber stamp, agent waits for user decision
- 🔴 DENY → red stamp, agent steps back

The integration is dormant if `radar_desk` isn't placed in the layout — no errors, no warnings. Vela appears only when the desk is added.

## License

MIT licensed and free to use. See [LICENSE](LICENSE).

The RADAR client packages — `radar-lite`, `radar-mcp`, `openclaw-radar` — are MIT licensed. The hosted Vela Essentian™ service and supporting infrastructure are proprietary and operated by [EssentianLabs](https://essentianlabs.com).
