import type { Tier } from "./types";

// ============================================================
// Pipeline Intelligence — Types & Computation Engine
// Combines daily production, leads pool, and pipeline compliance
// ============================================================

export type HealthGrade = "A" | "B" | "C" | "D" | "F";

export type BehavioralFlag =
  | "CHERRY_PICKER"
  | "PIPELINE_HOARDER"
  | "FOLLOWUP_AVOIDER"
  | "POOL_FARMER"
  | "DEAD_WEIGHT_CARRIER"
  | "HIGH_PERFORMER";

export const FLAG_META: Record<BehavioralFlag, { label: string; description: string; severity: "critical" | "warning" | "positive" }> = {
  CHERRY_PICKER:      { label: "Cherry Picker",       description: "Only works fresh leads, abandons older ones",     severity: "warning" },
  PIPELINE_HOARDER:   { label: "Pipeline Hoarder",    description: "Sitting on leads without working them",           severity: "critical" },
  FOLLOWUP_AVOIDER:   { label: "Follow-up Avoider",   description: "Letting follow-ups rot",                          severity: "critical" },
  POOL_FARMER:        { label: "Pool Farmer",          description: "Avoiding assigned pipeline for pool",             severity: "warning" },
  DEAD_WEIGHT_CARRIER:{ label: "Dead Weight Carrier",  description: "Carrying massive unrealized revenue",             severity: "critical" },
  HIGH_PERFORMER:     { label: "High Performer",       description: "Clean pipeline AND converting well",              severity: "positive" },
};

export interface PipelineComplianceRow {
  scrape_date: string;
  agent_name: string;
  agent_id_crm: string | null;
  tier: string;
  past_due_follow_ups: number | null;
  new_leads: number | null;
  call_queue_count: number | null;
  todays_follow_ups: number | null;
  post_sale_leads: number | null;
  total_stale: number | null;
  revenue_at_risk: number | null;
  projected_recovery: number | null;
}

export interface PipelineAgent {
  name: string;
  tier: Tier;
  site: string;
  manager: string | null;

  // Production (daily_scrape_data)
  totalDials: number;
  totalSales: number;
  totalPremium: number;
  talkTimeMin: number;
  ibLeads: number;
  obLeads: number;
  ibSales: number;
  obSales: number;

  // Pool (leads_pool_daily_data)
  poolDials: number;
  poolTalk: number;
  poolSelfAssigned: number;
  poolSales: number;
  poolAnswered: number;

  // Pipeline compliance (pipeline_compliance_daily)
  pastDue: number;
  newLeads: number;
  callQueue: number;
  todaysFollowUps: number;
  postSaleLeads: number;
  totalStale: number;
  revenueAtRisk: number;
  projectedRecovery: number;

  // Revenue model transparency
  avgPremium: number;
  closeRate: number;
  premiumSource: "agent" | "tier";
  closeRateSource: "agent" | "tier";
  tierAvgPremium: number;
  tierAvgCloseRate: number;

  // Follow-up compliance (enhanced)
  pastDueDelta: number | null;

  // Derived sub-scores (0–25 each)
  followUpDiscipline: number;
  pipelineFreshness: number;
  workRate: number;
  conversionEfficiency: number;

  // Composite
  healthScore: number;
  healthGrade: HealthGrade;
  flags: BehavioralFlag[];
  followUpCompliance: number;
  wasteRatio: number;
}

// ---- Sub-score calculators (each returns 0–25) ----

function calcFollowUpDiscipline(pastDue: number, todaysFollowUps: number): number {
  const total = pastDue + todaysFollowUps;
  if (total === 0) return 25;
  return (1 - pastDue / total) * 25;
}

function calcPipelineFreshness(totalStale: number, newLeads: number, callQueue: number, pastDue: number): number {
  const total = newLeads + callQueue + pastDue;
  if (total === 0) return 25;
  const ratio = 1 - Math.min(totalStale / total, 1);
  return ratio * 25;
}

