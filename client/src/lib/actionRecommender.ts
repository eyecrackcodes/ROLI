import type { Tier } from "./types";
import { TIER_CONFIGS, type TierConfig } from "./tierTargets";

// ============================================================
// Action Recommender Engine
//
// Pure function: given weekly production data, pipeline state,
// pool activity, and intraday snapshots, returns a prioritized
// recommendation per agent telling managers what each agent
// should be doing right now.
// ============================================================

export type ActionType =
  | "TAKE_MORE_LEADS"
  | "WORK_FOLLOWUPS"
  | "GET_IN_POOL"
  | "CLEAR_PIPELINE"
  | "REVIEW_QUALITY"
  | "ON_TRACK";

export type ActionSeverity = "critical" | "warning" | "info";

export interface ActionMetrics {
  weeklyCR: number | null;
  dailyCRs: number[];
  pastDue: number | null;
  pipelineSize: number | null;
  callQueue: number | null;
  poolDials: number;
  todaysLeads: number;
  todaysSales: number;
  todaysDials: number;
  todaysTalkMin: number;
}

export interface AgentRecommendation {
  name: string;
  tier: Tier;
  site: string;
  manager: string | null;
  action: ActionType;
  severity: ActionSeverity;
  reason: string;
  metrics: ActionMetrics;
}

// ---- Input types ----

export interface WeeklyAgentStats {
  name: string;
  tier: Tier;
  site: string;
  manager: string | null;
  dailyRows: Array<{
    date: string;
    ibLeads: number;
    obLeads: number;
    ibSales: number;
    obSales: number;
    customSales: number;
  }>;
}

export interface PipelineSnapshot {
  agentName: string;
  pastDue: number;
  newLeads: number;
  callQueue: number;
  todaysFollowUps: number;
}

export interface IntradaySnapshot {
  agentName: string;
  totalDials: number;
  talkTimeMin: number;
  ibLeadsDelivered: number;
  ibSales: number;
  obLeads: number;
  obSales: number;
  totalPremium: number;
}

export interface PoolSnapshot {
  agentName: string;
  poolDials: number;
  poolTalkMin: number;
  poolSelfAssigned: number;
  poolAnswered: number;
  poolLongCalls: number;
  poolSales: number;
}

// ---- Core engine ----

function computeWeeklyCR(rows: WeeklyAgentStats["dailyRows"], tier: Tier): { weeklyCR: number | null; dailyCRs: number[] } {
  if (rows.length === 0) return { weeklyCR: null, dailyCRs: [] };

  const isInbound = tier === "T1" || tier === "T2";

  const dailyCRs = rows.map(r => {
    const leads = isInbound ? r.ibLeads : (r.obLeads || r.ibLeads);
    const sales = isInbound ? r.ibSales : (r.obSales || r.ibSales + r.obSales + r.customSales);
    return leads > 0 ? (sales / leads) * 100 : 0;
  });

  const totalLeads = rows.reduce((s, r) => s + (isInbound ? r.ibLeads : (r.obLeads || r.ibLeads)), 0);
  const totalSales = rows.reduce((s, r) => s + (isInbound ? r.ibSales : (r.obSales || r.ibSales + r.obSales + r.customSales)), 0);
  const weeklyCR = totalLeads > 0 ? (totalSales / totalLeads) * 100 : null;

  return { weeklyCR, dailyCRs };
}

function countConsecutiveLowCRDays(dailyCRs: number[], threshold: number): number {
  let count = 0;
  for (let i = dailyCRs.length - 1; i >= 0; i--) {
    if (dailyCRs[i] < threshold) count++;
    else break;
  }
  return count;
}

