export const DEFAULT_SLIDER = 0.5;
export const DEFAULT_PROVIDER = 'anthropic';
export const VALID_STRATEGIES = ['avoid', 'mitigate', 'transfer', 'accept'];
export const T1_LABEL = 'VELA LITE (T1)';
export const T2_LABEL = 'VELA LITE (T2)';

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
