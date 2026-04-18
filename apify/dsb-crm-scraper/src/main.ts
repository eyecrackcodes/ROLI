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

type SaleChannel = "inbound" | "outbound" | "custom";

interface SaleMadePassInput {
  typeFilter: string;
  channel: SaleChannel;
  label?: string;
}

interface ActorInput {
  crmUsername: string;
  crmPassword: string;
  scrapeDate?: string;
  loginUrl?: string;
  poolReconcileDays?: number;
  agentTiers?: Record<string, string>;
  /**
   * Per Apify agency key (`RMT`, `CHA`), override the CRM `type` query param on the **outbound**
   * sale-made pass only (replaces the default "Exclusive (OB)" filter). Use when CRM renames the
   * remote OB tag (e.g. Luminary Life remote team) — value is the `type=` id from the report URL.
   */
  saleMadeOutboundTypeBySite?: Record<string, string>;
  /**
   * Full replacement of sale-made passes for a given agency key. When set for a site, overrides
   * defaults and `saleMadeOutboundTypeBySite` for that site.
   */
  saleMadePassesBySite?: Record<string, SaleMadePassInput[]>;
  /**
   * Sales-only backfill mode. When set, the actor SKIPS Lead Tracker, Calls Report,
   * Pool Report, Pool Inventory, and Agent Performance, and instead only re-scrapes
   * the Sale Made Report for each ISO date provided. Each date produces a typed
   * dataset item `{ _type: "sale_made_backfill", scrape_date, agents }` that n8n
   * forwards to ingest-daily-scrape with `mode: "sales_only"` so dials/talk/leads
   * are preserved.
   */
  salesBackfillDates?: string[];
}

type TierLabel = "T1" | "T2" | "T3";

