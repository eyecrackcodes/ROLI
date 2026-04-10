import type { Tier } from "./types";
import {
  T3_PACE_CURVE,
  T3_INTRADAY_TARGETS,
  T3_POOL_KPI,
  BUSINESS_HOURS,
  type GateStatus,
  type ScorecardGate,
  buildT3Gates,
} from "./t3Targets";
import { UNIFIED_CONFIG } from "./unifiedTargets";

// Re-export T3 targets for unified access
export {
  T3_PACE_CURVE,
  T3_INTRADAY_TARGETS,
  T3_POOL_KPI,
  BUSINESS_HOURS,
  buildT3Gates,
};
export type { GateStatus, ScorecardGate };

export { UNIFIED_CONFIG };

// ============================================================
// Tier-Specific Target Definitions
// Used by Action Recommender, compliance gates, and Slack alerts.
// Thresholds are intentionally configurable constants so they
// can be updated easily after roster/org changes.
// ============================================================

export interface TierConfig {
  tier: Tier;
  label: string;
  hasPool: boolean;

  // Close rate thresholds (percent, e.g. 25 = 25%)
  CR_TARGET: number;
  CR_FLOOR: number;
  CR_CRISIS: number;
  CR_CRISIS_DAYS: number;

  // Pipeline limits
  MAX_PIPELINE: number;
  MAX_PAST_DUE: number;

  // Daily lead volume
  DAILY_LEADS: number;

  // Lead cost per unit
  LEAD_COST: number;
}

// ---- T1 Inbound ----

export const T1_CONFIG: TierConfig = {
  tier: "T1",
  label: "Inbound",
  hasPool: false,
  CR_TARGET: 25,
  CR_FLOOR: 20,
  CR_CRISIS: 15,
  CR_CRISIS_DAYS: 3,
  MAX_PIPELINE: 25,
  MAX_PAST_DUE: 0,
  DAILY_LEADS: 10,
  LEAD_COST: 83,
};

// T1 pace curve — IB agents have a simpler day structure than T3.
// Production is 9 AM–5 PM CST with follow-up block 9:00–9:30
// and live IB calls the rest of the day.
export const T1_PACE_CURVE: Record<number, number> = {
  9: 0.05, 10: 0.15, 11: 0.28, 12: 0.42,
  13: 0.50, 14: 0.65, 15: 0.78, 16: 0.92, 17: 1.0,
};

export const T1_INTRADAY_TARGETS = {
  IB_LEADS: 10,
  TALK_TIME: 120,
  BEHIND_THRESHOLD: 0.80,
} as const;

// ---- T2 Hybrid ----

export const T2_CONFIG: TierConfig = {
  tier: "T2",
  label: "Hybrid",
  hasPool: true,
  CR_TARGET: 20,
  CR_FLOOR: 15,
  CR_CRISIS: 10,
  CR_CRISIS_DAYS: 3,
  MAX_PIPELINE: 40,
  MAX_PAST_DUE: 0,
  DAILY_LEADS: 7,
  LEAD_COST: 73,
};

export const T2_PACE_CURVE: Record<number, number> = {
  9: 0.05, 10: 0.15, 11: 0.28, 12: 0.42,
  13: 0.50, 14: 0.65, 15: 0.78, 16: 0.92, 17: 1.0,
};

export const T2_INTRADAY_TARGETS = {
  IB_LEADS: 7,
  POOL_DIALS: 40,
  POOL_LONG_CALLS: 2,
  TALK_TIME: 120,
  ASSIGN_RATE: 30,
  BEHIND_THRESHOLD: 0.80,
} as const;

export const T2_POOL_KPI = {
  MIN_POOL_DIALS: 40,
  MAX_POOL_DIALS: 70,
  MIN_LONG_CALLS: 2,
  MIN_TALK_TIME: 120,
  MIN_ASSIGN_RATE: 30,
  MAX_PAST_DUE: 0,
  MAX_PIPELINE: 40,
  GATES_TO_PASS: 4,
  TOTAL_GATES: 6,
} as const;

// ---- T3 Outbound ----

export const T3_CONFIG: TierConfig = {
  tier: "T3",
  label: "Outbound",
  hasPool: true,
  CR_TARGET: 5,
  CR_FLOOR: 4,
  CR_CRISIS: 3,
  CR_CRISIS_DAYS: 3,
  MAX_PIPELINE: 80,
  MAX_PAST_DUE: 0,
  DAILY_LEADS: 25,
  LEAD_COST: 15,
};

// ---- Lookup helpers ----

export const TIER_CONFIGS: Record<Tier, TierConfig> = {
  T1: T1_CONFIG,
  T2: T2_CONFIG,
  T3: T3_CONFIG,
};

/**
 * Returns the operational config for an agent.
 * After the 2026-04-10 org restructure, all active agents use UNIFIED_CONFIG.
 * Pass `useUnified: true` for active agents; historical views can pass false
 * to get the original tier-specific config.
 */
export function getTierConfig(tier: Tier, useUnified = false): TierConfig {
  if (useUnified) return UNIFIED_CONFIG;
  return TIER_CONFIGS[tier];
}

// ---- T2 Compliance Gates ----

export function buildT2Gates(
  ibLeadsWorked: number,
  ibCloseRate: number,
  poolDials: number,
  talkTimeMin: number,
  pastDue: number | null,
  poolLongCalls: number,
): ScorecardGate[] {
  return [
    {
      label: "IB Leads Worked",
      target: `All allocated (${T2_POOL_KPI.MIN_POOL_DIALS > 0 ? "7-10" : "7"})`,
      actual: ibLeadsWorked,
      status: ibLeadsWorked >= T2_CONFIG.DAILY_LEADS ? "pass" : "fail",
    },
    {
      label: "IB Close Rate",
      target: `≥ ${T2_CONFIG.CR_FLOOR}%`,
      actual: `${ibCloseRate.toFixed(0)}%`,
      status: ibCloseRate >= T2_CONFIG.CR_FLOOR ? "pass" : "fail",
    },
    {
      label: "Pool Dials",
      target: `≥ ${T2_POOL_KPI.MIN_POOL_DIALS}`,
      actual: poolDials,
      status: poolDials >= T2_POOL_KPI.MIN_POOL_DIALS ? "pass" : "fail",
    },
    {
      label: "Talk Time",
      target: `≥ ${T2_POOL_KPI.MIN_TALK_TIME}m`,
      actual: `${Math.round(talkTimeMin)}m`,
      status: talkTimeMin >= T2_POOL_KPI.MIN_TALK_TIME ? "pass" : "fail",
    },
    {
      label: "Past Due",
      target: "0",
      actual: pastDue ?? "--",
      status: pastDue == null ? "na" : pastDue <= T2_POOL_KPI.MAX_PAST_DUE ? "pass" : "fail",
    },
    {
      label: "Pool Long Calls",
      target: `≥ ${T2_POOL_KPI.MIN_LONG_CALLS}`,
      actual: poolLongCalls,
      status: poolLongCalls >= T2_POOL_KPI.MIN_LONG_CALLS ? "pass" : "fail",
    },
  ];
}
