import type { Tier, FunnelMetrics } from "./types";

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
  | "QUEUE_BLOAT"
  | "HIGH_PERFORMER";

export const FLAG_META: Record<BehavioralFlag, { label: string; description: string; severity: "critical" | "warning" | "positive" }> = {
  CHERRY_PICKER:      { label: "Cherry Picker",       description: "Only works fresh leads, ignores past dues",        severity: "warning" },
  PIPELINE_HOARDER:   { label: "Pipeline Hoarder",    description: "Huge call queue relative to dials made",           severity: "critical" },
  FOLLOWUP_AVOIDER:   { label: "Follow-up Avoider",   description: "Past dues piling up vs today's appointments",      severity: "critical" },
  POOL_FARMER:        { label: "Pool Farmer",          description: "Working pool while own pipeline is full",          severity: "warning" },
  DEAD_WEIGHT_CARRIER:{ label: "Dead Weight Carrier",  description: "Premium at stake far exceeds premium written",     severity: "critical" },
  QUEUE_BLOAT:        { label: "Queue Bloat",          description: "Queue exceeds 150 — leads not being withdrawn after 6 attempts", severity: "warning" },
  HIGH_PERFORMER:     { label: "High Performer",       description: "Clean pipeline AND converting above team average", severity: "positive" },
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
  // Legacy DB columns from the old "stale" model. Kept on the row type so
  // existing readers don't break, but no longer used in computation —
  // pipelineIntelligence now derives everything from the raw CRM buckets above.
  total_stale: number | null;
  revenue_at_risk: number | null;
  projected_recovery: number | null;
}

export interface PipelineAgent {
  name: string;
  tier: Tier;
  site: string;
  manager: string | null;
  /** ADP-sourced original hire date (YYYY-MM-DD). Drives tenure cohorts. */
  hiredDate: string | null;

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

  // Pipeline compliance — raw CRM buckets the agent actually sees.
  pastDue: number;          // missed-appointment count from #past-due-follow-ups
  newLeads: number;         // untouched leads from #user-new-leads
  callQueue: number;        // active dialer queue from #call-queue-count-field
  todaysFollowUps: number;
  postSaleLeads: number;

  // Simplified model (replaces the old "stale" composite):
  //   actionableLeads = pastDue + newLeads     ← things the agent must act on now
  //   premiumAtStake  = actionableLeads × avgPremium  ← theoretical max $ sitting on shelf
  // Active call queue is tracked but does NOT contribute to either — the cadence
  // engine is working it, so penalising it would punish agents for healthy workload.
  actionableLeads: number;
  premiumAtStake: number;

