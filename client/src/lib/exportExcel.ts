import ExcelJS from "exceljs";
import type { DailyPulseAgent, MonthlyAgent, Tier, PoolMetrics } from "./types";
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

export type SortKey = "totalPremium" | "salesToday" | "dials" | "talkTimeMin" | "totalTalk" | "closeRate" | "mtdROLI" | "mtdPace";

const SORT_LABELS: Record<SortKey, string> = {
  totalPremium: "Total Premium",
  salesToday: "Sales",
  dials: "Dials",
  talkTimeMin: "Talk Time",
  totalTalk: "Total Talk (CRM+Pool)",
  closeRate: "Close Rate",
  mtdROLI: "MTD ROLI",
  mtdPace: "MTD Pace",
};
export { SORT_LABELS };

export interface ExportOptions {
  tiers: Tier[];
  sortBy?: SortKey;
  startDate: string;
  endDate: string;
}

const PULSE_COLS = {
  rank: { key: "rank", header: "#", width: 5, format: "number" as const },
  name: { key: "name", header: "Agent", width: 22, format: "text" as const },
  site: { key: "site", header: "Site", width: 6, format: "text" as const },
  daysActive: { key: "daysActive", header: "Days", width: 5, format: "number" as const },
  ibCalls: { key: "ibCalls", header: "IB Calls", format: "number" as const },
  ibSales: { key: "ibSales", header: "IB Sales", format: "number" as const, gradient: true },
  obLeads: { key: "obLeads", header: "OB Leads", format: "number" as const },
  obSales: { key: "obSales", header: "OB Sales", format: "number" as const, gradient: true },
  dials: { key: "dials", header: "CRM Dials", format: "number" as const, gradient: true },
  talkTimeMin: { key: "talkTimeMin", header: "CRM Talk", format: "number" as const, gradient: true },
  poolDials: { key: "poolDials", header: "Pool Dials", format: "number" as const, gradient: true },
  poolTalk: { key: "poolTalk", header: "Pool Talk", format: "number" as const, gradient: true },
  totalDials: { key: "totalDials", header: "Total Dials", format: "number" as const, gradient: true },
  totalTalk: { key: "totalTalk", header: "Total Talk", format: "number" as const, gradient: true },
  poolContactRate: { key: "poolContactRate", header: "Contact %", format: "decimal" as const, gradient: true },
  poolConnectRate: { key: "poolConnectRate", header: "Connect %", format: "decimal" as const, gradient: true },
  poolSelfAssigned: { key: "poolSelfAssigned", header: "Self-Assigned", format: "number" as const },
  poolGhostAssigns: { key: "poolGhostAssigns", header: "No Long Call", format: "number" as const },
  salesToday: { key: "salesToday", header: "Sales", format: "number" as const, gradient: true },
  premiumToday: { key: "premiumToday", header: "Premium", format: "currency" as const, gradient: true },
  bonusSales: { key: "bonusSales", header: "Bonus", format: "number" as const },
  totalPremium: { key: "totalPremium", header: "Total Premium", format: "currency" as const, gradient: true },
  closeRate: { key: "closeRate", header: "Close Rate %", format: "decimal" as const, gradient: true },
  ibCR: { key: "ibCR", header: "IB CR%", format: "decimal" as const, gradient: true },
  obCR: { key: "obCR", header: "OB CR%", format: "decimal" as const, gradient: true },
  mtdSales: { key: "mtdSales", header: "MTD Sales", format: "number" as const, gradient: true },
  mtdPace: { key: "mtdPace", header: "MTD Pace", format: "decimal" as const, gradient: true },
  mtdROLI: { key: "mtdROLI", header: "MTD ROLI", format: "decimal" as const, gradient: true },
};

