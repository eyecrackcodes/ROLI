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
  // computed
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

// ---- Coaching signals ----

export interface CoachingSignal {
  type: "strength" | "improvement" | "action";
  severity: "positive" | "warning" | "critical";
  label: string;
  detail: string;
}

// ---- Hook return ----

export interface AgentProfileData {
  agent: AgentRow | null;
  days: ProfileDay[];
  summary: ProfileSummary | null;
  coaching: CoachingSignal[];
  flags: BehavioralFlag[];
  loading: boolean;
}

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

function buildCoaching(summary: ProfileSummary, days: ProfileDay[], flags: BehavioralFlag[]): CoachingSignal[] {
  const signals: CoachingSignal[] = [];

  // Gate-based signals
  if (summary.complianceRate >= 80) {
    signals.push({ type: "strength", severity: "positive", label: "Consistent compliance", detail: `${summary.complianceRate.toFixed(0)}% of days compliant (${summary.compliantDays}/${summary.days})` });
  } else if (summary.complianceRate < 50) {
    signals.push({ type: "improvement", severity: "critical", label: "Low compliance rate", detail: `Only ${summary.complianceRate.toFixed(0)}% of days compliant — need ${T3_POOL_KPI.GATES_TO_PASS}/${T3_POOL_KPI.TOTAL_GATES} gates daily` });
  }

  // Volume
  if (summary.avgCombinedDials >= T3_POOL_KPI.MIN_COMBINED_DIALS) {
    signals.push({ type: "strength", severity: "positive", label: "Strong dial volume", detail: `Averaging ${Math.round(summary.avgCombinedDials)} combined dials/day (target: ${T3_POOL_KPI.MIN_COMBINED_DIALS})` });
  } else if (summary.avgCombinedDials < T3_POOL_KPI.MIN_COMBINED_DIALS * 0.7) {
    signals.push({ type: "improvement", severity: "critical", label: "Low dial volume", detail: `Averaging ${Math.round(summary.avgCombinedDials)}/day — need ${T3_POOL_KPI.MIN_COMBINED_DIALS} combined` });
  }

  // Pool balance
  if (summary.avgPoolPct >= T3_POOL_KPI.MIN_POOL_PCT && summary.avgPoolPct <= T3_POOL_KPI.MAX_POOL_PCT) {
    signals.push({ type: "strength", severity: "positive", label: "Balanced pool/pipeline ratio", detail: `${summary.avgPoolPct.toFixed(0)}% pool — in the ${T3_POOL_KPI.MIN_POOL_PCT}-${T3_POOL_KPI.MAX_POOL_PCT}% sweet spot` });
  } else if (summary.avgPoolPct > T3_POOL_KPI.MAX_POOL_PCT) {
    signals.push({ type: "improvement", severity: "warning", label: "Over-indexed on pool", detail: `${summary.avgPoolPct.toFixed(0)}% pool — neglecting assigned pipeline. Target: ${T3_POOL_KPI.MIN_POOL_PCT}-${T3_POOL_KPI.MAX_POOL_PCT}%` });
  } else if (summary.avgPoolPct < T3_POOL_KPI.MIN_POOL_PCT && summary.totalPoolDials > 0) {
    signals.push({ type: "improvement", severity: "warning", label: "Under-utilizing pool", detail: `${summary.avgPoolPct.toFixed(0)}% pool — missing new lead acquisition. Target: ${T3_POOL_KPI.MIN_POOL_PCT}-${T3_POOL_KPI.MAX_POOL_PCT}%` });
  }

  // Long calls
  if (summary.avgLongCalls >= T3_POOL_KPI.MIN_LONG_CALLS) {
    signals.push({ type: "strength", severity: "positive", label: "Strong engagement", detail: `${summary.avgLongCalls.toFixed(1)} long calls/day — the #1 predictor of sales` });
  } else if (summary.avgLongCalls < 2) {
    signals.push({ type: "improvement", severity: "critical", label: "Low engagement", detail: `Only ${summary.avgLongCalls.toFixed(1)} long calls/day — agents with <2 average 0.09 sales/day` });
  }

  // Talk time
  if (summary.avgTalkTime < T3_POOL_KPI.MIN_TALK_TIME * 0.6) {
    signals.push({ type: "improvement", severity: "critical", label: "Very low talk time", detail: `${Math.round(summary.avgTalkTime)} min/day avg — dialing without engaging. Need ${T3_POOL_KPI.MIN_TALK_TIME}+ min` });
  }

  // Past due
  if (summary.avgPastDue === 0) {
    signals.push({ type: "strength", severity: "positive", label: "Clean follow-up discipline", detail: "Zero past-due appointments — all follow-ups worked on schedule" });
  } else if (summary.avgPastDue > 10) {
    signals.push({ type: "improvement", severity: "critical", label: "Past-due follow-ups accumulating", detail: `Averaging ${Math.round(summary.avgPastDue)} past due — missing scheduled appointments` });
    signals.push({ type: "action", severity: "critical", label: "Clear past-due backlog", detail: "Stop pool activity until all past-due follow-ups are worked. These are appointments — not optional." });
  }
  if (summary.pastDueTrend === "growing") {
    signals.push({ type: "improvement", severity: "warning", label: "Past due trending up", detail: "Follow-up backlog is growing day over day" });
  }

  // Queue
  if (summary.latestQueue != null && summary.latestQueue > T3_POOL_KPI.MAX_QUEUE) {
    signals.push({ type: "improvement", severity: "warning", label: "Queue bloated", detail: `Queue at ${summary.latestQueue} leads — exceeds ${T3_POOL_KPI.MAX_QUEUE} max. Leads likely past 6 attempts.` });
    signals.push({ type: "action", severity: "warning", label: "Audit and withdraw stale queue leads", detail: "Review queue for leads with 6+ contact attempts. Withdraw them to keep pipeline flowing." });
  } else if (summary.latestQueue != null && summary.latestQueue <= 80) {
    signals.push({ type: "strength", severity: "positive", label: "Clean queue", detail: `Queue at ${summary.latestQueue} — well-managed pipeline` });
  }
  if (summary.queueTrend === "growing") {
    signals.push({ type: "improvement", severity: "warning", label: "Queue trending up", detail: "Queue growing day over day — leads entering faster than exiting" });
  }

  // Assign rate
  if (summary.avgAssignRate >= 40) {
    signals.push({ type: "strength", severity: "positive", label: "Strong self-assignment", detail: `${summary.avgAssignRate.toFixed(0)}% assign rate — keeping the pool clean` });
  } else if (summary.avgAssignRate < T3_POOL_KPI.MIN_ASSIGN_RATE && summary.totalPoolAnswered > 0) {
    signals.push({ type: "improvement", severity: "warning", label: "Low self-assignment", detail: `${summary.avgAssignRate.toFixed(0)}% assign rate — contacts recycling back into pool. Target: ${T3_POOL_KPI.MIN_ASSIGN_RATE}%+` });
  }

  // Behavioral flags
  for (const flag of flags) {
    const meta = FLAG_META[flag];
    if (meta.severity === "positive") {
      signals.push({ type: "strength", severity: "positive", label: meta.label, detail: meta.description });
    } else {
      signals.push({ type: "improvement", severity: meta.severity, label: meta.label, detail: meta.description });
    }
  }

  // Sales performance
  if (summary.avgSalesPerDay >= 1) {
    signals.push({ type: "strength", severity: "positive", label: "Producing daily", detail: `${summary.avgSalesPerDay.toFixed(1)} sales/day, $${Math.round(summary.avgPremiumPerDay)}/day premium` });
  } else if (summary.totalSales === 0 && summary.days >= 3) {
    signals.push({ type: "improvement", severity: "critical", label: "Zero sales in period", detail: `No sales across ${summary.days} days — review call quality and qualification` });
  }

  return signals;
}

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

  const totalLeads = summary.totalIbSales + summary.totalObSales > 0 ? (summary.totalSales / (summary.totalIbSales + summary.totalObSales + summary.totalBonusSales + summary.totalPoolSales)) : 0;
  if (summary.closeRate > 0 && summary.avgLongCalls >= 4 && summary.avgCombinedDials >= 200 && totalLeads > 0) {
    flags.push("HIGH_PERFORMER");
  }

  return flags;
}

export function useAgentProfile(agentName: string | null, startDate: string, endDate: string): AgentProfileData {
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [days, setDays] = useState<ProfileDay[]>([]);
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

        const regDials = p?.total_dials ?? 0;
        const regTalk = p?.talk_time_minutes ?? 0;
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

        const combinedDials = regDials + poolDials;
        const combinedTalk = regTalk + poolTalk;
        const combinedSales = regSales + poolSales;
        const combinedPremium = regPremium + poolPremium;
        const poolPct = combinedDials > 0 ? (poolDials / combinedDials) * 100 : 0;
        const assignRate = poolAnswered > 0 ? (poolAssigned / poolAnswered) * 100 : 0;

        const gates = buildT3Gates(poolDials, poolAnswered, assignRate, poolLongCalls, poolTalk, regDials, regTalk, pastDue, callQueue);
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
    return buildCoaching(summary, days, flags);
  }, [summary, days, flags]);

  return { agent, days, summary, coaching, flags, loading };
}
