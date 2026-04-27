export const DEFAULT_SLIDER = 0.5;
export const DEFAULT_PROVIDER = 'anthropic';

// Strategies Vela offers on a HOLD verdict — exactly four. Single source of truth.
export const HOLD_STRATEGIES = ['avoid', 'mitigate', 'transfer', 'accept'];

// All strategies accepted by radar.strategy() — HOLD strategies plus override_deny for DENY override path.
// override_deny is a deliberate human action, NOT a Vela-offered option.
export const VALID_STRATEGIES = [...HOLD_STRATEGIES, 'override_deny'];

export const T1_LABEL = 'VELA LITE (T1)';
export const T2_LABEL = 'VELA LITE (T2)';

// v0.3 verdict model
// T1: PROCEED (low risk, go ahead)
// T2: HOLD (requires review, holdAction applies)
// Policy/rules: DENY (hard stop, override_deny required to proceed)
// ESCALATE is internal only — never returned to developer
export const VALID_STATUSES = ['PROCEED', 'HOLD', 'DENY'];

// Deny threshold — score at or above with irreversibility signal = DENY
export const DENY_SCORE_THRESHOLD = 20;

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
