import { Actor, log } from "apify";
import { chromium, type Page, type Download } from "playwright";
import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// DSB CRM Scraper — Apify Actor
// Uses URL query parameters to load filtered reports directly.
// Only the Lead Tracker needs CSV export (per-lead rows with Type column).
// Sale Made and Calls Report are scraped from the HTML table.
// ============================================================

interface ActorInput {
  crmUsername: string;
  crmPassword: string;
  scrapeDate?: string;
  loginUrl?: string;
}

interface AgentRecord {
  agent_name: string;
  tier: "T1" | "T2" | "T3";
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
}

const CRM_BASE = "https://crm.digitalseniorbenefits.com";

const TIERS: Array<{ tier: "T1" | "T2" | "T3"; agencyId: string }> = [
  { tier: "T1", agencyId: "12055" },
  { tier: "T2", agencyId: "12056" },
  { tier: "T3", agencyId: "10581" },
];

function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function toMMDDYYYY(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

function encodeDate(isoDate: string): string {
  return encodeURIComponent(toMMDDYYYY(isoDate));
}

function buildLeadTrackerUrl(agencyId: string, scrapeDate: string): string {
  const d = encodeDate(scrapeDate);
  return `${CRM_BASE}/admin-lead-tracker/?period=custom&start_date=${d}&end_date=${d}&agent_id=all&coach=&tier=all&type=all&website_name=&traffic_source=&lead_source=&agency_id=${agencyId}`;
}

function buildSaleMadeUrl(agencyId: string, scrapeDate: string, typeFilter: string = "all"): string {
  const d = encodeDate(scrapeDate);
  return `${CRM_BASE}/admin-sale-made/?period=custom&start_date=${d}&end_date=${d}&agent_id=all&coach=&type=${typeFilter}&carrier_id=all&agency_id=${agencyId}&sort=count_desc`;
}

function buildCallsReportUrl(agencyId: string, scrapeDate: string): string {
  const d = encodeDate(scrapeDate);
  return `${CRM_BASE}/admin-calls-report/?period=custom&start_date=${d}&end_date=${d}&agent_id=all&coach=&agency_id=${agencyId}`;
}

function emptyRecord(name: string, tier: "T1" | "T2" | "T3"): AgentRecord {
  return {
    agent_name: name, tier,
    ib_leads_delivered: 0, ob_leads_delivered: 0, custom_leads: 0,
    ib_sales: 0, ob_sales: 0, custom_sales: 0,
    ib_premium: 0, ob_premium: 0, custom_premium: 0,
    total_dials: 0, talk_time_minutes: 0,
  };
}

function getOrCreate(map: Map<string, AgentRecord>, name: string, tier: "T1" | "T2" | "T3"): AgentRecord {
  const key = name.trim();
  if (!map.has(key)) map.set(key, emptyRecord(key, tier));
  return map.get(key)!;
}

function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseTalkTime(val: string | undefined): number {
  if (!val) return 0;
  const trimmed = val.trim();
  const parts = trimmed.split(":");
  if (parts.length === 3) return parseInt(parts[0]) * 60 + parseInt(parts[1]) + parseInt(parts[2]) / 60;
  if (parts.length === 2) return parseInt(parts[0]) + parseInt(parts[1]) / 60;
  return parseNumber(val);
}

// ---- Find the real Export button (not the sidebar nav link) ----

async function findExportButton(page: Page): Promise<ReturnType<Page["locator"]> | null> {
  // The CRM has a sidebar link to "/admin-report-request-exports/" that also contains "Export".
  // The real export button is in the main content area and triggers a file download.
  const candidates = [
    // Buttons with "Export" text (most specific first)
    'main button:has-text("Export")',
    '.content button:has-text("Export")',
    '.container button:has-text("Export")',
    '#content button:has-text("Export")',
    '.page-content button:has-text("Export")',
    '.panel button:has-text("Export")',
    '.card button:has-text("Export")',
    // Buttons with export-related classes
    'button.export', 'button.btn-export', '.export-btn',
    'button[data-export]', 'button.dt-button:has-text("Export")',
    // DataTables export buttons
    '.dt-buttons button:has-text("Export")',
    '.dt-buttons button:has-text("CSV")',
    '.buttons-csv',
    '.buttons-html5',
    // Links that trigger download (exclude the sidebar nav link)
    'a:has-text("Export"):not([href*="admin-report-request"])',
    // Generic fallback — button near the table
    '.dataTables_wrapper ~ button:has-text("Export")',
    'table ~ button:has-text("Export")',
  ];

  for (const selector of candidates) {
    const btn = page.locator(selector).first();
    try {
      if (await btn.count() > 0 && await btn.isVisible({ timeout: 2000 })) {
        log.info(`Found Export button: ${selector}`);
        return btn;
      }
    } catch {}
  }

  // Last resort: find any Export text that's not the sidebar link
  const allExport = page.locator('button:has-text("Export"), a:has-text("Export")');
  const count = await allExport.count();
  for (let i = 0; i < count; i++) {
    const el = allExport.nth(i);
    const href = await el.getAttribute("href").catch(() => null);
    if (href && href.includes("admin-report-request")) continue;
    if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
      log.info(`Found Export button at index ${i} (fallback scan)`);
      return el;
    }
  }

  return null;
}

