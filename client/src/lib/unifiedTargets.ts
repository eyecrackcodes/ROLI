import type { TierConfig } from "./tierTargets";

// ============================================================
// Unified Flat Model — Target Configuration
// Effective: 2026-04-10 (Org Restructure)
//
// All active agents (RMT) operate under the same model:
// 7 IB leads/day, pool access, pipeline discipline.
// ============================================================

export const UNIFIED_CONFIG: TierConfig = {
  tier: "T2",
  label: "Unified",
  hasPool: true,
  CR_TARGET: 22,
  CR_FLOOR: 20,
  CR_CRISIS: 15,
  CR_CRISIS_DAYS: 3,
  MAX_PIPELINE: 30,
  MAX_PAST_DUE: 0,
  DAILY_LEADS: 7,
  LEAD_COST: 60,
};

export const UNIFIED_POOL = {
  FOLLOWUPS_PER_DAY: 5,
  SALES_PER_WEEK: 1,
  MIN_ASSIGN_RATE: 30,
} as const;

export const COMP_PLAN = {
  GUARANTEED_SALARY: 52_000,
  COMMISSION_RATE: 0.30,
  CHARGEBACK_MONTHS: 4,
} as const;

export const UNIFIED_PACE_CURVE: Record<number, number> = {
  9: 0.05, 10: 0.15, 11: 0.28, 12: 0.42,
  13: 0.50, 14: 0.65, 15: 0.78, 16: 0.92, 17: 1.0,
};

export const UNIFIED_INTRADAY_TARGETS = {
  IB_LEADS: 7,
  POOL_FOLLOWUPS: 5,
  TALK_TIME: 120,
  BEHIND_THRESHOLD: 0.80,
} as const;
