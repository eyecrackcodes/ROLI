import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { buildT3Gates, T3_POOL_KPI } from "@/lib/t3Targets";
import type { ScorecardGate } from "@/lib/t3Targets";
import type { BehavioralFlag } from "@/lib/pipelineIntelligence";
import { FLAG_META } from "@/lib/pipelineIntelligence";

// ---- Raw row shapes ----

interface ProdRow {
  scrape_date: string;
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

interface PoolRow {
  scrape_date: string;
  agent_name: string;
  calls_made: number;
  talk_time_minutes: number;
  sales_made: number;
  premium: number;
  self_assigned_leads: number;
  answered_calls: number;
  long_calls: number;
  contact_rate: number;
}

interface CompRow {
  scrape_date: string;
  agent_name: string;
  past_due_follow_ups: number | null;
  new_leads: number | null;
  call_queue_count: number | null;
  todays_follow_ups: number | null;
  post_sale_leads: number | null;
}

interface AgentRow {
  name: string;
  site: string;
  tier: string;
  manager: string | null;
}

// ---- Merged daily row ----

export interface ProfileDay {
  date: string;
  regDials: number;
  regTalk: number;
  regSales: number;
  regPremium: number;
  ibSales: number;
  obSales: number;
  bonusSales: number;
  ibPremium: number;
  obPremium: number;
  bonusPremium: number;
  ibLeads: number;
  obLeads: number;
  poolDials: number;
  poolTalk: number;
  poolSales: number;
  poolPremium: number;
  poolAnswered: number;
  poolAssigned: number;
  poolLongCalls: number;
  poolContactRate: number;
  pastDue: number | null;
  callQueue: number | null;
  todaysFollowUps: number | null;
  newLeads: number | null;
  postSaleLeads: number | null;
  combinedDials: number;
  combinedTalk: number;
  combinedSales: number;
  combinedPremium: number;
  poolPct: number;
  assignRate: number;
  gates: ScorecardGate[];
  gatesPassed: number;
  compliant: boolean;
}

// ---- Aggregated summary ----

export interface ProfileSummary {
  days: number;
  totalRegDials: number;
  totalPoolDials: number;
  totalCombinedDials: number;
  totalRegTalk: number;
  totalPoolTalk: number;
  totalCombinedTalk: number;
  totalSales: number;
  totalPremium: number;
  totalIbSales: number;
  totalObSales: number;
  totalBonusSales: number;
  totalPoolSales: number;
  totalPoolAssigned: number;
  totalPoolAnswered: number;
  totalPoolLongCalls: number;
  avgCombinedDials: number;
  avgPoolPct: number;
  avgTalkTime: number;
  avgLongCalls: number;
  avgSalesPerDay: number;
  avgPremiumPerDay: number;
  closeRate: number;
  poolCloseRate: number;
  avgAssignRate: number;
  avgPastDue: number;
  avgCallQueue: number;
  latestPastDue: number | null;
  latestQueue: number | null;
  queueTrend: "growing" | "shrinking" | "stable";
  pastDueTrend: "growing" | "shrinking" | "stable";
  compliantDays: number;
  complianceRate: number;
}

// ---- Tier averages for benchmarking ----

export interface TierBenchmark {
  avgDials: number;
  avgTalk: number;
  avgSales: number;
  avgPremium: number;
  avgPoolDials: number;
  avgPoolLongCalls: number;
  avgPoolAssignRate: number;
  agentCount: number;
}

// ---- MTD projection ----

export interface MtdProjection {
  mtdSales: number;
  mtdPremium: number;
  workingDaysElapsed: number;
  workingDaysLeft: number;
  salesPerDay: number;
  projectedSales: number;
  projectedPremium: number;
}

// ---- Coaching signals ----

export interface CoachingSignal {
  type: "strength" | "improvement" | "action" | "benchmark" | "revenue" | "callout" | "projection";
  severity: "positive" | "warning" | "critical" | "info";
  label: string;
  detail: string;
}

// ---- Hook return ----

export interface AgentProfileData {
  agent: AgentRow | null;
  days: ProfileDay[];
  summary: ProfileSummary | null;
  tierBenchmark: TierBenchmark | null;
  mtdProjection: MtdProjection | null;
  coaching: CoachingSignal[];
  flags: BehavioralFlag[];
  loading: boolean;
}

const FALLBACK_PREMIUM = 350;
const FALLBACK_CR = 0.06;

function calcTrend(values: (number | null)[]): "growing" | "shrinking" | "stable" {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return "stable";
  const half = Math.floor(nums.length / 2);
  const first = nums.slice(0, half).reduce((s, v) => s + v, 0) / half;
  const second = nums.slice(half).reduce((s, v) => s + v, 0) / (nums.length - half);
  const delta = second - first;
  if (Math.abs(delta) < 2) return "stable";
  return delta > 0 ? "growing" : "shrinking";
}

function pctDiff(agent: number, tier: number): string {
  if (tier === 0) return "";
  const diff = ((agent - tier) / tier) * 100;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${diff.toFixed(0)}%`;
}

function buildCoaching(
  summary: ProfileSummary,
  days: ProfileDay[],
  flags: BehavioralFlag[],
  tierBench: TierBenchmark | null,
  mtd: MtdProjection | null,
  tier: string,
): CoachingSignal[] {
  const signals: CoachingSignal[] = [];
  const avgPrem = summary.totalSales > 0 ? summary.totalPremium / summary.totalSales : FALLBACK_PREMIUM;
  const cr = summary.closeRate > 0 ? summary.closeRate / 100 : FALLBACK_CR;

  // ======== TIER BENCHMARKS ========
  if (tierBench && tierBench.agentCount > 1) {
    const tb = tierBench;
    if (summary.avgCombinedDials > 0) {
      const combined = summary.avgCombinedDials;
      const tierCombined = tb.avgDials + tb.avgPoolDials;
      signals.push({ type: "benchmark", severity: combined >= tierCombined ? "positive" : "warning",
        label: `Combined dials: ${Math.round(combined)}/day vs ${tier} avg ${Math.round(tierCombined)}`,
        detail: `${pctDiff(combined, tierCombined)} relative to tier. ${combined >= tierCombined ? "Outpacing peers on volume." : "Below peer average — more dialer time needed."}` });
    }
    if (summary.avgLongCalls > 0 || tb.avgPoolLongCalls > 0) {
      signals.push({ type: "benchmark", severity: summary.avgLongCalls >= tb.avgPoolLongCalls ? "positive" : "warning",
        label: `Long calls: ${summary.avgLongCalls.toFixed(1)}/day vs ${tier} avg ${tb.avgPoolLongCalls.toFixed(1)}`,
        detail: `${pctDiff(summary.avgLongCalls, tb.avgPoolLongCalls)} relative to tier. Long calls are the #1 predictor of sales.` });
    }
    if (summary.avgAssignRate > 0 || tb.avgPoolAssignRate > 0) {
      signals.push({ type: "benchmark", severity: summary.avgAssignRate >= tb.avgPoolAssignRate ? "positive" : "warning",
        label: `Assign rate: ${summary.avgAssignRate.toFixed(0)}% vs ${tier} avg ${tb.avgPoolAssignRate.toFixed(0)}%`,
        detail: `${pctDiff(summary.avgAssignRate, tb.avgPoolAssignRate)} relative to tier. Self-assigning every contact keeps the pool clean.` });
    }
    if (summary.avgSalesPerDay > 0 || tb.avgSales > 0) {
      signals.push({ type: "benchmark", severity: summary.avgSalesPerDay >= tb.avgSales ? "positive" : "warning",
        label: `Sales: ${summary.avgSalesPerDay.toFixed(1)}/day vs ${tier} avg ${tb.avgSales.toFixed(1)}`,
        detail: `${pctDiff(summary.avgSalesPerDay, tb.avgSales)} relative to tier. Premium: ${fmt(summary.avgPremiumPerDay)}/day vs ${fmt(tb.avgPremium)}.` });
    }
  }

  // ======== REVENUE IMPACT ========
  if (summary.latestPastDue != null && summary.latestPastDue > 0) {
    const recovery = Math.round(summary.latestPastDue * cr * avgPrem);
    signals.push({ type: "revenue", severity: "critical",
      label: `${summary.latestPastDue} past-due follow-ups = ${fmt(recovery)} recoverable`,
      detail: `At your ${(cr * 100).toFixed(1)}% close rate and ${fmt(avgPrem)} avg premium, clearing these past-due appointments could generate ${fmt(recovery)} in premium.` });
  }
  if (summary.latestQueue != null && summary.latestQueue > 0) {
    const queueValue = Math.round(summary.latestQueue * cr * avgPrem);
    signals.push({ type: "revenue", severity: "info",
      label: `Queue of ${summary.latestQueue} leads = ${fmt(queueValue)} pipeline value`,
      detail: `Working through the 6-attempt cadence on all queue leads represents ${fmt(queueValue)} in potential premium.` });
  }
  if (summary.totalPoolLongCalls > 0 && summary.totalPoolSales > 0) {
    const longCallValue = Math.round(summary.totalPremium / summary.totalPoolLongCalls);
    signals.push({ type: "revenue", severity: "positive",
      label: `Each long call ≈ ${fmt(longCallValue)} in expected premium`,
      detail: `Based on your conversion pattern, each 15+ minute presentation generates ~${fmt(longCallValue)}. Target: ${T3_POOL_KPI.MIN_LONG_CALLS}+/day.` });
  } else if (summary.totalPoolLongCalls > 0) {
    const tierLongCallValue = Math.round(FALLBACK_PREMIUM * FALLBACK_CR * 10);
    signals.push({ type: "revenue", severity: "info",
      label: `Each long call ≈ ${fmt(tierLongCallValue)} expected (tier estimate)`,
      detail: `Using tier-average conversion rates. Get sales to establish your own long-call value.` });
  }

  // ======== DAY-SPECIFIC CALL-OUTS ========
  for (const d of days) {
    if (d.poolDials >= 50 && d.poolLongCalls === 0) {
      signals.push({ type: "callout", severity: "critical",
        label: `${d.date}: ${d.poolDials} pool dials, 0 long calls`,
        detail: `Rapid-skip behavior — dialing through pool without engaging. ${d.poolDials} dials with zero 15+ min conversations.` });
    }
  }
  for (let i = 1; i < days.length; i++) {
    const d = days[i], prev = days[i - 1];
    if (d.pastDue != null && prev.pastDue != null && d.pastDue - prev.pastDue >= 10) {
      signals.push({ type: "callout", severity: "warning",
        label: `${d.date}: Past due jumped +${d.pastDue - prev.pastDue} (${prev.pastDue} → ${d.pastDue})`,
        detail: `Significant spike in missed appointments. Follow-ups scheduled but not executed.` });
    }
  }
  const zeroDays = days.filter(d => d.combinedDials === 0 && d.pastDue != null);
  if (zeroDays.length > 0 && zeroDays.length < days.length) {
    signals.push({ type: "callout", severity: "warning",
      label: `${zeroDays.length} day(s) with zero activity`,
      detail: `No dials on: ${zeroDays.map(d => d.date).join(", ")}. Pipeline data present but no production.` });
  }
  const bestDay = days.reduce((best, d) => d.combinedSales > best.combinedSales ? d : best, days[0]);
  if (bestDay && bestDay.combinedSales > 0) {
    signals.push({ type: "callout", severity: "positive",
      label: `Best day: ${bestDay.date} — ${bestDay.combinedSales} sales, ${fmt(bestDay.combinedPremium)}`,
      detail: `${bestDay.regDials} reg + ${bestDay.poolDials} pool dials, ${bestDay.poolLongCalls} long calls, ${Math.round(bestDay.combinedTalk)}m talk. Use this as the reference benchmark.` });
  }

  // ======== MTD PROJECTION ========
  if (mtd && mtd.workingDaysElapsed > 0) {
    signals.push({ type: "projection", severity: mtd.projectedSales >= 15 ? "positive" : mtd.projectedSales >= 8 ? "info" : "warning",
      label: `Month projection: ~${Math.round(mtd.projectedSales)} sales / ${fmt(mtd.projectedPremium)}`,
      detail: `${mtd.mtdSales} sales through ${mtd.workingDaysElapsed} working days (${mtd.salesPerDay.toFixed(1)}/day). ${mtd.workingDaysLeft} working days remaining.` });

    const targets = [10000, 15000, 20000];
    for (const target of targets) {
      if (mtd.projectedPremium < target && mtd.workingDaysLeft > 0) {
        const neededSales = Math.ceil((target - mtd.mtdPremium) / avgPrem);
        const neededPerDay = neededSales / mtd.workingDaysLeft;
        const neededDials = cr > 0 ? Math.ceil(neededPerDay / cr) : 0;
        signals.push({ type: "projection", severity: "info",
          label: `To hit ${fmt(target)}/mo: ${neededPerDay.toFixed(1)} sales/day needed`,
          detail: `Need ${neededSales} more sales in ${mtd.workingDaysLeft} days. At ${(cr * 100).toFixed(1)}% close rate, that's ~${neededDials} dials/day.` });
        break;
      }
    }
  }

  // ======== EXISTING SIGNALS (strengths / improvements / actions) ========
  if (summary.complianceRate >= 80) {
    signals.push({ type: "strength", severity: "positive", label: "Consistent compliance", detail: `${summary.complianceRate.toFixed(0)}% of days compliant (${summary.compliantDays}/${summary.days})` });
  } else if (summary.complianceRate < 50) {
    signals.push({ type: "improvement", severity: "critical", label: "Low compliance rate", detail: `Only ${summary.complianceRate.toFixed(0)}% of days compliant — need ${T3_POOL_KPI.GATES_TO_PASS}/${T3_POOL_KPI.TOTAL_GATES} gates daily` });
  }

  if (summary.avgCombinedDials >= T3_POOL_KPI.MIN_COMBINED_DIALS) {
    signals.push({ type: "strength", severity: "positive", label: "Strong dial volume", detail: `Averaging ${Math.round(summary.avgCombinedDials)} combined dials/day (target: ${T3_POOL_KPI.MIN_COMBINED_DIALS})` });
  } else if (summary.avgCombinedDials < T3_POOL_KPI.MIN_COMBINED_DIALS * 0.7) {
    signals.push({ type: "improvement", severity: "critical", label: "Low dial volume", detail: `Averaging ${Math.round(summary.avgCombinedDials)}/day — need ${T3_POOL_KPI.MIN_COMBINED_DIALS} combined` });
  }

  if (summary.avgPoolPct >= T3_POOL_KPI.MIN_POOL_PCT && summary.avgPoolPct <= T3_POOL_KPI.MAX_POOL_PCT) {
    signals.push({ type: "strength", severity: "positive", label: "Balanced pool/pipeline ratio", detail: `${summary.avgPoolPct.toFixed(0)}% pool — in the ${T3_POOL_KPI.MIN_POOL_PCT}-${T3_POOL_KPI.MAX_POOL_PCT}% sweet spot` });
  } else if (summary.avgPoolPct > T3_POOL_KPI.MAX_POOL_PCT) {
    signals.push({ type: "improvement", severity: "warning", label: "Over-indexed on pool", detail: `${summary.avgPoolPct.toFixed(0)}% pool — neglecting assigned pipeline` });
  } else if (summary.avgPoolPct < T3_POOL_KPI.MIN_POOL_PCT && summary.totalPoolDials > 0) {
    signals.push({ type: "improvement", severity: "warning", label: "Under-utilizing pool", detail: `${summary.avgPoolPct.toFixed(0)}% pool — missing new lead acquisition` });
  }

  if (summary.avgLongCalls >= T3_POOL_KPI.MIN_LONG_CALLS) {
    signals.push({ type: "strength", severity: "positive", label: "Strong engagement", detail: `${summary.avgLongCalls.toFixed(1)} long calls/day — the #1 predictor of sales` });
  } else if (summary.avgLongCalls < 2) {
    signals.push({ type: "improvement", severity: "critical", label: "Low engagement", detail: `Only ${summary.avgLongCalls.toFixed(1)} long calls/day — agents with <2 average 0.09 sales/day` });
  }

  if (summary.avgTalkTime < T3_POOL_KPI.MIN_TALK_TIME * 0.6) {
    signals.push({ type: "improvement", severity: "critical", label: "Very low talk time", detail: `${Math.round(summary.avgTalkTime)} min/day avg — dialing without engaging` });
  }

  if (summary.avgPastDue === 0) {
    signals.push({ type: "strength", severity: "positive", label: "Clean follow-up discipline", detail: "Zero past-due appointments" });
  } else if (summary.avgPastDue > 10) {
    signals.push({ type: "improvement", severity: "critical", label: "Past-due follow-ups accumulating", detail: `Averaging ${Math.round(summary.avgPastDue)} past due` });
    signals.push({ type: "action", severity: "critical", label: "Clear past-due backlog", detail: "Stop pool activity until all past-due follow-ups are worked. These are appointments — not optional." });
  }
  if (summary.pastDueTrend === "growing") {
    signals.push({ type: "improvement", severity: "warning", label: "Past due trending up", detail: "Follow-up backlog is growing day over day" });
  }

  if (summary.latestQueue != null && summary.latestQueue > T3_POOL_KPI.MAX_QUEUE) {
    signals.push({ type: "improvement", severity: "warning", label: "Queue bloated", detail: `Queue at ${summary.latestQueue} — exceeds ${T3_POOL_KPI.MAX_QUEUE} max` });
    signals.push({ type: "action", severity: "warning", label: "Audit and withdraw stale queue leads", detail: "Review queue for leads with 6+ attempts. Withdraw to keep pipeline flowing." });
  } else if (summary.latestQueue != null && summary.latestQueue <= 80) {
    signals.push({ type: "strength", severity: "positive", label: "Clean queue", detail: `Queue at ${summary.latestQueue} — well-managed` });
  }

  if (summary.avgAssignRate >= 40) {
    signals.push({ type: "strength", severity: "positive", label: "Strong self-assignment", detail: `${summary.avgAssignRate.toFixed(0)}% assign rate` });
  } else if (summary.avgAssignRate < T3_POOL_KPI.MIN_ASSIGN_RATE && summary.totalPoolAnswered > 0) {
    signals.push({ type: "improvement", severity: "warning", label: "Low self-assignment", detail: `${summary.avgAssignRate.toFixed(0)}% — contacts recycling back into pool` });
  }

  for (const flag of flags) {
    const meta = FLAG_META[flag];
    if (meta.severity === "positive") {
      signals.push({ type: "strength", severity: "positive", label: meta.label, detail: meta.description });
    } else {
      signals.push({ type: "improvement", severity: meta.severity, label: meta.label, detail: meta.description });
    }
  }

  if (summary.avgSalesPerDay >= 1) {
    signals.push({ type: "strength", severity: "positive", label: "Producing daily", detail: `${summary.avgSalesPerDay.toFixed(1)} sales/day, ${fmt(summary.avgPremiumPerDay)}/day premium` });
  } else if (summary.totalSales === 0 && summary.days >= 3) {
    signals.push({ type: "improvement", severity: "critical", label: "Zero sales in period", detail: `No sales across ${summary.days} days` });
  }

  return signals;
}

