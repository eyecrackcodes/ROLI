import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface Agent {
  id: string;
  name: string;
  site: "CHA" | "AUS";
  tier: "T1" | "T2" | "T3";
  daily_lead_volume: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

type AgentInput = Omit<Agent, "id" | "created_at" | "updated_at">;

interface UseAgentsReturn {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  addAgent: (agent: AgentInput) => Promise<void>;
  updateAgent: (id: string, updates: Partial<Agent>) => Promise<void>;
  toggleActive: (id: string, isActive: boolean) => Promise<void>;
  bulkImport: (agents: AgentInput[]) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useAgents(): UseAgentsReturn {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchErr } = await supabase
        .from("agents")
        .select("*")
        .order("tier")
        .order("name");

      if (fetchErr) throw fetchErr;
      setAgents((data as Agent[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  const addAgent = useCallback(
    async (agent: AgentInput) => {
      if (!isSupabaseConfigured) return;
      const { error: insertErr } = await supabase
        .from("agents")
        .insert(agent as Record<string, unknown>);
      if (insertErr) throw insertErr;
      await fetchAgents();
    },
    [fetchAgents]
  );

  const updateAgent = useCallback(
    async (id: string, updates: Partial<Agent>) => {
      if (!isSupabaseConfigured) return;
      const { error: updateErr } = await supabase
        .from("agents")
        .update(updates as Record<string, unknown>)
        .eq("id", id);
      if (updateErr) throw updateErr;
      await fetchAgents();
    },
    [fetchAgents]
  );

  const toggleActive = useCallback(
    async (id: string, isActive: boolean) => {
      if (!isSupabaseConfigured) return;
      const { error: updateErr } = await supabase
        .from("agents")
        .update({ is_active: isActive } as Record<string, unknown>)
        .eq("id", id);
      if (updateErr) throw updateErr;
      await fetchAgents();
    },
    [fetchAgents]
  );

  const bulkImport = useCallback(
    async (newAgents: AgentInput[]) => {
      if (!isSupabaseConfigured) return;
      const { error: insertErr } = await supabase
        .from("agents")
        .upsert(newAgents as Record<string, unknown>[], { onConflict: "name" });
      if (insertErr) throw insertErr;
      await fetchAgents();
    },
    [fetchAgents]
  );

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return { agents, loading, error, addAgent, updateAgent, toggleActive, bulkImport, refetch: fetchAgents };
}
