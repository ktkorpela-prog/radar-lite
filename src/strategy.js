import { getAssessment, updateStrategy } from './register.js';
import { VALID_STRATEGIES } from './constants.js';

export async function recordStrategy(callId, chosenStrategy, options = {}) {
  if (!VALID_STRATEGIES.includes(chosenStrategy)) {
    throw new Error(`Invalid strategy: ${chosenStrategy}. Must be one of: ${VALID_STRATEGIES.join(', ')}`);
  }

  const record = await getAssessment(callId);
  if (!record) {
    throw new Error(`Assessment not found: ${callId}`);
  }

  const decidedBy = options.decidedBy || 'unknown';

  const velaOverridden = options.velaRecommended
    ? chosenStrategy !== options.velaRecommended
    : false;

  const updated = await updateStrategy(callId, chosenStrategy, decidedBy, velaOverridden);

  return {
    success: updated,
    callId,
    chosenStrategy,
    velaOverridden
  };
}