function recommendT1(
  config: TierConfig,
  weeklyCR: number | null,
  dailyCRs: number[],
  pipeline: PipelineSnapshot | undefined,
  intraday: IntradaySnapshot | undefined,
): { action: ActionType; severity: ActionSeverity; reason: string } {
  const pastDue = pipeline?.pastDue ?? 0;
  const pipelineSize = (pipeline?.newLeads ?? 0) + (pipeline?.todaysFollowUps ?? 0) + pastDue;
  const consecutiveLow = countConsecutiveLowCRDays(dailyCRs, config.CR_CRISIS);

  if (pastDue > 3) {
    return {
      action: "WORK_FOLLOWUPS",
      severity: "critical",
      reason: `${pastDue} past due follow-ups — $${pastDue * config.LEAD_COST} in lead spend rotting. Work these before taking any new calls.`,
    };
  }

  if (pipelineSize > config.MAX_PIPELINE) {
    return {
      action: "CLEAR_PIPELINE",
      severity: "critical",
      reason: `Pipeline at ${pipelineSize} leads (max ${config.MAX_PIPELINE}). Close out stale leads before accepting new inbound.`,
    };
  }

  if (consecutiveLow >= config.CR_CRISIS_DAYS && weeklyCR !== null) {
    return {
      action: "REVIEW_QUALITY",
      severity: "critical",
      reason: `Close rate below ${config.CR_CRISIS}% for ${consecutiveLow} consecutive days (weekly: ${weeklyCR.toFixed(0)}%). Review call quality and presentations.`,
    };
  }

  if (pastDue > 0) {
    return {
      action: "WORK_FOLLOWUPS",
      severity: "warning",
      reason: `${pastDue} past due follow-up${pastDue > 1 ? "s" : ""} — work these in Block 1 before taking inbound calls.`,
    };
  }

  if (weeklyCR !== null && weeklyCR < config.CR_FLOOR) {
    return {
      action: "WORK_FOLLOWUPS",
      severity: "warning",
      reason: `Weekly CR at ${weeklyCR.toFixed(0)}% (target: ${config.CR_TARGET}%+). Focus on converting existing follow-ups to boost close rate.`,
    };
  }

  if (
    weeklyCR !== null &&
    weeklyCR >= config.CR_TARGET &&
    pipelineSize < 15 &&
    pastDue === 0
  ) {
    return {
      action: "TAKE_MORE_LEADS",
      severity: "info",
      reason: `CR at ${weeklyCR.toFixed(0)}% with clean pipeline (${pipelineSize} leads). Capacity available for additional volume.`,
    };
  }

  return {
    action: "ON_TRACK",
    severity: "info",
    reason: weeklyCR !== null
      ? `CR ${weeklyCR.toFixed(0)}% · Pipeline ${pipelineSize} · Past due ${pastDue} — on track.`
      : `Pipeline ${pipelineSize} · Past due ${pastDue} — on track.`,
  };
}

function recommendT2(
  config: TierConfig,
  weeklyCR: number | null,
  dailyCRs: number[],
  pipeline: PipelineSnapshot | undefined,
  intraday: IntradaySnapshot | undefined,
  pool: PoolSnapshot | undefined,
): { action: ActionType; severity: ActionSeverity; reason: string } {
  const pastDue = pipeline?.pastDue ?? 0;
  const pipelineSize = (pipeline?.newLeads ?? 0) + (pipeline?.todaysFollowUps ?? 0) + pastDue;
  const consecutiveLow = countConsecutiveLowCRDays(dailyCRs, config.CR_CRISIS);
  const poolDials = pool?.poolDials ?? 0;

  if (pastDue > 3) {
    return {
      action: "WORK_FOLLOWUPS",
      severity: "critical",
      reason: `${pastDue} past due follow-ups — both IB and pool leads rotting. Clear follow-ups before any pool sessions.`,
    };
  }

  if (pipelineSize > config.MAX_PIPELINE) {
    return {
      action: "CLEAR_PIPELINE",
      severity: "critical",
      reason: `Pipeline overloaded at ${pipelineSize} leads (max ${config.MAX_PIPELINE}). Close out stale leads before adding pool contacts.`,
    };
  }

  if (consecutiveLow >= config.CR_CRISIS_DAYS && weeklyCR !== null) {
    return {
      action: "REVIEW_QUALITY",
      severity: "critical",
      reason: `IB close rate below ${config.CR_CRISIS}% for ${consecutiveLow} consecutive days (weekly: ${weeklyCR.toFixed(0)}%). Review presentations and call quality.`,
    };
  }

  if (pastDue > 0) {
    return {
      action: "WORK_FOLLOWUPS",
      severity: "warning",
      reason: `${pastDue} past due follow-up${pastDue > 1 ? "s" : ""}. Work these before entering the leads pool.`,
    };
  }

  if (weeklyCR !== null && weeklyCR < config.CR_FLOOR) {
    return {
      action: "WORK_FOLLOWUPS",
      severity: "warning",
      reason: `IB CR at ${weeklyCR.toFixed(0)}% (floor: ${config.CR_FLOOR}%). Reduce pool time and focus on converting existing pipeline.`,
    };
  }

  if (pipelineSize < 10 && poolDials === 0) {
    return {
      action: "GET_IN_POOL",
      severity: "warning",
      reason: `Light pipeline at ${pipelineSize} leads with zero pool dials today. Pool session needed to build follow-up pipeline.`,
    };
  }

  if (
    weeklyCR !== null &&
    weeklyCR >= config.CR_TARGET + 5 &&
    pipelineSize < 25 &&
    pastDue === 0
  ) {
    return {
      action: "TAKE_MORE_LEADS",
      severity: "info",
      reason: `IB CR at ${weeklyCR.toFixed(0)}% — closing strong. Eligible for bonus leads. Pipeline healthy at ${pipelineSize}.`,
    };
  }

  if (pipelineSize < 10) {
    return {
      action: "GET_IN_POOL",
      severity: "info",
      reason: `Pipeline at ${pipelineSize} leads — on the light side. Pool sessions will build tomorrow's follow-up pipeline.`,
    };
  }

  return {
    action: "ON_TRACK",
    severity: "info",
    reason: weeklyCR !== null
      ? `IB CR ${weeklyCR.toFixed(0)}% · Pipeline ${pipelineSize} · Pool dials ${poolDials} — on track.`
      : `Pipeline ${pipelineSize} · Pool dials ${poolDials} — on track.`,
  };
}

