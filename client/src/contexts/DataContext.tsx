import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { DailyPulseAgent, MonthlyAgent, Tier } from "@/lib/types";
import {
  sampleDailyT1, sampleDailyT2, sampleDailyT3,
  sampleMonthlyT1, sampleMonthlyT2, sampleMonthlyT3,
} from "@/lib/sampleData";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { EvaluationWindow } from "@/hooks/useEvaluationWindows";

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

function buildPulseAgents(
  rows: DailyScrapeRow[],
  agentMap: Map<string, { name: string; site: string; tier: string }>,
  mtdMap: Map<string, { mtdSales: number; mtdDays: number; mtdPremium: number }>,
  daysActiveMap?: Map<string, number>,
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

  for (const [name, agentRows] of grouped) {
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

    const pulseAgent: DailyPulseAgent = {
      name,
      site,
      tier,
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
    };

    if (tier === "T1") t1.push(pulseAgent);
    else if (tier === "T2") t2.push(pulseAgent);
    else t3.push(pulseAgent);
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

  // Fetch available dates + evaluation window on mount, then smart-select date
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    (async () => {
      try {
        const [{ data: windowData }, { data: dateRows }] = await Promise.all([
          supabase.from("evaluation_windows").select("*").eq("is_active", true).single(),
          supabase.from("daily_scrape_data").select("scrape_date").order("scrape_date", { ascending: false }),
        ]);

        if (windowData) {
          const w = windowData as EvaluationWindow;
          setActiveWindow(w);
          setWindowStart(w.start_date);
          setWindowEnd(w.end_date);
          setWorkingDays(w.working_days);
        }

        const uniqueDates = [...new Set((dateRows ?? []).map((r: { scrape_date: string }) => r.scrape_date))].sort().reverse();
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
      .select("name, site, tier")
      .eq("is_active", true);
    return new Map((agents ?? []).map((a: { name: string; site: string; tier: string }) => [a.name, a]));
  }, []);

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

      if (isRangeMode && dateRange.start && dateRange.end) {
        query = query.gte("scrape_date", dateRange.start).lte("scrape_date", dateRange.end);
      } else {
        query = query.eq("scrape_date", selectedDate);
      }

      const { data: dailyRows } = await query;
      const typedRows = (dailyRows ?? []) as DailyScrapeRow[];

      if (typedRows.length === 0) {
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

      const { t1, t2, t3 } = buildPulseAgents(typedRows, agentMap, mtdMap, daysActiveMap);
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