function calcWorkRate(
  totalDials: number, poolDials: number,
  newLeads: number, callQueue: number, pastDue: number, todaysFollowUps: number,
): number {
  const pipeline = newLeads + callQueue + pastDue + todaysFollowUps;
  if (pipeline === 0) return 25;
  const ratio = Math.min((totalDials + poolDials) / pipeline, 1);
  return ratio * 25;
}

function calcConversionEfficiency(totalSales: number, totalLeads: number, tierAvgCR: number): number {
  if (totalLeads === 0 || tierAvgCR === 0) return 12.5;
  const agentCR = totalSales / totalLeads;
  const ratio = Math.min(agentCR / tierAvgCR, 1.5);
  return Math.min((ratio / 1.5) * 25, 25);
}

function calcHealthGrade(score: number, flags: BehavioralFlag[]): HealthGrade {
  const criticalFlags = flags.filter(f => FLAG_META[f].severity === "critical");
  const nonPositiveFlags = flags.filter(f => FLAG_META[f].severity !== "positive");

  if (score >= 85 && nonPositiveFlags.length === 0) return "A";
  if (score >= 70 && nonPositiveFlags.length <= 1 && criticalFlags.length === 0) return "B";
  if (score >= 55 && criticalFlags.length === 0) return "C";
  if (score >= 40 && criticalFlags.length <= 1) return "D";
  return "F";
}

// ---- Behavioral flag detection ----

function detectFlags(agent: PipelineAgent, tierAvgCR: number): BehavioralFlag[] {
  const flags: BehavioralFlag[] = [];
  const totalLeads = agent.ibLeads + agent.obLeads;
  const totalSales = agent.ibSales + agent.obSales;
  const agentCR = totalLeads > 0 ? totalSales / totalLeads : 0;

  if (agent.newLeads > 5 && agent.pastDue < 3 && agent.callQueue < 5) {
    flags.push("CHERRY_PICKER");
  }

  if (agent.callQueue > 0 && agent.totalDials > 0 && agent.callQueue > 2 * agent.totalDials) {
    flags.push("PIPELINE_HOARDER");
  }

  if (agent.pastDue > 0 && agent.todaysFollowUps > 0 && agent.pastDue > 3 * agent.todaysFollowUps) {
    flags.push("FOLLOWUP_AVOIDER");
  }

  if (agent.poolDials > agent.totalDials && agent.totalDials > 0 && agent.callQueue > 10) {
    flags.push("POOL_FARMER");
  }

  if (agent.revenueAtRisk > 0 && agent.totalPremium > 0 && agent.revenueAtRisk > 2 * agent.totalPremium) {
    flags.push("DEAD_WEIGHT_CARRIER");
  }

  if (agent.healthScore >= 80 && agentCR > tierAvgCR && totalLeads > 0) {
    flags.push("HIGH_PERFORMER");
  }

  return flags;
}

// ---- Main builder ----

export interface ProductionRow {
  agent_name: string;
  tier: string;
  ib_leads_delivered: number;
  ob_leads_delivered: number;
  ib_sales: number;
  ob_sales: number;
  custom_sales: number;
  ib_premium: number;
  ob_premium: number;
  custom_premium: number;
  total_dials: number;
  talk_time_minutes: number;
}

export interface PoolRow {
  agent_name: string;
  calls_made: number;
  talk_time_minutes: number;
  sales_made: number;
  premium: number;
  self_assigned_leads: number;
  answered_calls: number;
}

export interface HistoricalAgentStats {
  totalSales: number;
  totalLeads: number;
  totalPremium: number;
  days: number;
}

export interface PriorDayCompliance {
  pastDue: number;
}

const STALE_QUEUE_RATE: Record<string, number> = { T1: 0.15, T2: 0.10, T3: 0.08 };
const FALLBACK_PREMIUM: Record<string, number> = { T1: 400, T2: 300, T3: 250 };
const FALLBACK_CR: Record<string, number> = { T1: 0.08, T2: 0.06, T3: 0.04 };
const MIN_DAYS_FOR_AGENT_STATS = 3;