  // Legacy aliases — preserved so older consumers keep compiling. They now point
  // at the new honest numbers (no synthetic 10%-of-queue contribution).
  /** @deprecated use actionableLeads */
  totalStale: number;
  /** @deprecated use premiumAtStake */
  revenueAtRisk: number;
  /** @deprecated derive from premiumAtStake × closeRate at the call site if needed */
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

/**
 * Pipeline Freshness — what % of the agent's visible pipeline is *actionable backlog*
 * (past dues + untouched) vs *active queue* being worked by the cadence engine.
 *
 * Heavier on past-due / untouched = lower score (you're letting things rot).
 * Heavier on call queue = higher score (cadence is doing its job).
 */
function calcPipelineFreshness(actionableLeads: number, callQueue: number): number {
  const total = actionableLeads + callQueue;
  if (total === 0) return 25;
  const ratio = 1 - Math.min(actionableLeads / total, 1);
  return ratio * 25;
}

function calcWorkRate(
  totalDials: number,
  newLeads: number, callQueue: number, pastDue: number, todaysFollowUps: number,
): number {
  const pipeline = newLeads + callQueue + pastDue + todaysFollowUps;
  if (pipeline === 0) return 25;
  // totalDials from Calls Report already includes pool dials
  const ratio = Math.min(totalDials / pipeline, 1);
  return ratio * 25;
}

function calcConversionEfficiency(
  totalSales: number,
  totalLeads: number,
  tierAvgCR: number,
  funnel?: FunnelMetrics,
): number {
  if (totalLeads === 0 || tierAvgCR === 0) return 12.5;

  const agentCR = totalSales / totalLeads;
  const crRatio = Math.min(agentCR / tierAvgCR, 1.5);
  const baseScore = (crRatio / 1.5) * 25;

  if (!funnel || funnel.leadsWorked === 0) return Math.min(baseScore, 25);

  // Presentation to Close % — how well the agent converts 15+ min calls to sales
  const presToClose = funnel.presentationToClosePct / 100;
  // Contact to Close % — overall efficiency from contact to sale
  const contactToClose = funnel.contactToClosePct / 100;

  const presBonus = (presToClose > 0.3 ? 3 : presToClose > 0.15 ? 1.5 : presToClose > 0 ? 0 : -1.5);
  const contactBonus = (contactToClose > 0.15 ? 3 : contactToClose > 0.08 ? 1.5 : contactToClose > 0 ? 0 : -1.5);

  return Math.max(0, Math.min(25, baseScore + presBonus + contactBonus));
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

  const poolPct = agent.totalDials > 0 ? (agent.poolDials / agent.totalDials) * 100 : 0;
  if (poolPct > 45 && agent.callQueue > 10) {
    flags.push("POOL_FARMER");
  }

  if (agent.premiumAtStake > 0 && agent.totalPremium > 0 && agent.premiumAtStake > 2 * agent.totalPremium) {
    flags.push("DEAD_WEIGHT_CARRIER");
  }

  if (agent.callQueue > 150) {
    flags.push("QUEUE_BLOAT");
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

// Unified flat model. Floors used when an agent has too little history to
// trust their personal averages. The synthetic STALE_QUEUE_RATE constant
// from the previous "stale" model has been removed — actionable leads now
// equal exactly what the agent sees in CRM (past dues + untouched).
const UNIFIED_FALLBACK_PREMIUM = 700;
const UNIFIED_FALLBACK_CR = 0.1;
const MIN_DAYS_FOR_AGENT_STATS = 3;

/** Org-wide marketing row (CPC, avg premium) synced from Marketing AAR into ROLI. */
export interface MarketingContext {
  avgPremium: number;
  cpc?: number;
}

export function buildPipelineAgents(
  productionRows: ProductionRow[],
  poolRows: PoolRow[],
  complianceRows: PipelineComplianceRow[],
  agentRoster: Map<string, { name: string; site: string; tier: string; manager?: string | null; hired_date?: string | null }>,
  historicalStats?: Map<string, HistoricalAgentStats>,
  priorDayCompliance?: Map<string, PriorDayCompliance>,
  funnelMap?: Map<string, FunnelMetrics>,
  marketingContext?: MarketingContext | null,
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
  const mktAvgPrem = marketingContext?.avgPremium;
  for (const [tier, agg] of Array.from(tierAgg)) {
    tierAvgCRMap.set(tier, agg.totalLeads > 0 ? agg.totalSales / agg.totalLeads : UNIFIED_FALLBACK_CR);
    tierAvgPremMap.set(
      tier,
      agg.totalSales > 0 ? agg.totalPremium / agg.totalSales : (mktAvgPrem && mktAvgPrem > 0 ? mktAvgPrem : UNIFIED_FALLBACK_PREMIUM),
    );
  }

  const agents: PipelineAgent[] = [];

  for (const name of Array.from(allNames)) {
    const comp = complianceMap.get(name);
    if (!comp) continue;

    if (agentRoster.size > 0 && !agentRoster.has(name)) continue;

    const prod = prodMap.get(name);
    const pool = poolMap.get(name);
    const roster = agentRoster.get(name);
    const hist = historicalStats?.get(name);

    const tier = (roster?.tier ?? comp.tier ?? "T3") as Tier;
    const site = roster?.site ?? "RMT";
    const manager = roster?.manager ?? null;
    const hiredDate = roster?.hired_date ?? null;

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
    const tierAvgPrem = tierAvgPremMap.get(tier) ?? (mktAvgPrem && mktAvgPrem > 0 ? mktAvgPrem : UNIFIED_FALLBACK_PREMIUM);
    const tierAvgCR = tierAvgCRMap.get(tier) ?? UNIFIED_FALLBACK_CR;

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

    // --- Simplified pipeline math ---
    // actionableLeads = the two CRM buckets that demand the agent's attention NOW.
    // premiumAtStake  = theoretical max revenue sitting on the shelf (option B).
    const actionableLeads = pastDue + newLeads;
    const premiumAtStake = Math.round(actionableLeads * avgPremium);

    // --- Follow-up compliance with day-over-day delta ---
    const prior = priorDayCompliance?.get(name);
    const pastDueDelta = prior != null ? pastDue - prior.pastDue : null;

    const followUpDiscipline = calcFollowUpDiscipline(pastDue, todaysFollowUps);
    const pipelineFreshness = calcPipelineFreshness(actionableLeads, callQueue);
    const workRateScore = calcWorkRate(totalDials, newLeads, callQueue, pastDue, todaysFollowUps);
    const totalLeads = ibLeads + obLeads;
    const agentFunnel = funnelMap?.get(name);
    const conversionEfficiency = calcConversionEfficiency(totalSales, totalLeads, tierAvgCR, agentFunnel);

    const healthScore = Math.round(followUpDiscipline + pipelineFreshness + workRateScore + conversionEfficiency);

    const followUpCompliance = (pastDue + todaysFollowUps) > 0
      ? (1 - pastDue / (pastDue + todaysFollowUps)) * 100
      : 100;

    const wasteRatio = (totalPremium + premiumAtStake) > 0
      ? (premiumAtStake / (totalPremium + premiumAtStake)) * 100
      : 0;

    const agent: PipelineAgent = {
      name, tier, site, manager, hiredDate,
      totalDials, totalSales, totalPremium, talkTimeMin,
      ibLeads, obLeads, ibSales, obSales,
      poolDials, poolTalk, poolSelfAssigned, poolSales, poolAnswered,
      pastDue, newLeads, callQueue, todaysFollowUps, postSaleLeads,
      actionableLeads, premiumAtStake,
      // Legacy aliases — same numbers, old names so nothing breaks until consumers migrate.
      totalStale: actionableLeads,
      revenueAtRisk: premiumAtStake,
      projectedRecovery: Math.round(actionableLeads * closeRate * avgPremium),
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
  totalActionableLeads: number;
  totalPremiumAtStake: number;
  orgFollowUpCompliance: number;
  agentCount: number;
  gradeDistribution: Record<HealthGrade, number>;
  flagCounts: Record<BehavioralFlag, string[]>;
  topRiskAgents: PipelineAgent[];
  // Legacy aliases mirroring the new fields above so existing UI keeps compiling.
  /** @deprecated use totalPremiumAtStake */
  totalRevenueAtRisk: number;
  /** @deprecated derive at the call site if you really need it */
  totalProjectedRecovery: number;
  /** @deprecated use topRiskAgents */
  topRecoveryAgents: PipelineAgent[];
}

export function buildPipelineSummary(agents: PipelineAgent[]): PipelineSummary {
  if (agents.length === 0) {
    return {
      avgHealthScore: 0,
      totalActionableLeads: 0,
      totalPremiumAtStake: 0,
      totalRevenueAtRisk: 0,
      totalProjectedRecovery: 0,
      orgFollowUpCompliance: 0,
      agentCount: 0,
      gradeDistribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
      flagCounts: {
        CHERRY_PICKER: [], PIPELINE_HOARDER: [], FOLLOWUP_AVOIDER: [],
        POOL_FARMER: [], DEAD_WEIGHT_CARRIER: [], QUEUE_BLOAT: [],
        HIGH_PERFORMER: [],
      },
      topRiskAgents: [],
      topRecoveryAgents: [],
    };
  }

  const totalHealth = agents.reduce((s, a) => s + a.healthScore, 0);
  const totalPastDue = agents.reduce((s, a) => s + a.pastDue, 0);
  const totalFollowUps = agents.reduce((s, a) => s + a.todaysFollowUps, 0);
  const totalActionableLeads = agents.reduce((s, a) => s + a.actionableLeads, 0);
  const totalPremiumAtStake = agents.reduce((s, a) => s + a.premiumAtStake, 0);

  const gradeDistribution: Record<HealthGrade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const a of agents) gradeDistribution[a.healthGrade]++;

  const flagCounts: Record<BehavioralFlag, string[]> = {
    CHERRY_PICKER: [], PIPELINE_HOARDER: [], FOLLOWUP_AVOIDER: [],
    POOL_FARMER: [], DEAD_WEIGHT_CARRIER: [], QUEUE_BLOAT: [],
    HIGH_PERFORMER: [],
  };
  for (const a of agents) {
    for (const f of a.flags) flagCounts[f].push(a.name);
  }

  const topRisk = [...agents]
    .sort((a, b) => b.premiumAtStake - a.premiumAtStake)
    .slice(0, 5);

  return {
    avgHealthScore: Math.round(totalHealth / agents.length),
    totalActionableLeads,
    totalPremiumAtStake,
    totalRevenueAtRisk: totalPremiumAtStake,
    totalProjectedRecovery: agents.reduce((s, a) => s + a.projectedRecovery, 0),
    orgFollowUpCompliance: (totalPastDue + totalFollowUps) > 0
      ? (1 - totalPastDue / (totalPastDue + totalFollowUps)) * 100
      : 100,
    agentCount: agents.length,
    gradeDistribution,
    flagCounts,
    topRiskAgents: topRisk,
    topRecoveryAgents: topRisk,
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
