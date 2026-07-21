import { getAssessment, updateOutcome } from './register.js';
import { VALID_OUTCOMES, DIFF_NOTES_CHAR_CAP } from './constants.js';

// v0.5.0 B1 — post-execution observation.
//
// recordComplete() attaches what ACTUALLY happened to a prior assess() call,
// keyed by callId. It is the post-execution analogue of recordStrategy():
// additive audit, never blocks, mirrors the local-register write pattern.
//
// Divergence detection here is intentionally PARTIAL. The register stores only
// action_hash, never the raw action text, so the two rules that compare the
// intent string against the outcome (SPEC §4.1 rules 3 & 4) cannot run locally —
// they belong to radar-api, which holds the full action. What CAN run locally is
// outcome-vs-diff_notes self-consistency (rules 1 & 2), implemented below.
function detectDivergence(outcome, hasDiffNotes) {
  const reasons = [];
  // Rule 1: reported success but supplied divergence notes → likely partial.
  if (outcome === 'succeeded' && hasDiffNotes) {
    reasons.push('succeeded reported with diff_notes present — possible partial outcome');
  }
  // Rule 2: reported partial but gave no context on what diverged.
  if (outcome === 'partial' && !hasDiffNotes) {
    reasons.push('partial reported without diff_notes — missing divergence context');
  }
  return reasons;
}

export async function recordComplete(callId, outcome = {}) {
  // 1. Validate the outcome enum.
  if (!VALID_OUTCOMES.includes(outcome.outcome)) {
    throw new Error(
      `Invalid outcome: ${outcome.outcome}. Must be one of: ${VALID_OUTCOMES.join(', ')}`
    );
  }

  // 2. Enforce the diff_notes cap (aligns with the action-string limit).
  if (typeof outcome.diff_notes === 'string' && outcome.diff_notes.length > DIFF_NOTES_CHAR_CAP) {
    throw new Error(
      `diff_notes exceeds the ${DIFF_NOTES_CHAR_CAP} character cap (${outcome.diff_notes.length}). Trim it.`
    );
  }

  // 3. The call must exist.
  const record = await getAssessment(callId);
  if (!record) {
    throw new Error(`Assessment not found: ${callId}`);
  }

  // 4. Idempotency — one outcome per call. A second report is a no-op, never an
  //    overwrite (SPEC §4.1: unique index on callId; assessAndTrack never double-reports).
  if (record.outcome != null) {
    return {
      recorded: false,
      alreadyCompleted: true,
      divergence_flagged: !!record.divergence_flagged,
      divergence_reasons: record.divergence_reasons_json
        ? JSON.parse(record.divergence_reasons_json)
        : []
    };
  }

  // 5. Local divergence heuristics (rules 1 & 2).
  const hasDiffNotes = typeof outcome.diff_notes === 'string' && outcome.diff_notes.trim().length > 0;
  const divergenceReasons = detectDivergence(outcome.outcome, hasDiffNotes);
  const divergenceFlagged = divergenceReasons.length > 0;

  // 6. Persist. reported_by_agent defaults to the originating agent.
  await updateOutcome(callId, {
    outcome: outcome.outcome,
    actual_scope: outcome.actual_scope ?? null,
    diff_notes: outcome.diff_notes ?? null,
    metrics: outcome.metrics ?? null,
    divergence_flagged: divergenceFlagged,
    divergence_reasons: divergenceReasons,
    reported_at: new Date().toISOString(),
    reported_by_agent: outcome.reported_by_agent ?? record.agent_id ?? null
  });

  const result = { recorded: true, divergence_flagged: divergenceFlagged };
  if (divergenceFlagged) result.divergence_reasons = divergenceReasons;
  return result;
}
