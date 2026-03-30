import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { DailyPulseAgent, MonthlyAgent, Tier, PoolMetrics, PoolInventorySnapshot, FunnelMetrics } from "@/lib/types";
import {
  sampleDailyT1, sampleDailyT2, sampleDailyT3,
  sampleMonthlyT1, sampleMonthlyT2, sampleMonthlyT3,
} from "@/lib/sampleData";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { EvaluationWindow } from "@/hooks/useEvaluationWindows";
import type { PipelineAgent, PipelineComplianceRow, ProductionRow, PoolRow as PipelinePoolRow, HistoricalAgentStats, PriorDayCompliance } from "@/lib/pipelineIntelligence";
import { buildPipelineAgents } from "@/lib/pipelineIntelligence";

interface DailyScrapeRow {
  agent_name: string;
  tier: string;
  ib_leads_delivered: number;
  ob_leads_delivered: number;
  custom_leads: number;
  ib_sales: number;
  ob_sales: number;
  custom_sales: number;
  ib_premium: number;
  ob_premium: number;
  custom_premium: number;
  total_dials: number;
  talk_time_minutes: number;
  scrape_date: string;
}

interface SnapshotRow {
  agent_name: string;
  tier: string;
  site: string | null;
  total_leads_delivered: number;
  total_ib_calls: number;
  total_ob_leads: number;
  total_sales: number;
  total_ib_sales: number;
  total_ob_sales: number;
  total_custom_sales: number;
  total_premium: number;
  lead_cost: number;
  profit: number;
  roli: number;
  close_rate: number;
  ib_close_rate: number | null;
  ob_close_rate: number | null;
  prior_roli: number | null;
  rank_in_tier: number | null;
}

interface PoolDailyRow {
  agent_name: string;
  calls_made: number;
  talk_time_minutes: number;
  sales_made: number;
  premium: number;
  self_assigned_leads: number;
  answered_calls: number;
  long_calls: number;
  contact_rate: number;
  scrape_date: string;
}

interface AgentPerfRow {
  agent_name: string;
  tier: string;
  dials: number;
  leads_worked: number;
  contacts_made: number;
  conversations: number;
  presentations: number;
  follow_ups_set: number;
  sales: number;
  talk_time_minutes: number;
  premium: number;
  scrape_date: string;
  scrape_hour: number | null;
}

export interface DateRange {
  start: string;
  end: string;
}

interface DataContextType {
  dailyT1: DailyPulseAgent[];
  dailyT2: DailyPulseAgent[];
  dailyT3: DailyPulseAgent[];
  setDailyT1: (data: DailyPulseAgent[]) => void;
  setDailyT2: (data: DailyPulseAgent[]) => void;
  setDailyT3: (data: DailyPulseAgent[]) => void;
  monthlyT1: MonthlyAgent[];
  monthlyT2: MonthlyAgent[];
  monthlyT3: MonthlyAgent[];
  setMonthlyT1: (data: MonthlyAgent[]) => void;
  setMonthlyT2: (data: MonthlyAgent[]) => void;
  setMonthlyT3: (data: MonthlyAgent[]) => void;
  windowStart: string;
  windowEnd: string;
  workingDays: number;
  workingDaysCompleted: number;
  setWindowStart: (d: string) => void;
  setWindowEnd: (d: string) => void;
  setWorkingDays: (n: number) => void;
  setWorkingDaysCompleted: (n: number) => void;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  activeWindow: EvaluationWindow | null;
  loadSampleData: () => void;
  clearData: () => void;
  loading: boolean;
  isConnected: boolean;
  refreshDaily: () => Promise<void>;
  refreshMonthly: () => Promise<void>;
  availableDates: string[];
  isRangeMode: boolean;
  setIsRangeMode: (v: boolean) => void;
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  poolInventory: PoolInventorySnapshot[];
  pipelineAgents: PipelineAgent[];
  refreshPipeline: () => Promise<void>;
  pipelineLoading: boolean;
}

