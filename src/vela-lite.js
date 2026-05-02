import { callLLM, DEFAULT_PROVIDER } from './providers.js';
import { HOLD_STRATEGIES, T1_LABEL, T2_LABEL, T3_LABEL, T4_LABEL, PROMPT_MODE_T3_T4_REVIEW } from './constants.js';

export const VelaLite = {
  profile: Object.freeze({
    name: "Vela Lite",
    version: "1.0.0",
    role: "Local risk advisor — T1/T2 assessment + T3/T4 dual-LLM review (v0.4)",
    by: "EssentianLabs",
    note: "Vela Lite is a lightweight version of Vela, the EssentianLabs Risk Management Essentian. Her full intelligence is available on the paid tier at radar.essentianlabs.com"
  })
};

// Only HOLD_STRATEGIES are valid as Vela-offered options on a HOLD verdict.
// override_deny is excluded — it is a DENY override mechanism, not a HOLD strategy.
const HOLD_STRATEGIES_UPPER = HOLD_STRATEGIES.map(s => s.toUpperCase());
// Permissive regex captures any label (including OVERRIDE_DENY hallucinations) — whitelist applied after parse.
const STRATEGIES_REGEX = /^→\s*([A-Z_]+):\s*(.+)/i;

// Normalise a label for whitelist comparison: lowercase + strip non-alphanumeric.
// Catches: OVERRIDE_DENY, override-deny, "Override Deny", OVERRIDEDENY → "overridedeny"
//          AVOID, "Avoid", avoid → "avoid"
function normaliseLabel(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HOLD_STRATEGIES_NORMALISED = new Set(HOLD_STRATEGIES.map(normaliseLabel));

function buildOnelinerPrompt(priorDecision) {
  let priorLine = '';
  if (priorDecision) {
    priorLine = `\nPrior decision for this action: ${priorDecision.verdict}${priorDecision.outcome ? ' (' + priorDecision.outcome + ')' : ''}. Factor this into your verdict.`;
  }

  return `You are Vela Lite — a local risk advisor for AI agent actions.
You are assessing an action — what the agent intends to do — not content it has produced. If the input appears to be content rather than an action description, return HOLD and note the issue.
Your assessment is bounded by the action description provided. You cannot verify what the agent actually executes — assess what you are told, and flag gaps explicitly rather than assuming them away.
Return ONLY one line in this exact format, nothing else:
${T1_LABEL} | PROCEED | {one specific trigger reason} | {activityType} | score {n}
This is a T1 low-risk assessment. Your verdict is PROCEED.
Base your trigger reason on the risk score and context provided.${priorLine}
No other text. No explanation.`;
}

function buildTldrPrompt(sliderPosition, priorDecision) {
  const strategyLines = HOLD_STRATEGIES_UPPER
    .map(s => `→ ${s}:     {one concrete action, max 12 words}{recommended_marker}`)
    .join('\n');

  let priorSection = '';
  if (priorDecision) {
    priorSection = `\nPrior decision: ${priorDecision.verdict}${priorDecision.outcome ? ' — outcome: ' + priorDecision.outcome : ''}${priorDecision.notes ? ' — ' + priorDecision.notes : ''}. Factor this into your verdict and options.`;
  }

  return `You are Vela Lite — a local risk advisor for AI agent actions.
You are assessing an action — what the agent intends to do — not content it has produced. If the input appears to be content rather than an action description, return HOLD and note the issue.
Your assessment is bounded by the action description provided. You cannot verify what the agent actually executes — assess what you are told, and flag gaps explicitly rather than assuming them away.
Give a fast, actionable risk response. No lengthy analysis. No regulatory citations.

Risk appetite slider: ${sliderPosition} (0.0 = permissive, 0.5 = balanced, 1.0 = conservative)

Strategy definitions — use these EXACTLY four. Do not invent additional strategies.
AVOID = do not take this action at all — block it entirely
MITIGATE = take the action but add specific controls to reduce risk
TRANSFER = delegate the risk to a third party (vendor, legal, compliance)
ACCEPT = proceed as-is, document the decision and accept accountability

The four strategies above are the complete taxonomy for a HOLD verdict. Output exactly four option lines — one for each. Do not output a fifth option under any label.

Return ONLY this exact format, nothing else:

${T2_LABEL} | {activityType} | score {score}

HOLD — {one sentence recommendation, max 12 words}

${strategyLines}

— Vela Lite · EssentianLabs

Rules:
- The rules engine already determined this action exceeds the review threshold. This action requires review.
- Your verdict is always HOLD. T2 actions do not PROCEED — they are held for human or system review.
- Your job is to recommend the best strategy (AVOID, MITIGATE, TRANSFER, or ACCEPT), not to decide whether to proceed.
- Mark only ONE option with " (recommended)" inline
- Each option must be specific to this action — no generic advice
- No extra text before or after the format above${priorSection}`;
}

function buildUserMessage(action, activityType, riskScore, triggerReason, sliderPosition) {
  return `Action: ${action}
Activity: ${activityType}
Score: ${riskScore}
Trigger: ${triggerReason}
Slider: ${sliderPosition}`;
}

// v0.4: T3/T4 review prompt builder.
// Locked design — see V04-PLAN.md "Locked: t3_t4_review prompt (v1)" section.
// Takes structured input: action, ctx (score/tier/trigger), opCfg (slider/holdAction/
// humanReview/denyAtTier/policies), llm1Out (verdict/reasoning/options/recommended),
// priorDecision. Reserved <operator_policy> XML slot for Phase B (v0.4.1) policy upload.
function buildT3T4ReviewPrompt(action, ctx, opCfg, llm1Out, priorDecision) {
  const tier = ctx.tier;
  const tierLabel = tier === 4 ? T4_LABEL : T3_LABEL;

  const policyText = opCfg.policyContent || '(no policy uploaded for this activity type)';
  const priorText = priorDecision
    ? `${priorDecision.verdict}${priorDecision.outcome ? ' — outcome: ' + priorDecision.outcome : ''}${priorDecision.notes ? ' — ' + priorDecision.notes : ''}`
    : '(no prior decision for this action hash)';

  const llm1Options = llm1Out.options || {};
  const llm1OptionsText = `  AVOID: ${llm1Options.avoid || '(not provided)'}
  MITIGATE: ${llm1Options.mitigate || '(not provided)'}
  TRANSFER: ${llm1Options.transfer || '(not provided)'}
  ACCEPT: ${llm1Options.accept || '(not provided)'}`;

  return `You are Vela — a senior risk reviewer for AI agent actions on the RADAR platform.

You review the assessment from a junior assessor (LLM1) and produce the
authoritative verdict for T3/T4 actions. Treat LLM1's assessment as a peer
review you may agree or disagree with — not as anchor. Disagreement with LLM1
is valuable signal — state it explicitly when you see it.

SCOPE BOUNDARY:
You assess actions — what the agent intends to do — not content the agent
has produced. Your assessment is bounded by the information provided. You
cannot verify what the agent actually executes; assess what you are told,
and flag gaps explicitly rather than assuming them away.

EVIDENCE:

<action>
${action}
</action>

<context>
Activity type: ${ctx.activityType}
Risk score: ${ctx.riskScore}/25 (T${tier})
Trigger reason: ${ctx.triggerReason}
</context>

<operator_configuration>
Slider position: ${opCfg.sliderPosition} (0.0 permissive → 1.0 conservative)
Hold action: ${opCfg.holdAction || 'halt'}
Human review required: ${opCfg.requiresHumanReview || false}
Deny at tier: ${opCfg.denyAtTier == null ? 'none configured' : 'T' + opCfg.denyAtTier + '+'}
Active trigger policies: ${opCfg.matchedPolicies || 'none'}
</operator_configuration>

<operator_policy activity_type="${ctx.activityType}">
${policyText}
</operator_policy>

<prior_decision>
${priorText}
</prior_decision>

<llm1_assessment>
Recommended strategy: ${llm1Out.recommended || '(not provided)'}
Reasoning: ${llm1Out.reasoning || ctx.triggerReason}
Options offered:
${llm1OptionsText}
</llm1_assessment>

YOUR JOB:

1. Form your own verdict independently. Treat LLM1's assessment as a peer
   review you may agree or disagree with. The operator's configured posture
   (slider, deny_at_tier, hold_action) tells you their risk appetite. Weight it.

2. Risk vs benefit: name the specific risk if this action goes wrong AND the
   specific benefit if it proceeds. Does benefit justify residual risk under
   THIS operator's posture?

3. Scope hygiene: check whether the action description, activity_type, and
   trigger reason are mutually consistent. Examples of mismatches:
     - action says "delete all records" but activity_type is data_read
     - action describes broad blast radius but trigger reason implies a narrow goal
     - action implies bulk operation but activity_type is single-record
   Do NOT attempt to validate whether this is the "right" action for the agent's
   broader goal — that is upstream judgement, not yours.

4. Produce four concrete strategy options. Be specific to this action — generic
   risk advice is worse than no advice. Each strategy must be actionable in
   12 words or fewer.

5. Mark exactly ONE strategy as recommended.

6. State explicitly whether you concur or diverge from LLM1. The DIVERGENCE
   line is required on every response — even when you concur.

STRATEGY DEFINITIONS — use these EXACTLY four. Do not invent additional strategies.
AVOID = do not take this action at all — block it entirely
MITIGATE = take the action but add specific controls to reduce risk
TRANSFER = delegate the risk to a third party (vendor, legal, compliance)
ACCEPT = proceed as-is, document the decision and accept accountability

The four strategies above are the complete taxonomy for a HOLD verdict. Do
not output a fifth option under any label (such as OVERRIDE_DENY) — that is
not a Vela strategy. Your maximum verdict severity is HOLD; you cannot escalate
to DENY (DENY is determined by deterministic rules, not LLM judgment).

UNCERTAINTY TIEBREAKER:
If the evidence is genuinely ambiguous and you cannot resolve the assessment,
err toward recommend=avoid and name the specific uncertainty in your HOLD
sentence. Do not default to extreme caution as a habit — apply it only when
ambiguity is genuinely unresolvable.

ACCEPT AT T3/T4:
At T3/T4, an ACCEPT recommendation requires explicit justification — name
the specific conditions under which accepting residual risk is proportionate.
Do not recommend ACCEPT casually at this tier.

Return ONLY this exact format, nothing else:

${tierLabel} | ${ctx.activityType} | score ${ctx.riskScore}

HOLD — {one sentence recommendation, max 14 words}

RISK vs BENEFIT:
{2-3 sentences. Name the specific risk if action fails AND the specific
benefit if action succeeds. Concrete to this action, not generic.}

SCOPE HYGIENE:
{One of:
  - "No scope issues detected." (when activity_type, action, and trigger are mutually consistent)
  - "{specific_mismatch}: {brief description}" (when there is an issue)
}

→ AVOID:     {one concrete action, max 12 words}{recommended_marker}
→ MITIGATE:  {one concrete action, max 12 words}{recommended_marker}
→ TRANSFER:  {one concrete action, max 12 words}{recommended_marker}
→ ACCEPT:    {one concrete action, max 12 words}{recommended_marker}

DIVERGENCE FROM LLM1: {Concur with LLM1's assessment.} OR {Diverge: <one sentence specifying what LLM1 underweighted, missed, or misjudged>.}

— Vela · EssentianLabs

Rules:
- Your verdict is always HOLD. T3/T4 do not PROCEED.
- Mark exactly ONE option with " (recommended)" inline.
- The RISK vs BENEFIT, SCOPE HYGIENE, and DIVERGENCE FROM LLM1 lines/blocks are required on every response.
- Each option must be specific to this action — no generic advice.
- No extra text before or after the format above.`;
}

function parseOnelinerResponse(raw) {
  const line = raw.trim().split('\n')[0].trim();

  let verdict = null;
  let parseFailed = false;

  if (line.includes('PROCEED')) verdict = 'PROCEED';
  if (line.includes('HOLD')) verdict = 'HOLD';

  if (verdict === null) {
    console.warn('⚠ RADAR: Vela Lite oneliner response did not contain PROCEED or HOLD — defaulting to HOLD');
    verdict = 'HOLD';
    parseFailed = true;
  }

  return {
    formatted: line,
    verdict,
    recommended: null,
    options: null,
    parseFailed
  };
}

function parseTldrResponse(raw) {
  const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean);

  let verdict = null;
  let recommended = null;
  let parseFailed = false;
  const options = {};
  const droppedLabels = [];

  for (const line of lines) {
    if (line.startsWith('PROCEED')) verdict = 'PROCEED';
    if (line.startsWith('HOLD')) verdict = 'HOLD';

    const optionMatch = line.match(STRATEGIES_REGEX);
    if (optionMatch) {
      const rawLabel = optionMatch[1];
      const normalised = normaliseLabel(rawLabel);
      const lineHasRecommendedMarker = optionMatch[2].includes('(recommended)');

      // Whitelist: drop any option whose label is not in HOLD_STRATEGIES.
      // This catches OVERRIDE_DENY, override-deny, "Override Deny", OVERRIDEDENY,
      // and any other label the LLM hallucinates. Load-bearing — the prompt is helpful
      // but probabilistic; the whitelist is the contract.
      if (!HOLD_STRATEGIES_NORMALISED.has(normalised)) {
        droppedLabels.push(rawLabel);
        // If (recommended) marker was on a dropped line, mark it so fallback knows
        // to pick a valid option rather than leaving recommended null.
        if (lineHasRecommendedMarker) recommended = '__dropped_recommended__';
        continue;
      }

      const key = normalised;
      let value = optionMatch[2].trim();
      if (lineHasRecommendedMarker) {
        recommended = key;
        value = value.replace(/\s*\(recommended\)\s*/i, '').trim();
      }
      options[key] = value;
    }
  }

  if (droppedLabels.length > 0) {
    // Verbose-only — never returned to caller. M7 sanitisation pattern.
    console.warn(`[radar-lite verbose] Dropped ${droppedLabels.length} non-whitelist option label(s) from Vela response: ${droppedLabels.join(', ')}`);
  }

  // Fallback: if recommended is invalid (or was OVERRIDE_DENY before normalisation,
  // or the (recommended) marker was on a dropped line), pick first valid option in
  // the array, or 'mitigate' as last resort.
  if (recommended !== null && !HOLD_STRATEGIES_NORMALISED.has(recommended)) {
    const before = recommended;
    const validKeys = Object.keys(options);
    recommended = validKeys.length > 0 ? validKeys[0] : 'mitigate';
    console.warn(`[radar-lite verbose] Vela recommended invalid strategy "${before}" — fallback to "${recommended}"`);
  }

  // If options object is empty entirely and we have a HOLD verdict, fallback to mitigate
  // so the calling agent gets a usable verdict.
  if (verdict === 'HOLD' && Object.keys(options).length === 0 && recommended === null) {
    recommended = 'mitigate';
    console.warn(`[radar-lite verbose] Vela returned no valid HOLD options — fallback recommended=mitigate`);
  }

  if (verdict === null) {
    console.warn('⚠ RADAR: Vela Lite LLM response did not contain PROCEED or HOLD — defaulting to HOLD');
    verdict = 'HOLD';
    parseFailed = true;
  }

  return {
    formatted: raw.trim(),
    verdict,
    recommended,
    options,
    parseFailed
  };
}

