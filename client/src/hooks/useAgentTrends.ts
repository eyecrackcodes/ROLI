import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface DailyTrend {
  date: string;
  sales: number;
  premium: number;
  dials: number;
  talkTime: number;
  ibLeads: number;
  obLeads: number;
  ibSales: number;
  obSales: number;
  customSales: number;
  ibPremium: number;
  obPremium: number;
  customPremium: number;
  closeRate: number;
  pace: number;
}

export interface IntradayPoint {
  hour: number;
  hourLabel: string;
  sales: number;
  premium: number;
  dials: number;
  talkTime: number;
  ibSales: number;
  obSales: number;
}

export interface WeeklyTrend {
  week: string;
  weekLabel: string;
  sales: number;
  premium: number;
  dials: number;
  avgCloseRate: number;
  days: number;
}

export interface WindowTrend {
  windowName: string;
  roli: number;
  premium: number;
  profit: number;
  closeRate: number;
  sales: number;
}

interface DailyRow {
  scrape_date: string;
  ib_leads_delivered: number;
  ob_leads_delivered: number;
  ib_sales: number;
  ob_sales: number;
  custom_sales: number;
  ib_premium: number;
  ob_premium: number;
  custom_premium: number;
  total_dials: number;
  talk_time_minutes: number;
}

interface IntradayRow {
  scrape_hour: number;
  ib_sales: number;
  ob_sales: number;
  custom_sales: number;
  ib_premium: number;
  ob_premium: number;
  custom_premium: number;
  total_dials: number;
  talk_time_minutes: number;
}

interface SnapshotRow {
  roli: number;
  total_premium: number;
  profit: number;
  close_rate: number;
  total_sales: number;
  window_name: string;
}

const HOUR_LABELS: Record<number, string> = {
  6: "6AM", 7: "7AM", 8: "8AM", 9: "9AM", 10: "10AM", 11: "11AM",
  12: "12PM", 13: "1PM", 14: "2PM", 15: "3PM", 16: "4PM", 17: "5PM",
  18: "6PM", 19: "7PM", 20: "8PM",
};