function recommendT3(
  config: TierConfig,
  weeklyCR: number | null,
  dailyCRs: number[],
  pipeline: PipelineSnapshot | undefined,
  _intraday: IntradaySnapshot | undefined,
  pool: PoolSnapshot | undefined,
): { action: ActionType; severity: ActionSeverity; reason: string } {
  const pastDue = pipeline?.pastDue ?? 0;
  const callQueue = pipeline?.callQueue ?? 0;
  const consecutiveLow = countConsecutiveLowCRDays(dailyCRs, config.CR_CRISIS);

  if (pastDue > 0) {
    return {
      action: "WORK_FOLLOWUPS",
      severity: "critical",
      reason: `${pastDue} past due follow-up${pastDue > 1 ? "s" : ""}. T3 standard is zero past due — work scheduled appointments before any pool or queue activity.`,
    };
  }

  if (callQueue > 200) {
    return {
      action: "CLEAR_PIPELINE",
      severity: "critical",
      reason: `Queue bloated at ${callQueue} leads (max 200). Stop pool sessions and withdraw leads past 6 contact attempts.`,
    };
  }

  if (consecutiveLow >= config.CR_CRISIS_DAYS && weeklyCR !== null) {
    return {
      action: "REVIEW_QUALITY",
      severity: "critical",
      reason: `Close rate below ${config.CR_CRISIS}% for ${consecutiveLow} consecutive days (weekly: ${weeklyCR.toFixed(0)}%). Audit call quality and qualification.`,
    };
  }

  if (callQueue > config.MAX_PIPELINE) {
    return {
      action: "CLEAR_PIPELINE",
      severity: "warning",
      reason: `Queue at ${callQueue} (healthy max ${config.MAX_PIPELINE}). Reduce pool time and enforce 6-attempt withdrawal cadence.`,
    };
  }

  if (callQueue < 50) {
    return {
      action: "GET_IN_POOL",
      severity: "warning",
      reason: `Queue light at ${callQueue} leads (healthy: 50–120). Increase pool time and self-assign more answered contacts.`,
    };
  }

  if (
    weeklyCR !== null &&
    weeklyCR >= config.CR_TARGET &&
    callQueue >= 50 &&
    callQueue <= config.MAX_PIPELINE &&
    pastDue === 0
  ) {
    return {
      action: "ON_TRACK",
      severity: "info",
      reason: `CR ${weeklyCR.toFixed(0)}% · Queue ${callQueue} · Past due ${pastDue} — performing well.`,
    };
  }

  return {
    action: "ON_TRACK",
    severity: "info",
    reason: weeklyCR !== null
      ? `CR ${weeklyCR.toFixed(0)}% · Queue ${callQueue} · Past due ${pastDue} — on track.`
      : `Queue ${callQueue} · Past due ${pastDue} — on track.`,
  };
}