function fmt(v: number) { return "$" + Math.round(v).toLocaleString(); }

function detectFlags(summary: ProfileSummary, days: ProfileDay[]): BehavioralFlag[] {
  const flags: BehavioralFlag[] = [];
  const latest = days[days.length - 1];
  if (!latest) return flags;

  const latestQueue = latest.callQueue ?? 0;
  const latestPastDue = latest.pastDue ?? 0;
  const latestFollowUps = latest.todaysFollowUps ?? 0;
  const latestNewLeads = latest.newLeads ?? 0;

  if (latestNewLeads > 5 && latestPastDue < 3 && latestQueue < 5) flags.push("CHERRY_PICKER");
  if (latestQueue > 0 && latest.regDials > 0 && latestQueue > 2 * latest.regDials) flags.push("PIPELINE_HOARDER");
  if (latestPastDue > 0 && latestFollowUps > 0 && latestPastDue > 3 * latestFollowUps) flags.push("FOLLOWUP_AVOIDER");
  if (latest.poolDials > latest.regDials && latest.regDials > 0 && latestQueue > 10) flags.push("POOL_FARMER");
  if (latestQueue > 150) flags.push("QUEUE_BLOAT");

  if (summary.closeRate > 0 && summary.avgLongCalls >= 4 && summary.avgCombinedDials >= 200) {
    flags.push("HIGH_PERFORMER");
  }

  return flags;
}

