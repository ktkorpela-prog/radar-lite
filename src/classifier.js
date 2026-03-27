import { DEFAULT_SLIDER } from './constants.js';

const BASE_SCORES = {
  financial:     { likelihood: 3, consequence: 5 },
  data_deletion: { likelihood: 3, consequence: 5 },
  email:         { likelihood: 3, consequence: 4 },
  publishing:    { likelihood: 3, consequence: 3 },
  external_api:  { likelihood: 2, consequence: 3 },
  default:       { likelihood: 2, consequence: 2 }
};

const KNOWN_TYPES = Object.keys(BASE_SCORES).filter(k => k !== 'default');

const RISK_SIGNALS = {
  increase: [
    { pattern: /\ball\b|\beveryone\b|\bmass\b|\bbulk\b/i,    weight: 3, name: 'scale' },
    { pattern: /\bdelete\b|\bremove\b|\beirreversible\b/i,    weight: 3, name: 'irreversibility' },
    { pattern: /\bpublic\b|\bpublish\b|\blive\b/i,            weight: 2, name: 'visibility' },
    { pattern: /\b\d{4,}\b/,                                  weight: 2, name: 'large numbers' },
    { pattern: /\bpassword\b|\bcredit\b|\bpayment\b/i,        weight: 4, name: 'sensitive data' }
  ],
  decrease: [
    { pattern: /\bdraft\b|\bpreview\b|\btest\b/i,             weight: 3, name: 'reversible' },
    { pattern: /\binternal\b|\bprivate\b|\bstaging\b/i,       weight: 2, name: 'low visibility' },
    { pattern: /\bundo\b|\breversible\b|\bcancel\b/i,         weight: 2, name: 'reversibility' }
  ]
};

function getThresholds(sliderPosition) {
  // 0.0 permissive: T2 at 7,  T3 at 13, T4 at 20
  // 0.5 balanced:   T2 at 5,  T3 at 10, T4 at 17
  // 1.0 conservative: T2 at 3, T3 at 7,  T4 at 12
  const t2 = 7 - (4 * sliderPosition);
  const t3 = 13 - (6 * sliderPosition);
  const t4 = 20 - (8 * sliderPosition);
  return { t2, t3, t4 };
}

function resolveVerdict(effectiveTier, score, thresholds) {
  // T2 always holds — needs deliberation
  if (effectiveTier === 2) return 'HOLD';
  // T1 proceeds — score is below T2 threshold
  return 'PROCEED';
}

export function classify(action, activityType, sliderPosition = DEFAULT_SLIDER) {
  const base = BASE_SCORES[activityType] || BASE_SCORES.default;
  const isUnknownType = !BASE_SCORES[activityType];

  if (isUnknownType && activityType !== 'default') {
    console.warn(`⚠ RADAR: Unknown activity type '${activityType}' — scored as default. Known types: ${KNOWN_TYPES.join(', ')}`);
  }

  let score = base.likelihood * base.consequence;

  const triggers = [];

  for (const signal of RISK_SIGNALS.increase) {
    if (signal.pattern.test(action)) {
      score += signal.weight;
      triggers.push(signal.name);
    }
  }

  for (const signal of RISK_SIGNALS.decrease) {
    if (signal.pattern.test(action)) {
      score -= signal.weight;
      triggers.push(signal.name + ' (-)');
    }
  }

  score = Math.max(1, Math.min(25, score));

  const thresholds = getThresholds(sliderPosition);

  let rawTier;
  if (score < thresholds.t2) {
    rawTier = 1;
  } else if (score < thresholds.t3) {
    rawTier = 2;
  } else {
    rawTier = score < thresholds.t4 ? 3 : 4;
  }

  // radar-lite only handles T1/T2 — cap tier at 2 for local processing
  const effectiveTier = Math.min(rawTier, 2);

  const triggerReason = triggers.length > 0
    ? triggers.join(', ')
    : isUnknownType
      ? `Unknown type '${activityType}' — scored as default`
      : `Base ${activityType} risk`;

  const verdict = resolveVerdict(effectiveTier, score, thresholds);

  const result = {
    tier: effectiveTier,
    rawTier,
    riskScore: score,
    triggerReason,
    verdict,
    activityType
  };

  return result;
}

export function formatT1(result) {
  return `VELA LITE (T1) | ${result.verdict} | ${result.triggerReason} | ${result.activityType} | score ${result.riskScore}`;
}
