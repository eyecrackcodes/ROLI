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
}

const DataContext = createContext<DataContextType | null>(null);

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
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    if (day === 0) d.setDate(d.getDate() - 2); // Sunday → Friday
    if (day === 6) d.setDate(d.getDate() - 1); // Saturday → Friday
    return d.toISOString().slice(0, 10);
  });
  const [activeWindow, setActiveWindow] = useState<EvaluationWindow | null>(null);
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    (async () => {
      try {
        const { data } = await supabase
          .from("evaluation_windows")
          .select("*")
          .eq("is_active", true)
          .single();

        if (data) {
          const w = data as EvaluationWindow;
          setActiveWindow(w);
          setWindowStart(w.start_date);
          setWindowEnd(w.end_date);
          setWorkingDays(w.working_days);
          setWorkingDaysCompleted(calcWorkingDaysCompleted(w.start_date, selectedDate));
          setIsConnected(true);
        }
      } catch {
        // Fall back to sample data
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Recalculate working days completed when date changes
  useEffect(() => {
    if (windowStart) {
      setWorkingDaysCompleted(calcWorkingDaysCompleted(windowStart, selectedDate));
    }
  }, [selectedDate, windowStart]);

  const refreshDaily = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);

    try {
      const { data: dailyRows } = await supabase
        .from("daily_scrape_data")
        .select("*")
        .eq("scrape_date", selectedDate);

      const { data: agents } = await supabase
        .from("agents")
        .select("name, site, tier")
        .eq("is_active", true);

      const typedRows = (dailyRows ?? []) as DailyScrapeRow[];
      const typedAgents = (agents ?? []) as Array<{ name: string; site: string; tier: string }>;

      if (typedRows.length === 0) {
        setDailyT1([]);
        setDailyT2([]);
        setDailyT3([]);
        setLoading(false);
        return;
      }

      const agentMap = new Map(typedAgents.map((a) => [a.name, a]));

      let mtdMap = new Map<string, { mtdSales: number; mtdDays: number; mtdPremium: number }>();
      if (windowStart) {
        const { data: mtdRows } = await supabase
          .from("daily_scrape_data")
          .select("agent_name, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, scrape_date")
          .gte("scrape_date", windowStart)
          .lte("scrape_date", selectedDate);

        const typedMtd = (mtdRows ?? []) as DailyScrapeRow[];
        const grouped = new Map<string, DailyScrapeRow[]>();
        for (const row of typedMtd) {
          const existing = grouped.get(row.agent_name) ?? [];
          existing.push(row);
          grouped.set(row.agent_name, existing);
        }
        Array.from(grouped.entries()).forEach(([name, rows]) => {
          const totalSales = rows.reduce((s: number, r: DailyScrapeRow) => s + r.ib_sales + r.ob_sales + r.custom_sales, 0);
          const totalPremium = rows.reduce((s: number, r: DailyScrapeRow) => s + r.ib_premium + r.ob_premium + r.custom_premium, 0);
          const uniqueDays = new Set(rows.map((r: DailyScrapeRow) => r.scrape_date)).size;
          mtdMap.set(name, { mtdSales: totalSales, mtdDays: uniqueDays, mtdPremium: totalPremium });
        });
      }

      const t1: DailyPulseAgent[] = [];
      const t2: DailyPulseAgent[] = [];
      const t3: DailyPulseAgent[] = [];

      for (const row of typedRows) {
        const agent = agentMap.get(row.agent_name);
        const site = agent?.site ?? "CHA";
        const tier = (row.tier as Tier) ?? (agent?.tier as Tier) ?? "T3";
        const totalSales = row.ib_sales + row.ob_sales + row.custom_sales;
        const totalPremium = row.ib_premium + row.ob_premium + row.custom_premium;
        const mtd = mtdMap.get(row.agent_name);

        const pulseAgent: DailyPulseAgent = {
          name: row.agent_name,
          site,
          tier,
          ibCalls: row.ib_leads_delivered || undefined,
          ibSales: row.ib_sales || undefined,
          obLeads: row.ob_leads_delivered || undefined,
          obSales: row.ob_sales || undefined,
          dials: row.total_dials || undefined,
          talkTimeMin: row.talk_time_minutes || undefined,
          salesToday: totalSales,
          premiumToday: totalPremium - (row.custom_premium ?? 0),
          bonusSales: row.custom_sales || undefined,
          totalPremium,
          mtdSales: mtd?.mtdSales,
          mtdPace: mtd && mtd.mtdDays > 0 ? mtd.mtdSales / mtd.mtdDays : undefined,
        };

        if (tier === "T1") t1.push(pulseAgent);
        else if (tier === "T2") t2.push(pulseAgent);
        else t3.push(pulseAgent);
      }

      setDailyT1(t1);
      setDailyT2(t2);
      setDailyT3(t3);
      setIsConnected(true);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, [selectedDate, windowStart]);

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
  }, [selectedDate, refreshDaily]);

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