export function buildPipelineAgents(
  productionRows: ProductionRow[],
  poolRows: PoolRow[],
  complianceRows: PipelineComplianceRow[],
  agentRoster: Map<string, { name: string; site: string; tier: string; manager?: string | null }>,
  historicalStats?: Map<string, HistoricalAgentStats>,
  priorDayCompliance?: Map<string, PriorDayCompliance>,
): PipelineAgent[] {
  const complianceMap = new Map<string, PipelineComplianceRow>();
  for (const row of complianceRows) complianceMap.set(row.agent_name, row);

  const poolMap = new Map<string, PoolRow>();
  for (const row of poolRows) poolMap.set(row.agent_name, row);

  const prodMap = new Map<string, ProductionRow>();
  for (const row of productionRows) prodMap.set(row.agent_name, row);

  const allNames = new Set([
    ...Array.from(complianceMap.keys()),
    ...Array.from(prodMap.keys()),
  ]);

  // Aggregate tier-level stats from historical data (or today's data as fallback)
  const tierAgg = new Map<string, { totalSales: number; totalLeads: number; totalPremium: number }>();

  if (historicalStats && historicalStats.size > 0) {
    for (const [name, stats] of Array.from(historicalStats)) {
      const roster = agentRoster.get(name);
      const tier = roster?.tier ?? "T3";
      const agg = tierAgg.get(tier) ?? { totalSales: 0, totalLeads: 0, totalPremium: 0 };
      agg.totalSales += stats.totalSales;
      agg.totalLeads += stats.totalLeads;
      agg.totalPremium += stats.totalPremium;
      tierAgg.set(tier, agg);
    }
  } else {
    for (const name of Array.from(allNames)) {
      const prod = prodMap.get(name);
      if (!prod) continue;
      const roster = agentRoster.get(name);
      const tier = prod.tier ?? roster?.tier ?? "T3";
      const agg = tierAgg.get(tier) ?? { totalSales: 0, totalLeads: 0, totalPremium: 0 };
      agg.totalSales += (prod.ib_sales ?? 0) + (prod.ob_sales ?? 0) + (prod.custom_sales ?? 0);
      agg.totalLeads += (prod.ib_leads_delivered ?? 0) + (prod.ob_leads_delivered ?? 0);
      agg.totalPremium += (prod.ib_premium ?? 0) + (prod.ob_premium ?? 0) + (prod.custom_premium ?? 0);
      tierAgg.set(tier, agg);
    }
  }

  const tierAvgCRMap = new Map<string, number>();
  const tierAvgPremMap = new Map<string, number>();
  for (const [tier, agg] of Array.from(tierAgg)) {
    tierAvgCRMap.set(tier, agg.totalLeads > 0 ? agg.totalSales / agg.totalLeads : FALLBACK_CR[tier] ?? 0.06);
    tierAvgPremMap.set(tier, agg.totalSales > 0 ? agg.totalPremium / agg.totalSales : FALLBACK_PREMIUM[tier] ?? 300);
  }

  const agents: PipelineAgent[] = [];

  for (const name of Array.from(allNames)) {
    const comp = complianceMap.get(name);
    if (!comp) continue;

    const prod = prodMap.get(name);
    const pool = poolMap.get(name);
    const roster = agentRoster.get(name);
    const hist = historicalStats?.get(name);

    const tier = (roster?.tier ?? comp.tier ?? "T3") as Tier;
    const site = roster?.site ?? "CHA";
    const manager = roster?.manager ?? null;

    const totalDials = prod?.total_dials ?? 0;
    const ibLeads = prod?.ib_leads_delivered ?? 0;
    const obLeads = prod?.ob_leads_delivered ?? 0;
    const ibSales = prod?.ib_sales ?? 0;
    const obSales = prod?.ob_sales ?? 0;
    const totalSales = ibSales + obSales + (prod?.custom_sales ?? 0);
    const totalPremium = (prod?.ib_premium ?? 0) + (prod?.ob_premium ?? 0) + (prod?.custom_premium ?? 0);
    const talkTimeMin = prod?.talk_time_minutes ?? 0;
    const poolDials = pool?.calls_made ?? 0;
    const poolTalk = pool?.talk_time_minutes ?? 0;
    const poolSelfAssigned = pool?.self_assigned_leads ?? 0;
    const poolSales = pool?.sales_made ?? 0;
    const poolAnswered = pool?.answered_calls ?? 0;

    const pastDue = comp.past_due_follow_ups ?? 0;
    const newLeads = comp.new_leads ?? 0;
    const callQueue = comp.call_queue_count ?? 0;
    const todaysFollowUps = comp.todays_follow_ups ?? 0;
    const postSaleLeads = comp.post_sale_leads ?? 0;

    // --- Data-driven financial modeling ---
    const tierAvgPrem = tierAvgPremMap.get(tier) ?? FALLBACK_PREMIUM[tier] ?? 300;
    const tierAvgCR = tierAvgCRMap.get(tier) ?? FALLBACK_CR[tier] ?? 0.06;

    let avgPremium: number;
    let premiumSource: "agent" | "tier";
    if (hist && hist.days >= MIN_DAYS_FOR_AGENT_STATS && hist.totalSales >= 2) {
      avgPremium = hist.totalPremium / hist.totalSales;
      premiumSource = "agent";
    } else {
      avgPremium = tierAvgPrem;
      premiumSource = "tier";
    }

    let closeRate: number;
    let closeRateSource: "agent" | "tier";
    if (hist && hist.days >= MIN_DAYS_FOR_AGENT_STATS && hist.totalLeads >= 5) {
      closeRate = hist.totalSales / hist.totalLeads;
      closeRateSource = "agent";
    } else {
      closeRate = tierAvgCR;
      closeRateSource = "tier";
    }

    const staleRate = STALE_QUEUE_RATE[tier] ?? 0.10;
    const staleCallQueue = Math.round(callQueue * staleRate);
    const totalStale = pastDue + newLeads + staleCallQueue;
    const revenueAtRisk = Math.round(totalStale * avgPremium);
    const projectedRecovery = Math.round(totalStale * closeRate * avgPremium);

    // --- Follow-up compliance with day-over-day delta ---
    const prior = priorDayCompliance?.get(name);
    const pastDueDelta = prior != null ? pastDue - prior.pastDue : null;

    const followUpDiscipline = calcFollowUpDiscipline(pastDue, todaysFollowUps);
    const pipelineFreshness = calcPipelineFreshness(totalStale, newLeads, callQueue, pastDue);
    const workRateScore = calcWorkRate(totalDials, poolDials, newLeads, callQueue, pastDue, todaysFollowUps);
    const totalLeads = ibLeads + obLeads;
    const conversionEfficiency = calcConversionEfficiency(totalSales, totalLeads, tierAvgCR);

    const healthScore = Math.round(followUpDiscipline + pipelineFreshness + workRateScore + conversionEfficiency);

    const followUpCompliance = (pastDue + todaysFollowUps) > 0
      ? (1 - pastDue / (pastDue + todaysFollowUps)) * 100
      : 100;

    const wasteRatio = (totalPremium + revenueAtRisk) > 0
      ? (revenueAtRisk / (totalPremium + revenueAtRisk)) * 100
      : 0;

    const agent: PipelineAgent = {
      name, tier, site, manager,
      totalDials, totalSales, totalPremium, talkTimeMin,
      ibLeads, obLeads, ibSales, obSales,
      poolDials, poolTalk, poolSelfAssigned, poolSales, poolAnswered,
      pastDue, newLeads, callQueue, todaysFollowUps, postSaleLeads,
      totalStale, revenueAtRisk, projectedRecovery,
      avgPremium, closeRate, premiumSource, closeRateSource,
      tierAvgPremium: tierAvgPrem, tierAvgCloseRate: tierAvgCR,
      pastDueDelta,
      followUpDiscipline, pipelineFreshness, workRate: workRateScore, conversionEfficiency,
      healthScore,
      healthGrade: "C",
      flags: [],
      followUpCompliance,
      wasteRatio,
    };

    agent.flags = detectFlags(agent, tierAvgCR);
    agent.healthGrade = calcHealthGrade(healthScore, agent.flags);

    agents.push(agent);
  }

  return agents.sort((a, b) => b.healthScore - a.healthScore);
}

