import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface EvaluationWindow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  working_days: number;
  is_active: boolean;
  is_inaugural: boolean;
  created_at: string;
}

interface UseEvaluationWindowsReturn {
  windows: EvaluationWindow[];
  activeWindow: EvaluationWindow | null;
  loading: boolean;
  error: string | null;
  setActiveWindow: (windowId: string) => Promise<void>;
  addWindow: (window: Omit<EvaluationWindow, "id" | "created_at">) => Promise<void>;
  updateWindow: (id: string, updates: Partial<EvaluationWindow>) => Promise<void>;
  computeSnapshot: (windowId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useEvaluationWindows(): UseEvaluationWindowsReturn {
  const [windows, setWindows] = useState<EvaluationWindow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWindows = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchErr } = await supabase
        .from("evaluation_windows")
        .select("*")
        .order("start_date", { ascending: true });

      if (fetchErr) throw fetchErr;
      setWindows((data as EvaluationWindow[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load windows");
    } finally {
      setLoading(false);
    }
  }, []);

  const setActiveWindowFn = useCallback(
    async (windowId: string) => {
      if (!isSupabaseConfigured) return;
      await supabase
        .from("evaluation_windows")
        .update({ is_active: false })
        .neq("id", windowId);
      await supabase
        .from("evaluation_windows")
        .update({ is_active: true })
        .eq("id", windowId);
      await fetchWindows();
    },
    [fetchWindows]
  );

  const addWindow = useCallback(
    async (window: Omit<EvaluationWindow, "id" | "created_at">) => {
      if (!isSupabaseConfigured) return;
      const { error: insertErr } = await supabase
        .from("evaluation_windows")
        .insert(window);
      if (insertErr) throw insertErr;
      await fetchWindows();
    },
    [fetchWindows]
  );

  const updateWindow = useCallback(
    async (id: string, updates: Partial<EvaluationWindow>) => {
      if (!isSupabaseConfigured) return;
      const { error: updateErr } = await supabase
        .from("evaluation_windows")
        .update(updates)
        .eq("id", id);
      if (updateErr) throw updateErr;
      await fetchWindows();
    },
    [fetchWindows]
  );

  const computeSnapshot = useCallback(async (windowId: string) => {
    if (!isSupabaseConfigured) return;
    const { error: rpcErr } = await supabase.rpc("compute_monthly_snapshot", {
      p_window_id: windowId,
    });
    if (rpcErr) throw rpcErr;
  }, []);

  useEffect(() => {
    fetchWindows();
  }, [fetchWindows]);

  const activeWindow = windows.find((w) => w.is_active) ?? null;

  return {
    windows,
    activeWindow,
    loading,
    error,
    setActiveWindow: setActiveWindowFn,
    addWindow,
    updateWindow,
    computeSnapshot,
    refetch: fetchWindows,
  };
}
