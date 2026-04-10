import type { Tier } from "./types";
import { TIER_CONFIGS, type TierConfig } from "./tierTargets";
import { UNIFIED_CONFIG, UNIFIED_POOL } from "./unifiedTargets";

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
  poolSelfAssigned: number;
  poolPct: number;
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
  intraday: IntradaySnapshot | undefined,
  pool: PoolSnapshot | undefined,
): { action: ActionType; severity: ActionSeverity; reason: string } {
  const pastDue = pipeline?.pastDue ?? 0;
  const callQueue = pipeline?.callQueue ?? 0;
  const consecutiveLow = countConsecutiveLowCRDays(dailyCRs, config.CR_CRISIS);
  const poolDials = pool?.poolDials ?? 0;
  const totalDials = intraday?.totalDials ?? 0;
  const poolPct = totalDials > 0 ? (poolDials / totalDials) * 100 : 0;
  const poolAnswered = pool?.poolAnswered ?? 0;
  const poolSelfAssigned = pool?.poolSelfAssigned ?? 0;
  const assignRate = poolAnswered > 0 ? (poolSelfAssigned / poolAnswered) * 100 : 0;

  // P1: Past due follow-ups are always critical
  if (pastDue > 0) {
    return {
      action: "WORK_FOLLOWUPS",
      severity: "critical",
      reason: `${pastDue} past due follow-up${pastDue > 1 ? "s" : ""}. T3 standard is zero past due — work scheduled appointments before any pool or queue activity.`,
    };
  }

  // P2: Queue over 120 is critically bloated (spam risk compounds with large queues)
  if (callQueue > 120) {
    return {
      action: "CLEAR_PIPELINE",
      severity: "critical",
      reason: `Queue bloated at ${callQueue} leads (critical: >120). Stop pool sessions and withdraw leads past 6 contact attempts — large queues amplify spam flagging.`,
    };
  }

  // P3: Sustained low close rate
  if (consecutiveLow >= config.CR_CRISIS_DAYS && weeklyCR !== null) {
    return {
      action: "REVIEW_QUALITY",
      severity: "critical",
      reason: `Close rate below ${config.CR_CRISIS}% for ${consecutiveLow} consecutive days (weekly: ${weeklyCR.toFixed(0)}%). Audit call quality and qualification.`,
    };
  }

  // P4: Queue over max (80) needs cleanup
  if (callQueue > config.MAX_PIPELINE) {
    return {
      action: "CLEAR_PIPELINE",
      severity: "warning",
      reason: `Queue at ${callQueue} (max ${config.MAX_PIPELINE}). Withdraw stale contacts past 6 attempts before adding more from pool.`,
    };
  }

  // P5: Pool-first check — agent spending too much time in queue
  if (totalDials > 0 && poolPct < 55) {
    return {
      action: "GET_IN_POOL",
      severity: "warning",
      reason: `Pool dials at ${poolPct.toFixed(0)}% of total (target: 55-80%). Shift time from queue to pool — queue dialing causes spam flags.`,
    };
  }

  // P6: Low self-assign rate in pool
  if (poolAnswered > 10 && assignRate < 30) {
    return {
      action: "GET_IN_POOL",
      severity: "warning",
      reason: `Pool assign rate at ${assignRate.toFixed(0)}% (target: 40%+). Self-assign every answered contact to remove from rotation.`,
    };
  }

  return {
    action: "ON_TRACK",
    severity: "info",
    reason: weeklyCR !== null
      ? `CR ${weeklyCR.toFixed(0)}% · Queue ${callQueue} · Pool ${poolPct.toFixed(0)}% · Past due ${pastDue} — on track.`
      : `Queue ${callQueue} · Pool ${poolPct.toFixed(0)}% · Past due ${pastDue} — on track.`,
  };
}

