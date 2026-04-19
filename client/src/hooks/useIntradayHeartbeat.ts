import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { UNIFIED_PACE_CURVE } from "@/lib/unifiedTargets";

/**
 * Intraday Heartbeat
 *
 * Reads `intraday_snapshots` rows (CRM scrape, written hourly by n8n) for one
 * agent (or the whole floor when agentName is null) on a given date, then
 * derives ground-truth-only signals:
 *
 *   1. Cumulative-to-hourly DELTA per metric per business hour (9 AM – 5 PM CST).
 *   2. Cumulative percentage by hour (running total / day total).
 *   3. Pace overlay from `UNIFIED_PACE_CURVE` (the published expected curve).
 *   4. Whether each hour was on/off pace, and the scalar gap.
 *
 * Everything in here is derived from CRM data — no inference, no heuristics.
 * The only judgement call is the published pace curve, which is the same one
 * used by the existing useIntradayPace hook.
 */

export const HEARTBEAT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17] as const;
export type HeartbeatHour = (typeof HEARTBEAT_HOURS)[number];

interface IntradayRow {
  agent_name: string;
  scrape_hour: number;
  total_dials: number | null;
  talk_time_minutes: number | null;
  ib_sales: number | null;
  ob_sales: number | null;
  custom_sales: number | null;
  ib_premium: number | null;
  ob_premium: number | null;
  custom_premium: number | null;
  pool_dials: number | null;
  pool_talk_minutes: number | null;
  pool_self_assigned: number | null;
}

export interface HeartbeatHourCell {
  hour: HeartbeatHour;
  /** Hourly delta (cumulative_h − cumulative_(h-1)). Never negative. */
  dials: number;
  poolDials: number;
  talkMinutes: number;
  poolTalkMinutes: number;
  sales: number;
  premium: number;
  poolSelfAssigned: number;
  /** Cumulative through end-of-this-hour (sum of deltas through h). */
  cumulativeDials: number;
  cumulativeSales: number;
  cumulativePremium: number;
  /** Cumulative % of agent's own day total at this hour (0..1). */
  cumDialsPct: number;
  cumSalesPct: number;
  /** Expected cumulative % per the published pace curve. */
  expectedPct: number;
  /** Gap = actual − expected (in cumulative percentage points). */
  paceGap: number;
  /** True if this hour produced any signal. */
  hasData: boolean;
}

export interface HeartbeatSummary {
  /** "Eric Marrs" or "All Agents" when aggregate. */
  scope: string;
  scrapeDate: string;
  isAggregate: boolean;
  agentCount: number;          // > 1 only when aggregate
  totalDials: number;
  totalPoolDials: number;
  totalTalkMinutes: number;
  totalSales: number;
  totalPremium: number;
  /** Hour at which the first sale of the day landed (NaN if none). */
  firstSaleHour: number;
  /** Hour with the most dials. */
  busiestDialHour: number;
  /** Hour with the most sales. */
  hottestSaleHour: number;
  /** Cumulative pct vs published curve at the latest hour with data. */
  paceVsCurve: number;
  /** Verdict at the latest data hour. */
  paceVerdict: "ahead" | "on_pace" | "behind" | "no_data";
}

export interface HeartbeatData {
  scope: string;
  scrapeDate: string;
  isAggregate: boolean;
  cells: HeartbeatHourCell[];
  summary: HeartbeatSummary;
  loading: boolean;
  error: string | null;
}

const ZERO_CELL = (hour: HeartbeatHour): HeartbeatHourCell => ({
  hour,
  dials: 0, poolDials: 0, talkMinutes: 0, poolTalkMinutes: 0,
  sales: 0, premium: 0, poolSelfAssigned: 0,
  cumulativeDials: 0, cumulativeSales: 0, cumulativePremium: 0,
  cumDialsPct: 0, cumSalesPct: 0,
  expectedPct: UNIFIED_PACE_CURVE[hour] ?? 0,
  paceGap: 0,
  hasData: false,
});