// ---- Login ----

async function login(page: Page, loginUrl: string, username: string, password: string): Promise<void> {
  log.info(`Navigating to login: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill('input[name="email"], input[name="username"], input[type="email"], input[type="text"]', username);
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
  await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 });
  log.info("Login successful");
}

// ---- Lead Tracker: CSV Export (one row per lead, has Type column) ----

async function scrapeLeadTracker(
  page: Page,
  agencyId: string,
  scrapeDate: string,
  tier: "T1" | "T2" | "T3",
  agentMap: Map<string, AgentRecord>
): Promise<void> {
  const url = buildLeadTrackerUrl(agencyId, scrapeDate);
  log.info(`Lead Tracker [${tier}]: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  // Wait for table to render
  await page.waitForSelector('table, .dataTables_wrapper', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // Download CSV via Export button
  const downloadDir = path.join(process.cwd(), "downloads");
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const exportBtn = await findExportButton(page);
  if (!exportBtn) {
    log.warning(`Lead Tracker [${tier}]: No Export button found — skipping`);
    return;
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await exportBtn.scrollIntoViewIfNeeded().catch(() => {});
  await exportBtn.click({ force: true });
  log.info(`Lead Tracker [${tier}]: Clicked Export, waiting for download...`);

  const download: Download = await downloadPromise;
  const filePath = path.join(downloadDir, `lead-tracker-${tier}-${Date.now()}.csv`);
  await download.saveAs(filePath);
  log.info(`Lead Tracker [${tier}]: CSV saved to ${filePath}`);

  // Parse CSV — each row is one lead
  const content = fs.readFileSync(filePath, "utf-8");
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
  log.info(`Lead Tracker [${tier}]: ${records.length} lead rows`);

  // Count leads per agent per type
  for (const row of records) {
    const agentName = row["Agent"]?.trim();
    if (!agentName) continue;

    const leadType = (row["Type"] ?? "").trim().toLowerCase();
    const rec = getOrCreate(agentMap, agentName, tier);

    if (leadType.includes("call in") || leadType.includes("callin")) {
      rec.ib_leads_delivered++;
    } else if (leadType.includes("exclusive") || leadType.includes("outbound") || leadType.includes("fex")) {
      rec.ob_leads_delivered++;
    } else if (leadType.includes("custom")) {
      rec.custom_leads++;
    } else {
      // For T1 (pure IB) default to inbound, for T3 (pure OB) default to outbound
      if (tier === "T1") rec.ib_leads_delivered++;
      else if (tier === "T3") rec.ob_leads_delivered++;
      else rec.ob_leads_delivered++; // T2 unknown defaults to OB
    }
  }

  try { fs.unlinkSync(filePath); } catch {}
}

// ---- Sale Made Report ----
// Columns: #, Agent, Count, Total Premium, SDP Count, SDP Percentage, Production Goal, View
// Each row = one agent with aggregated count + total premium
// For T2, we run separate passes per type filter to split IB/OB/Custom

type SaleChannel = "inbound" | "outbound" | "custom";

interface SaleMadePass {
  typeFilter: string;
  channel: SaleChannel;
  label: string;
}

function getSaleMadePasses(tier: "T1" | "T2" | "T3"): SaleMadePass[] {
  if (tier === "T1") {
    // T1 is pure inbound — run once with all, then custom separately
    return [
      { typeFilter: "all", channel: "inbound", label: "All (IB)" },
    ];
  }
  if (tier === "T3") {
    // T3 is pure outbound — run once with all
    return [
      { typeFilter: "all", channel: "outbound", label: "All (OB)" },
    ];
  }
  // T2 hybrid — must split by type
  return [
    { typeFilter: "9", channel: "inbound", label: "Call In (IB)" },
    { typeFilter: "1", channel: "outbound", label: "Exclusive (OB)" },
    { typeFilter: "custom", channel: "custom", label: "Custom" },
  ];
}

function applySaleMadeData(
  agentName: string,
  salesCount: number,
  premium: number,
  tier: "T1" | "T2" | "T3",
  channel: SaleChannel,
  agentMap: Map<string, AgentRecord>
): void {
  const rec = getOrCreate(agentMap, agentName, tier);
  if (channel === "inbound") {
    rec.ib_sales += salesCount;
    rec.ib_premium += premium;
  } else if (channel === "outbound") {
    rec.ob_sales += salesCount;
    rec.ob_premium += premium;
  } else {
    rec.custom_sales += salesCount;
    rec.custom_premium += premium;
  }
}

async function scrapeSaleMade(
  page: Page,
  agencyId: string,
  scrapeDate: string,
  tier: "T1" | "T2" | "T3",
  agentMap: Map<string, AgentRecord>
): Promise<void> {
  const passes = getSaleMadePasses(tier);

  for (const pass of passes) {
    const url = buildSaleMadeUrl(agencyId, scrapeDate, pass.typeFilter);
    log.info(`Sale Made [${tier}] ${pass.label}: ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});

    // Try CSV export
    const exportBtn = await findExportButton(page);
    if (exportBtn) {
      try {
        const downloadDir = path.join(process.cwd(), "downloads");
        if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

        const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
        await exportBtn.scrollIntoViewIfNeeded().catch(() => {});
        await exportBtn.click({ force: true });

        const download: Download = await downloadPromise;
        const filePath = path.join(downloadDir, `sale-made-${tier}-${pass.channel}-${Date.now()}.csv`);
        await download.saveAs(filePath);

        const content = fs.readFileSync(filePath, "utf-8");
        const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
        log.info(`Sale Made [${tier}] ${pass.label}: ${records.length} rows from CSV`);

        for (const row of records) {
          const agentName = (row["Agent"] ?? row["Agent Name"] ?? "").trim();
          if (!agentName || agentName.toLowerCase() === "total") continue;
          const salesCount = parseNumber(row["Count"] ?? row["Policies"] ?? "1");
          const premium = parseNumber(row["Total Premium"] ?? row["Premium"] ?? row["Annual Premium"] ?? row["Modal Premium"] ?? "0");
          applySaleMadeData(agentName, salesCount, premium, tier, pass.channel, agentMap);
        }

        try { fs.unlinkSync(filePath); } catch {}
        continue;
      } catch (err) {
        log.warning(`Sale Made [${tier}] ${pass.label}: CSV failed, trying HTML table`);
      }
    }

    // Fallback: HTML table scrape
    // Columns: #(0), Agent(1), Count(2), Total Premium(3), ...
    const rows = await page.$$eval('table tbody tr', (trs) =>
      trs.map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td'));
        return cells.map((td) => td.textContent?.trim() ?? "");
      })
    );

    log.info(`Sale Made [${tier}] ${pass.label}: ${rows.length} rows from HTML`);
    for (const cells of rows) {
      if (cells.length < 4) continue;
      // Column 0 = row #, Column 1 = Agent, Column 2 = Count, Column 3 = Total Premium
      const agentName = cells[1]?.trim();
      if (!agentName || agentName.toLowerCase() === "total" || agentName === "Agent") continue;
      const salesCount = parseNumber(cells[2]);
      const premium = parseNumber(cells[3]);
      applySaleMadeData(agentName, salesCount, premium, tier, pass.channel, agentMap);
    }
  }
}

// ---- Calls Report: Scrape HTML table ----

async function scrapeCallsReport(
  page: Page,
  agencyId: string,
  scrapeDate: string,
  tier: "T1" | "T2" | "T3",
  agentMap: Map<string, AgentRecord>
): Promise<void> {
  const url = buildCallsReportUrl(agencyId, scrapeDate);
  log.info(`Calls Report [${tier}]: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});

  // Try CSV export first
  const exportBtn = await findExportButton(page);
  if (exportBtn) {
    try {
      const downloadDir = path.join(process.cwd(), "downloads");
      if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

      const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
      await exportBtn.scrollIntoViewIfNeeded().catch(() => {});
      await exportBtn.click({ force: true });

      const download: Download = await downloadPromise;
      const filePath = path.join(downloadDir, `calls-${tier}-${Date.now()}.csv`);
      await download.saveAs(filePath);

      const content = fs.readFileSync(filePath, "utf-8");
      const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
      log.info(`Calls Report [${tier}]: ${records.length} rows from CSV`);

      for (const row of records) {
        const agentName = (row["Agent"] ?? row["Agent Name"] ?? row["Name"] ?? "").trim();
        if (!agentName) continue;
        const rec = getOrCreate(agentMap, agentName, tier);
        rec.total_dials += parseNumber(row["Total Calls"] ?? row["Calls"] ?? row["Dials"] ?? row["Outgoing"] ?? "0");
        rec.talk_time_minutes += parseTalkTime(row["Talk Time"] ?? row["Duration"] ?? row["Talk"] ?? "0");
      }

      try { fs.unlinkSync(filePath); } catch {}
      return;
    } catch (err) {
      log.warning(`Calls Report [${tier}]: CSV export failed, falling back to HTML table`);
    }
  }

  // Fallback: scrape HTML table
  const headers = await page.$$eval('table thead th', (ths) =>
    ths.map((th) => th.textContent?.trim().toLowerCase() ?? "")
  );
  const rows = await page.$$eval('table tbody tr', (trs) =>
    trs.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td'));
      return cells.map((td) => td.textContent?.trim() ?? "");
    })
  );

  const nameIdx = headers.findIndex((h) => h.includes("agent") || h.includes("name"));
  const dialsIdx = headers.findIndex((h) => h.includes("call") || h.includes("dial") || h.includes("outgoing"));
  const talkIdx = headers.findIndex((h) => h.includes("talk") || h.includes("duration"));

  log.info(`Calls Report [${tier}]: ${rows.length} rows from HTML, columns: name=${nameIdx}, dials=${dialsIdx}, talk=${talkIdx}`);

  for (const cells of rows) {
    const agentName = cells[nameIdx >= 0 ? nameIdx : 0]?.trim();
    if (!agentName || agentName === "Total" || agentName === "Agent") continue;
    const rec = getOrCreate(agentMap, agentName, tier);
    if (dialsIdx >= 0) rec.total_dials += parseNumber(cells[dialsIdx]);
    if (talkIdx >= 0) rec.talk_time_minutes += parseTalkTime(cells[talkIdx]);
  }
}

// ---- Main ----

await Actor.init();

try {
  const input = (await Actor.getInput()) as ActorInput;
  if (!input.crmUsername || !input.crmPassword) {
    throw new Error("CRM username and password are required");
  }

  const scrapeDate = input.scrapeDate || todayISO();
  const loginUrl = input.loginUrl || "https://crm.digitalseniorbenefits.com/login";

  log.info(`Starting DSB CRM scrape for date: ${scrapeDate}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  await login(page, loginUrl, input.crmUsername, input.crmPassword);

  const agentMap = new Map<string, AgentRecord>();

  for (const { tier, agencyId } of TIERS) {
    log.info(`\n========== ${tier} (Agency ${agencyId}) ==========`);

    try {
      await scrapeLeadTracker(page, agencyId, scrapeDate, tier, agentMap);
    } catch (err) {
      log.error(`Lead Tracker [${tier}] failed: ${err instanceof Error ? err.message : err}`);
    }

    try {
      await scrapeSaleMade(page, agencyId, scrapeDate, tier, agentMap);
    } catch (err) {
      log.error(`Sale Made [${tier}] failed: ${err instanceof Error ? err.message : err}`);
    }

    try {
      await scrapeCallsReport(page, agencyId, scrapeDate, tier, agentMap);
    } catch (err) {
      log.error(`Calls Report [${tier}] failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  await browser.close();

  const agents = Array.from(agentMap.values());
  log.info(`\nScraped ${agents.length} total agents across all tiers`);

  // Log a summary per tier
  for (const tier of ["T1", "T2", "T3"] as const) {
    const tierAgents = agents.filter((a) => a.tier === tier);
    const totalLeads = tierAgents.reduce((s, a) => s + a.ib_leads_delivered + a.ob_leads_delivered, 0);
    const totalSales = tierAgents.reduce((s, a) => s + a.ib_sales + a.ob_sales, 0);
    log.info(`  ${tier}: ${tierAgents.length} agents, ${totalLeads} leads, ${totalSales} sales`);
  }

  const dataset = await Actor.openDataset();
  await dataset.pushData(agents);

  const { count } = await dataset.getInfo() ?? { count: 0 };
  log.info(`Dataset verified: ${count} items stored (expected ${agents.length}). Actor complete.`);
} catch (err) {
  log.error(`Actor failed: ${err instanceof Error ? err.message : err}`);
  throw err;
} finally {
  await Actor.exit();
}
