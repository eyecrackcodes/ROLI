import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Daily coaching action per agent — backed by `agent_coaching_actions_daily`.
 *
 * One row per agent per day with a single resolved coaching action label
 * (clear_pipeline | get_on_phones | coach_close | audit_calls | stay_course |
 * build_the_day | no_data) plus a one-line rationale.
 *
 * Use to render an action badge on the Daily Pulse table and a header card
 * on the AgentDrillDown.
 */

export type CoachingActionCode =
  | "clear_pipeline"
  | "get_on_phones"
  | "coach_close"
  | "audit_calls"
  | "stay_course"
  | "build_the_day"
  | "no_data";

export interface CoachingAction {
  agent_name: string;
  scrape_date: string;
  action_code: CoachingActionCode;
  action_label: string;
  action_priority: number;
  action_rationale: string;
  rpa_minutes: number;
  rpa_band: string;
  total_sales: number;
  total_premium: number;
  total_leads: number;
  contact_pct: number;
  leads_worked: number;
  past_due: number;
  todays_fu: number;
  untouched: number;
  call_queue: number;
  actionable_leads: number;
  dial_overhead_source: string;
}

export interface CoachingActionTallies {
  clear_pipeline: number;
  get_on_phones: number;
  coach_close: number;
  audit_calls: number;
  stay_course: number;
  build_the_day: number;
  no_data: number;
  total: number;
}

export interface UseCoachingActionsReturn {
  /** Map keyed by agent_name for O(1) row lookup. */
  byAgent: Map<string, CoachingAction>;
  /** All actions sorted by priority asc, then premium desc (the daily coaching queue). */
  queue: CoachingAction[];
  /** Counts per action_code (and total) for dashboard summary tiles. */
  tallies: CoachingActionTallies;
  loading: boolean;
  error: string | null;
}

const EMPTY_TALLIES: CoachingActionTallies = {
  clear_pipeline: 0,
  get_on_phones: 0,
  coach_close: 0,
  audit_calls: 0,
  stay_course: 0,
  build_the_day: 0,
  no_data: 0,
  total: 0,
};

interface RawRow {
  agent_name: string;
  scrape_date: string;
  action_code: string;
  action_label: string;
  action_priority: number;
  action_rationale: string;
  rpa_minutes: number | string | null;
  rpa_band: string | null;
  total_sales: number | string | null;
  total_premium: number | string | null;
  total_leads: number | string | null;
  contact_pct: number | string | null;
  leads_worked: number | string | null;
  past_due: number | string | null;
  todays_fu: number | string | null;
  untouched: number | string | null;
  call_queue: number | string | null;
  actionable_leads: number | string | null;
  dial_overhead_source: string | null;
}

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function useCoachingActions(scrapeDate: string | null): UseCoachingActionsReturn {
  const [rows, setRows] = useState<RawRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isSupabaseConfigured || !scrapeDate) {
        setRows([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase
          .from("agent_coaching_actions_daily")
          .select("*")
          .eq("scrape_date", scrapeDate);
        if (err) throw err;
        if (!cancelled) setRows((data ?? []) as RawRow[]);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load coaching actions");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [scrapeDate]);

  return useMemo<UseCoachingActionsReturn>(() => {
    const actions: CoachingAction[] = rows.map((r) => ({
      agent_name: r.agent_name,
      scrape_date: r.scrape_date,
      action_code: (r.action_code as CoachingActionCode) ?? "no_data",
      action_label: r.action_label ?? "No data yet",
      action_priority: r.action_priority ?? 9,
      action_rationale: r.action_rationale ?? "",
      rpa_minutes: num(r.rpa_minutes),
      rpa_band: r.rpa_band ?? "short",
      total_sales: num(r.total_sales),
      total_premium: num(r.total_premium),
      total_leads: num(r.total_leads),
      contact_pct: num(r.contact_pct),
      leads_worked: num(r.leads_worked),
      past_due: num(r.past_due),
      todays_fu: num(r.todays_fu),
      untouched: num(r.untouched),
      call_queue: num(r.call_queue),
      actionable_leads: num(r.actionable_leads),
      dial_overhead_source: r.dial_overhead_source ?? "inference",
    }));

    const byAgent = new Map<string, CoachingAction>();
    for (const a of actions) byAgent.set(a.agent_name, a);

    const queue = [...actions].sort((a, b) => {
      if (a.action_priority !== b.action_priority) {
        return a.action_priority - b.action_priority;
      }
      return b.total_premium - a.total_premium;
    });

    const tallies: CoachingActionTallies = { ...EMPTY_TALLIES };
    for (const a of actions) {
      tallies[a.action_code] += 1;
      tallies.total += 1;
    }

    return { byAgent, queue, tallies, loading, error };
  }, [rows, loading, error]);
}

/**
 * Visual metadata per action code — color, short verb, icon hint.
 * Single source of truth so the badge in DailyPulse and the card in
 * AgentDrillDown stay consistent.
 */
export const ACTION_META: Record<
  CoachingActionCode,
  { label: string; short: string; tone: "red" | "amber" | "violet" | "blue" | "emerald" | "slate"; tw: string; dot: string }
> = {
  clear_pipeline: {
    label: "Clear the pipeline",
    short: "Pipeline",
    tone: "red",
    tw: "bg-red-500/10 text-red-400 border-red-500/30",
    dot: "bg-red-400",
  },
  get_on_phones: {
    label: "Get on the phones",
    short: "Effort",
    tone: "amber",
    tw: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    dot: "bg-amber-400",
  },
  coach_close: {
    label: "Coach the close",
    short: "Skill",
    tone: "violet",
    tw: "bg-violet-500/10 text-violet-400 border-violet-500/30",
    dot: "bg-violet-400",
  },
  audit_calls: {
    label: "Audit the calls",
    short: "Audit",
    tone: "blue",
    tw: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    dot: "bg-blue-400",
  },
  stay_course: {
    label: "Stay the course",
    short: "Star",
    tone: "emerald",
    tw: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  build_the_day: {
    label: "Build the day",
    short: "Building",
    tone: "slate",
    tw: "bg-slate-500/10 text-slate-300 border-slate-500/30",
    dot: "bg-slate-400",
  },
  no_data: {
    label: "No data yet",
    short: "—",
    tone: "slate",
    tw: "bg-muted/40 text-muted-foreground border-border",
    dot: "bg-muted-foreground/40",
  },
};