interface AgentRecord {
  agent_name: string;
  tier: TierLabel;
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

interface PoolAgentRecord {
  agent_name: string;
  calls_made: number;
  talk_time_minutes: number;
  sales_made: number;
  premium: number;
  self_assigned_leads: number;
  answered_calls: number;
  long_calls: number;
  contact_rate: number;
}

interface PoolInventoryRecord {
  status: string;
  total_leads: number;
}

interface AgentPerformanceRecord {
  agent_name: string;
  tier: TierLabel;
  dials: number;
  leads_worked: number;
  contacts_made: number;
  conversations: number;
  presentations: number;
  follow_ups_set: number;
  sales: number;
  talk_time_minutes: number;
  premium: number;
}

const CRM_BASE = "https://crm.digitalseniorbenefits.com";

const AGENCIES: Array<{ site: string; agencyId: string }> = [
  { site: "RMT", agencyId: "12912" },
];

function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function getPastBusinessDays(fromDate: string, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(fromDate + "T12:00:00");
  while (dates.length < count) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return dates;
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
  const typeEnc = encodeURIComponent(typeFilter);
  return `${CRM_BASE}/admin-sale-made/?period=custom&start_date=${d}&end_date=${d}&agent_id=all&coach=&type=${typeEnc}&carrier_id=all&tier=all&agency_id=${agencyId}&sort=count_desc`;
}

function buildCallsReportUrl(agencyId: string, scrapeDate: string): string {
  const d = encodeDate(scrapeDate);
  return `${CRM_BASE}/admin-calls-report/?period=custom&start_date=${d}&end_date=${d}&agent_id=all&coach=&agency_id=${agencyId}`;
}

function buildLeadsPoolReportUrl(scrapeDate: string): string {
  const d = encodeDate(scrapeDate);
  return `${CRM_BASE}/admin-leads-pool-report/?period=custom&start_date=${d}&end_date=${d}&agent_id=all&coach=&agency_id=`;
}

const LEADS_POOL_INVENTORY_URL = `${CRM_BASE}/admin-in-leads-pool-status-report/?status=reports_currently_in_leads_pool_status_default_group`;

function buildAgentPerformanceUrl(agencyId: string, scrapeDate: string): string {
  const d = encodeDate(scrapeDate);
  return `${CRM_BASE}/admin-daily-agent-performance/?period=custom&start_date=${d}&end_date=${d}&agent_id=all&coach=&agency_id=${agencyId}`;
}

function emptyRecord(name: string, tier: TierLabel): AgentRecord {
  return {
    agent_name: name, tier,
    ib_leads_delivered: 0, ob_leads_delivered: 0, custom_leads: 0,
    ib_sales: 0, ob_sales: 0, custom_sales: 0,
    ib_premium: 0, ob_premium: 0, custom_premium: 0,
    total_dials: 0, talk_time_minutes: 0,
  };
}

function getOrCreate(map: Map<string, AgentRecord>, name: string, tier: TierLabel): AgentRecord {
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
  site: string,
  agentMap: Map<string, AgentRecord>,
  tierLookup: (name: string) => TierLabel,
): Promise<void> {
  const url = buildLeadTrackerUrl(agencyId, scrapeDate);
  log.info(`Lead Tracker [${site}]: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  await page.waitForSelector('table, .dataTables_wrapper', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // Try CSV export first
  const downloadDir = path.join(process.cwd(), "downloads");
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const exportBtn = await findExportButton(page);
  if (exportBtn) {
    try {
      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
      await exportBtn.scrollIntoViewIfNeeded().catch(() => {});
      await exportBtn.click({ force: true });
      log.info(`Lead Tracker [${site}]: Clicked Export, waiting for download...`);

      const download: Download = await downloadPromise;
      const filePath = path.join(downloadDir, `lead-tracker-${site}-${Date.now()}.csv`);
      await download.saveAs(filePath);

      const content = fs.readFileSync(filePath, "utf-8");
      const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
      log.info(`Lead Tracker [${site}]: ${records.length} lead rows from CSV`);

      for (const row of records) {
        const agentName = row["Agent"]?.trim();
        if (!agentName) continue;
        const rec = getOrCreate(agentMap, agentName, tierLookup(agentName));
        const leadType = (row["Type"] ?? "").trim().toLowerCase();
        if (leadType.includes("missed") || leadType.includes("fex") || leadType.includes("exclusive") || leadType.includes("recycled")) {
          rec.ob_leads_delivered++;
        } else {
          rec.ib_leads_delivered++;
        }
      }

      try { fs.unlinkSync(filePath); } catch {}
      return;
    } catch (err) {
      log.warning(`Lead Tracker [${site}]: CSV export failed, falling back to HTML table`);
    }
  } else {
    log.warning(`Lead Tracker [${site}]: No Export button found, falling back to HTML table`);
  }

  // Fallback: scrape HTML table — show all entries first (DataTables paginates by default)
  try {
    const showAllSel = 'select[name$="_length"], .dataTables_length select';
    await page.waitForSelector(showAllSel, { timeout: 5000 });
    await page.selectOption(showAllSel, { label: "All" }).catch(() =>
      page.selectOption(showAllSel, "-1").catch(() => {})
    );
    await page.waitForTimeout(2000);
  } catch {
    log.info(`Lead Tracker [${site}]: Could not set DataTables to show all — using default page size`);
  }

  const headers = await page.$$eval('table thead th', (ths) =>
    ths.map((th) => th.textContent?.trim().toLowerCase() ?? "")
  );
  const rows = await page.$$eval('table tbody tr', (trs) =>
    trs.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td'));
      return cells.map((td) => td.textContent?.trim() ?? "");
    })
  );

  const agentIdx = headers.findIndex((h) => h.includes("agent") || h.includes("name"));
  const typeIdx = headers.findIndex((h) => h === "type" || h.includes("lead type"));
  log.info(`Lead Tracker [${site}]: ${rows.length} rows from HTML table, agent=${agentIdx}, type=${typeIdx}`);

  for (const cells of rows) {
    const agentName = cells[agentIdx >= 0 ? agentIdx : 0]?.trim();
    if (!agentName || agentName.toLowerCase() === "total" || agentName === "Agent") continue;
    const rec = getOrCreate(agentMap, agentName, tierLookup(agentName));
    const leadType = (cells[typeIdx >= 0 ? typeIdx : -1] ?? "").toLowerCase();
    if (leadType.includes("missed") || leadType.includes("fex") || leadType.includes("exclusive") || leadType.includes("recycled")) {
      rec.ob_leads_delivered++;
    } else {
      rec.ib_leads_delivered++;
    }
  }
}

// ---- Sale Made Report ----
// Columns: #, Agent, Count, Total Premium, SDP Count, SDP Percentage, Production Goal, View
// Each row = one agent with aggregated count + total premium
// For T2, we run separate passes per type filter to split IB/OB/Custom

interface SaleMadePass {
  typeFilter: string;
  channel: SaleChannel;
  label: string;
}

function getSaleMadePasses(): SaleMadePass[] {
  return [
    { typeFilter: "all", channel: "inbound", label: "All Types" },
  ];
}

function resolveSaleMadePasses(_site: string, _input: ActorInput): SaleMadePass[] {
  return getSaleMadePasses();
}

function applySaleMadeData(
  agentName: string,
  salesCount: number,
  premium: number,
  tier: TierLabel,
  channel: SaleChannel,
  agentMap: Map<string, AgentRecord>
): void {
  const rec = getOrCreate(agentMap, agentName, tier);
  if (channel === "custom") {
    rec.custom_sales += salesCount;
    rec.custom_premium += premium;
  } else if (channel === "inbound") {
    rec.ib_sales += salesCount;
    rec.ib_premium += premium;
  } else {
    rec.ob_sales += salesCount;
    rec.ob_premium += premium;
  }
}

async function extractSaleMadeTypes(page: Page): Promise<Array<{ value: string; label: string }>> {
  try {
    const allSelects = await page.$$eval("select", (sels) =>
      sels.map((s) => ({
        name: s.getAttribute("name") || "",
        id: s.id || "",
        optionCount: s.options.length,
        sampleOptions: Array.from(s.options).slice(0, 5).map((o) => ({
          value: o.value?.trim() ?? "",
          label: o.textContent?.trim() ?? "",
        })),
      }))
    );
    log.info(`Sale Made page selects: ${JSON.stringify(allSelects.map(s => ({ name: s.name, id: s.id, opts: s.optionCount })))}`);

    for (const sel of allSelects) {
      const hasTypeKeyword =
        sel.name.toLowerCase().includes("type") ||
        sel.id.toLowerCase().includes("type");
      const looksLikeTypeDropdown =
        sel.optionCount >= 2 &&
        sel.optionCount <= 30 &&
        sel.sampleOptions.some((o) => o.value === "all" || o.label.toLowerCase().includes("all"));
      if (hasTypeKeyword && looksLikeTypeDropdown) {
        const nameOrId = sel.name || sel.id;
        const options = await page.$$eval(
          `select[name="${nameOrId}"] option, select#${nameOrId} option`,
          (opts) =>
            opts.map((o) => ({
              value: (o as HTMLOptionElement).value?.trim() ?? "",
              label: (o as HTMLOptionElement).textContent?.trim() ?? "",
            })).filter((o) => o.value && o.value !== "all" && o.value !== "")
        );
        if (options.length > 0) return options;
      }
    }
  } catch (err) {
    log.warning(`extractSaleMadeTypes failed: ${err instanceof Error ? err.message : err}`);
  }
  return [];
}

