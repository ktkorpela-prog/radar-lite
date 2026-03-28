import { getAssessment, updateStrategy } from './register.js';
import { VALID_STRATEGIES } from './constants.js';

const VALID_SCOPES = ['single', 'pattern'];

export async function recordStrategy(callId, chosenStrategy, options = {}) {
  if (!VALID_STRATEGIES.includes(chosenStrategy)) {
    throw new Error(`Invalid strategy: ${chosenStrategy}. Must be one of: ${VALID_STRATEGIES.join(', ')}`);
  }

  const scope = options.scope || 'single';
  if (!VALID_SCOPES.includes(scope)) {
    throw new Error(`Invalid scope: ${scope}. Must be one of: ${VALID_SCOPES.join(', ')}`);
  }

  const record = await getAssessment(callId);
  if (!record) {
    throw new Error(`Assessment not found: ${callId}`);
  }

  const decidedBy = options.decidedBy || 'unknown';

  const velaOverridden = options.velaRecommended
    ? chosenStrategy !== options.velaRecommended
    : false;

  const updated = await updateStrategy(callId, chosenStrategy, decidedBy, velaOverridden, scope);

  if (scope === 'pattern') {
    console.log('Pattern acceptance recorded — not yet active. Coming in a future version.');
  }

  return {
    success: updated,
    callId,
    chosenStrategy,
    velaOverridden,
    scope
  };
}