const DataContext = createContext<DataContextType | null>(null);

function todayCentral(): string {
  const central = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [y, m, dd] = central.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2);
  if (day === 6) d.setDate(d.getDate() - 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function calcWorkingDaysCompleted(startDate: string, currentDate: string): number {
  const start = new Date(startDate);
  const current = new Date(currentDate);
  let count = 0;
  const d = new Date(start);
  while (d <= current) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function buildPoolMetricsMap(poolRows: PoolDailyRow[]): Map<string, PoolMetrics> {
  const grouped = new Map<string, PoolDailyRow[]>();
  for (const row of poolRows) {
    const existing = grouped.get(row.agent_name) ?? [];
    existing.push(row);
    grouped.set(row.agent_name, existing);
  }

  const result = new Map<string, PoolMetrics>();
  for (const [name, rows] of grouped) {
    const callsMade = rows.reduce((s, r) => s + r.calls_made, 0);
    const longCalls = rows.reduce((s, r) => s + r.long_calls, 0);
    const selfAssigned = rows.reduce((s, r) => s + r.self_assigned_leads, 0);
    const answeredCalls = rows.reduce((s, r) => s + r.answered_calls, 0);

    result.set(name, {
      callsMade,
      talkTimeMin: rows.reduce((s, r) => s + r.talk_time_minutes, 0),
      salesMade: rows.reduce((s, r) => s + r.sales_made, 0),
      premium: rows.reduce((s, r) => s + r.premium, 0),
      selfAssignedLeads: selfAssigned,
      answeredCalls,
      longCalls,
      contactRate: callsMade > 0 ? (answeredCalls / callsMade) * 100 : 0,
      assignRate: answeredCalls > 0 ? (selfAssigned / answeredCalls) * 100 : 0,
      closeRate: selfAssigned > 0 ? (rows.reduce((s, r) => s + r.sales_made, 0) / selfAssigned) * 100 : 0,
    });
  }
  return result;
}

function buildFunnelMap(perfRows: AgentPerfRow[]): Map<string, FunnelMetrics> {
  const grouped = new Map<string, AgentPerfRow[]>();
  for (const row of perfRows) {
    const existing = grouped.get(row.agent_name) ?? [];
    existing.push(row);
    grouped.set(row.agent_name, existing);
  }

  const result = new Map<string, FunnelMetrics>();
  for (const [name, rows] of grouped) {
    const dials = rows.reduce((s, r) => s + r.dials, 0);
    const leadsWorked = rows.reduce((s, r) => s + r.leads_worked, 0);
    const contactsMade = rows.reduce((s, r) => s + r.contacts_made, 0);
    const conversations = rows.reduce((s, r) => s + r.conversations, 0);
    const presentations = rows.reduce((s, r) => s + r.presentations, 0);
    const followUpsSet = rows.reduce((s, r) => s + r.follow_ups_set, 0);
    const sales = rows.reduce((s, r) => s + r.sales, 0);

    result.set(name, {
      dials,
      leadsWorked,
      contactsMade,
      conversations,
      presentations,
      followUpsSet,
      sales,
      talkTimeMinutes: rows.reduce((s, r) => s + r.talk_time_minutes, 0),
      premium: rows.reduce((s, r) => s + r.premium, 0),
      contactPct: leadsWorked > 0 ? (contactsMade / leadsWorked) * 100 : 0,
      contactToClosePct: contactsMade > 0 ? (sales / contactsMade) * 100 : 0,
      conversationToClosePct: conversations > 0 ? (sales / conversations) * 100 : 0,
      presentationToClosePct: presentations > 0 ? (sales / presentations) * 100 : 0,
    });
  }
  return result;
}

function buildPulseAgents(
  rows: DailyScrapeRow[],
  agentMap: Map<string, { name: string; site: string; tier: string; manager?: string | null }>,
  mtdMap: Map<string, { mtdSales: number; mtdDays: number; mtdPremium: number }>,
  daysActiveMap?: Map<string, number>,
  poolMap?: Map<string, PoolMetrics>,
  funnelMap?: Map<string, FunnelMetrics>,
): { t1: DailyPulseAgent[]; t2: DailyPulseAgent[]; t3: DailyPulseAgent[] } {
  const t1: DailyPulseAgent[] = [];
  const t2: DailyPulseAgent[] = [];
  const t3: DailyPulseAgent[] = [];

  const grouped = new Map<string, DailyScrapeRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.agent_name) ?? [];
    existing.push(row);
    grouped.set(row.agent_name, existing);
  }

  // Track which agents we've processed (for pool-only agents)
  const processedNames = new Set<string>();

  for (const [name, agentRows] of grouped) {
    processedNames.add(name);
    const agent = agentMap.get(name);
    const site = agent?.site ?? "CHA";
    const tier = (agentRows[0].tier as Tier) ?? (agent?.tier as Tier) ?? "T3";

    const ibLeads = agentRows.reduce((s, r) => s + r.ib_leads_delivered, 0);
    const obLeads = agentRows.reduce((s, r) => s + r.ob_leads_delivered, 0);
    const ibSales = agentRows.reduce((s, r) => s + r.ib_sales, 0);
    const obSales = agentRows.reduce((s, r) => s + r.ob_sales, 0);
    const customSales = agentRows.reduce((s, r) => s + r.custom_sales, 0);
    const ibPrem = agentRows.reduce((s, r) => s + r.ib_premium, 0);
    const obPrem = agentRows.reduce((s, r) => s + r.ob_premium, 0);
    const customPrem = agentRows.reduce((s, r) => s + r.custom_premium, 0);
    const dials = agentRows.reduce((s, r) => s + r.total_dials, 0);
    const talkTime = agentRows.reduce((s, r) => s + r.talk_time_minutes, 0);

    const totalSales = ibSales + obSales + customSales;
    const totalPremium = ibPrem + obPrem + customPrem;
    const mtd = mtdMap.get(name);
    const pool = poolMap?.get(name);
    const funnel = funnelMap?.get(name);

    const pulseAgent: DailyPulseAgent = {
      name,
      site,
      tier,
      manager: agent?.manager ?? null,
      ibCalls: ibLeads || undefined,
      ibSales: ibSales || undefined,
      obLeads: obLeads || undefined,
      obSales: obSales || undefined,
      dials: dials || undefined,
      talkTimeMin: talkTime || undefined,
      salesToday: totalSales,
      premiumToday: totalPremium - customPrem,
      bonusSales: customSales || undefined,
      bonusLeads: agentRows.reduce((s, r) => s + (r.custom_leads ?? 0), 0) || undefined,
      bonusPremium: customPrem || undefined,
      totalPremium,
      mtdSales: mtd?.mtdSales,
      mtdPace: mtd && mtd.mtdDays > 0 ? mtd.mtdSales / mtd.mtdDays : undefined,
      daysActive: daysActiveMap?.get(name),
      pool,
      funnel,
    };

    if (tier === "T1") t1.push(pulseAgent);
    else if (tier === "T2") t2.push(pulseAgent);
    else t3.push(pulseAgent);
  }

  // Add pool-only agents (agents who only have pool activity, no regular scrape data)
  if (poolMap) {
    for (const [name, pool] of poolMap) {
      if (processedNames.has(name)) continue;
      const agent = agentMap.get(name);
      if (!agent) continue;
      const tier = agent.tier as Tier;
      const mtd = mtdMap.get(name);

      const funnel = funnelMap?.get(name);
      const pulseAgent: DailyPulseAgent = {
        name,
        site: agent.site ?? "CHA",
        tier,
        manager: agent.manager ?? null,
        salesToday: 0,
        premiumToday: 0,
        totalPremium: 0,
        mtdSales: mtd?.mtdSales,
        mtdPace: mtd && mtd.mtdDays > 0 ? mtd.mtdSales / mtd.mtdDays : undefined,
        daysActive: daysActiveMap?.get(name),
        pool,
        funnel,
      };

      if (tier === "T1") t1.push(pulseAgent);
      else if (tier === "T2") t2.push(pulseAgent);
      else t3.push(pulseAgent);
    }
  }

  return { t1, t2, t3 };
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [dailyT1, setDailyT1] = useState<DailyPulseAgent[]>(sampleDailyT1);
  const [dailyT2, setDailyT2] = useState<DailyPulseAgent[]>(sampleDailyT2);
  const [dailyT3, setDailyT3] = useState<DailyPulseAgent[]>(sampleDailyT3);
  const [monthlyT1, setMonthlyT1] = useState<MonthlyAgent[]>(sampleMonthlyT1);
  const [monthlyT2, setMonthlyT2] = useState<MonthlyAgent[]>(sampleMonthlyT2);
  const [monthlyT3, setMonthlyT3] = useState<MonthlyAgent[]>(sampleMonthlyT3);
  const [windowStart, setWindowStart] = useState("2026-03-30");
  const [windowEnd, setWindowEnd] = useState("2026-05-01");
  const [workingDays, setWorkingDays] = useState(23);
  const [workingDaysCompleted, setWorkingDaysCompleted] = useState(10);
  const [selectedDate, setSelectedDate] = useState(todayCentral);
  const [activeWindow, setActiveWindow] = useState<EvaluationWindow | null>(null);
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [isRangeMode, setIsRangeMode] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({ start: "", end: "" });
  const [poolInventory, setPoolInventory] = useState<PoolInventorySnapshot[]>([]);
  const [pipelineAgents, setPipelineAgents] = useState<PipelineAgent[]>([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);

  // Fetch available dates + evaluation window on mount, then smart-select date
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    (async () => {
      try {
        const [{ data: windowData }, { data: dateRows }, { data: pipelineDateRows }, { data: perfDateRows }] = await Promise.all([
          supabase.from("evaluation_windows").select("*").eq("is_active", true).single(),
          supabase.from("daily_scrape_data").select("scrape_date").order("scrape_date", { ascending: false }),
          supabase.from("pipeline_compliance_daily").select("scrape_date").order("scrape_date", { ascending: false }),
          supabase.from("agent_performance_daily").select("scrape_date").order("scrape_date", { ascending: false }),
        ]);

        if (windowData) {
          const w = windowData as EvaluationWindow;
          setActiveWindow(w);
          setWindowStart(w.start_date);
          setWindowEnd(w.end_date);
          setWorkingDays(w.working_days);
        }

        const allDateSet = new Set<string>();
        for (const r of (dateRows ?? []) as Array<{ scrape_date: string }>) allDateSet.add(r.scrape_date);
        for (const r of (pipelineDateRows ?? []) as Array<{ scrape_date: string }>) allDateSet.add(r.scrape_date);
        for (const r of (perfDateRows ?? []) as Array<{ scrape_date: string }>) allDateSet.add(r.scrape_date);
        const uniqueDates = Array.from(allDateSet).sort().reverse();
        setAvailableDates(uniqueDates);

        if (uniqueDates.length > 0) {
          const today = todayCentral();
          const bestDate = uniqueDates.includes(today) ? today : uniqueDates[0];
          setSelectedDate(bestDate);
          setDateRange({ start: uniqueDates[uniqueDates.length - 1], end: uniqueDates[0] });
          if (windowData) {
            setWorkingDaysCompleted(calcWorkingDaysCompleted((windowData as EvaluationWindow).start_date, bestDate));
          }
        }

        setIsConnected(true);
      } catch {
        // Fall back to sample data
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (windowStart) {
      setWorkingDaysCompleted(calcWorkingDaysCompleted(windowStart, selectedDate));
    }
  }, [selectedDate, windowStart]);

  const fetchAgentMap = useCallback(async () => {
    const { data: agents } = await supabase
      .from("agents")
      .select("name, site, tier, is_active, terminated_date, manager");

    const targetDate = isRangeMode ? dateRange.end : selectedDate;
    const filtered = (agents ?? []).filter((a: { is_active: boolean; terminated_date: string | null }) => {
      if (a.is_active) return true;
      if (a.terminated_date && targetDate < a.terminated_date) return true;
      return false;
    });

    return new Map(filtered.map((a: { name: string; site: string; tier: string; manager: string | null }) => [a.name, a]));
  }, [selectedDate, isRangeMode, dateRange]);

  const fetchMtdMap = useCallback(async (endDate: string) => {
    const mtdMap = new Map<string, { mtdSales: number; mtdDays: number; mtdPremium: number }>();
    if (!windowStart) return mtdMap;

    const { data: mtdRows } = await supabase
      .from("daily_scrape_data")
      .select("agent_name, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, scrape_date")
      .gte("scrape_date", windowStart)
      .lte("scrape_date", endDate);

    const grouped = new Map<string, DailyScrapeRow[]>();
    for (const row of (mtdRows ?? []) as DailyScrapeRow[]) {
      const existing = grouped.get(row.agent_name) ?? [];
      existing.push(row);
      grouped.set(row.agent_name, existing);
    }
    for (const [name, rows] of grouped) {
      mtdMap.set(name, {
        mtdSales: rows.reduce((s, r) => s + r.ib_sales + r.ob_sales + r.custom_sales, 0),
        mtdDays: new Set(rows.map((r) => r.scrape_date)).size,
        mtdPremium: rows.reduce((s, r) => s + r.ib_premium + r.ob_premium + r.custom_premium, 0),
      });
    }
    return mtdMap;
  }, [windowStart]);

  const refreshDaily = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);

    try {
      let query = supabase.from("daily_scrape_data").select("*");
      let poolQuery = supabase.from("leads_pool_daily_data").select("*");
      if (isRangeMode && dateRange.start && dateRange.end) {
        query = query.gte("scrape_date", dateRange.start).lte("scrape_date", dateRange.end);
        poolQuery = poolQuery.gte("scrape_date", dateRange.start).lte("scrape_date", dateRange.end);
      } else {
        query = query.eq("scrape_date", selectedDate);
        poolQuery = poolQuery.eq("scrape_date", selectedDate);
      }

      const perfDateFilter = isRangeMode && dateRange.start && dateRange.end
        ? { start: dateRange.start, end: dateRange.end }
        : { eq: selectedDate };

      const [{ data: dailyRows }, { data: poolRows }, { data: inventoryRows }] = await Promise.all([
        query,
        poolQuery,
        supabase
          .from("leads_pool_inventory")
          .select("*")
          .eq("scrape_date", isRangeMode ? dateRange.end : selectedDate)
          .order("scrape_hour", { ascending: false }),
      ]);

      let perfBase = supabase.from("agent_performance_daily").select("*").is("scrape_hour", null);
      if (perfDateFilter.eq) perfBase = perfBase.eq("scrape_date", perfDateFilter.eq);
      else perfBase = perfBase.gte("scrape_date", perfDateFilter.start!).lte("scrape_date", perfDateFilter.end!);
      let { data: perfRows } = await perfBase;

      if (!perfRows || perfRows.length === 0) {
        let hourlyQ = supabase.from("agent_performance_daily").select("*").order("scrape_hour", { ascending: false });
        if (perfDateFilter.eq) hourlyQ = hourlyQ.eq("scrape_date", perfDateFilter.eq);
        else hourlyQ = hourlyQ.gte("scrape_date", perfDateFilter.start!).lte("scrape_date", perfDateFilter.end!);
        const { data: hourlyRows } = await hourlyQ;
        if (hourlyRows && hourlyRows.length > 0) {
          const maxHour = Math.max(...(hourlyRows as AgentPerfRow[]).map(r => r.scrape_hour ?? 0));
          perfRows = hourlyRows.filter((r: AgentPerfRow) => r.scrape_hour === maxHour);
        }
      }

      const typedRows = (dailyRows ?? []) as DailyScrapeRow[];
      const typedPoolRows = (poolRows ?? []) as PoolDailyRow[];
      const typedPerfRows = (perfRows ?? []) as AgentPerfRow[];

      // Build pool inventory (use latest hour's snapshot)
      if (inventoryRows && inventoryRows.length > 0) {
        const latestHour = (inventoryRows as Array<{ scrape_hour: number }>)[0].scrape_hour;
        const latestInventory = (inventoryRows as Array<{ status: string; total_leads: number; scrape_hour: number }>)
          .filter((r) => r.scrape_hour === latestHour)
          .map((r) => ({ status: r.status, totalLeads: r.total_leads }));
        setPoolInventory(latestInventory);
      } else {
        setPoolInventory([]);
      }

      const poolMap = typedPoolRows.length > 0 ? buildPoolMetricsMap(typedPoolRows) : undefined;
      const funnelMap = typedPerfRows.length > 0 ? buildFunnelMap(typedPerfRows) : undefined;

      if (typedRows.length === 0 && !poolMap && !funnelMap) {
        setDailyT1([]);
        setDailyT2([]);
        setDailyT3([]);
        setLoading(false);
        return;
      }

      const agentMap = await fetchAgentMap();
      const endDate = isRangeMode ? dateRange.end : selectedDate;
      const mtdMap = await fetchMtdMap(endDate);

      let daysActiveMap: Map<string, number> | undefined;
      if (isRangeMode) {
        daysActiveMap = new Map();
        const byAgent = new Map<string, Set<string>>();
        for (const row of typedRows) {
          const set = byAgent.get(row.agent_name) ?? new Set();
          set.add(row.scrape_date);
          byAgent.set(row.agent_name, set);
        }
        for (const [name, dates] of byAgent) {
          daysActiveMap.set(name, dates.size);
        }
      }

      const { t1, t2, t3 } = buildPulseAgents(typedRows, agentMap, mtdMap, daysActiveMap, poolMap, funnelMap);
      setDailyT1(t1);
      setDailyT2(t2);
      setDailyT3(t3);
      setIsConnected(true);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, [selectedDate, windowStart, isRangeMode, dateRange, fetchAgentMap, fetchMtdMap]);

  const refreshMonthly = useCallback(async () => {
    if (!isSupabaseConfigured || !activeWindow) return;
    setLoading(true);

    try {
      const { data: snapshots } = await supabase
        .from("monthly_snapshots")
        .select("*")
        .eq("window_id", activeWindow.id);

      const typedSnapshots = (snapshots ?? []) as SnapshotRow[];
      const t1: MonthlyAgent[] = [];
      const t2: MonthlyAgent[] = [];
      const t3: MonthlyAgent[] = [];

      for (const s of typedSnapshots) {
        const agent: MonthlyAgent = {
          name: s.agent_name,
          site: s.site ?? undefined,
          tier: s.tier as Tier,
          leadsDelivered: s.total_leads_delivered,
          ibCalls: s.total_ib_calls || undefined,
          obLeads: s.total_ob_leads || undefined,
          sales: s.total_sales,
          ibSales: s.total_ib_sales || undefined,
          obSales: s.total_ob_sales || undefined,
          bonusSales: s.total_custom_sales || undefined,
          totalPremium: s.total_premium,
          leadCost: s.lead_cost,
          profit: s.profit,
          roli: s.roli,
          closeRate: s.close_rate,
          ibCR: s.ib_close_rate ?? undefined,
          obCR: s.ob_close_rate ?? undefined,
          priorROLI: s.prior_roli ?? undefined,
        };

        if (s.tier === "T1") t1.push(agent);
        else if (s.tier === "T2") t2.push(agent);
        else t3.push(agent);
      }

      setMonthlyT1(t1);
      setMonthlyT2(t2);
      setMonthlyT3(t3);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, [activeWindow]);

  const refreshPipeline = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setPipelineLoading(true);
    try {
      const targetDate = isRangeMode ? dateRange.end : selectedDate;

      // 30-day lookback for rolling avg premium & close rate
      const lookbackDate = (() => {
        const d = new Date(targetDate);
        d.setDate(d.getDate() - 30);
        return d.toISOString().slice(0, 10);
      })();

      // Prior business day for follow-up delta
      const priorDate = (() => {
        const idx = availableDates.indexOf(targetDate);
        return idx >= 0 && idx < availableDates.length - 1 ? availableDates[idx + 1] : null;
      })();

      const [
        { data: compRows },
        { data: prodRows },
        { data: plRows },
        agentMap,
        { data: histRows },
        { data: priorRows },
      ] = await Promise.all([
        supabase.from("pipeline_compliance_daily").select("*").eq("scrape_date", targetDate),
        supabase.from("daily_scrape_data").select("agent_name, tier, ib_leads_delivered, ob_leads_delivered, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, total_dials, talk_time_minutes").eq("scrape_date", targetDate),
        supabase.from("leads_pool_daily_data").select("agent_name, calls_made, talk_time_minutes, sales_made, premium, self_assigned_leads, answered_calls").eq("scrape_date", targetDate),
        fetchAgentMap(),
        supabase.from("daily_scrape_data").select("agent_name, ib_leads_delivered, ob_leads_delivered, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, scrape_date").gte("scrape_date", lookbackDate).lte("scrape_date", targetDate),
        priorDate
          ? supabase.from("pipeline_compliance_daily").select("agent_name, past_due_follow_ups").eq("scrape_date", priorDate)
          : Promise.resolve({ data: null }),
      ]) as [
        { data: PipelineComplianceRow[] | null },
        { data: ProductionRow[] | null },
        { data: PipelinePoolRow[] | null },
        Map<string, { name: string; site: string; tier: string }>,
        { data: Array<{ agent_name: string; ib_leads_delivered: number; ob_leads_delivered: number; ib_sales: number; ob_sales: number; custom_sales: number; ib_premium: number; ob_premium: number; custom_premium: number; scrape_date: string }> | null },
        { data: Array<{ agent_name: string; past_due_follow_ups: number }> | null },
      ];

      let { data: perfRows2 } = await supabase.from("agent_performance_daily").select("*").eq("scrape_date", targetDate).is("scrape_hour", null);
      if (!perfRows2 || perfRows2.length === 0) {
        const { data: hourlyRows } = await supabase.from("agent_performance_daily").select("*").eq("scrape_date", targetDate).order("scrape_hour", { ascending: false });
        if (hourlyRows && hourlyRows.length > 0) {
          const maxHour = Math.max(...(hourlyRows as AgentPerfRow[]).map(r => r.scrape_hour ?? 0));
          perfRows2 = hourlyRows.filter((r: AgentPerfRow) => r.scrape_hour === maxHour);
        }
      }

      const typedComp = (compRows ?? []) as PipelineComplianceRow[];
      const typedProd = (prodRows ?? []) as ProductionRow[];
      const typedPool = (plRows ?? []) as PipelinePoolRow[];

      if (typedComp.length === 0) {
        setPipelineAgents([]);
        return;
      }

      // Build rolling historical stats per agent
      const historicalStats = new Map<string, HistoricalAgentStats>();
      if (histRows && histRows.length > 0) {
        const byAgent = new Map<string, typeof histRows>();
        for (const r of histRows) {
          const existing = byAgent.get(r.agent_name) ?? [];
          existing.push(r);
          byAgent.set(r.agent_name, existing);
        }
        for (const [name, rows] of Array.from(byAgent)) {
          historicalStats.set(name, {
            totalSales: rows.reduce((s, r) => s + r.ib_sales + r.ob_sales + r.custom_sales, 0),
            totalLeads: rows.reduce((s, r) => s + r.ib_leads_delivered + r.ob_leads_delivered, 0),
            totalPremium: rows.reduce((s, r) => s + r.ib_premium + r.ob_premium + r.custom_premium, 0),
            days: new Set(rows.map(r => r.scrape_date)).size,
          });
        }
      }

      // Build prior-day compliance map
      const priorDayCompliance = new Map<string, PriorDayCompliance>();
      if (priorRows) {
        for (const r of priorRows) {
          priorDayCompliance.set(r.agent_name, { pastDue: r.past_due_follow_ups ?? 0 });
        }
      }

      const pipelineFunnelMap = (perfRows2 ?? []).length > 0 ? buildFunnelMap((perfRows2 ?? []) as AgentPerfRow[]) : undefined;
      const agents = buildPipelineAgents(typedProd, typedPool, typedComp, agentMap, historicalStats, priorDayCompliance, pipelineFunnelMap);
      setPipelineAgents(agents);
    } catch {
      // keep existing data
    } finally {
      setPipelineLoading(false);
    }
  }, [selectedDate, isRangeMode, dateRange, fetchAgentMap, availableDates]);

  useEffect(() => {
    if (isSupabaseConfigured) refreshPipeline();
  }, [selectedDate, refreshPipeline]);

  useEffect(() => {
    if (isSupabaseConfigured) refreshDaily();
  }, [selectedDate, isRangeMode, dateRange, refreshDaily]);

  useEffect(() => {
    if (isSupabaseConfigured && activeWindow) refreshMonthly();
  }, [activeWindow, refreshMonthly]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const channel = supabase
      .channel("daily-scrape-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "daily_scrape_data",
          filter: `scrape_date=eq.${selectedDate}`,
        },
        () => {
          refreshDaily();
          // Refresh available dates when new data arrives
          supabase
            .from("daily_scrape_data")
            .select("scrape_date")
            .order("scrape_date", { ascending: false })
            .then(({ data }) => {
              if (data) {
                const dates = [...new Set(data.map((r: { scrape_date: string }) => r.scrape_date))].sort().reverse();
                setAvailableDates(dates);
              }
            });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDate, refreshDaily]);

  const loadSampleData = useCallback(() => {
    setDailyT1(sampleDailyT1);
    setDailyT2(sampleDailyT2);
    setDailyT3(sampleDailyT3);
    setMonthlyT1(sampleMonthlyT1);
    setMonthlyT2(sampleMonthlyT2);
    setMonthlyT3(sampleMonthlyT3);
  }, []);

  const clearData = useCallback(() => {
    setDailyT1([]);
    setDailyT2([]);
    setDailyT3([]);
    setMonthlyT1([]);
    setMonthlyT2([]);
    setMonthlyT3([]);
  }, []);

  return (
    <DataContext.Provider
      value={{
        dailyT1, dailyT2, dailyT3,
        setDailyT1, setDailyT2, setDailyT3,
        monthlyT1, monthlyT2, monthlyT3,
        setMonthlyT1, setMonthlyT2, setMonthlyT3,
        windowStart, windowEnd, workingDays, workingDaysCompleted,
        setWindowStart, setWindowEnd, setWorkingDays, setWorkingDaysCompleted,
        selectedDate, setSelectedDate,
        activeWindow,
        loadSampleData, clearData,
        loading, isConnected,
        refreshDaily, refreshMonthly,
        availableDates, isRangeMode, setIsRangeMode,
        dateRange, setDateRange,
        poolInventory,
        pipelineAgents, refreshPipeline, pipelineLoading,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
