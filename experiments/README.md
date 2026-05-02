# experiments/

Working scripts for empirical validation during v0.4 development. Excluded from the npm tarball via `.npmignore`.

## v04-baseline.mjs

Compares current radar-lite v0.3.7 single-LLM verdicts against the locked v0.4 t3_t4_review prompt's dual-LLM verdicts on a representative set of 10 T3/T4 actions.

**Goal:** evidence that the dual-LLM review architecture meaningfully improves verdict quality before committing to ship Phase A code.

**Requires:**
- `~/.radar/.env` with at minimum `LLM_PROVIDER` and `LLM_API_KEY` (LLM1)
- Optional but recommended: `T2_PROVIDER` and `T2_API_KEY` (LLM2 — different provider for true dual-LLM review)

**Run:**

```bash
cd C:\Users\karin\RADAR\radar-lite
node experiments/v04-baseline.mjs
```

**Output:**
- Console: per-action progress, side-by-side summary
- `experiments/results/v04-baseline-{timestamp}.json`: full results with raw LLM2 outputs

**Cost note:**
~20 LLM calls per run (10 v0.3.7 baseline calls + 10 LLM2 review calls). Token usage depends on the action descriptions and model verbosity — typically ~$0.10–$0.50 per run on Anthropic Sonnet, less on Haiku/cheaper models.

**What we measure:**
- Concur vs diverge rate (does LLM2 push back on LLM1?)
- Recommendation changes between v0.3.7 and v0.4
- Scope hygiene catches (intentional mismatch detection)
- Per-action verdict explainability (subjective — review JSON output)

**Decision gate after running:**
- If dual-LLM produces meaningfully better verdicts (more accurate divergences, scope hygiene catches real issues, recommended strategies are more contextually appropriate) → ship Phase A
- If outputs are largely identical or worse → revisit prompt design before code
