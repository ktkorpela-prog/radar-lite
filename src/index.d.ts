export type ActivityType =
  | 'email_single'
  | 'email_bulk'
  | 'publish'
  | 'data_read'
  | 'data_write'
  | 'data_delete_single'
  | 'data_delete_bulk'
  | 'web_search'
  | 'external_api_call'
  | 'system_execute'
  | 'system_files'
  | 'financial';

export type Status = 'PROCEED' | 'HOLD' | 'DENY';
export type Strategy = 'avoid' | 'mitigate' | 'transfer' | 'accept' | 'override_deny';
export type PromptMode = 'oneliner' | 'tldr';
export type HoldAction = 'halt' | 'queue' | 'log_only' | 'notify';
export type PolicyDecision = 'assess' | 'human_required' | 'no_assessment' | 'deny';
export type Provider = 'anthropic' | 'openai' | 'google';

export interface ConfigureOptions {
  llmKey?: string | null;
  llmProvider?: Provider;
  t2Provider?: Provider | null;
  t2Key?: string | null;
  activities?: Partial<Record<ActivityType, number>>;
  logLevel?: 'silent' | 'info' | 'verbose';
}

export interface AssessOptions {
  agentId?: string | null;
}

export interface StrategyOptions {
  justification?: string;
  decidedBy?: string;
  scope?: 'single' | 'pattern';
  reason?: string;
}

export interface AssessmentOptions {
  avoid: string;
  mitigate: string;
  transfer: string;
  accept: string;
}

export interface AssessResult {
  status: Status;
  verdict: Status;
  proceed: boolean;
  tier: number | null;
  reviewRequired: boolean;
  riskScore: number | null;
  triggerReason: string | null;
  activityType: string;
  callId: string;
  vela: string | null;
  options: AssessmentOptions | null;
  recommended: string | null;
  promptMode: PromptMode | null;
  t2Attempted?: boolean;
  wouldEscalate?: boolean;
  escalateTier?: number | null;
  parseFailed?: boolean;
  policyDecision: PolicyDecision | null;
  radarEnabled: boolean;
  reason?: string;
  holdAction?: HoldAction;
  notifyUrl?: string | null;
  responseTimeMs: number;
}

export interface StrategyResult {
  success: boolean;
  callId: string;
  chosenStrategy: string;
  velaOverridden: boolean;
}

export interface StatsResult {
  total: number;
  holdRate: number;
  tiers: Record<string, number>;
  topActivity: string | null;
  disabled: number;
}

export interface AssessmentRecord {
  id: string;
  action_hash: string;
  activity_type: string;
  tier: number | null;
  risk_score: number | null;
  verdict: string;
  chosen_strategy: string | null;
  decided_by: string | null;
  vela_overridden: number | null;
  policy_decision: string | null;
  radar_enabled: number;
  agent_id: string | null;
  created_at: string;
}

export interface VelaLiteProfile {
  name: string;
  version: string;
  role: string;
  by: string;
  note: string;
}

export function configure(options?: ConfigureOptions): void;
export function assess(action: string, activityType: ActivityType | string, options?: AssessOptions): Promise<AssessResult>;
export function strategy(callId: string, chosenStrategy: Strategy, options?: StrategyOptions): Promise<StrategyResult>;
export function history(limit?: number): Promise<AssessmentRecord[]>;
export function stats(): Promise<StatsResult>;
export function checkPolicy(action: string, agentId?: string | null): Promise<PolicyDecision>;
export function saveActivityConfig(activityType: ActivityType | string, config: {
  sliderPosition?: number;
  requiresHumanReview?: boolean;
  holdAction?: HoldAction;
  notifyUrl?: string | null;
}): Promise<void>;
export function savePolicy(actionPattern: string, policy: PolicyDecision, agentId?: string | null): Promise<void>;
export function reload(): Promise<void>;
export function clear(): Promise<{ cleared: boolean }>;

export const VelaLite: {
  profile: Readonly<VelaLiteProfile>;
};

export interface Radar {
  configure: typeof configure;
  assess: typeof assess;
  strategy: typeof strategy;
  history: typeof history;
  stats: typeof stats;
  checkPolicy: typeof checkPolicy;
  saveActivityConfig: typeof saveActivityConfig;
  savePolicy: typeof savePolicy;
  reload: typeof reload;
  clear: typeof clear;
}

export const radar: Radar;
export default radar;