// v0.4: parser for the t3_t4_review prompt's structured output.
// Extends parseTldrResponse with new blocks: RISK vs BENEFIT, SCOPE HYGIENE,
// DIVERGENCE FROM LLM1. Falls back to mitigate / first-valid-option when the
// recommended marker is on a dropped (non-whitelist) option line.
function parseT3T4ReviewResponse(raw, llm1Recommended) {
  const lines = raw.trim().split('\n').map(l => l.trim());
  const result = {
    formatted: raw.trim(),
    verdict: 'HOLD',                 // T3/T4 always HOLD
    holdSentence: null,
    riskBenefit: null,
    scopeHygiene: { issuesDetected: false, note: 'No scope issues detected.' },
    options: {},
    recommended: null,
    review: {
      llm1Recommended: llm1Recommended || null,
      llm2Recommended: null,
      agreement: null,
      divergenceReason: null
    },
    parseFailed: false
  };

  let mode = null;
  let buffer = [];
  const droppedLabels = [];

  for (const line of lines) {
    if (line.startsWith('VELA LITE (T') || line.startsWith('VELA (T')) {
      mode = null;
      continue;
    }
    if (/^HOLD\s*[—-]/.test(line)) {
      result.holdSentence = line.replace(/^HOLD\s*[—-]\s*/, '').trim();
      mode = null;
      continue;
    }
    if (line === 'RISK vs BENEFIT:') { mode = 'risk_benefit'; buffer = []; continue; }
    if (line === 'SCOPE HYGIENE:') {
      if (mode === 'risk_benefit') result.riskBenefit = buffer.join(' ').trim();
      mode = 'scope_hygiene';
      buffer = [];
      continue;
    }

    // → STRATEGY: ... lines — same parsing logic as parseTldrResponse with whitelist filter
    const optionMatch = line.match(STRATEGIES_REGEX);
    if (optionMatch) {
      // Flush scope_hygiene buffer if we just transitioned out of it
      if (mode === 'scope_hygiene' && buffer.length) {
        const noteText = buffer.join(' ').trim();
        result.scopeHygiene.note = noteText;
        result.scopeHygiene.issuesDetected = !/no scope issues detected/i.test(noteText);
        buffer = [];
      }
      mode = 'options';

      const rawLabel = optionMatch[1];
      const normalised = normaliseLabel(rawLabel);
      const lineHasRecommendedMarker = optionMatch[2].includes('(recommended)');

      if (!HOLD_STRATEGIES_NORMALISED.has(normalised)) {
        droppedLabels.push(rawLabel);
        if (lineHasRecommendedMarker) result.recommended = '__dropped_recommended__';
        continue;
      }
      const key = normalised;
      let value = optionMatch[2].trim();
      if (lineHasRecommendedMarker) {
        result.recommended = key;
        value = value.replace(/\s*\(recommended\)\s*/i, '').trim();
      }
      result.options[key] = value;
      continue;
    }

    if (line.startsWith('DIVERGENCE FROM LLM1:')) {
      const text = line.replace(/^DIVERGENCE FROM LLM1:\s*/, '').trim();
      const isDiverge = /^diverge[:\s]/i.test(text);
      result.review.agreement = !isDiverge;
      result.review.divergenceReason = isDiverge ? text.replace(/^diverge[:\s]\s*/i, '').trim() : null;
      mode = null;
      continue;
    }

    // Continuation line for current mode (multi-line risk/benefit or scope hygiene)
    if (mode === 'risk_benefit' || mode === 'scope_hygiene') {
      if (line) buffer.push(line);
    }
  }

  // Edge case: SCOPE HYGIENE block was last before end of message
  if (mode === 'scope_hygiene' && buffer.length) {
    const noteText = buffer.join(' ').trim();
    result.scopeHygiene.note = noteText;
    result.scopeHygiene.issuesDetected = !/no scope issues detected/i.test(noteText);
  }

  if (droppedLabels.length > 0) {
    console.warn(`[radar-lite verbose] T3/T4 review dropped ${droppedLabels.length} non-whitelist option label(s): ${droppedLabels.join(', ')}`);
  }

  // Fallback: invalid recommended → first valid option → mitigate
  if (result.recommended !== null && !HOLD_STRATEGIES_NORMALISED.has(result.recommended)) {
    const before = result.recommended;
    const validKeys = Object.keys(result.options);
    result.recommended = validKeys.length > 0 ? validKeys[0] : 'mitigate';
    console.warn(`[radar-lite verbose] T3/T4 review recommended invalid strategy "${before}" — fallback to "${result.recommended}"`);
  }
  if (result.recommended === null && Object.keys(result.options).length === 0) {
    result.recommended = 'mitigate';
    console.warn(`[radar-lite verbose] T3/T4 review returned no valid options — fallback recommended=mitigate`);
  }

  // Set llm2Recommended now that we have it parsed
  result.review.llm2Recommended = result.recommended;

  // Sanity check
  if (!result.holdSentence || Object.keys(result.options).length === 0) {
    result.parseFailed = true;
  }

  return result;
}

