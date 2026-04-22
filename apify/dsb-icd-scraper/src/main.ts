import { Actor, log } from "apify";
import { chromium, type Page } from "playwright";

// ============================================================
// DSB ICD Scraper — Apify Actor
//
// Scrapes the Insurance Calls Direct (ICD) "Calls Agents Report"
// (admin-calls-agents-report) and emits per-agent Billable Leads
// for each scrape date. ROLI consumes this as the source-of-truth
// for ib_leads_delivered (replacing the old DSB Lead Tracker
// row-count which over-reported because it counted every lead row,
// not just billable ones).
//
// Output dataset items (one per scrape date):
//   {
//     _type: "icd_calls_report",
//     scrape_date: "YYYY-MM-DD",
//     agency_id: "1428",
//     agents: [
//       {
//         agent_name: <canonical ROLI name>,
//         agent_name_raw: <as shown in ICD>,
//         billable_leads: number,
//         billable_pct: number,
//         remaining_leads: number,
//         sales_made: number | null,    // null when ICD shows "Not Available"
//         annual_premium: number,
//         sales_pct: number,
//         queue_minutes: number,
//         avg_wait_minutes: number,
//         talk_minutes: number,
//       },
//       ...
//     ],
//     unmatched_agents: [<icd_raw_name>, ...]   // present in ICD but not in canonical map (informational)
//   }
// ============================================================

interface ActorInput {
  icdUsername: string;
  icdPassword: string;
  scrapeDate?: string;
  backfillDates?: string[];
  loginUrl?: string;
  agencyId?: string;
  nameAliases?: Record<string, string>;
  targetAgents?: string[];
  requestDelay?: number;
}

interface AgentRow {
  agent_name: string;
  agent_name_raw: string;
  billable_leads: number;
  billable_pct: number;
  remaining_leads: number;
  sales_made: number | null;
  annual_premium: number;
  sales_pct: number;
  queue_minutes: number;
  avg_wait_minutes: number;
  talk_minutes: number;
}

const ICD_BASE = "https://app.insurancecallsdirect.com";