/**
 * Build per-hour cells from a set of cumulative rows. Rows can be either
 * one agent's per-hour cumulative snapshots, or a sum across many agents'
 * per-hour cumulative snapshots — both are still cumulative through that
 * hour, so the delta math is identical.
 */
function buildCells(rowsByHour: Map<number, IntradayRow[]>): HeartbeatHourCell[] {
  // First, sum any duplicates per hour (when aggregate, multiple agents per hour).
  const cumulativePerHour = new Map<number, {
    dials: number; pool: number; talk: number; poolTalk: number;
    sales: number; premium: number; selfAssigned: number;
  }>();

  for (const hr of HEARTBEAT_HOURS) {
    const rows = rowsByHour.get(hr) ?? [];
    cumulativePerHour.set(hr, rows.reduce((acc, r) => ({
      dials: acc.dials + (r.total_dials ?? 0),
      pool: acc.pool + (r.pool_dials ?? 0),
      talk: acc.talk + Number(r.talk_time_minutes ?? 0),
      poolTalk: acc.poolTalk + Number(r.pool_talk_minutes ?? 0),
      sales: acc.sales + (r.ib_sales ?? 0) + (r.ob_sales ?? 0) + (r.custom_sales ?? 0),
      premium: acc.premium + Number(r.ib_premium ?? 0) + Number(r.ob_premium ?? 0) + Number(r.custom_premium ?? 0),
      selfAssigned: acc.selfAssigned + (r.pool_self_assigned ?? 0),
    }), { dials: 0, pool: 0, talk: 0, poolTalk: 0, sales: 0, premium: 0, selfAssigned: 0 }));
  }

  // Forward-fill cumulatives so an hour with no scrape inherits the prior hour
  // (intraday_snapshots may skip an hour if scrape failed; the next hour will
  // be the cumulative through that hour anyway, so the missing hour shows 0
  // delta which is the right answer).
  let lastSeen = { dials: 0, pool: 0, talk: 0, poolTalk: 0, sales: 0, premium: 0, selfAssigned: 0 };
  const filled = new Map<number, typeof lastSeen>();
  for (const hr of HEARTBEAT_HOURS) {
    const cur = cumulativePerHour.get(hr)!;
    const hasAny = cur.dials > 0 || cur.sales > 0 || cur.talk > 0;
    if (hasAny) lastSeen = cur;
    filled.set(hr, hasAny ? cur : lastSeen);
  }

  // Day-end totals come from the last hour's cumulative.
  const last = filled.get(HEARTBEAT_HOURS[HEARTBEAT_HOURS.length - 1])!;
  const dayDials = last.dials || 1;   // avoid div/0; pct stays 0 if dials=0
  const daySales = last.sales || 1;

  // Now build per-hour deltas.
  const cells: HeartbeatHourCell[] = [];
  let prev = { dials: 0, pool: 0, talk: 0, poolTalk: 0, sales: 0, premium: 0, selfAssigned: 0 };
  for (const hr of HEARTBEAT_HOURS) {
    const cur = filled.get(hr)!;
    const cell: HeartbeatHourCell = {
      ...ZERO_CELL(hr),
      dials: Math.max(0, cur.dials - prev.dials),
      poolDials: Math.max(0, cur.pool - prev.pool),
      talkMinutes: Math.max(0, cur.talk - prev.talk),
      poolTalkMinutes: Math.max(0, cur.poolTalk - prev.poolTalk),
      sales: Math.max(0, cur.sales - prev.sales),
      premium: Math.max(0, cur.premium - prev.premium),
      poolSelfAssigned: Math.max(0, cur.selfAssigned - prev.selfAssigned),
      cumulativeDials: cur.dials,
      cumulativeSales: cur.sales,
      cumulativePremium: cur.premium,
      cumDialsPct: cur.dials / dayDials,
      cumSalesPct: cur.sales / daySales,
      expectedPct: UNIFIED_PACE_CURVE[hr] ?? 0,
      paceGap: 0,
      hasData: cur.dials > 0 || cur.sales > 0,
    };
    cell.paceGap = cell.cumDialsPct - cell.expectedPct;
    cells.push(cell);
    prev = cur;
  }

  return cells;
}