async function scrapeSaleMade(
  page: Page,
  agencyId: string,
  scrapeDate: string,
  site: string,
  agentMap: Map<string, AgentRecord>,
  tierLookup: (name: string) => TierLabel,
  passes: SaleMadePass[],
): Promise<Array<{ value: string; label: string }>> {
  let discoveredTypes: Array<{ value: string; label: string }> = [];

  for (const pass of passes) {
    const url = buildSaleMadeUrl(agencyId, scrapeDate, pass.typeFilter);
    log.info(`Sale Made [${site}] ${pass.label}: ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});

    if (discoveredTypes.length === 0) {
      discoveredTypes = await extractSaleMadeTypes(page);
      if (discoveredTypes.length > 0) {
        log.info(`Sale Made type dropdown [${site}]: ${discoveredTypes.map(t => `${t.value}="${t.label}"`).join(", ")}`);
      }
    }

    const exportBtn = await findExportButton(page);
    if (exportBtn) {
      try {
        const downloadDir = path.join(process.cwd(), "downloads");
        if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

        const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
        await exportBtn.scrollIntoViewIfNeeded().catch(() => {});
        await exportBtn.click({ force: true });

        const download: Download = await downloadPromise;
        const filePath = path.join(downloadDir, `sale-made-${site}-${pass.channel}-${Date.now()}.csv`);
        await download.saveAs(filePath);

        const content = fs.readFileSync(filePath, "utf-8");
        const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
        log.info(`Sale Made [${site}] ${pass.label}: ${records.length} rows from CSV`);

        for (const row of records) {
          const agentName = (row["Agent"] ?? row["Agent Name"] ?? "").trim();
          if (!agentName || agentName.toLowerCase() === "total") continue;
          const tier = tierLookup(agentName);
          const salesCount = parseNumber(row["Count"] ?? row["Policies"] ?? "1");
          const premium = parseNumber(row["Total Premium"] ?? row["Premium"] ?? row["Annual Premium"] ?? row["Modal Premium"] ?? "0");
          applySaleMadeData(agentName, salesCount, premium, tier, pass.channel, agentMap);
        }

        try { fs.unlinkSync(filePath); } catch {}
        continue;
      } catch (err) {
        log.warning(`Sale Made [${site}] ${pass.label}: CSV failed, trying HTML table`);
      }
    }

    const rows = await page.$$eval('table tbody tr', (trs) =>
      trs.map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td'));
        return cells.map((td) => td.textContent?.trim() ?? "");
      })
    );

    log.info(`Sale Made [${site}] ${pass.label}: ${rows.length} rows from HTML`);
    for (const cells of rows) {
      if (cells.length < 4) continue;
      const agentName = cells[1]?.trim();
      if (!agentName || agentName.toLowerCase() === "total" || agentName === "Agent") continue;
      const tier = tierLookup(agentName);
      const salesCount = parseNumber(cells[2]);
      const premium = parseNumber(cells[3]);
      applySaleMadeData(agentName, salesCount, premium, tier, pass.channel, agentMap);
    }
  }

  return discoveredTypes;
}

// ---- Calls Report: Scrape HTML table ----

async function scrapeCallsReport(
  page: Page,
  agencyId: string,
  scrapeDate: string,
  site: string,
  agentMap: Map<string, AgentRecord>,
  tierLookup: (name: string) => TierLabel,
): Promise<void> {
  const url = buildCallsReportUrl(agencyId, scrapeDate);
  log.info(`Calls Report [${site}]: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});

  const exportBtn = await findExportButton(page);
  if (exportBtn) {
    try {
      const downloadDir = path.join(process.cwd(), "downloads");
      if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

      const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
      await exportBtn.scrollIntoViewIfNeeded().catch(() => {});
      await exportBtn.click({ force: true });

      const download: Download = await downloadPromise;
      const filePath = path.join(downloadDir, `calls-${site}-${Date.now()}.csv`);
      await download.saveAs(filePath);

      const content = fs.readFileSync(filePath, "utf-8");
      const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
      log.info(`Calls Report [${site}]: ${records.length} rows from CSV`);

      for (const row of records) {
        const agentName = (row["Agent"] ?? row["Agent Name"] ?? row["Name"] ?? "").trim();
        if (!agentName) continue;
        const rec = getOrCreate(agentMap, agentName, tierLookup(agentName));
        rec.total_dials += parseNumber(row["Total Calls"] ?? row["Calls"] ?? row["Dials"] ?? row["Outgoing"] ?? "0");
        rec.talk_time_minutes += parseTalkTime(row["Talk Time"] ?? row["Duration"] ?? row["Talk"] ?? "0");
      }

      try { fs.unlinkSync(filePath); } catch {}
      return;
    } catch (err) {
      log.warning(`Calls Report [${site}]: CSV export failed, falling back to HTML table`);
    }
  }

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

  log.info(`Calls Report [${site}]: ${rows.length} rows from HTML, columns: name=${nameIdx}, dials=${dialsIdx}, talk=${talkIdx}`);

  for (const cells of rows) {
    const agentName = cells[nameIdx >= 0 ? nameIdx : 0]?.trim();
    if (!agentName || agentName === "Total" || agentName === "Agent") continue;
    const rec = getOrCreate(agentMap, agentName, tierLookup(agentName));
    if (dialsIdx >= 0) rec.total_dials += parseNumber(cells[dialsIdx]);
    if (talkIdx >= 0) rec.talk_time_minutes += parseTalkTime(cells[talkIdx]);
  }
}

