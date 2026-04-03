// T3 Outbound KPI Targets (v2 — three-channel model)
// Shared between LeadsPool scorecard, AgentProfile, and coaching logic

export const T3_POOL_KPI = {
  MIN_COMBINED_DIALS: 200,
  MIN_POOL_PCT: 25,
  MAX_POOL_PCT: 40,
  MIN_LONG_CALLS: 4,
  MIN_TALK_TIME: 180,
  MIN_ASSIGN_RATE: 30,
  MAX_PAST_DUE: 0,
  MAX_QUEUE: 120,
  GATES_TO_PASS: 5,
  TOTAL_GATES: 7,
} as const;

export type GateStatus = "pass" | "fail" | "na";

export interface ScorecardGate {
  label: string;
  target: string;
  actual: number | string;
  status: GateStatus;
}

export function buildT3Gates(
  poolDials: number,
  poolAnswered: number,
  poolAssignRate: number,
  poolLongCalls: number,
  poolTalkMin: number,
  regDials: number,
  regTalkMin: number,
  pastDue: number | null,
  callQueue: number | null,
): ScorecardGate[] {
  const combinedDials = regDials + poolDials;
  const combinedTalk = regTalkMin + poolTalkMin;
  const poolPct = combinedDials > 0 ? (poolDials / combinedDials) * 100 : 0;

  return [
    {
      label: "Volume",
      target: `≥ ${T3_POOL_KPI.MIN_COMBINED_DIALS}`,
      actual: combinedDials,
      status: combinedDials >= T3_POOL_KPI.MIN_COMBINED_DIALS ? "pass" : "fail",
    },
    {
      label: "Pool %",
      target: `${T3_POOL_KPI.MIN_POOL_PCT}-${T3_POOL_KPI.MAX_POOL_PCT}%`,
      actual: combinedDials > 0 ? `${poolPct.toFixed(0)}%` : "--",
      status: combinedDials === 0 ? "na"
        : poolPct >= T3_POOL_KPI.MIN_POOL_PCT && poolPct <= T3_POOL_KPI.MAX_POOL_PCT ? "pass" : "fail",
    },
    {
      label: "Long Calls",
      target: `≥ ${T3_POOL_KPI.MIN_LONG_CALLS}`,
      actual: poolLongCalls,
      status: poolLongCalls >= T3_POOL_KPI.MIN_LONG_CALLS ? "pass" : "fail",
    },
    {
      label: "Talk Time",
      target: `≥ ${T3_POOL_KPI.MIN_TALK_TIME}m`,
      actual: `${Math.round(combinedTalk)}m`,
      status: combinedTalk >= T3_POOL_KPI.MIN_TALK_TIME ? "pass" : "fail",
    },
    {
      label: "Assign %",
      target: `≥ ${T3_POOL_KPI.MIN_ASSIGN_RATE}%`,
      actual: poolAnswered > 0 ? `${poolAssignRate.toFixed(0)}%` : "--",
      status: poolAnswered === 0 ? "na" : poolAssignRate >= T3_POOL_KPI.MIN_ASSIGN_RATE ? "pass" : "fail",
    },
    {
      label: "Past Due",
      target: "0",
      actual: pastDue ?? "--",
      status: pastDue == null ? "na" : pastDue <= T3_POOL_KPI.MAX_PAST_DUE ? "pass" : "fail",
    },
    {
      label: "Queue",
      target: `≤ ${T3_POOL_KPI.MAX_QUEUE}`,
      actual: callQueue ?? "--",
      status: callQueue == null ? "na" : callQueue <= T3_POOL_KPI.MAX_QUEUE ? "pass" : "fail",
    },
  ];
}
