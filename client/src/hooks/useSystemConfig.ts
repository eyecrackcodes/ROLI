import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface GateThresholds {
  MIN_CR_FOR_PROMOTION: number;
  PROFIT_FLOOR_PERCENTILE: number;
  TRAJECTORY_IMPROVEMENT: number;
  T1_IB_CR_QUARTILE: number;
  MAX_SWAPS_PER_WINDOW: number;
}

const DEFAULT_THRESHOLDS: GateThresholds = {
  MIN_CR_FOR_PROMOTION: 5,
  PROFIT_FLOOR_PERCENTILE: 40,
  TRAJECTORY_IMPROVEMENT: 20,
  T1_IB_CR_QUARTILE: 25,
  MAX_SWAPS_PER_WINDOW: 5,
};

interface UseSystemConfigReturn {
  gateThresholds: GateThresholds;
  loading: boolean;
  error: string | null;
  saveThresholds: (thresholds: GateThresholds) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useSystemConfig(): UseSystemConfigReturn {
  const [gateThresholds, setGateThresholds] = useState<GateThresholds>(DEFAULT_THRESHOLDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchErr } = await supabase
        .from("system_config")
        .select("key, value")
        .eq("key", "gate_thresholds")
        .single();

      if (fetchErr && fetchErr.code !== "PGRST116") throw fetchErr;

      if (data?.value) {
        setGateThresholds({ ...DEFAULT_THRESHOLDS, ...(data.value as unknown as GateThresholds) });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, []);

  const saveThresholds = useCallback(
    async (thresholds: GateThresholds) => {
      if (!isSupabaseConfigured) return;
      const { error: upsertErr } = await supabase
        .from("system_config")
        .upsert({
          key: "gate_thresholds",
          value: thresholds as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        });
      if (upsertErr) throw upsertErr;
      setGateThresholds(thresholds);
    },
    []
  );

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return { gateThresholds, loading, error, saveThresholds, refetch: fetchConfig };
}
