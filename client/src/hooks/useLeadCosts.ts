import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface LeadCostEntry {
  id: string;
  tier: "T1" | "T2" | "T3";
  lead_channel: "inbound" | "outbound";
  cost_per_lead: number;
  effective_date: string;
  created_at: string;
  created_by: string | null;
}

export interface ActiveCost {
  tier: string;
  lead_channel: string;
  cost_per_lead: number;
}

interface UseLeadCostsReturn {
  activeCosts: ActiveCost[];
  costHistory: LeadCostEntry[];
  loading: boolean;
  error: string | null;
  setCost: (
    tier: "T1" | "T2" | "T3",
    channel: "inbound" | "outbound",
    cost: number,
    effectiveDate: string
  ) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useLeadCosts(): UseLeadCostsReturn {
  const [activeCosts, setActiveCosts] = useState<ActiveCost[]>([]);
  const [costHistory, setCostHistory] = useState<LeadCostEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCosts = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError(null);

    try {
      const { data: active, error: activeErr } = await supabase.rpc(
        "get_active_lead_costs",
        { target_date: new Date().toISOString().slice(0, 10) }
      );
      if (activeErr) throw activeErr;
      setActiveCosts((active as ActiveCost[]) ?? []);

      const { data: history, error: histErr } = await supabase
        .from("lead_cost_config")
        .select("*")
        .order("effective_date", { ascending: false })
        .order("tier")
        .order("lead_channel");
      if (histErr) throw histErr;
      setCostHistory((history as LeadCostEntry[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load costs");
    } finally {
      setLoading(false);
    }
  }, []);

  const setCost = useCallback(
    async (
      tier: "T1" | "T2" | "T3",
      channel: "inbound" | "outbound",
      cost: number,
      effectiveDate: string
    ) => {
      if (!isSupabaseConfigured) return;

      const { error: insertErr } = await supabase
        .from("lead_cost_config")
        .upsert(
          {
            tier,
            lead_channel: channel,
            cost_per_lead: cost,
            effective_date: effectiveDate,
          },
          { onConflict: "tier,lead_channel,effective_date" }
        );

      if (insertErr) throw insertErr;
      await fetchCosts();
    },
    [fetchCosts]
  );

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

  return { activeCosts, costHistory, loading, error, setCost, refetch: fetchCosts };
}
