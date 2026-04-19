import ExcelJS from "exceljs";
import type { DailyPulseAgent, MonthlyAgent, Tier, PoolMetrics } from "./types";
import type { PipelineAgent, HealthGrade, BehavioralFlag } from "./pipelineIntelligence";
import { FLAG_META } from "./pipelineIntelligence";
import { supabase, isSupabaseConfigured } from "./supabase";

type ExportableRow = Record<string, string | number | undefined>;

interface ExportConfig {
  title: string;
  subtitle?: string;
  date?: string;
  columns: Array<{
    key: string;
    header: string;
    width?: number;
    format?: "currency" | "percent" | "number" | "text" | "decimal";
    gradient?: boolean; // Apply red-to-green conditional formatting
  }>;
  rows: ExportableRow[];
  tier?: Tier;
}

function getGradientColor(value: number, min: number, max: number): string {
  if (max === min) return "FFFFFF";
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // Red (low) → Yellow (mid) → Green (high)
  const r = ratio < 0.5 ? 255 : Math.round(255 * (1 - ratio) * 2);
  const g = ratio > 0.5 ? 255 : Math.round(255 * ratio * 2);
  const b = 50;
  return [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function buildWorkbook(configs: ExportConfig[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DSB Tier Calculator";
  workbook.created = new Date();

  for (const config of configs) {
    const sheetName = config.tier ? `${config.tier} — ${config.title}` : config.title;
    const ws = workbook.addWorksheet(sheetName.slice(0, 31));

    // Title row
    ws.mergeCells(1, 1, 1, config.columns.length);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = config.title + (config.date ? ` — ${config.date}` : "");
    titleCell.font = { bold: true, size: 14, color: { argb: "FF1A1A2E" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F5" } };
    titleCell.alignment = { horizontal: "center" };

    if (config.subtitle) {
      ws.mergeCells(2, 1, 2, config.columns.length);
      const subCell = ws.getCell(2, 1);
      subCell.value = config.subtitle;
      subCell.font = { size: 10, italic: true, color: { argb: "FF666688" } };
      subCell.alignment = { horizontal: "center" };
    }

    const headerRowIdx = config.subtitle ? 4 : 3;

    // Header row
    const headerRow = ws.getRow(headerRowIdx);
    config.columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.header;
      cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A2E" } };
      cell.alignment = { horizontal: col.format === "text" ? "left" : "center" };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FF333355" } },
      };
      if (col.width) ws.getColumn(i + 1).width = col.width;
    });

    // Compute min/max for gradient columns
    const gradientRanges = new Map<number, { min: number; max: number }>();
    config.columns.forEach((col, i) => {
      if (col.gradient) {
        const values = config.rows
          .map((r) => typeof r[col.key] === "number" ? r[col.key] as number : 0)
          .filter((v) => v !== 0);
        if (values.length > 0) {
          gradientRanges.set(i, {
            min: Math.min(...values),
            max: Math.max(...values),
          });
        }
      }
    });

    // Data rows
    config.rows.forEach((row, rowIdx) => {
      const dataRow = ws.getRow(headerRowIdx + 1 + rowIdx);

      config.columns.forEach((col, colIdx) => {
        const cell = dataRow.getCell(colIdx + 1);
        const val = row[col.key];
        cell.value = val ?? "";

        // Number formatting
        if (col.format === "currency" && typeof val === "number") {
          cell.numFmt = '"$"#,##0.00';
        } else if (col.format === "percent" && typeof val === "number") {
          cell.numFmt = "0.0%";
        } else if (col.format === "decimal" && typeof val === "number") {
          cell.numFmt = "0.00";
        } else if (col.format === "number" && typeof val === "number") {
          cell.numFmt = "#,##0";
        }

        cell.alignment = { horizontal: col.format === "text" ? "left" : "center" };
        cell.font = { size: 10 };

        // Alternating row shading
        if (rowIdx % 2 === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F8FC" } };
        }

        // Gradient coloring
        const range = gradientRanges.get(colIdx);
        if (range && typeof val === "number" && val !== 0) {
          const color = getGradientColor(val, range.min, range.max);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${color}` } };
          cell.font = { size: 10, bold: val >= range.max * 0.8 || val <= range.min * 1.2, color: { argb: "FF1A1A1A" } };
        }
      });
    });

    // Totals row
    const totalsRowIdx = headerRowIdx + 1 + config.rows.length;
    const totalsRow = ws.getRow(totalsRowIdx);
    const avgFormats = new Set(["percent", "decimal"]);

    config.columns.forEach((col, colIdx) => {
      const cell = totalsRow.getCell(colIdx + 1);

      if (col.format === "text") {
        cell.value = colIdx === 0 ? "" : col.key === "name" ? "TOTALS" : "";
      } else if (col.key === "rank") {
        cell.value = "";
      } else {
        const numericVals = config.rows
          .map((r) => (typeof r[col.key] === "number" ? (r[col.key] as number) : 0));
        const nonZero = numericVals.filter((v) => v !== 0);

        if (avgFormats.has(col.format ?? "")) {
          cell.value = nonZero.length > 0 ? nonZero.reduce((s, v) => s + v, 0) / nonZero.length : 0;
        } else {
          cell.value = numericVals.reduce((s, v) => s + v, 0);
        }

        if (col.format === "currency") cell.numFmt = '"$"#,##0.00';
        else if (col.format === "percent") cell.numFmt = "0.0%";
        else if (col.format === "decimal") cell.numFmt = "0.00";
        else if (col.format === "number") cell.numFmt = "#,##0";
      }

      cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2D2D44" } };
      cell.alignment = { horizontal: col.format === "text" ? "left" : "center" };
      cell.border = { top: { style: "thin", color: { argb: "FF333355" } } };
    });

    // Auto-fit column widths where not specified
    config.columns.forEach((col, i) => {
      if (!col.width) {
        const maxLen = Math.max(
          col.header.length,
          ...config.rows.map((r) => String(r[col.key] ?? "").length)
        );
        ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 2, 10), 30);
      }
    });
  }

  return workbook;
}

// MTD ROLI intentionally omitted — these exports are agent-facing and we
// surface ROLI only inside the management UI.
export type SortKey = "totalPremium" | "salesToday" | "dials" | "talkTimeMin" | "totalTalk" | "closeRate" | "mtdPace";

const SORT_LABELS: Record<SortKey, string> = {
  totalPremium: "Total Premium",
  salesToday: "Sales",
  dials: "Dials",
  talkTimeMin: "Talk Time",
  totalTalk: "Total Talk (CRM+Pool)",
  closeRate: "Close Rate",
  mtdPace: "MTD Pace",
};
export { SORT_LABELS };

export interface ExportOptions {
  /** Legacy: retained for backwards-compatibility with callers. Ignored under
   *  the unified all-remote model — all agents export to a single sheet. */
  tiers?: Tier[];
  sortBy?: SortKey;
  startDate: string;
  endDate: string;
  dailyBreakdown?: boolean;
}

const PULSE_COLS = {
  rank: { key: "rank", header: "#", width: 5, format: "number" as const },
  name: { key: "name", header: "Agent", width: 22, format: "text" as const },
  site: { key: "site", header: "Site", width: 6, format: "text" as const },
  daysActive: { key: "daysActive", header: "Days", width: 5, format: "number" as const },
  ibCalls: { key: "ibCalls", header: "Inbound Leads", format: "number" as const },
  ibSales: { key: "ibSales", header: "Inbound Sales", format: "number" as const, gradient: true },
  dials: { key: "dials", header: "CRM Dials", format: "number" as const, gradient: true },
  talkTimeMin: { key: "talkTimeMin", header: "CRM Talk", format: "number" as const, gradient: true },
  poolDials: { key: "poolDials", header: "Pool Dials", format: "number" as const, gradient: true },
  poolTalk: { key: "poolTalk", header: "Pool Talk", format: "number" as const, gradient: true },
  totalDials: { key: "totalDials", header: "Total Dials", format: "number" as const, gradient: true },
  totalTalk: { key: "totalTalk", header: "Total Talk", format: "number" as const, gradient: true },
  poolContactRate: { key: "poolContactRate", header: "Contact %", format: "decimal" as const, gradient: true },
  poolAssignRate: { key: "poolAssignRate", header: "Assign %", format: "decimal" as const, gradient: true },
  poolCloseRate: { key: "poolCloseRate", header: "Pool CR%", format: "decimal" as const, gradient: true },
  poolSales: { key: "poolSales", header: "Pool Sales", format: "number" as const },
  poolPremium: { key: "poolPremium", header: "Pool Premium", format: "currency" as const },
  poolSelfAssigned: { key: "poolSelfAssigned", header: "Self-Assigned", format: "number" as const },
  poolGhostAssigns: { key: "poolGhostAssigns", header: "No Long Call", format: "number" as const },
  salesToday: { key: "salesToday", header: "Sales", format: "number" as const, gradient: true },
  premiumToday: { key: "premiumToday", header: "Premium", format: "currency" as const, gradient: true },
  bonusSales: { key: "bonusSales", header: "Bonus Sales", format: "number" as const },
  bonusPremium: { key: "bonusPremium", header: "Bonus Premium", format: "currency" as const },
  poolPct: { key: "poolPct", header: "Pool %", format: "decimal" as const },
  totalPremium: { key: "totalPremium", header: "Total Premium", format: "currency" as const, gradient: true },
  closeRate: { key: "closeRate", header: "Close Rate %", format: "decimal" as const, gradient: true },
  ibCR: { key: "ibCR", header: "Inbound CR%", format: "decimal" as const, gradient: true },
  // ---- Per-row totals (unified all-remote model) ----
  totalLeads: { key: "totalLeads", header: "Total Leads", format: "number" as const, gradient: true },
  totalSales: { key: "totalSales", header: "Total Sales", format: "number" as const, gradient: true },
  overallCR: { key: "overallCR", header: "Overall CR%", format: "decimal" as const, gradient: true },
  mtdSales: { key: "mtdSales", header: "MTD Sales", format: "number" as const, gradient: true },
  mtdPace: { key: "mtdPace", header: "MTD Pace", format: "decimal" as const, gradient: true },
};

function flattenWithPool(agent: DailyPulseAgent): ExportableRow {
  const poolCalls = agent.pool?.callsMade ?? 0;
  const longCalls = agent.pool?.longCalls ?? 0;
  const selfAssigned = agent.pool?.selfAssignedLeads ?? 0;
  const answered = agent.pool?.answeredCalls ?? 0;
  const poolSales = agent.pool?.salesMade ?? 0;
  const poolPremium = agent.pool?.premium ?? 0;

  // Under the unified all-remote model the legacy `ob_*` bucket holds
  // non-standard inbound types (missed inbound, FEX, exclusive, recycled).
  // Fold it into IB so every report shows a single honest "Inbound" channel.
  const ibLeads = (agent.ibCalls ?? 0) + (agent.obLeads ?? 0);
  const ibSales = (agent.ibSales ?? 0) + (agent.obSales ?? 0);
  const bonusSales = agent.bonusSales ?? 0;

  // Unified all-remote totals: every conversion-eligible touch counts toward
  // overall conversion. Pool self-assigned leads are the "leads" denominator
  // for pool work.
  //
  // IMPORTANT: salesToday/totalPremium come from daily_scrape_data which is
  // sourced from the CRM Sale Made report — the system of record for ALL
  // sales regardless of channel (inbound, pool, bonus). Pool sales from
  // leads_pool_daily_data are the SAME physical sales re-attributed to pool
  // dialing, so we must NOT add them again. Use the pre-aggregated
  // salesToday field which is already correct in both daily and range paths.
  const totalLeads = ibLeads + selfAssigned;
  const totalSales = agent.salesToday ?? (ibSales + bonusSales);
  const overallCR = totalLeads > 0 ? (totalSales / totalLeads) * 100 : 0;

  return {
    name: agent.name,
    site: agent.site,
    tier: agent.tier,
    ibCalls: ibLeads,
    ibSales,
    dials: agent.dials,
    talkTimeMin: agent.talkTimeMin ? Math.round(agent.talkTimeMin) : undefined,
    salesToday: agent.salesToday,
    premiumToday: agent.premiumToday,
    bonusSales: agent.bonusSales,
    bonusPremium: agent.bonusPremium,
    poolPct: (agent.dials ?? 0) > 0 && poolCalls > 0 ? Math.min((poolCalls / (agent.dials ?? 1)) * 100, 100) : 0,
    totalPremium: agent.totalPremium,
    mtdSales: agent.mtdSales,
    mtdPace: agent.mtdPace,
    daysActive: agent.daysActive,
    poolDials: poolCalls,
    poolTalk: Math.round(agent.pool?.talkTimeMin ?? 0),
    totalDials: (agent.dials ?? 0) + poolCalls,
    totalTalk: Math.round((agent.talkTimeMin ?? 0) + (agent.pool?.talkTimeMin ?? 0)),
    poolContactRate: agent.pool?.contactRate ?? 0,
    poolAssignRate: answered > 0 ? (selfAssigned / answered) * 100 : 0,
    poolCloseRate: agent.pool?.closeRate ?? 0,
    poolSales,
    poolPremium,
    poolSelfAssigned: selfAssigned,
    poolGhostAssigns: Math.max(0, selfAssigned - longCalls),
    // Channel-scoped CRs for context
    closeRate: ibLeads > 0 ? (ibSales / ibLeads) * 100 : 0,
    ibCR: ibLeads > 0 ? (ibSales / ibLeads) * 100 : 0,
    // Per-row aggregates (the "totals on each row" the unified model needs)
    totalLeads,
    totalSales,
    overallCR,
  };
}

function getSortValue(agent: DailyPulseAgent, key: SortKey): number {
  const flat = flattenWithPool(agent);
  return (flat[key] as number) ?? 0;
}

function sortAgents(agents: DailyPulseAgent[], sortBy: SortKey): DailyPulseAgent[] {
  return [...agents].sort((a, b) => getSortValue(b, sortBy) - getSortValue(a, sortBy));
}

// Build the unified column list used by the Production sheet. Pool/OB
// blocks are auto-included only when at least one agent has activity
// in that channel — keeps the sheet narrow when not needed.
function buildUnifiedColumns(agents: DailyPulseAgent[], isRange: boolean): string[] {
  const hasPool = agents.some((a) => a.pool && a.pool.callsMade > 0);
  const hasBonus = agents.some((a) => (a.bonusSales ?? 0) > 0 || (a.bonusPremium ?? 0) > 0);

  const cols: string[] = ["rank", "name"];
  if (isRange) cols.push("daysActive");

  // Inbound block (always present in unified model — folds the legacy
  // `ob_*` misc-inbound bucket into a single Inbound channel).
  cols.push("ibCalls", "ibSales", "ibCR");

  // Pool block
  if (hasPool) {
    cols.push(
      "poolDials",
      "poolSelfAssigned",
      "poolSales",
      "poolPremium",
      "poolCloseRate",
      "poolContactRate",
      "poolAssignRate",
    );
  }

  // Bonus
  if (hasBonus) cols.push("bonusSales", "bonusPremium");

  // Effort
  cols.push("dials", "talkTimeMin");
  if (hasPool) cols.push("totalDials", "totalTalk");

  // Per-row totals + premium (the headline aggregates)
  cols.push("totalLeads", "totalSales", "overallCR", "totalPremium");

  // MTD context (ROLI omitted — agent-facing exports show only outcomes, not cost-derived metrics).
  cols.push("mtdSales");

  return cols;
}

/**
 * Export Daily Pulse — unified all-remote model.
 *
 * Signature accepts up to three agent arrays for backwards compatibility
 * (callers historically split by tier). Internally they are merged into a
 * single "Production" sheet. Each row has Total Leads / Total Sales /
 * Overall CR% so per-agent conversion is visible without aggregation.
 */
export async function exportDailyPulse(
  t1: DailyPulseAgent[],
  t2: DailyPulseAgent[],
  t3: DailyPulseAgent[],
  opts: ExportOptions,
): Promise<void> {
  const { sortBy, startDate, endDate } = opts;
  const isRange = startDate !== endDate;
  const dateLabel = isRange ? `${startDate} to ${endDate}` : startDate;
  const sortLabel = SORT_LABELS[sortBy ?? "totalPremium"];

  const allAgents = [...t1, ...t2, ...t3];
  if (allAgents.length === 0) {
    throw new Error("No agents to export.");
  }

  const sorted = sortAgents(allAgents, sortBy ?? "totalPremium");
  const colKeys = buildUnifiedColumns(sorted, isRange);
  const columns = colKeys.map((k) => PULSE_COLS[k as keyof typeof PULSE_COLS]).filter(Boolean);

  const configs: ExportConfig[] = [{
    title: "Production",
    subtitle: `${sorted.length} agents · Sorted by ${sortLabel} DESC`,
    date: dateLabel,
    columns,
    rows: sorted.map((a, i) => ({ rank: i + 1, ...flattenWithPool(a) })),
  }];

  const workbook = await buildWorkbook(configs);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = isRange ? `DSB-Production-${startDate}-to-${endDate}.xlsx` : `DSB-Production-${startDate}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

interface ScrapeRow {
  agent_name: string;
  tier: string;
  ib_leads_delivered: number;
  ob_leads_delivered: number;
  custom_leads: number;
  ib_sales: number;
  ob_sales: number;
  custom_sales: number;
  ib_premium: number;
  ob_premium: number;
  custom_premium: number;
  total_dials: number;
  talk_time_minutes: number;
  scrape_date: string;
}

interface PoolRow {
  agent_name: string;
  calls_made: number;
  talk_time_minutes: number;
  sales_made: number;
  premium: number;
  self_assigned_leads: number;
  answered_calls: number;
  long_calls: number;
  contact_rate: number;
  scrape_date: string;
}

function buildPoolMap(poolRows: PoolRow[]): Map<string, PoolMetrics> {
  const grouped = new Map<string, PoolRow[]>();
  for (const r of poolRows) {
    const arr = grouped.get(r.agent_name) ?? [];
    arr.push(r);
    grouped.set(r.agent_name, arr);
  }
  const result = new Map<string, PoolMetrics>();
  for (const [name, rows] of Array.from(grouped)) {
    const callsMade = rows.reduce((s: number, r: PoolRow) => s + r.calls_made, 0);
    const longCalls = rows.reduce((s: number, r: PoolRow) => s + r.long_calls, 0);
    const selfAssigned = rows.reduce((s: number, r: PoolRow) => s + r.self_assigned_leads, 0);
    const answered = rows.reduce((s: number, r: PoolRow) => s + r.answered_calls, 0);
    result.set(name, {
      callsMade,
      talkTimeMin: rows.reduce((s: number, r: PoolRow) => s + r.talk_time_minutes, 0),
      salesMade: rows.reduce((s: number, r: PoolRow) => s + r.sales_made, 0),
      premium: rows.reduce((s: number, r: PoolRow) => s + r.premium, 0),
      selfAssignedLeads: selfAssigned,
      answeredCalls: answered,
      longCalls,
      contactRate: callsMade > 0 ? (answered / callsMade) * 100 : 0,
      assignRate: answered > 0 ? (selfAssigned / answered) * 100 : 0,
      closeRate: selfAssigned > 0 ? (rows.reduce((s: number, r: PoolRow) => s + r.sales_made, 0) / selfAssigned) * 100 : 0,
    });
  }
  return result;
}

function buildPulseFromRows(
  scrapeRows: ScrapeRow[],
  poolRows: PoolRow[],
  agentMap: Map<string, { name: string; site: string; tier: string }>,
  daysActiveMap?: Map<string, number>,
): { t1: DailyPulseAgent[]; t2: DailyPulseAgent[]; t3: DailyPulseAgent[] } {
  const poolMap = buildPoolMap(poolRows);
  const scrapeGrouped = new Map<string, ScrapeRow[]>();
  for (const r of scrapeRows) {
    const arr = scrapeGrouped.get(r.agent_name) ?? [];
    arr.push(r);
    scrapeGrouped.set(r.agent_name, arr);
  }

  const t1: DailyPulseAgent[] = [];
  const t2: DailyPulseAgent[] = [];
  const t3: DailyPulseAgent[] = [];
  const processed = new Set<string>();

  for (const [name, rows] of Array.from(scrapeGrouped)) {
    // Skip scrape rows for agents that aren't in the active roster (e.g.
    // terminated agents). Callers are responsible for building agentMap with
    // the desired inclusion policy.
    if (agentMap.size > 0 && !agentMap.has(name)) continue;
    processed.add(name);
    const agent = agentMap.get(name);
    const site = agent?.site ?? "RMT";
    const tier = (agent?.tier as Tier) ?? (rows[0].tier as Tier) ?? "T3";

    // Fold the legacy `ob_*` misc-inbound bucket into IB. Under the unified
    // all-remote model there is no outbound team — `ob_*` columns hold
    // missed/FEX/exclusive/recycled inbound leads.
    const ibLeads = rows.reduce((s: number, r: ScrapeRow) => s + r.ib_leads_delivered + r.ob_leads_delivered, 0);
    const ibSales = rows.reduce((s: number, r: ScrapeRow) => s + r.ib_sales + r.ob_sales, 0);
    const customSales = rows.reduce((s: number, r: ScrapeRow) => s + r.custom_sales, 0);
    const ibPrem = rows.reduce((s: number, r: ScrapeRow) => s + r.ib_premium + r.ob_premium, 0);
    const customPrem = rows.reduce((s: number, r: ScrapeRow) => s + r.custom_premium, 0);
    const dials = rows.reduce((s: number, r: ScrapeRow) => s + r.total_dials, 0);
    const talkTime = rows.reduce((s: number, r: ScrapeRow) => s + r.talk_time_minutes, 0);
    const totalPremium = ibPrem + customPrem;

    const pulse: DailyPulseAgent = {
      name, site, tier,
      ibCalls: ibLeads || undefined,
      ibSales: ibSales || undefined,
      dials: dials || undefined,
      talkTimeMin: talkTime || undefined,
      salesToday: ibSales + customSales,
      premiumToday: totalPremium - customPrem,
      bonusSales: customSales || undefined,
      bonusPremium: customPrem || undefined,
      totalPremium,
      daysActive: daysActiveMap?.get(name),
      pool: poolMap.get(name),
    };

    if (tier === "T1") t1.push(pulse);
    else if (tier === "T2") t2.push(pulse);
    else t3.push(pulse);
  }

  for (const [name, pool] of Array.from(poolMap)) {
    if (processed.has(name)) continue;
    const agent = agentMap.get(name);
    if (!agent) continue;
    const tier = agent.tier as Tier;
    const pulse: DailyPulseAgent = {
      name, site: agent.site, tier,
      salesToday: 0, premiumToday: 0, totalPremium: 0,
      daysActive: daysActiveMap?.get(name),
      pool,
    };
    if (tier === "T1") t1.push(pulse);
    else if (tier === "T2") t2.push(pulse);
    else t3.push(pulse);
  }

  return { t1, t2, t3 };
}

export async function fetchAndExportPulse(opts: ExportOptions): Promise<void> {
  if (!isSupabaseConfigured) throw new Error("Supabase not configured");

  const { startDate, endDate } = opts;
  const isRange = startDate !== endDate;

  const [{ data: dailyRows }, { data: poolRows }, { data: agents }] = await Promise.all([
    supabase
      .from("daily_scrape_data")
      .select("*")
      .gte("scrape_date", startDate)
      .lte("scrape_date", endDate),
    supabase
      .from("leads_pool_daily_data")
      .select("*")
      .gte("scrape_date", startDate)
      .lte("scrape_date", endDate),
    supabase
      .from("agents")
      .select("name, site, tier, is_active, terminated_date"),
  ]);

  const typedDailyRaw = (dailyRows ?? []) as ScrapeRow[];
  const typedPoolRaw = (poolRows ?? []) as PoolRow[];
  // Active-only: terminated agents are excluded from exports regardless of
  // whether they had production inside the date range. This keeps agent-facing
  // reports tied to the current roster.
  const agentMap = new Map<string, { name: string; site: string; tier: string }>();
  for (const a of (agents ?? []) as Array<{ name: string; site: string; tier: string; is_active: boolean; terminated_date: string | null }>) {
    if (a.is_active) agentMap.set(a.name, a);
  }
  // Drop scrape/pool rows belonging to terminated agents so totals match.
  const typedDaily = typedDailyRaw.filter((r) => agentMap.has(r.agent_name));
  const typedPool = typedPoolRaw.filter((r) => agentMap.has(r.agent_name));

  // Daily breakdown: one unified sheet per date (no tier split).
  if (opts.dailyBreakdown && isRange) {
    const dates = [...new Set(typedDaily.map((r) => r.scrape_date))].sort();
    const configs: ExportConfig[] = [];
    const sortLabel = SORT_LABELS[opts.sortBy ?? "totalPremium"];

    for (const date of dates) {
      const dayDaily = typedDaily.filter((r) => r.scrape_date === date);
      const dayPool = typedPool.filter((r) => r.scrape_date === date);
      const { t1, t2, t3 } = buildPulseFromRows(dayDaily, dayPool, agentMap);
      const day = [...t1, ...t2, ...t3];
      if (day.length === 0) continue;

      const sorted = sortAgents(day, opts.sortBy ?? "totalPremium");
      const colKeys = buildUnifiedColumns(sorted, false);
      const columns = colKeys.map((k) => PULSE_COLS[k as keyof typeof PULSE_COLS]).filter(Boolean);

      configs.push({
        title: date.slice(5),
        subtitle: `Production · ${date} · ${sorted.length} agents · Sorted by ${sortLabel} DESC`,
        date,
        columns,
        rows: sorted.map((a, i) => ({ rank: i + 1, ...flattenWithPool(a) })),
      });
    }

    const workbook = await buildWorkbook(configs);
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DSB-Production-Daily-${startDate}-to-${endDate}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  // Standard aggregated export
  const daysActiveMap = new Map<string, number>();
  if (isRange) {
    const byAgentDates = new Map<string, Set<string>>();
    for (const r of typedDaily) {
      const set = byAgentDates.get(r.agent_name) ?? new Set();
      set.add(r.scrape_date);
      byAgentDates.set(r.agent_name, set);
    }
    for (const [name, dates] of Array.from(byAgentDates)) {
      daysActiveMap.set(name, dates.size);
    }
  }

  const { t1, t2, t3 } = buildPulseFromRows(typedDaily, typedPool, agentMap, isRange ? daysActiveMap : undefined);
  await exportDailyPulse(t1, t2, t3, opts);
}

export async function exportMonthlyStackRank(
  t1: MonthlyAgent[],
  t2: MonthlyAgent[],
  t3: MonthlyAgent[],
  windowName: string,
  selectedTiers: Tier[] = ["T1", "T2", "T3"],
  selectedColumns?: string[]
): Promise<void> {
  const configs: ExportConfig[] = [];

  const allCols = {
    rank: { key: "rank", header: "#", width: 5, format: "number" as const },
    name: { key: "name", header: "Agent", width: 22, format: "text" as const },
    site: { key: "site", header: "Site", width: 6, format: "text" as const },
    leadsDelivered: { key: "leadsDelivered", header: "Leads", format: "number" as const },
    sales: { key: "sales", header: "Sales", format: "number" as const, gradient: true },
    ibSales: { key: "ibSales", header: "Inbound Sales", format: "number" as const, gradient: true },
    bonusSales: { key: "bonusSales", header: "Bonus", format: "number" as const },
    closeRate: { key: "closeRate", header: "CR%", format: "decimal" as const, gradient: true },
    ibCR: { key: "ibCR", header: "Inbound CR%", format: "decimal" as const, gradient: true },
    leadCost: { key: "leadCost", header: "Lead Cost", format: "currency" as const },
    totalPremium: { key: "totalPremium", header: "Premium", format: "currency" as const, gradient: true },
    profit: { key: "profit", header: "Profit", format: "currency" as const, gradient: true },
    roli: { key: "roli", header: "ROLI", format: "decimal" as const, gradient: true },
    status: { key: "status", header: "Status", width: 14, format: "text" as const },
  };

  const filterCols = (keys: string[]) => {
    const filtered = selectedColumns
      ? keys.filter((k) => selectedColumns.includes(k))
      : keys;
    return filtered.map((k) => allCols[k as keyof typeof allCols]).filter(Boolean);
  };

  if (selectedTiers.includes("T3") && t3.length > 0) {
    const sorted = [...t3].sort((a, b) => b.roli - a.roli);
    configs.push({
      title: "Tier 3 — Promotion Pool",
      subtitle: `${windowName} | Sorted by ROLI DESC`,
      tier: "T3",
      columns: filterCols(["rank", "name", "leadsDelivered", "sales", "closeRate", "leadCost", "totalPremium", "profit", "roli", "status"]),
      rows: sorted.map((a, i) => ({ rank: i + 1, ...a })),
    });
  }

  if (selectedTiers.includes("T2") && t2.length > 0) {
    const sorted = [...t2].sort((a, b) => b.roli - a.roli);
    configs.push({
      title: "Tier 2 — Proving Ground",
      subtitle: `${windowName} | Sorted by ROLI DESC`,
      tier: "T2",
      columns: filterCols(["rank", "name", "ibCR", "leadCost", "totalPremium", "profit", "roli", "status"]),
      rows: sorted.map((a, i) => ({ rank: i + 1, ...a })),
    });
  }

  if (selectedTiers.includes("T1") && t1.length > 0) {
    const sorted = [...t1].sort((a, b) => b.roli - a.roli);
    configs.push({
      title: "Tier 1 — Elite Pool",
      subtitle: `${windowName} | Sorted by ROLI DESC`,
      tier: "T1",
      columns: filterCols(["rank", "name", "ibSales", "closeRate", "leadCost", "totalPremium", "profit", "roli", "status"]),
      rows: sorted.map((a, i) => ({ rank: i + 1, ...a })),
    });
  }

  const workbook = await buildWorkbook(configs);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DSB-Stack-Rank-${windowName.replace(/\s/g, "-")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Pipeline Intelligence Export ----

const PIPELINE_COLS = [
  { key: "name", header: "Agent", width: 22, format: "text" as const },
  { key: "site", header: "Site", width: 10, format: "text" as const },
  { key: "tier", header: "Tier (hist.)", width: 10, format: "text" as const },
  { key: "healthScore", header: "Health Score", width: 14, format: "number" as const, gradient: true },
  { key: "healthGrade", header: "Grade", width: 8, format: "text" as const },
  { key: "flags", header: "Flags", width: 30, format: "text" as const },
  { key: "followUpDiscipline", header: "F/U Discipline", width: 14, format: "decimal" as const },
  { key: "pipelineFreshness", header: "Freshness", width: 12, format: "decimal" as const },
  { key: "workRate", header: "Work Rate", width: 12, format: "decimal" as const },
  { key: "conversionEfficiency", header: "Conversion", width: 12, format: "decimal" as const },
  { key: "pastDue", header: "Past Due", width: 10, format: "number" as const },
  { key: "newLeads", header: "Untouched", width: 10, format: "number" as const },
  { key: "actionableLeads", header: "Actionable", width: 11, format: "number" as const },
  { key: "callQueue", header: "Call Queue", width: 10, format: "number" as const },
  { key: "todaysFollowUps", header: "Today F/U", width: 10, format: "number" as const },
  { key: "postSaleLeads", header: "Post-Sale", width: 10, format: "number" as const },
  { key: "totalDials", header: "CRM Dials", width: 10, format: "number" as const },
  { key: "poolDials", header: "Pool Dials", width: 10, format: "number" as const },
  { key: "combinedDials", header: "Total Dials", width: 10, format: "number" as const },
  { key: "totalSales", header: "Sales", width: 8, format: "number" as const },
  { key: "totalPremium", header: "Premium", width: 12, format: "currency" as const },
  { key: "avgPremium", header: "Avg Premium", width: 12, format: "currency" as const },
  { key: "premiumSource", header: "Prem Source", width: 12, format: "text" as const },
  { key: "closeRatePct", header: "Close Rate %", width: 12, format: "decimal" as const },
  { key: "closeRateSource", header: "CR Source", width: 12, format: "text" as const },
  { key: "premiumAtStake", header: "Premium @ Stake", width: 14, format: "currency" as const, gradient: true },
  { key: "wasteRatio", header: "Waste %", width: 10, format: "decimal" as const },
  { key: "followUpCompliance", header: "F/U Compl %", width: 12, format: "decimal" as const },
  { key: "pastDueDelta", header: "PD Delta d/d", width: 12, format: "number" as const },
];

function flattenPipelineAgent(agent: PipelineAgent): ExportableRow {
  return {
    name: agent.name,
    tier: agent.tier,
    site: agent.site === "RMT" ? "Remote" : agent.site,
    healthScore: agent.healthScore,
    healthGrade: agent.healthGrade,
    flags: agent.flags.map((f: BehavioralFlag) => FLAG_META[f].label).join(", ") || "--",
    followUpDiscipline: agent.followUpDiscipline,
    pipelineFreshness: agent.pipelineFreshness,
    workRate: agent.workRate,
    conversionEfficiency: agent.conversionEfficiency,
    pastDue: agent.pastDue,
    newLeads: agent.newLeads,
    actionableLeads: agent.actionableLeads,
    callQueue: agent.callQueue,
    todaysFollowUps: agent.todaysFollowUps,
    postSaleLeads: agent.postSaleLeads,
    totalDials: agent.totalDials,
    poolDials: agent.poolDials,
    combinedDials: agent.totalDials,
    totalSales: agent.totalSales,
    totalPremium: agent.totalPremium,
    avgPremium: agent.avgPremium,
    premiumSource: agent.premiumSource,
    closeRatePct: agent.closeRate * 100,
    closeRateSource: agent.closeRateSource,
    premiumAtStake: agent.premiumAtStake,
    wasteRatio: agent.wasteRatio,
    followUpCompliance: agent.followUpCompliance,
    pastDueDelta: agent.pastDueDelta ?? "",
  };
}

export async function exportPipelineIntelligence(
  agents: PipelineAgent[],
  date: string,
): Promise<void> {
  const sorted = [...agents].sort((a, b) => b.healthScore - a.healthScore);
  const rows = sorted.map(flattenPipelineAgent);

  const totalStake = agents.reduce((s, a) => s + a.premiumAtStake, 0);
  const totalActionable = agents.reduce((s, a) => s + a.actionableLeads, 0);
  const avgHealth = agents.length > 0 ? Math.round(agents.reduce((s, a) => s + a.healthScore, 0) / agents.length) : 0;

  const configs: ExportConfig[] = [{
    title: "Pipeline Intelligence Report",
    subtitle: `${date} | ${agents.length} agents | Avg Health: ${avgHealth} | Actionable: ${totalActionable} | Premium @ Stake: $${Math.round(totalStake).toLocaleString()}`,
    date,
    columns: PIPELINE_COLS,
    rows,
  }];

  const workbook = await buildWorkbook(configs);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DSB-Pipeline-Intel-${date}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
