import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { DailyPulseAgent, Tier } from "@/lib/types";

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

interface AgentRow {
  name: string;
  site: string;
  tier: string;
}

interface UseDailyPulseReturn {
  dailyT1: DailyPulseAgent[];
  dailyT2: DailyPulseAgent[];
  dailyT3: DailyPulseAgent[];
  loading: boolean;
  error: string | null;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  refetch: () => Promise<void>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useDailyPulse(windowStartDate?: string): UseDailyPulseReturn {
  const [selectedDate, setSelectedDate] = useState(today());
  const [dailyT1, setDailyT1] = useState<DailyPulseAgent[]>([]);
  const [dailyT2, setDailyT2] = useState<DailyPulseAgent[]>([]);
  const [dailyT3, setDailyT3] = useState<DailyPulseAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDailyData = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError(null);

    try {
      const { data: dailyRows, error: dailyError } = await supabase
        .from("daily_scrape_data")
        .select("agent_name, tier, ib_leads_delivered, ob_leads_delivered, custom_leads, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, total_dials, talk_time_minutes")
        .eq("scrape_date", selectedDate);

      if (dailyError) throw dailyError;

      const { data: agents, error: agentError } = await supabase
        .from("agents")
        .select("name, site, tier, is_active, terminated_date");

      if (agentError) throw agentError;

      const typedRows = (dailyRows ?? []) as DailyScrapeRow[];
      const allAgents = (agents ?? []) as (AgentRow & { is_active: boolean; terminated_date: string | null })[];
      const typedAgents = allAgents.filter((a) => {
        if (a.is_active) return true;
        if (a.terminated_date && selectedDate < a.terminated_date) return true;
        return false;
      });
      const agentMap = new Map(typedAgents.map((a) => [a.name, a]));

      let mtdMap = new Map<string, { mtdSales: number; mtdDays: number; mtdPremium: number }>();
      if (windowStartDate) {
        const { data: mtdRows } = await supabase
          .from("daily_scrape_data")
          .select("agent_name, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, scrape_date")
          .gte("scrape_date", windowStartDate)
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
        const site = agent?.site ?? "RMT";
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
          mtdROLI: undefined,
        };

        if (tier === "T1") t1.push(pulseAgent);
        else if (tier === "T2") t2.push(pulseAgent);
        else t3.push(pulseAgent);
      }

      setDailyT1(t1);
      setDailyT2(t2);
      setDailyT3(t3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load daily data");
    } finally {
      setLoading(false);
    }
  }, [selectedDate, windowStartDate]);

  useEffect(() => {
    fetchDailyData();
  }, [fetchDailyData]);

  return {
    dailyT1,
    dailyT2,
    dailyT3,
    loading,
    error,
    selectedDate,
    setSelectedDate,
    refetch: fetchDailyData,
  };
}