function buildSummary(
  cells: HeartbeatHourCell[],
  scope: string,
  scrapeDate: string,
  isAggregate: boolean,
  agentCount: number,
): HeartbeatSummary {
  const last = cells[cells.length - 1];
  const totalDials = last?.cumulativeDials ?? 0;
  const totalSales = last?.cumulativeSales ?? 0;
  const totalPremium = last?.cumulativePremium ?? 0;

  const totalTalk = cells.reduce((s, c) => s + c.talkMinutes, 0);
  const totalPool = cells.reduce((s, c) => s + c.poolDials, 0);

  const firstSale = cells.find((c) => c.sales > 0);
  const busiestDial = [...cells].sort((a, b) => b.dials - a.dials)[0];
  const hottestSale = [...cells].sort((a, b) => b.sales - a.sales)[0];

  // Pace verdict at the latest hour that has data.
  const lastDataCell = [...cells].reverse().find((c) => c.hasData);
  const paceVsCurve = lastDataCell ? lastDataCell.cumDialsPct - lastDataCell.expectedPct : 0;
  const paceVerdict: HeartbeatSummary["paceVerdict"] = !lastDataCell
    ? "no_data"
    : paceVsCurve > 0.05 ? "ahead"
    : paceVsCurve < -0.10 ? "behind"
    : "on_pace";

  return {
    scope, scrapeDate, isAggregate, agentCount,
    totalDials, totalPoolDials: totalPool, totalTalkMinutes: totalTalk,
    totalSales, totalPremium,
    firstSaleHour: firstSale ? firstSale.hour : NaN,
    busiestDialHour: busiestDial?.hour ?? NaN,
    hottestSaleHour: hottestSale?.hour ?? NaN,
    paceVsCurve, paceVerdict,
  };
}

export function useIntradayHeartbeat(
  agentName: string | null,
  scrapeDate: string,
): HeartbeatData {
  const [rows, setRows] = useState<IntradayRow[]>([]);
  const [agentCount, setAgentCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured) { setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const cols = "agent_name, scrape_hour, total_dials, talk_time_minutes, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, pool_dials, pool_talk_minutes, pool_self_assigned";

      let q = supabase.from("intraday_snapshots")
        .select(cols)
        .eq("scrape_date", scrapeDate)
        .gte("scrape_hour", HEARTBEAT_HOURS[0])
        .lte("scrape_hour", HEARTBEAT_HOURS[HEARTBEAT_HOURS.length - 1]);

      if (agentName) q = q.eq("agent_name", agentName);

      const { data, error: qErr } = await q;
      if (qErr) throw qErr;

      const all = (data ?? []) as IntradayRow[];
      setRows(all);
      setAgentCount(new Set(all.map((r) => r.agent_name)).size);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load heartbeat data");
      setRows([]); setAgentCount(0);
    } finally {
      setLoading(false);
    }
  }, [agentName, scrapeDate]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return useMemo<HeartbeatData>(() => {
    const isAggregate = !agentName;
    const scope = agentName ?? "All Agents";

    // Group rows by hour. For aggregate mode, multiple agent rows per hour;
    // they get summed inside buildCells. For per-agent mode, at most one
    // row per hour.
    const rowsByHour = new Map<number, IntradayRow[]>();
    for (const r of rows) {
      const arr = rowsByHour.get(r.scrape_hour) ?? [];
      arr.push(r);
      rowsByHour.set(r.scrape_hour, arr);
    }

    const cells = buildCells(rowsByHour);
    const summary = buildSummary(cells, scope, scrapeDate, isAggregate, agentCount);

    return {
      scope, scrapeDate, isAggregate,
      cells, summary,
      loading, error,
    };
  }, [agentName, scrapeDate, rows, agentCount, loading, error]);
}
