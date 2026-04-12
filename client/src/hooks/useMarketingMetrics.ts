import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  fetchMarketingSummary,
  type MarketingDailySummary,
} from "@/lib/marketingSummary";

export interface UseMarketingMetricsResult {
  data: MarketingDailySummary | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Org-wide daily marketing metrics (CPC, ROAS) synced into ROLI by n8n from Marketing AAR.
 */
export function useMarketingMetrics(reportDate: string | null): UseMarketingMetricsResult {
  const [data, setData] = useState<MarketingDailySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!isSupabaseConfigured || !reportDate) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await fetchMarketingSummary(supabase, reportDate);
      setData(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load marketing summary");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [reportDate]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
