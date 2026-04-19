import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Coaching Quadrant + Momentum Trails
 *
 * Builds a 2D scatter of every active agent on:
 *   X = SKILL  (close rate %, sales / leads delivered)
 *   Y = EFFORT (talk minutes per working day)
 *
 * For each agent we compute aggregates across four trailing windows anchored
 * to `anchorDate` (typically Daily Pulse's selected date):
 *   T0  = anchor day itself
 *   T7  = trailing 7-day window  (anchor − 6 .. anchor)
 *   T14 = trailing 14-day window
 *   T30 = trailing 30-day window
 *
 * The momentum vector = T7 − T30 (the recent week vs the trailing month).
 * That direction + magnitude is what the quadrant trail visualizes.
 *
 * The "floor" lines = median of T7 across all active agents on each axis.
 * Quadrants are then defined relative to those medians, NOT to absolute targets,
 * so the chart tells the story of *this* roster vs each other right now.
 *
 * Source: `daily_scrape_data` (CRM Calls Report) for production volumes,
 * `agents` table for the active roster. Pure aggregation — no inference.
 */

export type QuadrantId = "stars" | "grinders" | "talents" | "atRisk";

export interface QuadrantMeta {
  id: QuadrantId;
  label: string;
  /** Coaching one-liner that summarizes "what to do with people in this quadrant". */
  prescription: string;
  /** Tailwind text color class. */
  textClass: string;
  /** Tailwind background tint for the quadrant backdrop. */
  bgClass: string;
  /** Hex color used by the SVG. */
  hex: string;
}

export const QUADRANT_META: Record<QuadrantId, QuadrantMeta> = {
  stars: {
    id: "stars",
    label: "Stars",
    prescription: "Protect & amplify — give them more leads, study their script",
    textClass: "text-emerald-400",
    bgClass: "bg-emerald-500/5",
    hex: "#10b981",
  },
  grinders: {
    id: "grinders",
    label: "Grinders",
    prescription: "Coach the close — high effort, skill is the unlock",
    textClass: "text-amber-400",
    bgClass: "bg-amber-500/5",
    hex: "#f59e0b",
  },
  talents: {
    id: "talents",
    label: "Talents",
    prescription: "Activate the engine — they can sell, they need reps",
    textClass: "text-violet-400",
    bgClass: "bg-violet-500/5",
    hex: "#8b5cf6",
  },
  atRisk: {
    id: "atRisk",
    label: "At Risk",
    prescription: "Performance review — neither effort nor closing showing up",
    textClass: "text-red-400",
    bgClass: "bg-red-500/5",
    hex: "#ef4444",
  },
};

export interface WindowStats {
  /** Sales / total leads (IB + OB + custom). 0 if no leads. */
  closeRate: number;
  /** Avg talk minutes per working day in the window. */
  talkMinutesPerDay: number;
  /** Total sales in the window. */
  sales: number;
  /** Total premium in the window. */
  premium: number;
  /** Total dials in the window. */
  dials: number;
  /** # of weekday rows present in the window (used for the per-day average). */
  daysActive: number;
}

export interface AgentTrack {
  name: string;
  site: string;
  tier: string;
  /** Window aggregates keyed by lookback (0 = today, 7/14/30 = trailing). */
  windows: { 0: WindowStats; 7: WindowStats; 14: WindowStats; 30: WindowStats };
  /** Current quadrant assignment based on T7. */
  quadrant: QuadrantId;
  /** Quadrant 30 days ago (using T30 stats, NOT T7-vs-T30 momentum). */
  prevQuadrant: QuadrantId;
  /** True if quadrant changed between T30 and T7. */
  movedQuadrant: boolean;
  /** Vector: { dx, dy } in axis units (pp for x, minutes for y). */
  momentum: { dx: number; dy: number; magnitude: number };
  /** Whether the agent had any activity in the window. */
  hasData: boolean;
}

export interface CoachingQuadrantData {
  /** All active agents with computed tracks (only those with T7 data). */
  agents: AgentTrack[];
  /** Median of T7 close rate across the floor. Becomes the X axis divider. */
  medianCloseRate: number;
  /** Median of T7 talk-min-per-day across the floor. Becomes the Y axis divider. */
  medianTalkPerDay: number;
  /** Bounds of the chart (axis max), padded for headroom. */
  axisMaxX: number;
  axisMaxY: number;
  anchorDate: string;
  loading: boolean;
  error: string | null;
}

interface DailyRow {
  agent_name: string;
  scrape_date: string;
  total_dials: number | null;
  talk_time_minutes: number | string | null;
  ib_leads_delivered: number | null;
  ob_leads_delivered: number | null;
  custom_leads: number | null;
  ib_sales: number | null;
  ob_sales: number | null;
  custom_sales: number | null;
  ib_premium: number | string | null;
  ob_premium: number | string | null;
  custom_premium: number | string | null;
}

interface AgentRow {
  name: string;
  site: string;
  tier: string;
  is_active: boolean;
  terminated_date: string | null;
}

const ZERO: WindowStats = {
  closeRate: 0, talkMinutesPerDay: 0,
  sales: 0, premium: 0, dials: 0, daysActive: 0,
};

/** Anchor − N days, formatted as YYYY-MM-DD (calendar days, no business-day skip). */
function shiftDate(anchor: string, daysBack: number): string {
  const d = new Date(anchor + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

/** Sum-of-rows aggregator scoped to a date range. */
function aggregate(rows: DailyRow[], from: string, to: string): WindowStats {
  let dials = 0, talk = 0, leads = 0, sales = 0, premium = 0;
  const daySet = new Set<string>();
  for (const r of rows) {
    if (r.scrape_date < from || r.scrape_date > to) continue;
    daySet.add(r.scrape_date);
    dials += r.total_dials ?? 0;
    talk += Number(r.talk_time_minutes ?? 0);
    leads += (r.ib_leads_delivered ?? 0) + (r.ob_leads_delivered ?? 0) + (r.custom_leads ?? 0);
    sales += (r.ib_sales ?? 0) + (r.ob_sales ?? 0) + (r.custom_sales ?? 0);
    premium += Number(r.ib_premium ?? 0) + Number(r.ob_premium ?? 0) + Number(r.custom_premium ?? 0);
  }
  const days = Math.max(1, daySet.size);
  return {
    closeRate: leads > 0 ? sales / leads : 0,
    talkMinutesPerDay: talk / days,
    sales, premium, dials,
    daysActive: daySet.size,
  };
}

/** Median of a number array, nan-safe. */
function median(xs: number[]): number {
  const s = xs.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function classify(cr: number, talk: number, medCR: number, medTalk: number): QuadrantId {
  const skilled = cr >= medCR;
  const effortful = talk >= medTalk;
  if (skilled && effortful)  return "stars";
  if (!skilled && effortful) return "grinders";
  if (skilled && !effortful) return "talents";
  return "atRisk";
}

export function useCoachingQuadrant(anchorDate: string): CoachingQuadrantData {
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [agentRoster, setAgentRoster] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured || !anchorDate) {
      setDailyRows([]); setAgentRoster([]); return;
    }
    setLoading(true); setError(null);
    try {
      // Pull the full 30-day window in one query, then slice client-side. The
      // table is indexed on scrape_date so this is cheap.
      const from30 = shiftDate(anchorDate, 29); // 30-day window inclusive of anchor

      const [dailyRes, agentsRes] = await Promise.all([
        supabase.from("daily_scrape_data")
          .select("agent_name, scrape_date, total_dials, talk_time_minutes, ib_leads_delivered, ob_leads_delivered, custom_leads, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium")
          .gte("scrape_date", from30)
          .lte("scrape_date", anchorDate),
        supabase.from("agents")
          .select("name, site, tier, is_active, terminated_date"),
      ]);

      if (dailyRes.error) throw dailyRes.error;
      if (agentsRes.error) throw agentsRes.error;

      setDailyRows((dailyRes.data ?? []) as DailyRow[]);
      setAgentRoster((agentsRes.data ?? []) as AgentRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load coaching quadrant");
      setDailyRows([]); setAgentRoster([]);
    } finally {
      setLoading(false);
    }
  }, [anchorDate]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return useMemo<CoachingQuadrantData>(() => {
    if (!anchorDate) {
      return {
        agents: [], medianCloseRate: 0, medianTalkPerDay: 0,
        axisMaxX: 0.4, axisMaxY: 240, anchorDate: "",
        loading, error,
      };
    }

    // Filter the roster to currently-active agents OR agents terminated AFTER
    // the anchor date (so historical views still show people who were active then).
    const activeAgents = agentRoster.filter((a) => {
      if (a.is_active) return true;
      if (a.terminated_date && a.terminated_date > anchorDate) return true;
      return false;
    });

    // Group daily rows by agent for fast scoping.
    const rowsByAgent = new Map<string, DailyRow[]>();
    for (const r of dailyRows) {
      const arr = rowsByAgent.get(r.agent_name) ?? [];
      arr.push(r);
      rowsByAgent.set(r.agent_name, arr);
    }

    const w0From  = anchorDate;
    const w7From  = shiftDate(anchorDate, 6);
    const w14From = shiftDate(anchorDate, 13);
    const w30From = shiftDate(anchorDate, 29);

    // First pass: per-agent aggregates for each window.
    const tracks: AgentTrack[] = activeAgents.map((a) => {
      const rows = rowsByAgent.get(a.name) ?? [];
      const w0  = aggregate(rows, w0From, anchorDate);
      const w7  = aggregate(rows, w7From, anchorDate);
      const w14 = aggregate(rows, w14From, anchorDate);
      const w30 = aggregate(rows, w30From, anchorDate);

      // Momentum vector = "you this week vs you on average over the trailing month".
      // X axis is close-rate proportion, Y axis is talk minutes per day.
      const dx = w7.closeRate - w30.closeRate;
      const dy = w7.talkMinutesPerDay - w30.talkMinutesPerDay;
      const mag = Math.sqrt(dx * dx + dy * dy);

      const track: AgentTrack = {
        name: a.name, site: a.site, tier: a.tier,
        windows: { 0: w0, 7: w7, 14: w14, 30: w30 },
        // Filled in below once we know the medians.
        quadrant: "atRisk", prevQuadrant: "atRisk", movedQuadrant: false,
        momentum: { dx, dy, magnitude: mag },
        hasData: w7.dials > 0 || w7.sales > 0 || w7.talkMinutesPerDay > 0,
      };
      return track;
    }).filter((t) => t.hasData);

    // Floor medians = median across active agents who actually showed up in T7.
    const medianCloseRate = median(tracks.map((t) => t.windows[7].closeRate));
    const medianTalkPerDay = median(tracks.map((t) => t.windows[7].talkMinutesPerDay));

    // Second pass: assign quadrants now that the dividers are known.
    for (const t of tracks) {
      t.quadrant = classify(t.windows[7].closeRate, t.windows[7].talkMinutesPerDay, medianCloseRate, medianTalkPerDay);
      t.prevQuadrant = classify(t.windows[30].closeRate, t.windows[30].talkMinutesPerDay, medianCloseRate, medianTalkPerDay);
      t.movedQuadrant = t.quadrant !== t.prevQuadrant;
    }

    // Axis bounds: snap a bit above the max observation so dots don't kiss edges.
    const axisMaxX = Math.max(0.30, ...tracks.map((t) =>
      Math.max(t.windows[0].closeRate, t.windows[7].closeRate, t.windows[14].closeRate, t.windows[30].closeRate)
    )) * 1.15;
    const axisMaxY = Math.max(60, ...tracks.map((t) =>
      Math.max(t.windows[0].talkMinutesPerDay, t.windows[7].talkMinutesPerDay, t.windows[14].talkMinutesPerDay, t.windows[30].talkMinutesPerDay)
    )) * 1.15;

    return {
      agents: tracks,
      medianCloseRate,
      medianTalkPerDay,
      axisMaxX, axisMaxY,
      anchorDate,
      loading, error,
    };
  }, [anchorDate, dailyRows, agentRoster, loading, error]);
}