function flattenWithPool(agent: DailyPulseAgent): ExportableRow {
  const poolDials = agent.pool?.callsMade ?? 0;
  const longCalls = agent.pool?.longCalls ?? 0;
  const selfAssigned = agent.pool?.selfAssignedLeads ?? 0;
  const connected = Math.max(longCalls, selfAssigned);
  const ibLeads = agent.ibCalls ?? 0;
  const obLeads = agent.obLeads ?? 0;
  const ibSales = agent.ibSales ?? 0;
  const obSales = agent.obSales ?? 0;
  const totalLeads = ibLeads + obLeads;
  const totalSales = ibSales + obSales;

  return {
    name: agent.name,
    site: agent.site,
    tier: agent.tier,
    ibCalls: agent.ibCalls,
    ibSales: agent.ibSales,
    obLeads: agent.obLeads,
    obSales: agent.obSales,
    dials: agent.dials,
    talkTimeMin: agent.talkTimeMin ? Math.round(agent.talkTimeMin) : undefined,
    salesToday: agent.salesToday,
    premiumToday: agent.premiumToday,
    bonusSales: agent.bonusSales,
    totalPremium: agent.totalPremium,
    mtdSales: agent.mtdSales,
    mtdPace: agent.mtdPace,
    mtdROLI: agent.mtdROLI,
    daysActive: agent.daysActive,
    poolDials,
    poolTalk: Math.round(agent.pool?.talkTimeMin ?? 0),
    totalDials: (agent.dials ?? 0) + poolDials,
    totalTalk: Math.round((agent.talkTimeMin ?? 0) + (agent.pool?.talkTimeMin ?? 0)),
    poolContactRate: agent.pool?.contactRate ?? 0,
    poolConnectRate: poolDials > 0 ? (connected / poolDials) * 100 : 0,
    poolSelfAssigned: selfAssigned,
    poolGhostAssigns: Math.max(0, selfAssigned - longCalls),
    closeRate: totalLeads > 0 ? (totalSales / totalLeads) * 100 : 0,
    ibCR: ibLeads > 0 ? (ibSales / ibLeads) * 100 : 0,
    obCR: obLeads > 0 ? (obSales / obLeads) * 100 : 0,
  };
}

function getSortValue(agent: DailyPulseAgent, key: SortKey): number {
  const flat = flattenWithPool(agent);
  return (flat[key] as number) ?? 0;
}

function sortAgents(agents: DailyPulseAgent[], sortBy: SortKey): DailyPulseAgent[] {
  return [...agents].sort((a, b) => getSortValue(b, sortBy) - getSortValue(a, sortBy));
}