// ---- Aggregate helpers for executive cards ----

export interface PipelineSummary {
  avgHealthScore: number;
  totalRevenueAtRisk: number;
  totalProjectedRecovery: number;
  orgFollowUpCompliance: number;
  agentCount: number;
  gradeDistribution: Record<HealthGrade, number>;
  flagCounts: Record<BehavioralFlag, string[]>;
  topRiskAgents: PipelineAgent[];
  topRecoveryAgents: PipelineAgent[];
}

export function buildPipelineSummary(agents: PipelineAgent[]): PipelineSummary {
  if (agents.length === 0) {
    return {
      avgHealthScore: 0,
      totalRevenueAtRisk: 0,
      totalProjectedRecovery: 0,
      orgFollowUpCompliance: 0,
      agentCount: 0,
      gradeDistribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
      flagCounts: {
        CHERRY_PICKER: [], PIPELINE_HOARDER: [], FOLLOWUP_AVOIDER: [],
        POOL_FARMER: [], DEAD_WEIGHT_CARRIER: [], HIGH_PERFORMER: [],
      },
      topRiskAgents: [],
      topRecoveryAgents: [],
    };
  }

  const totalHealth = agents.reduce((s, a) => s + a.healthScore, 0);
  const totalPastDue = agents.reduce((s, a) => s + a.pastDue, 0);
  const totalFollowUps = agents.reduce((s, a) => s + a.todaysFollowUps, 0);

  const gradeDistribution: Record<HealthGrade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const a of agents) gradeDistribution[a.healthGrade]++;

  const flagCounts: Record<BehavioralFlag, string[]> = {
    CHERRY_PICKER: [], PIPELINE_HOARDER: [], FOLLOWUP_AVOIDER: [],
    POOL_FARMER: [], DEAD_WEIGHT_CARRIER: [], HIGH_PERFORMER: [],
  };
  for (const a of agents) {
    for (const f of a.flags) flagCounts[f].push(a.name);
  }

  return {
    avgHealthScore: Math.round(totalHealth / agents.length),
    totalRevenueAtRisk: agents.reduce((s, a) => s + a.revenueAtRisk, 0),
    totalProjectedRecovery: agents.reduce((s, a) => s + a.projectedRecovery, 0),
    orgFollowUpCompliance: (totalPastDue + totalFollowUps) > 0
      ? (1 - totalPastDue / (totalPastDue + totalFollowUps)) * 100
      : 100,
    agentCount: agents.length,
    gradeDistribution,
    flagCounts,
    topRiskAgents: [...agents].sort((a, b) => b.revenueAtRisk - a.revenueAtRisk).slice(0, 5),
    topRecoveryAgents: [...agents].sort((a, b) => b.projectedRecovery - a.projectedRecovery).slice(0, 5),
  };
}

export function getHealthColor(score: number): "green" | "amber" | "red" | "blue" {
  if (score >= 80) return "green";
  if (score >= 60) return "amber";
  if (score >= 40) return "blue";
  return "red";
}

export function getGradeColor(grade: HealthGrade): string {
  switch (grade) {
    case "A": return "text-emerald-400";
    case "B": return "text-blue-400";
    case "C": return "text-amber-400";
    case "D": return "text-orange-400";
    case "F": return "text-red-400";
  }
}

export function getGradeBg(grade: HealthGrade): string {
  switch (grade) {
    case "A": return "bg-emerald-500/10 border-emerald-500/30";
    case "B": return "bg-blue-500/10 border-blue-500/30";
    case "C": return "bg-amber-500/10 border-amber-500/30";
    case "D": return "bg-orange-500/10 border-orange-500/30";
    case "F": return "bg-red-500/10 border-red-500/30";
  }
}
