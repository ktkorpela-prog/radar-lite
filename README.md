# @essentianlabs/radar-lite

Local risk assessment for AI agents. **Vela Lite** runs on your machine — no data ever leaves it.

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
    email: 0.7,        // 0.0 permissive → 1.0 conservative
    financial: 0.9,
    publishing: 0.5,
    data_deletion: 0.8,
    external_api: 0.4
  }
});

// Assess an action — Vela Lite runs on every assessment
const result = await radar.assess(
  'Send price increase email to 50,000 users',
  'email'
);

console.log(result.proceed);        // false
console.log(result.tier);           // 2
console.log(result.verdict);        // "HOLD"
console.log(result.promptMode);     // "tldr" — full assessment with options
console.log(result.vela);           // Vela Lite formatted output
console.log(result.options);        // { avoid, mitigate, transfer, accept }
console.log(result.t2Attempted);    // true — Vela Lite LLM call ran
console.log(result.wouldEscalate);  // true — raw score warranted T3/T4
console.log(result.escalateTier);   // 4 — the tier this action would get on the paid tier
console.log(result.parseFailed);    // false — Vela Lite output parsed correctly

// Record chosen strategy
await radar.strategy(result.callId, 'mitigate', {
  justification: 'staged rollout approved',
  decidedBy: 'human'
});
```

## How it works

Every call to `radar.assess()` follows this flow:

1. **Rules engine scores** — produces riskScore, triggerReason, activityType, rawTier
2. **Vela Lite always called** with that context (when LLM key is configured)
3. **Slider threshold determines output depth:**
   - Score below T2 threshold → Vela Lite returns **one-liner** (`promptMode: 'oneliner'`, tier 1)
   - Score at or above T2 threshold → Vela Lite returns **TL;DR with four options** (`promptMode: 'tldr'`, tier 2)

Without an LLM key, the rules engine provides a formatted one-liner fallback.

## Return object

`radar.assess()` returns:

```javascript
{
  proceed: false,              // boolean — can the agent go ahead?
  tier: 1 | 2,                // 1 = oneliner, 2 = tldr with options
  verdict: "PROCEED" | "HOLD",
  riskScore: 1-25,            // from rules engine
  triggerReason: "string",     // named risk signals that fired
  activityType: "email",
  callId: "ra_xxxxxxxxxxxx",   // unique ID for strategy recording
  vela: "formatted string",   // Vela Lite one-liner or full TL;DR output
  options: null | {            // null for oneliner, populated for tldr
    avoid: "...",
    mitigate: "...",
    transfer: "...",
    accept: "..."
  },
  recommended: null | "mitigate",  // null for oneliner, strategy name for tldr
  promptMode: "oneliner" | "tldr", // which Vela Lite mode ran
  t2Attempted: true | false,   // true when Vela Lite LLM call ran successfully
  wouldEscalate: true | false, // true if raw score warranted T3/T4
  escalateTier: null | 3 | 4,  // raw tier if wouldEscalate, null otherwise
  parseFailed: true | false    // true if Vela Lite LLM output was malformed
}
```

- `t2Attempted: false` means no LLM key was configured or the call failed — rules engine fallback
- `wouldEscalate: true` means the action scored high enough for T3/T4 — consider upgrading to [@essentianlabs/radar](https://radar.essentianlabs.com)
- `parseFailed: true` means the LLM returned output that didn't contain PROCEED or HOLD — verdict defaulted to HOLD

## Tiers

| Tier | What happens | Requires |
|------|-------------|----------|
| T1 | Vela Lite one-liner — quick verdict | LLM key (or rules engine fallback) |
| T2 | Vela Lite TL;DR — verdict + four strategy options | LLM key |
| T3/T4 | Server-side deliberation via Vela | [@essentianlabs/radar](https://radar.essentianlabs.com) |

## Slider positions

Each activity type has a slider from `0.0` (permissive) to `1.0` (conservative):

- **0.0–0.3 permissive**: T2 triggers at score 7
- **0.4–0.6 balanced**: T2 triggers at score 5
- **0.7–1.0 conservative**: T2 triggers at score 3

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