function todayCentral(): string {
  const central = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [y, m, dd] = central.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2);
  if (day === 6) d.setDate(d.getDate() - 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function daysAgoCST(n: number): string {
  const central = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [y, m, dd] = central.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  d.setDate(d.getDate() - n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function useAgentTrends(agentName: string | null, daysBack: number = 10) {
  const [daily, setDaily] = useState<DailyTrend[]>([]);
  const [intraday, setIntraday] = useState<IntradayPoint[]>([]);
  const [weekly, setWeekly] = useState<WeeklyTrend[]>([]);
  const [windows, setWindows] = useState<WindowTrend[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDayOverDay = useCallback(async () => {
    if (!isSupabaseConfigured || !agentName) return;

    const startDate = daysAgoCST(Math.ceil(daysBack * 1.5));

    const { data } = await supabase
      .from("daily_scrape_data")
      .select("scrape_date, ib_leads_delivered, ob_leads_delivered, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, total_dials, talk_time_minutes")
      .eq("agent_name", agentName)
      .gte("scrape_date", startDate)
      .order("scrape_date", { ascending: true });

    const rows = (data ?? []) as DailyRow[];
    setDaily(rows.map((r) => {
      const totalLeads = r.ib_leads_delivered + r.ob_leads_delivered;
      const totalSales = r.ib_sales + r.ob_sales;
      return {
        date: r.scrape_date,
        sales: totalSales + r.custom_sales,
        premium: r.ib_premium + r.ob_premium + r.custom_premium,
        dials: r.total_dials,
        talkTime: r.talk_time_minutes,
        ibLeads: r.ib_leads_delivered,
        obLeads: r.ob_leads_delivered,
        ibSales: r.ib_sales,
        obSales: r.ob_sales,
        customSales: r.custom_sales,
        ibPremium: r.ib_premium,
        obPremium: r.ob_premium,
        customPremium: r.custom_premium,
        closeRate: totalLeads > 0 ? (totalSales / totalLeads) * 100 : 0,
        pace: totalSales + r.custom_sales,
      };
    }));
  }, [agentName, daysBack]);

  const fetchIntraday = useCallback(async () => {
    if (!isSupabaseConfigured || !agentName) return;

    const today = todayCentral();

    // Try today first, then fall back to the latest date with intraday data
    let dateStr = today;
    const { data: checkToday } = await supabase
      .from("intraday_snapshots")
      .select("scrape_date")
      .eq("agent_name", agentName)
      .eq("scrape_date", today)
      .limit(1);

    if (!checkToday || checkToday.length === 0) {
      const { data: latestRow } = await supabase
        .from("intraday_snapshots")
        .select("scrape_date")
        .eq("agent_name", agentName)
        .order("scrape_date", { ascending: false })
        .limit(1);

      if (latestRow && latestRow.length > 0) {
        dateStr = (latestRow[0] as { scrape_date: string }).scrape_date;
      }
    }

    const { data, error } = await supabase
      .from("intraday_snapshots")
      .select("scrape_hour, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, total_dials, talk_time_minutes")
      .eq("agent_name", agentName)
      .eq("scrape_date", dateStr)
      .order("scrape_hour", { ascending: true });

    if (error) {
      console.error("[useAgentTrends] intraday fetch error:", error.message);
      setIntraday([]);
      return;
    }

    const rows = (data ?? []) as IntradayRow[];
    setIntraday(rows.map((r) => ({
      hour: r.scrape_hour,
      hourLabel: HOUR_LABELS[r.scrape_hour] ?? `${r.scrape_hour}:00`,
      sales: r.ib_sales + r.ob_sales + r.custom_sales,
      premium: r.ib_premium + r.ob_premium + r.custom_premium,
      dials: r.total_dials,
      talkTime: r.talk_time_minutes,
      ibSales: r.ib_sales,
      obSales: r.ob_sales,
    })));
  }, [agentName]);

  const fetchWeekly = useCallback(async () => {
    if (!isSupabaseConfigured || !agentName) return;

    const startDate = daysAgoCST(28);

    const { data } = await supabase
      .from("daily_scrape_data")
      .select("scrape_date, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, total_dials, ib_leads_delivered, ob_leads_delivered")
      .eq("agent_name", agentName)
      .gte("scrape_date", startDate)
      .order("scrape_date", { ascending: true });

    const rows = (data ?? []) as DailyRow[];
    const weekMap = new Map<string, { sales: number; premium: number; dials: number; totalLeads: number; totalSales: number; days: number }>();

    for (const r of rows) {
      const [ry, rm, rd] = r.scrape_date.split("-").map(Number);
      const d = new Date(ry, rm - 1, rd);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay() + 1);
      const weekKey = weekStart.getFullYear() + "-" + String(weekStart.getMonth() + 1).padStart(2, "0") + "-" + String(weekStart.getDate()).padStart(2, "0");
      const existing = weekMap.get(weekKey) ?? { sales: 0, premium: 0, dials: 0, totalLeads: 0, totalSales: 0, days: 0 };
      existing.sales += r.ib_sales + r.ob_sales + r.custom_sales;
      existing.premium += r.ib_premium + r.ob_premium + r.custom_premium;
      existing.dials += r.total_dials;
      existing.totalLeads += r.ib_leads_delivered + r.ob_leads_delivered;
      existing.totalSales += r.ib_sales + r.ob_sales;
      existing.days++;
      weekMap.set(weekKey, existing);
    }

    const weeks: WeeklyTrend[] = [];
    Array.from(weekMap.entries()).forEach(([weekKey, w]) => {
      const [wy, wm, wd] = weekKey.split("-").map(Number);
      const d = new Date(wy, wm - 1, wd);
      const endOfWeek = new Date(d);
      endOfWeek.setDate(d.getDate() + 4);
      weeks.push({
        week: weekKey,
        weekLabel: `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${endOfWeek.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        sales: w.sales,
        premium: w.premium,
        dials: w.dials,
        avgCloseRate: w.totalLeads > 0 ? (w.totalSales / w.totalLeads) * 100 : 0,
        days: w.days,
      });
    });

    setWeekly(weeks.sort((a, b) => a.week.localeCompare(b.week)));
  }, [agentName]);

  const fetchWindows = useCallback(async () => {
    if (!isSupabaseConfigured || !agentName) return;

    const { data } = await supabase
      .from("monthly_snapshots")
      .select("roli, total_premium, profit, close_rate, total_sales, evaluation_windows(name)")
      .eq("agent_name", agentName)
      .order("created_at", { ascending: true });

    if (!data) return;

    const wt: WindowTrend[] = (data as unknown as Array<SnapshotRow & { evaluation_windows: { name: string } | null }>).map((r) => ({
      windowName: r.evaluation_windows?.name ?? "Unknown",
      roli: r.roli,
      premium: r.total_premium,
      profit: r.profit,
      closeRate: r.close_rate,
      sales: r.total_sales,
    }));

    setWindows(wt);
  }, [agentName]);

  useEffect(() => {
    if (!agentName) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchDayOverDay(), fetchIntraday(), fetchWeekly(), fetchWindows()])
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [agentName, fetchDayOverDay, fetchIntraday, fetchWeekly, fetchWindows]);

  const yesterday = daily.length >= 2 ? daily[daily.length - 2] : null;
  const latestDay = daily.length >= 1 ? daily[daily.length - 1] : null;

  const deltas = {
    salesVsYesterday: latestDay && yesterday ? latestDay.sales - yesterday.sales : null,
    premiumVsYesterday: latestDay && yesterday ? latestDay.premium - yesterday.premium : null,
    salesVsLastWeek: weekly.length >= 2 ? weekly[weekly.length - 1].sales - weekly[weekly.length - 2].sales : null,
    premiumVsLastWeek: weekly.length >= 2 ? weekly[weekly.length - 1].premium - weekly[weekly.length - 2].premium : null,
  };

  return { daily, intraday, weekly, windows, loading, deltas };
}