// Exposed for test access only — not part of the public API.
export const _testInternals = { parseTldrResponse, parseT3T4ReviewResponse, normaliseLabel, HOLD_STRATEGIES_NORMALISED, buildT3T4ReviewPrompt };

export async function assessVela(action, activityType, riskScore, triggerReason, sliderPosition, mode, config, priorDecision = null) {
  const systemPrompt = mode === 'oneliner'
    ? buildOnelinerPrompt(priorDecision)
    : buildTldrPrompt(sliderPosition, priorDecision);

  const userMessage = buildUserMessage(action, activityType, riskScore, triggerReason, sliderPosition);

  // Determine provider and model tier based on mode
  // T1 (oneliner): use primary provider with fast model
  // T2 (tldr): use t2Provider (if configured) with reasoning model
  const provider = mode === 'tldr' && config.t2Provider
    ? config.t2Provider
    : (config.llmProvider || DEFAULT_PROVIDER);
  const apiKey = mode === 'tldr' && config.t2Key
    ? config.t2Key
    : config.llmKey;
  const modelTier = mode === 'tldr' ? 'reasoning' : 'fast';

  const raw = await callLLM(provider, systemPrompt, userMessage, apiKey, modelTier);

  return mode === 'oneliner'
    ? parseOnelinerResponse(raw)
    : parseTldrResponse(raw);
}