function recommendUnified(
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
  const poolSelfAssigned = pool?.poolSelfAssigned ?? 0;

  if (pastDue > 0) {
    return {
      action: "WORK_FOLLOWUPS",
      severity: "critical",
      reason: `${pastDue} past due follow-up${pastDue > 1 ? "s" : ""} — $${pastDue * config.LEAD_COST} in lead spend at risk. Work these before taking any new calls or entering the pool.`,
    };
  }

  if (pipelineSize > config.MAX_PIPELINE) {
    return {
      action: "CLEAR_PIPELINE",
      severity: "critical",
      reason: `Pipeline at ${pipelineSize} leads (max ${config.MAX_PIPELINE}). Close out stale leads before accepting new inbound or pool contacts.`,
    };
  }

  if (consecutiveLow >= config.CR_CRISIS_DAYS && weeklyCR !== null) {
    return {
      action: "REVIEW_QUALITY",
      severity: "critical",
      reason: `Close rate below ${config.CR_CRISIS}% for ${consecutiveLow} consecutive days (weekly: ${weeklyCR.toFixed(0)}%). Audit call quality and presentations.`,
    };
  }

  if (weeklyCR !== null && weeklyCR < config.CR_FLOOR) {
    return {
      action: "WORK_FOLLOWUPS",
      severity: "warning",
      reason: `Weekly CR at ${weeklyCR.toFixed(0)}% (floor: ${config.CR_FLOOR}%). Focus on converting existing pipeline before taking more volume.`,
    };
  }

  if (poolSelfAssigned < UNIFIED_POOL.FOLLOWUPS_PER_DAY && (intraday?.talkTimeMin ?? 0) > 60) {
    return {
      action: "GET_IN_POOL",
      severity: "warning",
      reason: `Only ${poolSelfAssigned} pool self-assigns today (target: ${UNIFIED_POOL.FOLLOWUPS_PER_DAY}). Find 5 people from the pool to follow up with.`,
    };
  }

  if (
    weeklyCR !== null &&
    weeklyCR >= config.CR_TARGET &&
    pipelineSize < 20 &&
    pastDue === 0
  ) {
    return {
      action: "TAKE_MORE_LEADS",
      severity: "info",
      reason: `CR at ${weeklyCR.toFixed(0)}% with clean pipeline (${pipelineSize} leads). Eligible for additional leads beyond 7/day.`,
    };
  }

  if (pipelineSize < 10 && (pool?.poolDials ?? 0) === 0) {
    return {
      action: "GET_IN_POOL",
      severity: "info",
      reason: `Light pipeline at ${pipelineSize} leads with zero pool dials. Pool session will build follow-up pipeline.`,
    };
  }

  return {
    action: "ON_TRACK",
    severity: "info",
    reason: weeklyCR !== null
      ? `CR ${weeklyCR.toFixed(0)}% · Pipeline ${pipelineSize} · Pool assigns ${poolSelfAssigned} — on track.`
      : `Pipeline ${pipelineSize} · Pool assigns ${poolSelfAssigned} — on track.`,
  };
}

// ---- Public API ----

export function computeRecommendations(
  weeklyStats: WeeklyAgentStats[],
  pipelineMap: Map<string, PipelineSnapshot>,
  intradayMap: Map<string, IntradaySnapshot>,
  poolMap: Map<string, PoolSnapshot>,
  useUnified = true,
): AgentRecommendation[] {
  const results: AgentRecommendation[] = [];

  for (const agent of weeklyStats) {
    const config = useUnified ? UNIFIED_CONFIG : TIER_CONFIGS[agent.tier];
    const { weeklyCR, dailyCRs } = computeWeeklyCR(agent.dailyRows, agent.tier);
    const pipeline = pipelineMap.get(agent.name);
    const intraday = intradayMap.get(agent.name);
    const pool = poolMap.get(agent.name);

    let result: { action: ActionType; severity: ActionSeverity; reason: string };

    if (useUnified) {
      result = recommendUnified(config, weeklyCR, dailyCRs, pipeline, intraday, pool);
    } else {
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
    }

    const pastDue = pipeline?.pastDue ?? null;
    const callQueue = pipeline?.callQueue ?? null;
    const pipelineSize = pipeline
      ? (pipeline.newLeads + pipeline.todaysFollowUps + (pipeline.pastDue ?? 0))
      : null;
    const poolDials = pool?.poolDials ?? 0;
    const poolSelfAssigned = pool?.poolSelfAssigned ?? 0;
    const totalDials = intraday?.totalDials ?? 0;
    const poolPct = totalDials > 0 ? (poolDials / totalDials) * 100 : 0;

    const todaysLeads = intraday ? intraday.ibLeadsDelivered + intraday.obLeads : 0;
    const todaysSales = intraday ? intraday.ibSales + intraday.obSales : 0;

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
        poolDials,
        poolSelfAssigned,
        poolPct,
        todaysLeads,
        todaysSales,
        todaysDials: totalDials,
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