// ---- Leads Pool Report: HTML table scrape ----
// Columns: #(0), Agent(1), Calls Made(2), Talk Time(3), Sales Made(4),
//          Premium(5), Self Assigned Leads(6), Answered Calls(7), Long Calls(8),
//          Contact Rate(9), View(10)

async function scrapeLeadsPoolReport(
  page: Page,
  scrapeDate: string,
): Promise<PoolAgentRecord[]> {
  const url = buildLeadsPoolReportUrl(scrapeDate);
  log.info(`Leads Pool Report: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});

  const headers = await page.$$eval('table thead th', (ths) =>
    ths.map((th) => th.textContent?.trim().toLowerCase() ?? "")
  );
  const rows = await page.$$eval('table tbody tr', (trs) =>
    trs.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td'));
      return cells.map((td) => td.textContent?.trim() ?? "");
    })
  );

  const agentIdx = headers.findIndex((h) => h.includes("agent"));
  const callsMadeIdx = headers.findIndex((h) => h.includes("calls made"));
  const talkTimeIdx = headers.findIndex((h) => h.includes("talk time"));
  const salesIdx = headers.findIndex((h) => h.includes("sales made"));
  const premiumIdx = headers.findIndex((h) => h.includes("premium"));
  const selfAssignedIdx = headers.findIndex((h) => h.includes("self assigned"));
  const answeredIdx = headers.findIndex((h) => h.includes("answered"));
  const longCallsIdx = headers.findIndex((h) => h.includes("long call"));
  const contactRateIdx = headers.findIndex((h) => h.includes("contact") && h.includes("rate"));

  log.info(`Leads Pool Report: ${rows.length} rows, columns: agent=${agentIdx}, calls=${callsMadeIdx}, talk=${talkTimeIdx}, sales=${salesIdx}, premium=${premiumIdx}, selfAssigned=${selfAssignedIdx}, answered=${answeredIdx}, long=${longCallsIdx}, contactRate=${contactRateIdx}`);

  const results: PoolAgentRecord[] = [];

  for (const cells of rows) {
    const agentName = cells[agentIdx >= 0 ? agentIdx : 1]?.trim();
    if (!agentName || agentName.toLowerCase() === "total" || agentName === "Agent") continue;

    const contactRateRaw = cells[contactRateIdx >= 0 ? contactRateIdx : 9] ?? "0";
    const contactRateVal = parseNumber(contactRateRaw.replace("%", ""));

    results.push({
      agent_name: agentName,
      calls_made: parseNumber(cells[callsMadeIdx >= 0 ? callsMadeIdx : 2]),
      talk_time_minutes: parseNumber(cells[talkTimeIdx >= 0 ? talkTimeIdx : 3]),
      sales_made: parseNumber(cells[salesIdx >= 0 ? salesIdx : 4]),
      premium: parseNumber(cells[premiumIdx >= 0 ? premiumIdx : 5]),
      self_assigned_leads: parseNumber(cells[selfAssignedIdx >= 0 ? selfAssignedIdx : 6]),
      answered_calls: parseNumber(cells[answeredIdx >= 0 ? answeredIdx : 7]),
      long_calls: parseNumber(cells[longCallsIdx >= 0 ? longCallsIdx : 8]),
      contact_rate: contactRateVal,
    });
  }

  log.info(`Leads Pool Report: parsed ${results.length} agent records`);
  return results;
}

// ---- Leads Pool Inventory: HTML table scrape ----
// Columns: Status(0), Total(1)

async function scrapeLeadsPoolInventory(
  page: Page,
): Promise<PoolInventoryRecord[]> {
  log.info(`Leads Pool Inventory: ${LEADS_POOL_INVENTORY_URL}`);
  await page.goto(LEADS_POOL_INVENTORY_URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});

  const rows = await page.$$eval('table tbody tr, table tr:not(:first-child)', (trs) =>
    trs.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td'));
      return cells.map((td) => td.textContent?.trim() ?? "");
    })
  );

  const results: PoolInventoryRecord[] = [];

  for (const cells of rows) {
    if (cells.length < 2) continue;
    const status = cells[0]?.trim();
    if (!status || status.toLowerCase() === "status") continue;
    const total = parseNumber(cells[1]);
    if (total > 0) {
      results.push({ status, total_leads: total });
    }
  }

  log.info(`Leads Pool Inventory: ${results.length} status rows, total leads: ${results.reduce((s, r) => s + r.total_leads, 0)}`);
  return results;
}

// ---- Daily Agent Performance Report: HTML table scrape ----
// Columns: Agent, Dials, Leads Worked, Contact Made, Conversations, Presentations,
//          Follow Up (Appt Set), Sale, Talk Min, Contact %, Contact to Close %,
//          Conversation to Close %, Presentation to Close %, Sale Made AP

async function scrapeAgentPerformance(
  page: Page,
  agencyId: string,
  scrapeDate: string,
  site: string,
  tierLookup: (name: string) => TierLabel,
): Promise<AgentPerformanceRecord[]> {
  const url = buildAgentPerformanceUrl(agencyId, scrapeDate);
  log.info(`Agent Performance [${site}]: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});

  const headers = await page.$$eval('table thead th', (ths) =>
    ths.map((th) => th.textContent?.trim().toLowerCase() ?? "")
  );
  const rows = await page.$$eval('table tbody tr', (trs) =>
    trs.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td'));
      return cells.map((td) => td.textContent?.trim() ?? "");
    })
  );

  const agentIdx = headers.findIndex((h) => h.includes("agent"));
  const dialsIdx = headers.findIndex((h) => h === "dials" || h.includes("dial"));
  const leadsWorkedIdx = headers.findIndex((h) => h.includes("leads worked"));
  const contactIdx = headers.findIndex((h) => h.includes("contact made"));
  const convoIdx = headers.findIndex((h) => h.includes("conversation"));
  const presIdx = headers.findIndex((h) => h.includes("presentation"));
  const fuIdx = headers.findIndex((h) => h.includes("follow up") || h.includes("appt set"));
  const saleIdx = headers.findIndex((h) => h === "sale" || (h.includes("sale") && !h.includes("made ap") && !h.includes("%")));
  const talkIdx = headers.findIndex((h) => h.includes("talk min") || h.includes("talk time"));
  const premiumIdx = headers.findIndex((h) => h.includes("sale made ap") || h.includes("premium"));

  log.info(`Agent Performance [${site}]: ${rows.length} rows, columns: agent=${agentIdx}, dials=${dialsIdx}, leadsWorked=${leadsWorkedIdx}, contact=${contactIdx}, convo=${convoIdx}, pres=${presIdx}, fu=${fuIdx}, sale=${saleIdx}, talk=${talkIdx}, premium=${premiumIdx}`);

  const results: AgentPerformanceRecord[] = [];

  for (const cells of rows) {
    const agentName = cells[agentIdx >= 0 ? agentIdx : 0]?.trim();
    if (!agentName || agentName.toLowerCase() === "total" || agentName === "Agent") continue;

    results.push({
      agent_name: agentName,
      tier: tierLookup(agentName),
      dials: parseNumber(cells[dialsIdx >= 0 ? dialsIdx : 1]),
      leads_worked: parseNumber(cells[leadsWorkedIdx >= 0 ? leadsWorkedIdx : 2]),
      contacts_made: parseNumber(cells[contactIdx >= 0 ? contactIdx : 3]),
      conversations: parseNumber(cells[convoIdx >= 0 ? convoIdx : 4]),
      presentations: parseNumber(cells[presIdx >= 0 ? presIdx : 5]),
      follow_ups_set: parseNumber(cells[fuIdx >= 0 ? fuIdx : 6]),
      sales: parseNumber(cells[saleIdx >= 0 ? saleIdx : 7]),
      talk_time_minutes: parseNumber(cells[talkIdx >= 0 ? talkIdx : 8]),
      premium: parseNumber(cells[premiumIdx >= 0 ? premiumIdx : 13]?.replace(/[$,_]/g, "") ?? "0"),
    });
  }

  log.info(`Agent Performance [${site}]: parsed ${results.length} agent records`);
  return results;
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
  const backfillDates = (input.salesBackfillDates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const isBackfillMode = backfillDates.length > 0;

  log.info(`Starting DSB CRM scrape for date: ${scrapeDate}${isBackfillMode ? ` | SALES BACKFILL MODE (${backfillDates.length} dates)` : ""}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  await login(page, loginUrl, input.crmUsername, input.crmPassword);

  const agentTiers: Record<string, string> = input.agentTiers ?? {};
  const tierLookup = (name: string): TierLabel => {
    const t = agentTiers[name.trim()];
    if (t === "T1" || t === "T2" || t === "T3") return t;
    return "T2";
  };

  // ---- SALES BACKFILL MODE: only re-scrape Sale Made for past dates ----
  if (isBackfillMode) {
    const dataset = await Actor.openDataset();
    log.info(`Backfill mode: skipping all reports except Sale Made for ${backfillDates.length} dates`);

    for (const date of backfillDates) {
      log.info(`\n========== SALES BACKFILL ${date} ==========`);
      const dateMap = new Map<string, AgentRecord>();
      for (const { site, agencyId } of AGENCIES) {
        try {
          await scrapeSaleMade(page, agencyId, date, site, dateMap, tierLookup, resolveSaleMadePasses(site, input));
        } catch (err) {
          log.error(`Sale Made backfill [${site}] [${date}] failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      const dateAgents = Array.from(dateMap.values());
      const totalSales = dateAgents.reduce((s, a) => s + a.ib_sales + a.ob_sales + a.custom_sales, 0);
      const totalPremium = dateAgents.reduce((s, a) => s + a.ib_premium + a.ob_premium + a.custom_premium, 0);
      log.info(`  ${date}: ${dateAgents.length} agents | ${totalSales} sales | $${totalPremium.toFixed(0)} premium`);
      await dataset.pushData({
        _type: "sale_made_backfill",
        scrape_date: date,
        agents: dateAgents,
      });
    }

    await browser.close();
    log.info(`\nBackfill complete: ${backfillDates.length} dates scraped.`);
  } else {

  const agentMap = new Map<string, AgentRecord>();
  let saleTypeOptions: Array<{ value: string; label: string }> = [];

  for (const { site, agencyId } of AGENCIES) {
    log.info(`\n========== ${site} (Agency ${agencyId}) ==========`);

    try {
      await scrapeLeadTracker(page, agencyId, scrapeDate, site, agentMap, tierLookup);
    } catch (err) {
      log.error(`Lead Tracker [${site}] failed: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const types = await scrapeSaleMade(page, agencyId, scrapeDate, site, agentMap, tierLookup, resolveSaleMadePasses(site, input));
      if (types.length > 0 && saleTypeOptions.length === 0) saleTypeOptions = types;
    } catch (err) {
      log.error(`Sale Made [${site}] failed: ${err instanceof Error ? err.message : err}`);
    }

    try {
      await scrapeCallsReport(page, agencyId, scrapeDate, site, agentMap, tierLookup);
    } catch (err) {
      log.error(`Calls Report [${site}] failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ---- Daily Agent Performance (per agency) ----
  let perfAgents: AgentPerformanceRecord[] = [];

  for (const { site, agencyId } of AGENCIES) {
    try {
      log.info(`\n========== AGENT PERFORMANCE ${site} ==========`);
      const sitePerf = await scrapeAgentPerformance(page, agencyId, scrapeDate, site, tierLookup);
      perfAgents.push(...sitePerf);
    } catch (err) {
      log.error(`Agent Performance [${site}] failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ---- Leads Pool (cross-tier, no agency filter) ----
  let poolAgents: PoolAgentRecord[] = [];
  let poolInventory: PoolInventoryRecord[] = [];

  try {
    log.info(`\n========== LEADS POOL REPORT ==========`);
    poolAgents = await scrapeLeadsPoolReport(page, scrapeDate);
  } catch (err) {
    log.error(`Leads Pool Report failed: ${err instanceof Error ? err.message : err}`);
  }

  try {
    log.info(`\n========== LEADS POOL INVENTORY ==========`);
    poolInventory = await scrapeLeadsPoolInventory(page);
  } catch (err) {
    log.error(`Leads Pool Inventory failed: ${err instanceof Error ? err.message : err}`);
  }

  // ---- Pool Sales Reconciliation: re-scrape past N business days ----
  // The CRM retroactively attributes pool sales to the assignment date,
  // not the close date. Re-scraping past dates picks up those updates.
  // Only sales_made and premium from these re-scrapes should be used
  // (n8n sends them to ingest-leads-pool with sales_only: true).
  const reconcileDays = input.poolReconcileDays ?? 0;
  const reconcileResults: Array<{ scrape_date: string; pool_agents: PoolAgentRecord[] }> = [];

  if (reconcileDays > 0) {
    const pastDates = getPastBusinessDays(scrapeDate, reconcileDays);
    log.info(`\n========== POOL SALES RECONCILIATION (${pastDates.length} days) ==========`);

    for (const pastDate of pastDates) {
      try {
        const pastPoolAgents = await scrapeLeadsPoolReport(page, pastDate);
        if (pastPoolAgents.length > 0) {
          reconcileResults.push({ scrape_date: pastDate, pool_agents: pastPoolAgents });
          const pastSales = pastPoolAgents.reduce((s, a) => s + a.sales_made, 0);
          log.info(`  ${pastDate}: ${pastPoolAgents.length} agents, ${pastSales} sales`);
        } else {
          log.info(`  ${pastDate}: no pool data`);
        }
      } catch (err) {
        log.error(`Pool reconciliation [${pastDate}] failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  await browser.close();

  const agents = Array.from(agentMap.values());
  log.info(`\nScraped ${agents.length} total agents across all agencies`);
  log.info(`Pool agents: ${poolAgents.length}, Pool inventory statuses: ${poolInventory.length}`);

  const totalLeads = agents.reduce((s, a) => s + a.ib_leads_delivered + a.ob_leads_delivered, 0);
  const totalSales = agents.reduce((s, a) => s + a.ib_sales + a.ob_sales, 0);
  log.info(`  Total: ${agents.length} agents, ${totalLeads} leads, ${totalSales} sales`);

  if (poolAgents.length > 0) {
    const totalPoolCalls = poolAgents.reduce((s, a) => s + a.calls_made, 0);
    const totalSelfAssigned = poolAgents.reduce((s, a) => s + a.self_assigned_leads, 0);
    const totalLongCalls = poolAgents.reduce((s, a) => s + a.long_calls, 0);
    log.info(`  Pool: ${totalPoolCalls} calls, ${totalSelfAssigned} self-assigned, ${totalLongCalls} long calls`);
  }

  if (perfAgents.length > 0) {
    const totalContacts = perfAgents.reduce((s, a) => s + a.contacts_made, 0);
    const totalConvos = perfAgents.reduce((s, a) => s + a.conversations, 0);
    const totalPres = perfAgents.reduce((s, a) => s + a.presentations, 0);
    log.info(`  Performance funnel: ${perfAgents.length} agents, ${totalContacts} contacts, ${totalConvos} conversations, ${totalPres} presentations`);
  }

  const dataset = await Actor.openDataset();

  // Push agent records as individual items (backward-compatible with existing n8n pipeline)
  await dataset.pushData(agents);

  // Push pool data as a separate typed item so n8n can distinguish it
  if (poolAgents.length > 0 || poolInventory.length > 0) {
    await dataset.pushData({
      _type: "pool_data",
      scrape_date: scrapeDate,
      pool_agents: poolAgents,
      pool_inventory: poolInventory,
    });
  }

  // Push agent performance funnel data as a separate typed item
  if (perfAgents.length > 0) {
    await dataset.pushData({
      _type: "agent_performance",
      scrape_date: scrapeDate,
      agents: perfAgents,
    });
  }

  if (saleTypeOptions.length > 0) {
    await dataset.pushData({
      _type: "sale_type_options",
      scrape_date: scrapeDate,
      types: saleTypeOptions,
      known_passes: resolveSaleMadePasses("RMT", input).map(p => ({ typeFilter: p.typeFilter, channel: p.channel, label: p.label })),
    });
    log.info(`  Sale type dropdown: ${saleTypeOptions.length} types discovered`);
  }

  // Push pool sales reconciliation items (one per past date)
  for (const rec of reconcileResults) {
    await dataset.pushData({
      _type: "pool_sales_reconciliation",
      scrape_date: rec.scrape_date,
      pool_agents: rec.pool_agents,
    });
  }

  const datasetInfo = await dataset.getInfo();
  const itemCount = datasetInfo && "itemCount" in datasetInfo ? (datasetInfo as { itemCount: number }).itemCount : 0;
  log.info(`Dataset verified: ${itemCount} items stored (${agents.length} agents + ${poolAgents.length > 0 ? 1 : 0} pool + ${perfAgents.length > 0 ? 1 : 0} perf + ${reconcileResults.length} reconciliation). Actor complete.`);
  } // end of else (non-backfill mode)
} catch (err) {
  log.error(`Actor failed: ${err instanceof Error ? err.message : err}`);
  throw err;
} finally {
  await Actor.exit();
}
