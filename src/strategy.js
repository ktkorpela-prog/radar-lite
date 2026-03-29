import { getAssessment, updateStrategy } from './register.js';
import { VALID_STRATEGIES } from './constants.js';

const VALID_SCOPES = ['single', 'pattern'];

export async function recordStrategy(callId, chosenStrategy, options = {}) {
  if (!VALID_STRATEGIES.includes(chosenStrategy)) {
    throw new Error(`Invalid strategy: ${chosenStrategy}. Must be one of: ${VALID_STRATEGIES.join(', ')}`);
  }

  const record = await getAssessment(callId);
  if (!record) {
    throw new Error(`Assessment not found: ${callId}`);
  }

  // override_deny requires reason and decidedBy
  if (chosenStrategy === 'override_deny') {
    if (record.verdict !== 'DENY') {
      throw new Error(`Cannot override_deny: assessment ${callId} verdict is ${record.verdict}, not DENY`);
    }
    if (!options.reason || typeof options.reason !== 'string' || !options.reason.trim()) {
      throw new Error('override_deny requires a non-empty reason string');
    }
    if (!options.decidedBy || typeof options.decidedBy !== 'string' || !options.decidedBy.trim()) {
      throw new Error('override_deny requires a non-empty decidedBy string');
    }
  }

  const scope = options.scope || 'single';
  if (!VALID_SCOPES.includes(scope)) {
    throw new Error(`Invalid scope: ${scope}. Must be one of: ${VALID_SCOPES.join(', ')}`);
  }

  const decidedBy = options.decidedBy || 'unknown';

  const velaOverridden = chosenStrategy === 'override_deny'
    ? true
    : (options.velaRecommended ? chosenStrategy !== options.velaRecommended : false);

  const updated = await updateStrategy(callId, chosenStrategy, decidedBy, velaOverridden, scope);

  if (scope === 'pattern') {
    console.log('Pattern acceptance recorded — not yet active. Coming in a future version.');
  }

  if (chosenStrategy === 'override_deny') {
    console.warn(`⚠ RADAR: DENY override recorded for ${callId} by ${decidedBy}: ${options.reason}`);
  }

  return {
    success: updated,
    callId,
    chosenStrategy,
    velaOverridden,
    scope,
    overrideReason: chosenStrategy === 'override_deny' ? options.reason : undefined
  };
}
