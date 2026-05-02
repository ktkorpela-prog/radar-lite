export const DEFAULT_SLIDER = 0.5;
export const DEFAULT_PROVIDER = 'anthropic';

// Strategies Vela offers on a HOLD verdict — exactly four. Single source of truth.
export const HOLD_STRATEGIES = ['avoid', 'mitigate', 'transfer', 'accept'];

// All strategies accepted by radar.strategy() — HOLD strategies plus override_deny for DENY override path.
// override_deny is a deliberate human action, NOT a Vela-offered option.
export const VALID_STRATEGIES = [...HOLD_STRATEGIES, 'override_deny'];

export const T1_LABEL = 'VELA LITE (T1)';
export const T2_LABEL = 'VELA LITE (T2)';
// v0.4: T3/T4 review path — produces 'VELA LITE (T3)' or 'VELA LITE (T4)' dynamically
export const T3_LABEL = 'VELA LITE (T3)';
export const T4_LABEL = 'VELA LITE (T4)';

// v0.4 prompt modes — 'oneliner' (T1), 'tldr' (T2), 't3_t4_review' (T3/T4 dual-LLM)
export const PROMPT_MODE_T3_T4_REVIEW = 't3_t4_review';

// v0.3 verdict model
// T1: PROCEED (low risk, go ahead)
// T2: HOLD (requires review, holdAction applies)
// Policy/rules: DENY (hard stop, override_deny required to proceed)
// ESCALATE is internal only — never returned to developer
export const VALID_STATUSES = ['PROCEED', 'HOLD', 'DENY'];

// Deny threshold — score at or above with irreversibility signal = DENY
export const DENY_SCORE_THRESHOLD = 20;

// v0.4: per-activity DENY threshold (deny_at_tier).
// NULL = no activity-level deny override (current v0.3.x behavior).
// 3 = T3 and T4 both DENY for this activity.
// 4 = only T4 DENY (T3 still HOLD).
// VALID values for the column.
export const VALID_DENY_AT_TIER = [null, 3, 4];

// v0.4: conservative defaults for high-stakes activity types.
// These are NOT auto-applied on first use in v0.4.0 — operator must explicitly
// opt in via dashboard "Apply recommended defaults" (Reading B per V04-PLAN).
// v0.5.0 may switch to implicit-on-first-use based on telemetry.
export const CONSERVATIVE_DENY_DEFAULTS = {
  data_delete_bulk: 4,
  financial: 4,
  system_execute: 4,
  system_files: 4
};

// v0.4 Phase B: free tier policy character cap per activity type.
// Paid tier raises this to 50KB or unlimited.
export const FREE_POLICY_CHAR_CAP = 2000;

// v0.2 activity types — canonical list
export const ACTIVITY_TYPES = [
  'email_single',
  'email_bulk',
  'publish',
  'data_read',
  'data_write',
  'data_delete_single',
  'data_delete_bulk',
  'web_search',
  'external_api_call',
  'system_execute',
  'system_files',
  'financial'
];

// Deprecated type mappings — old name → new name
const DEPRECATED_TYPES = {
  email: 'email_single',
  publishing: 'publish',
  data_deletion: 'data_delete_single',
  external_api: 'external_api_call'
};

export function resolveActivityType(activityType) {
  if (DEPRECATED_TYPES[activityType]) {
    console.warn(`⚠ RADAR: activity type "${activityType}" is deprecated. Use "${DEPRECATED_TYPES[activityType]}"`);
    return DEPRECATED_TYPES[activityType];
  }
  return activityType;
}