// ---- Public API ----

export function computeRecommendations(
  weeklyStats: WeeklyAgentStats[],
  pipelineMap: Map<string, PipelineSnapshot>,
  intradayMap: Map<string, IntradaySnapshot>,
  poolMap: Map<string, PoolSnapshot>,
): AgentRecommendation[] {
  const results: AgentRecommendation[] = [];

  for (const agent of weeklyStats) {
    const config = TIER_CONFIGS[agent.tier];
    const { weeklyCR, dailyCRs } = computeWeeklyCR(agent.dailyRows, agent.tier);
    const pipeline = pipelineMap.get(agent.name);
    const intraday = intradayMap.get(agent.name);
    const pool = poolMap.get(agent.name);

    let result: { action: ActionType; severity: ActionSeverity; reason: string };

    switch (agent.tier) {
      case "T1":
        result = recommendT1(config, weeklyCR, dailyCRs, pipeline, intraday);
        break;
      case "T2":
        result = recommendT2(config, weeklyCR, dailyCRs, pipeline, intraday, pool);
        break;
      case "T3":
        result = recommendT3(config, weeklyCR, dailyCRs, pipeline, intraday, pool);
        break;
    }

    const pastDue = pipeline?.pastDue ?? null;
    const callQueue = pipeline?.callQueue ?? null;
    const pipelineSize = pipeline
      ? (pipeline.newLeads + pipeline.todaysFollowUps + (pipeline.pastDue ?? 0))
      : null;

    results.push({
      name: agent.name,
      tier: agent.tier,
      site: agent.site,
      manager: agent.manager,
      action: result.action,
      severity: result.severity,
      reason: result.reason,
      metrics: {
        weeklyCR,
        dailyCRs,
        pastDue,
        pipelineSize,
        callQueue,
        poolDials: pool?.poolDials ?? 0,
        todaysLeads: intraday
          ? intraday.ibLeadsDelivered + intraday.obLeads
          : 0,
        todaysSales: intraday
          ? intraday.ibSales + intraday.obSales
          : 0,
        todaysDials: intraday?.totalDials ?? 0,
        todaysTalkMin: intraday?.talkTimeMin ?? 0,
      },
    });
  }

  // Sort by severity: critical first, then warning, then info
  const severityRank: Record<ActionSeverity, number> = { critical: 0, warning: 1, info: 2 };
  results.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return results;
}

// ---- Helpers for display ----

export function getActionLabel(action: ActionType): string {
  switch (action) {
    case "TAKE_MORE_LEADS": return "Take More Leads";
    case "WORK_FOLLOWUPS": return "Work Follow-Ups";
    case "GET_IN_POOL": return "Get in Pool";
    case "CLEAR_PIPELINE": return "Clear Pipeline";
    case "REVIEW_QUALITY": return "Review Quality";
    case "ON_TRACK": return "On Track";
  }
}

export function getActionColor(action: ActionType): string {
  switch (action) {
    case "TAKE_MORE_LEADS": return "text-blue-400 bg-blue-500/10 border-blue-500/30";
    case "WORK_FOLLOWUPS": return "text-amber-400 bg-amber-500/10 border-amber-500/30";
    case "GET_IN_POOL": return "text-cyan-400 bg-cyan-500/10 border-cyan-500/30";
    case "CLEAR_PIPELINE": return "text-red-400 bg-red-500/10 border-red-500/30";
    case "REVIEW_QUALITY": return "text-orange-400 bg-orange-500/10 border-orange-500/30";
    case "ON_TRACK": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  }
}

export function getSeverityColor(severity: ActionSeverity): string {
  switch (severity) {
    case "critical": return "text-red-400";
    case "warning": return "text-amber-400";
    case "info": return "text-muted-foreground";
  }
}