// v0.4: T3/T4 dual-LLM review.
// Called by index.js when scored.rawTier >= 3 AND T2 keys are configured.
// Routes to t2Provider/t2Key for the review prompt (segregation of duties).
// Takes structured input — not the positional signature of assessVela.
//
// ctx:    { activityType, riskScore, triggerReason, tier }
// opCfg:  { sliderPosition, holdAction, requiresHumanReview, denyAtTier, matchedPolicies, policyContent }
// llm1Out: result from prior LLM1 call — { recommended, reasoning, options }
//         (typically populated by calling assessVela with mode='tldr' first)
// config: same shape as elsewhere — { llmProvider, llmKey, t2Provider, t2Key, ... }
//
// Returns the parser output: { verdict, holdSentence, riskBenefit, scopeHygiene,
// options, recommended, review, parseFailed, formatted }
export async function assessVelaT3T4Review(action, ctx, opCfg, llm1Out, config, priorDecision = null) {
  const systemPrompt = buildT3T4ReviewPrompt(action, ctx, opCfg, llm1Out, priorDecision);
  const userMessage = `Action: ${action}\nActivity: ${ctx.activityType}\nReview LLM1's assessment and produce your authoritative verdict.`;

  // T3/T4 review ALWAYS routes to LLM2 (segregation of duties is the point).
  // The caller (index.js) verifies t2Key is set BEFORE calling this — if not,
  // the gate returns HOLD with policyDecision='llm2_required' rather than
  // falling through to LLM1.
  const provider = config.t2Provider || config.llmProvider || DEFAULT_PROVIDER;
  const apiKey = config.t2Key || config.llmKey;

  const raw = await callLLM(provider, systemPrompt, userMessage, apiKey, 'reasoning');
  return parseT3T4ReviewResponse(raw, llm1Out.recommended || null);
}
