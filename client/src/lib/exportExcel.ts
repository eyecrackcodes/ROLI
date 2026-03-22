import ExcelJS from "exceljs";
import type { DailyPulseAgent, MonthlyAgent, Tier } from "./types";

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

export async function exportDailyPulse(
  t1: DailyPulseAgent[],
  t2: DailyPulseAgent[],
  t3: DailyPulseAgent[],
  date: string,
  selectedTiers: Tier[] = ["T1", "T2", "T3"],
  selectedColumns?: string[]
): Promise<void> {
  const configs: ExportConfig[] = [];

  const allCols = {
    rank: { key: "rank", header: "#", width: 5, format: "number" as const },
    name: { key: "name", header: "Agent", width: 22, format: "text" as const },
    site: { key: "site", header: "Site", width: 6, format: "text" as const },
    ibCalls: { key: "ibCalls", header: "IB Calls", format: "number" as const },
    ibSales: { key: "ibSales", header: "IB Sales", format: "number" as const, gradient: true },
    obLeads: { key: "obLeads", header: "OB Leads", format: "number" as const },
    obSales: { key: "obSales", header: "OB Sales", format: "number" as const, gradient: true },
    dials: { key: "dials", header: "Dials", format: "number" as const, gradient: true },
    talkTimeMin: { key: "talkTimeMin", header: "Talk Time", format: "number" as const, gradient: true },
    salesToday: { key: "salesToday", header: "Sales", format: "number" as const, gradient: true },
    premiumToday: { key: "premiumToday", header: "Premium", format: "currency" as const, gradient: true },
    bonusSales: { key: "bonusSales", header: "Bonus", format: "number" as const },
    totalPremium: { key: "totalPremium", header: "Total Premium", format: "currency" as const, gradient: true },
    mtdSales: { key: "mtdSales", header: "MTD Sales", format: "number" as const, gradient: true },
    mtdPace: { key: "mtdPace", header: "MTD Pace", format: "decimal" as const, gradient: true },
    mtdROLI: { key: "mtdROLI", header: "MTD ROLI", format: "decimal" as const, gradient: true },
  };

  const filterCols = (keys: string[]) => {
    const filtered = selectedColumns
      ? keys.filter((k) => selectedColumns.includes(k))
      : keys;
    return filtered.map((k) => allCols[k as keyof typeof allCols]).filter(Boolean);
  };

  if (selectedTiers.includes("T3") && t3.length > 0) {
    const sorted = [...t3].sort((a, b) => (b.talkTimeMin ?? 0) - (a.talkTimeMin ?? 0));
    configs.push({
      title: "Tier 3 — Outbound",
      subtitle: "Sorted by Talk Time DESC",
      date,
      tier: "T3",
      columns: filterCols(["rank", "name", "site", "obLeads", "dials", "talkTimeMin", "salesToday", "premiumToday", "totalPremium", "mtdSales", "mtdPace"]),
      rows: sorted.map((a, i) => ({ rank: i + 1, ...a })),
    });
  }

  if (selectedTiers.includes("T2") && t2.length > 0) {
    const sorted = [...t2].sort((a, b) => b.totalPremium - a.totalPremium);
    configs.push({
      title: "Tier 2 — Hybrid",
      subtitle: "Sorted by Total Premium DESC",
      date,
      tier: "T2",
      columns: filterCols(["rank", "name", "site", "ibCalls", "ibSales", "obLeads", "obSales", "premiumToday", "totalPremium", "mtdROLI"]),
      rows: sorted.map((a, i) => ({ rank: i + 1, ...a })),
    });
  }

  if (selectedTiers.includes("T1") && t1.length > 0) {
    const sorted = [...t1].sort((a, b) => b.totalPremium - a.totalPremium);
    configs.push({
      title: "Tier 1 — Inbound",
      subtitle: "Sorted by Total Premium DESC",
      date,
      tier: "T1",
      columns: filterCols(["rank", "name", "site", "ibCalls", "salesToday", "premiumToday", "bonusSales", "totalPremium", "mtdROLI"]),
      rows: sorted.map((a, i) => ({ rank: i + 1, ...a })),
    });
  }

  const workbook = await buildWorkbook(configs);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DSB-Daily-Pulse-${date}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
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