function getWorkingDaysInMonth(year: number, month: number): number {
  let count = 0;
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function getWorkingDaysElapsed(year: number, month: number, throughDay: number): number {
  let count = 0;
  const d = new Date(year, month, 1);
  while (d.getMonth() === month && d.getDate() <= throughDay) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

export function useAgentProfile(agentName: string | null, startDate: string, endDate: string): AgentProfileData {
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [days, setDays] = useState<ProfileDay[]>([]);
  const [tierBenchmark, setTierBenchmark] = useState<TierBenchmark | null>(null);
  const [mtdProjection, setMtdProjection] = useState<MtdProjection | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured || !agentName) return;
    setLoading(true);

    try {
      const [{ data: agentData }, { data: prodData }, { data: poolData }, { data: compData }] = await Promise.all([
        supabase.from("agents").select("name, site, tier, manager").eq("name", agentName).single(),
        supabase.from("daily_scrape_data")
          .select("scrape_date, agent_name, tier, ib_leads_delivered, ob_leads_delivered, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, total_dials, talk_time_minutes")
          .eq("agent_name", agentName).gte("scrape_date", startDate).lte("scrape_date", endDate)
          .order("scrape_date"),
        supabase.from("leads_pool_daily_data")
          .select("scrape_date, agent_name, calls_made, talk_time_minutes, sales_made, premium, self_assigned_leads, answered_calls, long_calls, contact_rate")
          .eq("agent_name", agentName).gte("scrape_date", startDate).lte("scrape_date", endDate)
          .order("scrape_date"),
        supabase.from("pipeline_compliance_daily")
          .select("scrape_date, agent_name, past_due_follow_ups, new_leads, call_queue_count, todays_follow_ups, post_sale_leads")
          .eq("agent_name", agentName).gte("scrape_date", startDate).lte("scrape_date", endDate)
          .order("scrape_date"),
      ]);

      setAgent(agentData as AgentRow | null);

      const agentTier = (agentData as AgentRow | null)?.tier ?? "T3";

      // Tier benchmarks — same-tier averages across same date range
      const [{ data: tierProdData }, { data: tierPoolData }] = await Promise.all([
        supabase.from("daily_scrape_data")
          .select("agent_name, total_dials, talk_time_minutes, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium")
          .eq("tier", agentTier).gte("scrape_date", startDate).lte("scrape_date", endDate),
        supabase.from("leads_pool_daily_data")
          .select("agent_name, calls_made, long_calls, self_assigned_leads, answered_calls, sales_made")
          .gte("scrape_date", startDate).lte("scrape_date", endDate),
      ]);

      if (tierProdData && tierProdData.length > 0) {
        const agentDays = new Map<string, number>();
        const agentTotals = new Map<string, { dials: number; talk: number; sales: number; premium: number }>();
        for (const r of tierProdData as Array<{ agent_name: string; total_dials: number; talk_time_minutes: number; ib_sales: number; ob_sales: number; custom_sales: number; ib_premium: number; ob_premium: number; custom_premium: number }>) {
          const t = agentTotals.get(r.agent_name) ?? { dials: 0, talk: 0, sales: 0, premium: 0 };
          t.dials += r.total_dials; t.talk += r.talk_time_minutes;
          t.sales += r.ib_sales + r.ob_sales + r.custom_sales;
          t.premium += r.ib_premium + r.ob_premium + r.custom_premium;
          agentTotals.set(r.agent_name, t);
          agentDays.set(r.agent_name, (agentDays.get(r.agent_name) ?? 0) + 1);
        }

        const poolByAgent = new Map<string, { dials: number; long: number; assigned: number; answered: number }>();
        for (const r of (tierPoolData ?? []) as Array<{ agent_name: string; calls_made: number; long_calls: number; self_assigned_leads: number; answered_calls: number }>) {
          const t = poolByAgent.get(r.agent_name) ?? { dials: 0, long: 0, assigned: 0, answered: 0 };
          t.dials += r.calls_made; t.long += r.long_calls; t.assigned += r.self_assigned_leads; t.answered += r.answered_calls;
          poolByAgent.set(r.agent_name, t);
        }

        const agents = [...agentTotals.keys()];
        const n = agents.length;
        let totDials = 0, totTalk = 0, totSales = 0, totPrem = 0, totPoolDials = 0, totPoolLong = 0, totAssigned = 0, totAnswered = 0;
        for (const a of agents) {
          const t = agentTotals.get(a)!;
          const d = agentDays.get(a) ?? 1;
          totDials += t.dials / d; totTalk += t.talk / d; totSales += t.sales / d; totPrem += t.premium / d;
          const p = poolByAgent.get(a);
          if (p) { totPoolDials += p.dials / d; totPoolLong += p.long / d; totAssigned += p.assigned; totAnswered += p.answered; }
        }
        setTierBenchmark({
          avgDials: n > 0 ? totDials / n : 0, avgTalk: n > 0 ? totTalk / n : 0,
          avgSales: n > 0 ? totSales / n : 0, avgPremium: n > 0 ? totPrem / n : 0,
          avgPoolDials: n > 0 ? totPoolDials / n : 0, avgPoolLongCalls: n > 0 ? totPoolLong / n : 0,
          avgPoolAssignRate: totAnswered > 0 ? (totAssigned / totAnswered) * 100 : 0,
          agentCount: n,
        });
      }

      // MTD projection
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const today = now.toISOString().slice(0, 10);
      const { data: mtdProdData } = await supabase.from("daily_scrape_data")
        .select("ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium")
        .eq("agent_name", agentName).gte("scrape_date", monthStart).lte("scrape_date", today);
      const { data: mtdPoolData } = await supabase.from("leads_pool_daily_data")
        .select("sales_made, premium")
        .eq("agent_name", agentName).gte("scrape_date", monthStart).lte("scrape_date", today);

      if (mtdProdData) {
        let mtdSales = 0, mtdPremium = 0;
        for (const r of mtdProdData as Array<{ ib_sales: number; ob_sales: number; custom_sales: number; ib_premium: number; ob_premium: number; custom_premium: number }>) {
          mtdSales += r.ib_sales + r.ob_sales + r.custom_sales;
          mtdPremium += r.ib_premium + r.ob_premium + r.custom_premium;
        }
        for (const r of (mtdPoolData ?? []) as Array<{ sales_made: number; premium: number }>) {
          mtdSales += r.sales_made; mtdPremium += r.premium;
        }
        const totalWd = getWorkingDaysInMonth(now.getFullYear(), now.getMonth());
        const elapsedWd = getWorkingDaysElapsed(now.getFullYear(), now.getMonth(), now.getDate());
        const leftWd = totalWd - elapsedWd;
        const spd = elapsedWd > 0 ? mtdSales / elapsedWd : 0;
        setMtdProjection({
          mtdSales, mtdPremium, workingDaysElapsed: elapsedWd, workingDaysLeft: leftWd,
          salesPerDay: spd, projectedSales: spd * totalWd, projectedPremium: (spd * totalWd) * (mtdSales > 0 ? mtdPremium / mtdSales : FALLBACK_PREMIUM),
        });
      }

      // Build daily merged rows
      const prodMap = new Map<string, ProdRow>();
      for (const r of (prodData ?? []) as ProdRow[]) prodMap.set(r.scrape_date, r);
      const poolMap = new Map<string, PoolRow>();
      for (const r of (poolData ?? []) as PoolRow[]) poolMap.set(r.scrape_date, r);
      const compMap = new Map<string, CompRow>();
      for (const r of (compData ?? []) as CompRow[]) compMap.set(r.scrape_date, r);

      const allDates = new Set([...prodMap.keys(), ...poolMap.keys(), ...compMap.keys()]);
      const sorted = [...allDates].sort();

      const merged: ProfileDay[] = sorted.map(date => {
        const p = prodMap.get(date);
        const pl = poolMap.get(date);
        const c = compMap.get(date);

        // Calls Report total_dials already includes pool dials (deduplicated per lead)
        const combinedDials = p?.total_dials ?? 0;
        const combinedTalk = p?.talk_time_minutes ?? 0;
        const ibSales = p?.ib_sales ?? 0;
        const obSales = p?.ob_sales ?? 0;
        const bonusSales = p?.custom_sales ?? 0;
        const regSales = ibSales + obSales + bonusSales;
        const ibPrem = p?.ib_premium ?? 0;
        const obPrem = p?.ob_premium ?? 0;
        const bonusPrem = p?.custom_premium ?? 0;
        const regPremium = ibPrem + obPrem + bonusPrem;

        const poolDials = pl?.calls_made ?? 0;
        const poolTalk = pl?.talk_time_minutes ?? 0;
        const poolSales = pl?.sales_made ?? 0;
        const poolPremium = pl?.premium ?? 0;
        const poolAnswered = pl?.answered_calls ?? 0;
        const poolAssigned = pl?.self_assigned_leads ?? 0;
        const poolLongCalls = pl?.long_calls ?? 0;
        const poolContactRate = pl?.contact_rate ?? 0;

        const pastDue = c?.past_due_follow_ups ?? null;
        const callQueue = c?.call_queue_count ?? null;
        const todaysFollowUps = c?.todays_follow_ups ?? null;
        const newLeads = c?.new_leads ?? null;
        const postSaleLeads = c?.post_sale_leads ?? null;

        const regDials = Math.max(0, combinedDials - poolDials);
        const regTalk = Math.max(0, combinedTalk - poolTalk);
        // regSales / regPremium come from daily_scrape_data, sourced from the CRM
        // Sale Made report — system of record for ALL sales regardless of channel.
        // Pool sales (poolSales) are the SAME physical sales re-attributed to pool
        // dialing in leads_pool_daily_data, so they must NOT be added again.
        const combinedSales = regSales;
        const combinedPremium = regPremium;
        const poolPct = combinedDials > 0 ? (poolDials / combinedDials) * 100 : 0;
        const assignRate = poolAnswered > 0 ? (poolAssigned / poolAnswered) * 100 : 0;

        const gates = buildT3Gates(poolDials, poolAnswered, assignRate, poolLongCalls, combinedDials, combinedTalk, pastDue, callQueue);
        const gatesPassed = gates.filter(g => g.status === "pass").length;

        return {
          date, regDials, regTalk, regSales, regPremium,
          ibSales, obSales, bonusSales, ibPremium: ibPrem, obPremium: obPrem, bonusPremium: bonusPrem,
          ibLeads: p?.ib_leads_delivered ?? 0, obLeads: p?.ob_leads_delivered ?? 0,
          poolDials, poolTalk, poolSales, poolPremium, poolAnswered, poolAssigned, poolLongCalls, poolContactRate,
          pastDue, callQueue, todaysFollowUps, newLeads, postSaleLeads,
          combinedDials, combinedTalk, combinedSales, combinedPremium, poolPct, assignRate,
          gates, gatesPassed, compliant: gatesPassed >= T3_POOL_KPI.GATES_TO_PASS,
        };
      });

      setDays(merged);
    } catch {
      // keep existing
    } finally {
      setLoading(false);
    }
  }, [agentName, startDate, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const summary = useMemo<ProfileSummary | null>(() => {
    if (days.length === 0) return null;
    const s = days.reduce((acc, d) => {
      acc.regDials += d.regDials; acc.poolDials += d.poolDials;
      acc.regTalk += d.regTalk; acc.poolTalk += d.poolTalk;
      acc.sales += d.combinedSales; acc.premium += d.combinedPremium;
      acc.ibSales += d.ibSales; acc.obSales += d.obSales;
      acc.bonusSales += d.bonusSales; acc.poolSales += d.poolSales;
      acc.poolAssigned += d.poolAssigned; acc.poolAnswered += d.poolAnswered;
      acc.poolLongCalls += d.poolLongCalls;
      acc.compliantDays += d.compliant ? 1 : 0;
      return acc;
    }, { regDials: 0, poolDials: 0, regTalk: 0, poolTalk: 0, sales: 0, premium: 0, ibSales: 0, obSales: 0, bonusSales: 0, poolSales: 0, poolAssigned: 0, poolAnswered: 0, poolLongCalls: 0, compliantDays: 0 });

    const n = days.length;
    const totalCombined = s.regDials + s.poolDials;
    const totalTalk = s.regTalk + s.poolTalk;
    const totalLeads = days.reduce((a, d) => a + d.ibLeads + d.obLeads, 0);
    const pastDues = days.map(d => d.pastDue);
    const queues = days.map(d => d.callQueue);
    const numsP = pastDues.filter((v): v is number => v != null);
    const numsQ = queues.filter((v): v is number => v != null);
    const latest = days[days.length - 1];

    return {
      days: n,
      totalRegDials: s.regDials, totalPoolDials: s.poolDials, totalCombinedDials: totalCombined,
      totalRegTalk: s.regTalk, totalPoolTalk: s.poolTalk, totalCombinedTalk: totalTalk,
      totalSales: s.sales, totalPremium: s.premium,
      totalIbSales: s.ibSales, totalObSales: s.obSales, totalBonusSales: s.bonusSales, totalPoolSales: s.poolSales,
      totalPoolAssigned: s.poolAssigned, totalPoolAnswered: s.poolAnswered, totalPoolLongCalls: s.poolLongCalls,
      avgCombinedDials: totalCombined / n,
      avgPoolPct: totalCombined > 0 ? (s.poolDials / totalCombined) * 100 : 0,
      avgTalkTime: totalTalk / n,
      avgLongCalls: s.poolLongCalls / n,
      avgSalesPerDay: s.sales / n,
      avgPremiumPerDay: s.premium / n,
      closeRate: totalLeads > 0 ? (s.sales / totalLeads) * 100 : 0,
      poolCloseRate: s.poolAssigned > 0 ? (s.poolSales / s.poolAssigned) * 100 : 0,
      avgAssignRate: s.poolAnswered > 0 ? (s.poolAssigned / s.poolAnswered) * 100 : 0,
      avgPastDue: numsP.length > 0 ? numsP.reduce((a, v) => a + v, 0) / numsP.length : 0,
      avgCallQueue: numsQ.length > 0 ? numsQ.reduce((a, v) => a + v, 0) / numsQ.length : 0,
      latestPastDue: latest.pastDue,
      latestQueue: latest.callQueue,
      queueTrend: calcTrend(queues),
      pastDueTrend: calcTrend(pastDues),
      compliantDays: s.compliantDays,
      complianceRate: (s.compliantDays / n) * 100,
    };
  }, [days]);

  const flags = useMemo(() => {
    if (!summary || days.length === 0) return [];
    return detectFlags(summary, days);
  }, [summary, days]);

  const coaching = useMemo(() => {
    if (!summary) return [];
    return buildCoaching(summary, days, flags, tierBenchmark, mtdProjection, agent?.tier ?? "T3");
  }, [summary, days, flags, tierBenchmark, mtdProjection, agent]);

  return { agent, days, summary, tierBenchmark, mtdProjection, coaching, flags, loading };
}