export async function exportDailyPulse(
  t1: DailyPulseAgent[],
  t2: DailyPulseAgent[],
  t3: DailyPulseAgent[],
  opts: ExportOptions,
): Promise<void> {
  const { tiers, sortBy, startDate, endDate } = opts;
  const isRange = startDate !== endDate;
  const dateLabel = isRange ? `${startDate} to ${endDate}` : startDate;
  const sortLabel = SORT_LABELS[sortBy ?? "totalPremium"];
  const configs: ExportConfig[] = [];

  const filterCols = (keys: string[]) =>
    keys.map((k) => PULSE_COLS[k as keyof typeof PULSE_COLS]).filter(Boolean);

  if (tiers.includes("T1") && t1.length > 0) {
    const sorted = sortAgents(t1, sortBy ?? "totalPremium");
    const cols = ["rank", "name", "site", ...(isRange ? ["daysActive"] : []),
      "ibCalls", "ibSales", "ibCR", "salesToday", "premiumToday", "bonusSales", "closeRate", "totalPremium", "mtdSales", "mtdROLI"];
    configs.push({
      title: "Tier 1 — Inbound",
      subtitle: `Sorted by ${sortLabel} DESC`,
      date: dateLabel,
      tier: "T1",
      columns: filterCols(cols),
      rows: sorted.map((a, i) => ({ rank: i + 1, ...flattenWithPool(a) })),
    });
  }

  if (tiers.includes("T2") && t2.length > 0) {
    const sorted = sortAgents(t2, sortBy ?? "totalPremium");
    const hasPool = t2.some(a => a.pool && a.pool.callsMade > 0);
    const cols = ["rank", "name", "site", ...(isRange ? ["daysActive"] : []),
      "ibCalls", "ibSales", "ibCR", "obLeads", "obSales", "obCR",
      ...(hasPool
        ? ["dials", "poolDials", "totalDials", "talkTimeMin", "poolTalk", "totalTalk"]
        : ["dials", "talkTimeMin"]),
      "closeRate", "premiumToday", "totalPremium", "mtdSales", "mtdROLI"];
    configs.push({
      title: "Tier 2 — Hybrid",
      subtitle: `Sorted by ${sortLabel} DESC${hasPool ? " · Includes Leads Pool" : ""}`,
      date: dateLabel,
      tier: "T2",
      columns: filterCols(cols),
      rows: sorted.map((a, i) => ({ rank: i + 1, ...flattenWithPool(a) })),
    });
  }

  if (tiers.includes("T3") && t3.length > 0) {
    const sorted = sortAgents(t3, sortBy ?? "totalTalk");
    const hasPool = t3.some(a => a.pool && a.pool.callsMade > 0);
    const cols = ["rank", "name", "site", ...(isRange ? ["daysActive"] : []),
      "obLeads", "obSales", "obCR",
      ...(hasPool
        ? ["dials", "poolDials", "totalDials", "talkTimeMin", "poolTalk", "totalTalk",
           "poolContactRate", "poolConnectRate", "poolSelfAssigned", "poolGhostAssigns"]
        : ["dials", "talkTimeMin"]),
      "salesToday", "premiumToday", "closeRate", "totalPremium", "mtdSales", "mtdPace"];
    configs.push({
      title: "Tier 3 — Outbound",
      subtitle: `Sorted by ${sortLabel} DESC${hasPool ? " · Includes Leads Pool" : ""}`,
      date: dateLabel,
      tier: "T3",
      columns: filterCols(cols),
      rows: sorted.map((a, i) => ({ rank: i + 1, ...flattenWithPool(a) })),
    });
  }

  const workbook = await buildWorkbook(configs);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = isRange ? `DSB-Daily-Pulse-${startDate}-to-${endDate}.xlsx` : `DSB-Daily-Pulse-${startDate}.xlsx`;
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
      .select("name, site, tier")
      .eq("is_active", true),
  ]);

  const typedDaily = (dailyRows ?? []) as ScrapeRow[];
  const typedPool = (poolRows ?? []) as PoolRow[];
  const agentMap = new Map<string, { name: string; site: string; tier: string }>();
  for (const a of (agents ?? []) as Array<{ name: string; site: string; tier: string }>) {
    agentMap.set(a.name, a);
  }

  const poolMap = new Map<string, PoolMetrics>();
  const poolGrouped = new Map<string, PoolRow[]>();
  for (const r of typedPool) {
    const arr = poolGrouped.get(r.agent_name) ?? [];
    arr.push(r);
    poolGrouped.set(r.agent_name, arr);
  }
  for (const [name, rows] of Array.from(poolGrouped)) {
    const callsMade = rows.reduce((s: number, r: PoolRow) => s + r.calls_made, 0);
    const longCalls = rows.reduce((s: number, r: PoolRow) => s + r.long_calls, 0);
    const selfAssigned = rows.reduce((s: number, r: PoolRow) => s + r.self_assigned_leads, 0);
    const answered = rows.reduce((s: number, r: PoolRow) => s + r.answered_calls, 0);
    poolMap.set(name, {
      callsMade,
      talkTimeMin: rows.reduce((s: number, r: PoolRow) => s + r.talk_time_minutes, 0),
      salesMade: rows.reduce((s: number, r: PoolRow) => s + r.sales_made, 0),
      premium: rows.reduce((s: number, r: PoolRow) => s + r.premium, 0),
      selfAssignedLeads: selfAssigned,
      answeredCalls: answered,
      longCalls,
      contactRate: callsMade > 0 ? (answered / callsMade) * 100 : 0,
      expectedAssignmentRate: longCalls > 0 ? (selfAssigned / longCalls) * 100 : undefined,
    });
  }

  const scrapeGrouped = new Map<string, ScrapeRow[]>();
  const daysActiveMap = new Map<string, number>();
  for (const r of typedDaily) {
    const arr = scrapeGrouped.get(r.agent_name) ?? [];
    arr.push(r);
    scrapeGrouped.set(r.agent_name, arr);
    if (isRange) {
      const dates = daysActiveMap.get(r.agent_name) ?? 0;
      daysActiveMap.set(r.agent_name, dates);
    }
  }
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

  const t1: DailyPulseAgent[] = [];
  const t2: DailyPulseAgent[] = [];
  const t3: DailyPulseAgent[] = [];
  const processed = new Set<string>();

  for (const [name, rows] of Array.from(scrapeGrouped)) {
    processed.add(name);
    const agent = agentMap.get(name);
    const site = agent?.site ?? "CHA";
    const tier = (rows[0].tier as Tier) ?? (agent?.tier as Tier) ?? "T3";

    const ibLeads = rows.reduce((s: number, r: ScrapeRow) => s + r.ib_leads_delivered, 0);
    const obLeads = rows.reduce((s: number, r: ScrapeRow) => s + r.ob_leads_delivered, 0);
    const ibSales = rows.reduce((s: number, r: ScrapeRow) => s + r.ib_sales, 0);
    const obSales = rows.reduce((s: number, r: ScrapeRow) => s + r.ob_sales, 0);
    const customSales = rows.reduce((s: number, r: ScrapeRow) => s + r.custom_sales, 0);
    const ibPrem = rows.reduce((s: number, r: ScrapeRow) => s + r.ib_premium, 0);
    const obPrem = rows.reduce((s: number, r: ScrapeRow) => s + r.ob_premium, 0);
    const customPrem = rows.reduce((s: number, r: ScrapeRow) => s + r.custom_premium, 0);
    const dials = rows.reduce((s: number, r: ScrapeRow) => s + r.total_dials, 0);
    const talkTime = rows.reduce((s: number, r: ScrapeRow) => s + r.talk_time_minutes, 0);
    const totalPremium = ibPrem + obPrem + customPrem;

    const pulse: DailyPulseAgent = {
      name, site, tier,
      ibCalls: ibLeads || undefined,
      ibSales: ibSales || undefined,
      obLeads: obLeads || undefined,
      obSales: obSales || undefined,
      dials: dials || undefined,
      talkTimeMin: talkTime || undefined,
      salesToday: ibSales + obSales + customSales,
      premiumToday: totalPremium - customPrem,
      bonusSales: customSales || undefined,
      totalPremium,
      daysActive: daysActiveMap.get(name),
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
      daysActive: daysActiveMap.get(name),
      pool,
    };
    if (tier === "T1") t1.push(pulse);
    else if (tier === "T2") t2.push(pulse);
    else t3.push(pulse);
  }

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
    ibSales: { key: "ibSales", header: "IB Sales", format: "number" as const, gradient: true },
    obSales: { key: "obSales", header: "OB Sales", format: "number" as const, gradient: true },
    bonusSales: { key: "bonusSales", header: "Bonus", format: "number" as const },
    closeRate: { key: "closeRate", header: "CR%", format: "decimal" as const, gradient: true },
    ibCR: { key: "ibCR", header: "IB CR%", format: "decimal" as const, gradient: true },
    obCR: { key: "obCR", header: "OB CR%", format: "decimal" as const, gradient: true },
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
      columns: filterCols(["rank", "name", "ibCR", "obCR", "leadCost", "totalPremium", "profit", "roli", "status"]),
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
