import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { MonthlyAgent, Tier } from "@/lib/types";

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

interface UseMonthlyDataReturn {
  monthlyT1: MonthlyAgent[];
  monthlyT2: MonthlyAgent[];
  monthlyT3: MonthlyAgent[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMonthlyData(windowId?: string): UseMonthlyDataReturn {
  const [monthlyT1, setMonthlyT1] = useState<MonthlyAgent[]>([]);
  const [monthlyT2, setMonthlyT2] = useState<MonthlyAgent[]>([]);
  const [monthlyT3, setMonthlyT3] = useState<MonthlyAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMonthlyData = useCallback(async () => {
    if (!isSupabaseConfigured || !windowId) return;
    setLoading(true);
    setError(null);

    try {
      const { data: snapshots, error: snapErr } = await supabase
        .from("monthly_snapshots")
        .select("*")
        .eq("window_id", windowId);

      if (snapErr) throw snapErr;

      const typed = (snapshots ?? []) as SnapshotRow[];
      const t1: MonthlyAgent[] = [];
      const t2: MonthlyAgent[] = [];
      const t3: MonthlyAgent[] = [];

      for (const s of typed) {
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
          status: undefined,
          rank: s.rank_in_tier ?? undefined,
        };

        if (s.tier === "T1") t1.push(agent);
        else if (s.tier === "T2") t2.push(agent);
        else t3.push(agent);
      }

      setMonthlyT1(t1);
      setMonthlyT2(t2);
      setMonthlyT3(t3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load monthly data");
    } finally {
      setLoading(false);
    }
  }, [windowId]);

  useEffect(() => {
    fetchMonthlyData();
  }, [fetchMonthlyData]);

  return { monthlyT1, monthlyT2, monthlyT3, loading, error, refetch: fetchMonthlyData };
}
