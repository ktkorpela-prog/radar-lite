# @essentianlabs/radar-lite

Local risk assessment for AI agents. **Vela Lite** runs on your machine — no data ever leaves it.

## Install

```bash
npm install @essentianlabs/radar-lite
```

## Quick start

```javascript
import radar from '@essentianlabs/radar-lite';

// Configure — LLM key is optional (enables T2 assessment)
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

// Assess an action
const result = await radar.assess(
  'Send price increase email to 50,000 users',
  'email'
);

console.log(result.proceed);     // false
console.log(result.tier);        // 2
console.log(result.verdict);     // "HOLD"
console.log(result.vela);        // Vela Lite formatted output
console.log(result.options);     // { avoid, mitigate, transfer, accept }

// Record chosen strategy
await radar.strategy(result.callId, 'mitigate', {
  justification: 'staged rollout approved',
  decidedBy: 'human'
});
```

## Tiers

| Tier | What happens | Requires |
|------|-------------|----------|
| T1 | Rules engine only — deterministic scoring | Nothing |
| T2 | Vela Lite LLM assessment — actionable strategies | Developer LLM key |
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

T2 uses your own LLM key. Supported providers:

| Provider | Model | SDK |
|----------|-------|-----|
| Anthropic | claude-haiku-4-5 | @anthropic-ai/sdk |
| OpenAI | gpt-4o-mini | openai |
| Google | gemini-2.0-flash | openai (compatibility) |

## License

MIT — [EssentianLabs](https://essentianlabs.com)
