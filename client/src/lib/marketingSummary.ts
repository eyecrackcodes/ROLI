import type { SupabaseClient } from "@supabase/supabase-js";

/** How CPC / org premium were chosen for this scrape date. */
export type MarketingSummaryMode = "exact" | "rolling_7d_intraday";

/** Row in ROLI `daily_marketing_summary` (synced from Marketing AAR). */
export interface MarketingDailySummary {
  report_date: string;
  total_cost: number;
  cpc: number;
  total_calls: number;
  total_sales: number;
  total_premium: number;
  avg_premium: number;
  roas: number;
  marketing_acq_pct: number;
  cost_per_sale: number;
  synced_at?: string;
  /** When set, CPC/ROAS/spend reflect a mean over completed days only (not partial same-day AAR). */
  summary_mode?: MarketingSummaryMode;
  /** Inclusive date span of rows included in `rolling_7d_intraday`. */
  rolling_window?: { from: string; to: string; days: number };
}

function num(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

/** Normalize a PostgREST row to numbers. */
export function normalizeMarketingRow(row: Record<string, unknown>): MarketingDailySummary {
  const tSales = Math.round(num(row.total_sales));
  const tCost = num(row.total_cost);
  const cps = tSales > 0 ? Math.round(tCost / tSales) : num(row.cost_per_sale);
  return {
    report_date: String(row.report_date ?? "").slice(0, 10),
    total_cost: tCost,
    cpc: num(row.cpc),
    total_calls: Math.round(num(row.total_calls)),
    total_sales: tSales,
    total_premium: num(row.total_premium),
    avg_premium: num(row.avg_premium),
    roas: num(row.roas),
    marketing_acq_pct: num(row.marketing_acq_pct),
    cost_per_sale: cps,
    synced_at: row.synced_at != null ? String(row.synced_at) : undefined,
  };
}

/** Current calendar date in America/Chicago as `YYYY-MM-DD`. */
export function centralDateISO(from: Date = new Date()): string {
  return from.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function averageCompletedDailyRows(
  rawRows: Record<string, unknown>[],
  anchorReportDate: string,
): MarketingDailySummary {
  const rows = rawRows.map((r) => normalizeMarketingRow(r));
  const dates = [...new Set(rows.map((r) => r.report_date))].sort();
  const from = dates[0] ?? anchorReportDate;
  const to = dates[dates.length - 1] ?? anchorReportDate;
  const n = rows.length;
  const mean = (pick: (r: MarketingDailySummary) => number) =>
    n > 0 ? rows.reduce((s, r) => s + pick(r), 0) / n : 0;
  const sumCost = rows.reduce((s, r) => s + r.total_cost, 0);
  const sumSales = rows.reduce((s, r) => s + r.total_sales, 0);
  const costPerSale = sumSales > 0 ? Math.round(sumCost / sumSales) : 0;
  return {
    report_date: anchorReportDate,
    total_cost: mean((r) => r.total_cost),
    cpc: mean((r) => r.cpc),
    total_calls: Math.round(mean((r) => r.total_calls)),
    total_sales: Math.round(mean((r) => r.total_sales)),
    total_premium: mean((r) => r.total_premium),
    avg_premium: mean((r) => r.avg_premium),
    roas: mean((r) => r.roas),
    marketing_acq_pct: mean((r) => r.marketing_acq_pct),
    cost_per_sale: costPerSale,
    summary_mode: "rolling_7d_intraday",
    rolling_window: { from, to, days: n },
  };
}

async function fetchExactOrPrior(
  client: SupabaseClient,
  scrapeDate: string,
): Promise<MarketingDailySummary | null> {
  const { data: exact } = await client
    .from("daily_marketing_summary")
    .select("*")
    .eq("report_date", scrapeDate)
    .maybeSingle();

  if (exact && exact.report_date) {
    return normalizeMarketingRow(exact as Record<string, unknown>);
  }

  const { data: prior } = await client
    .from("daily_marketing_summary")
    .select("*")
    .lte("report_date", scrapeDate)
    .order("report_date", { ascending: false })
    .limit(1);

  const row = prior?.[0];
  if (!row) return null;
  return normalizeMarketingRow(row as Record<string, unknown>);
}

/**
 * Load marketing summary for a scrape date.
 * - **Past dates** (`scrapeDate` before today in Central): exact row for that date, else latest on or before date (fully closed AAR days in ROLI).
 * - **Today** (Central): mean of up to the last **7** rows with `report_date` **strictly before** today so intraday views are not skewed by incomplete same-day marketing data.
 */
export async function fetchMarketingSummary(
  client: SupabaseClient,
  scrapeDate: string,
): Promise<MarketingDailySummary | null> {
  const today = centralDateISO();
  const isToday = scrapeDate === today;

  if (isToday) {
    const { data: completed } = await client
      .from("daily_marketing_summary")
      .select("*")
      .lt("report_date", today)
      .order("report_date", { ascending: false })
      .limit(7);

    if (completed && completed.length > 0) {
      return averageCompletedDailyRows(completed as Record<string, unknown>[], scrapeDate);
    }

    const { data: priorOnly } = await client
      .from("daily_marketing_summary")
      .select("*")
      .lt("report_date", today)
      .order("report_date", { ascending: false })
      .limit(1);

    const priorRow = priorOnly?.[0];
    if (priorRow) {
      return normalizeMarketingRow(priorRow as Record<string, unknown>);
    }
    return null;
  }

  return fetchExactOrPrior(client, scrapeDate);
}