function todayCST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function toMMDDYYYY(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${m}/${d}/${y}`;
}

function encodeDate(isoDate: string): string {
  return encodeURIComponent(toMMDDYYYY(isoDate));
}

function buildReportUrl(agencyId: string, scrapeDate: string): string {
  // Single-day pull: start_date = end_date
  const d = encodeDate(scrapeDate);
  return `${ICD_BASE}/admin-calls-agents-report/?period=custom&start_date=${d}&end_date=${d}&agent_id=all&type=all&agency_id=${agencyId}`;
}

function parseNumber(val: string | undefined | null): number {
  if (val == null) return 0;
  const trimmed = String(val).trim();
  if (!trimmed || trimmed.toLowerCase().includes("not available") || trimmed === "—" || trimmed === "-") return 0;
  const cleaned = trimmed.replace(/[$,%\s]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseSalesMade(val: string | undefined | null): number | null {
  // ICD shows "Not Available" for agents who haven't worked the queue yet.
  // Distinguish this from a real 0.
  if (val == null) return 0;
  const trimmed = String(val).trim();
  if (!trimmed) return 0;
  if (trimmed.toLowerCase().includes("not available")) return null;
  return parseNumber(trimmed);
}

// ---- Login ----

async function login(page: Page, loginUrl: string, username: string, password: string): Promise<void> {
  // ICD is occasionally slow at the start of the day. Retry once with longer
  // timeouts before giving up so the morning scheduled run does not silently
  // fail on a transient cold-start (same hardening as the DSB pipeline scraper).
  const userSelector = 'input[name="email"], input[name="username"], input[type="email"], input[id="email"], input[id="username"]';
  const passSelector = 'input[name="password"], input[type="password"], input[id="password"]';
  const submitSelector =
    'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Log In"), button:has-text("Sign In")';

  const attempts = 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const navTimeout = attempt === 1 ? 60000 : 90000;
      log.info(`[ICD] Navigating to login (attempt ${attempt}/${attempts}, timeout ${navTimeout}ms): ${loginUrl}`);
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: navTimeout });
      await page.waitForLoadState("networkidle", { timeout: navTimeout }).catch(() => {});
      await page.waitForSelector(userSelector, { timeout: 15000 });
      await page.fill(userSelector, username);
      await page.fill(passSelector, password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: navTimeout }).catch(() => {}),
        page.click(submitSelector),
      ]);
      await page.waitForLoadState("networkidle", { timeout: navTimeout }).catch(() => {});

      const stillOnLogin = await page
        .locator('input[type="password"]')
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      if (stillOnLogin) {
        throw new Error("ICD login appears to have failed (password field still visible after submit).");
      }
      log.info(`[ICD] Login successful`);
      return;
    } catch (err) {
      lastErr = err;
      log.warning(`[ICD] Login attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`);
      if (attempt < attempts) {
        await page.waitForTimeout(5000);
      }
    }
  }
  throw new Error(`ICD login failed after ${attempts} attempts: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

// ---- Report scrape (one date) ----

async function scrapeReport(
  page: Page,
  agencyId: string,
  scrapeDate: string,
  nameAliases: Record<string, string>,
  targetAgents: Set<string>,
  requestDelay: number,
): Promise<{ rows: AgentRow[]; unmatched: string[] }> {
  const url = buildReportUrl(agencyId, scrapeDate);
  log.info(`[ICD] ${scrapeDate}: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(Math.max(1000, requestDelay));

  // The ICD report is rendered as a standard HTML table. Wait for it then read headers + rows.
  await page.waitForSelector("table", { timeout: 20000 });

  const headers = await page.$$eval("table thead th, table tr:first-child th", (ths) =>
    ths.map((th) => (th.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase()),
  );
  const rows = await page.$$eval("table tbody tr", (trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim())),
  );

  log.info(`[ICD] ${scrapeDate}: ${rows.length} rows · headers=[${headers.join(" | ")}]`);

  // Defensive header resolution. Header text observed:
  //   Agent | Billable Leads | Billable Leads % | Remaining Leads | Sales Made |
  //   Annual Premium | Sales % | Time Spent In Queue (Minutes) |
  //   Calls Average Wait Time (Minutes) | Total Talk Time (Minutes)
  const findIdx = (predicate: (h: string) => boolean): number => headers.findIndex(predicate);

  const agentIdx = findIdx((h) => h === "agent" || h.includes("agent"));
  const billableIdx = findIdx((h) => h.includes("billable") && !h.includes("%"));
  const billablePctIdx = findIdx((h) => h.includes("billable") && h.includes("%"));
  const remainingIdx = findIdx((h) => h.includes("remaining"));
  const salesIdx = findIdx((h) => h.includes("sales made") || (h.startsWith("sales") && !h.includes("%")));
  const premiumIdx = findIdx((h) => h.includes("annual premium") || h === "premium" || h.includes("premium"));
  const salesPctIdx = findIdx((h) => h.includes("sales") && h.includes("%"));
  const queueIdx = findIdx((h) => h.includes("time") && h.includes("queue"));
  const waitIdx = findIdx((h) => h.includes("average wait") || (h.includes("wait") && h.includes("time")));
  const talkIdx = findIdx((h) => h.includes("total talk") || h.includes("talk time") || h.includes("talk"));

  log.info(
    `[ICD] ${scrapeDate}: column indices agent=${agentIdx} billable=${billableIdx} billable%=${billablePctIdx} ` +
      `remaining=${remainingIdx} sales=${salesIdx} premium=${premiumIdx} sales%=${salesPctIdx} ` +
      `queue=${queueIdx} wait=${waitIdx} talk=${talkIdx}`,
  );

  if (agentIdx < 0 || billableIdx < 0) {
    throw new Error(`[ICD] ${scrapeDate}: could not locate Agent or Billable Leads column. Headers seen: ${JSON.stringify(headers)}`);
  }

  const out: AgentRow[] = [];
  const unmatched: string[] = [];

  for (const cells of rows) {
    const rawName = (cells[agentIdx] ?? "").trim();
    if (!rawName || rawName.toLowerCase() === "agent" || rawName.toLowerCase() === "total") continue;

    // Resolve ICD display name -> canonical ROLI name via passed-in alias map.
    // If the name is not in the map and not in targetAgents, pass through as-is and flag.
    const canonical = nameAliases[rawName] ?? rawName;

    if (targetAgents.size > 0 && !targetAgents.has(canonical)) {
      unmatched.push(rawName);
      continue;
    }

    out.push({
      agent_name: canonical,
      agent_name_raw: rawName,
      billable_leads: parseNumber(cells[billableIdx]),
      billable_pct: billablePctIdx >= 0 ? parseNumber(cells[billablePctIdx]) : 0,
      remaining_leads: remainingIdx >= 0 ? parseNumber(cells[remainingIdx]) : 0,
      sales_made: salesIdx >= 0 ? parseSalesMade(cells[salesIdx]) : 0,
      annual_premium: premiumIdx >= 0 ? parseNumber(cells[premiumIdx]) : 0,
      sales_pct: salesPctIdx >= 0 ? parseNumber(cells[salesPctIdx]) : 0,
      queue_minutes: queueIdx >= 0 ? parseNumber(cells[queueIdx]) : 0,
      avg_wait_minutes: waitIdx >= 0 ? parseNumber(cells[waitIdx]) : 0,
      talk_minutes: talkIdx >= 0 ? parseNumber(cells[talkIdx]) : 0,
    });
  }

  log.info(`[ICD] ${scrapeDate}: parsed ${out.length} agents (unmatched=${unmatched.length})`);
  if (unmatched.length > 0) {
    log.warning(`[ICD] ${scrapeDate}: unmatched ICD names (not in canonical roster): ${unmatched.join(", ")}`);
  }

  return { rows: out, unmatched };
}

// ---- Main ----

await Actor.init();

try {
  const input = (await Actor.getInput()) as ActorInput;
  if (!input?.icdUsername || !input?.icdPassword) {
    throw new Error("icdUsername and icdPassword are required");
  }

  const loginUrl = input.loginUrl || "https://app.insurancecallsdirect.com/login";
  const agencyId = input.agencyId || "1428";
  const nameAliases = input.nameAliases ?? {};
  const targetAgents = new Set<string>(input.targetAgents ?? []);
  const requestDelay = input.requestDelay ?? 1500;

  // Build date list. backfillDates wins; otherwise single scrapeDate.
  const backfillDates = (input.backfillDates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const dates = backfillDates.length > 0 ? backfillDates : [input.scrapeDate || todayCST()];

  log.info(`[ICD] Starting ICD scrape · agency=${agencyId} · dates=${dates.join(", ")} · targetAgents=${targetAgents.size}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await login(page, loginUrl, input.icdUsername, input.icdPassword);

  const dataset = await Actor.openDataset();

  for (const date of dates) {
    try {
      const { rows, unmatched } = await scrapeReport(page, agencyId, date, nameAliases, targetAgents, requestDelay);
      const totalBillable = rows.reduce((s, r) => s + r.billable_leads, 0);
      const totalSales = rows.reduce((s, r) => s + (r.sales_made ?? 0), 0);
      log.info(`[ICD] ${date}: ${rows.length} agents · ${totalBillable} billable leads · ${totalSales} sales`);

      await dataset.pushData({
        _type: "icd_calls_report",
        scrape_date: date,
        agency_id: agencyId,
        agents: rows,
        unmatched_agents: unmatched,
      });

      if (dates.length > 1) await page.waitForTimeout(requestDelay);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[ICD] ${date} failed: ${msg}`);
      await dataset.pushData({
        _type: "icd_calls_report_error",
        scrape_date: date,
        agency_id: agencyId,
        error: msg,
      });
    }
  }

  await browser.close();

  const datasetInfo = await dataset.getInfo();
  const itemCount = datasetInfo && "itemCount" in datasetInfo ? (datasetInfo as { itemCount: number }).itemCount : 0;
  log.info(`[ICD] Dataset verified: ${itemCount} items stored across ${dates.length} dates. Actor complete.`);

  // Loud-fail when every date errored — a "succeeded with only error items"
  // run is never a real success. Counts only the success rows (icd_calls_report).
  const successRows = await dataset
    .getData({ limit: 1000 })
    .then((d) => d.items.filter((i) => (i as { _type?: string })._type === "icd_calls_report").length)
    .catch(() => 0);
  if (successRows === 0) {
    await Actor.fail("ICD scrape produced 0 successful date items — treating as failure");
    // Belt-and-braces: Actor.fail should terminate the process, but we can't
    // use a bare `return` here — this try/catch is at module top level and
    // ESM forbids top-level return. process.exit guarantees termination
    // without falling through to the trailing `await Actor.exit()` (which
    // would otherwise mark the run SUCCEEDED).
    process.exit(1);
  }

  await Actor.exit();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log.error(`[ICD] Actor failed: ${msg}`);
  // Use Actor.fail so the run is reported as FAILED in Apify (exit code 1).
  // The previous `throw err; finally Actor.exit()` pattern was being short-
  // circuited by the finally block calling process.exit(0).
  await Actor.fail(msg);
}
