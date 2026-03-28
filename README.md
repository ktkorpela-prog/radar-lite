# @essentianlabs/radar-lite

Local risk assessment for AI agents. **Vela Lite** runs on your machine — no data ever leaves it.

## Advisory notice

RADAR produces risk intelligence, not safety assurance. Vela Lite's verdict is an assessment based on the action description you provide. It does not verify what your agent actually executes. A PROCEED verdict does not transfer liability — the developer remains responsible for the action taken and the accuracy of the description submitted.

## Install

```bash
npm install @essentianlabs/radar-lite
```

## Quick start

```javascript
import radar from '@essentianlabs/radar-lite';

// Configure — LLM key is optional (enables Vela Lite assessment)
radar.configure({
  llmKey: process.env.ANTHROPIC_API_KEY,    // optional
  llmProvider: 'anthropic',                  // 'anthropic' | 'openai' | 'google'
  activities: {
    email_single: 0.5,
    email_bulk: 0.8,
    financial: 0.9,
    data_delete_bulk: 0.9,
    system_execute: 0.8,
    web_search: 0.2
  }
});

// Assess an action — Vela Lite runs on every assessment
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
  decidedBy: 'human'
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
3. **Rules engine scores** — produces riskScore, triggerReason, activityType, rawTier
4. **Prior decision lookup** — if the action hash has been assessed before, the prior verdict is passed to Vela Lite as context
5. **Vela Lite always called** with that context (when LLM key is configured)
6. **Slider threshold determines output depth:**
   - Score below T2 threshold → `oneliner` mode (tier 1)
   - Score at or above T2 threshold → `tldr` mode with four options (tier 2)

## Return object

`radar.assess()` returns:

```javascript
{
  proceed: false,
  tier: 1 | 2,                    // 0 for policy short-circuits
  verdict: "PROCEED" | "HOLD",
  riskScore: 1-25,                // 0 for policy short-circuits
  triggerReason: "string",
  activityType: "email_bulk",
  callId: "ra_xxxxxxxxxxxx",
  vela: "formatted string",       // null for policy short-circuits
  options: null | { avoid, mitigate, transfer, accept },
  recommended: null | "mitigate",
  promptMode: "oneliner" | "tldr", // null for policy short-circuits
  t2Attempted: true | false,
  wouldEscalate: true | false,
  escalateTier: null | 3 | 4,
  parseFailed: true | false,
  policyDecision: "assess" | "human_required" | "no_assessment",
  radarEnabled: true | false     // false when RADAR_ENABLED=false
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

## Disabling RADAR

You can disable RADAR assessment by setting `RADAR_ENABLED=false` in your `.radar/.env` file, or via the dashboard Settings tab. When disabled, `radar.assess()` returns PROCEED immediately without calling Vela. All bypass events are recorded in the local risk register regardless of this setting.

```bash
# In .radar/.env
RADAR_ENABLED=false
```

The return object includes `radarEnabled: false` when assessment is bypassed.

## Slider positions

Each activity type has a slider from `0.0` (permissive) to `1.0` (conservative):

- **0.0–0.3 permissive**: T2 triggers at score 7
- **0.4–0.6 balanced**: T2 triggers at score 5
- **0.7–1.0 conservative**: T2 triggers at score 3

Slider position is resolved in order: SQLite `activity_config` → JS `config.activities` → default 0.5.

**Note:** Vela Lite uses slider-interpolated thresholds that adapt to developer risk appetite. The full RADAR API (paid tier) uses fixed integer tier boundaries (T1=1–4, T2=5–9, T3=10–16, T4=17–25). This is an intentional design difference — Lite gives developers control over sensitivity; the full API enforces standardised tier classification.

## Dashboard

```bash
npx radar-lite dashboard
```

Opens a local dashboard at `http://localhost:4040` showing your risk register.

## CLI

```bash
npx radar-lite stats      # tier counts, hold rate
npx radar-lite history    # last 10 assessments
npx radar-lite version    # package version
```

## Privacy

- **No server calls** — everything runs locally
- **No telemetry** — zero phoning home
- **Hash-only storage** — SQLite stores SHA256 action hashes, never action text

## LLM providers

Vela Lite uses your own LLM key. Supported providers:

| Provider | Model | SDK |
|----------|-------|-----|
| Anthropic | claude-haiku-4-5 | @anthropic-ai/sdk |
| OpenAI | gpt-4o-mini | openai |
| Google | gemini-2.0-flash | openai (compatibility) |

## License

MIT — [EssentianLabs](https://essentianlabs.com)
