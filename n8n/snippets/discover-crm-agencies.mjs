/**
 * Discover all CRM agencies the scraper account has access to,
 * and check Sale Made Report for AD Hutton specifically across each.
 *
 * Usage: node n8n/snippets/discover-crm-agencies.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const apifyDir = path.join(repoRoot, "apify", "dsb-crm-scraper");
const secretsPath = path.join(repoRoot, "n8n", "dsb-daily-n8n-secrets.json");

const require = createRequire(path.join(apifyDir, "package.json"));
const { chromium } = require("playwright");

const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
const { crmUsername, crmPassword, crmLoginUrl } = secrets;

const TEST_AGENTS = ["AD Hutton", "Jonathan Dubbs", "Leslie Chandler", "Andrew Idahosa", "Drew Idahosa", "Arron Hutton", "Jonathan K Dubbs", "Leslie S Chandler"];
const TEST_DATE = "2026-04-16";

function toMMDDYYYY(iso) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function buildUrl(agencyId, date) {
  const d = encodeURIComponent(toMMDDYYYY(date));
  return `https://crm.digitalseniorbenefits.com/admin-sale-made/?period=custom&start_date=${d}&end_date=${d}&agent_id=all&coach=&type=all&carrier_id=all&tier=all&agency_id=${agencyId}&sort=count_desc`;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  console.log("Logging in...");
  await page.goto(crmLoginUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill('input[name="email"], input[name="username"], input[type="email"], input[type="text"]', crmUsername);
  await page.fill('input[name="password"], input[type="password"]', crmPassword);
  await page.click('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
  await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 });
  console.log("  login OK\n");

  // 1. Open Sale Made page and inspect the agency dropdown
  console.log(`Fetching agency dropdown (with agency=all on ${TEST_DATE})...`);
  await page.goto(buildUrl("all", TEST_DATE), { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  // Inspect ALL select dropdowns
  const allSelects = await page.$$eval("select", (sels) =>
    sels.map((s) => ({
      name: s.getAttribute("name") || "",
      id: s.id || "",
      optionCount: s.options.length,
      options: Array.from(s.options).map((o) => ({
        value: o.value?.trim() ?? "",
        label: o.textContent?.trim() ?? "",
      })),
    }))
  );

  const agencyDropdown = allSelects.find(
    (s) =>
      (s.name.toLowerCase().includes("agency") || s.id.toLowerCase().includes("agency")) &&
      s.optionCount > 1
  );

  if (!agencyDropdown) {
    console.log("Could not find agency dropdown by name. All selects:");
    for (const s of allSelects) {
      console.log(`  name="${s.name}" id="${s.id}" options=${s.optionCount}`);
      if (s.optionCount <= 30) {
        for (const o of s.options.slice(0, 30)) {
          console.log(`    [${o.value}] ${o.label}`);
        }
      }
    }
  } else {
    console.log(`\nAgency dropdown found: name="${agencyDropdown.name}" id="${agencyDropdown.id}"`);
    console.log(`${agencyDropdown.optionCount} options:`);
    for (const o of agencyDropdown.options) {
      console.log(`  [${o.value}] ${o.label}`);
    }
  }

  // 2. With agency=all, scrape today's table
  console.log(`\n========== ALL AGENCIES, DATE=${TEST_DATE} ==========`);
  await page.waitForSelector("table", { timeout: 15000 }).catch(() => {});
  try {
    await page.selectOption('select[name$="_length"], .dataTables_length select', "-1");
    await page.waitForTimeout(1000);
  } catch {}

  const rows = await page.$$eval("table tbody tr", (trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? ""))
  );
  console.log(`${rows.length} rows`);
  let total = 0;
  for (const cells of rows) {
    if (cells.length < 4) continue;
    const agent = (cells[1] || "").trim();
    if (!agent || agent.toLowerCase() === "total" || agent === "Agent") continue;
    const sales = parseFloat(String(cells[2]).replace(/[$,\s]/g, "")) || 0;
    const premium = parseFloat(String(cells[3]).replace(/[$,\s]/g, "")) || 0;
    total += sales;
    const flagged = TEST_AGENTS.some((t) => agent.toLowerCase().includes(t.toLowerCase().split(" ")[0]) || agent.toLowerCase().includes(t.toLowerCase().split(" ").slice(-1)[0]));
    console.log(`  ${flagged ? "*" : " "} ${agent.padEnd(30)} ${String(sales).padStart(3)} sales / $${premium.toFixed(0)}`);
  }
  console.log(`  TOTAL: ${total} sales`);

  // 3. If we found an agency dropdown, iterate each agency and look for our missing agents
  if (agencyDropdown && agencyDropdown.options.length > 1) {
    console.log(`\n========== PER-AGENCY SEARCH FOR MISSING AGENTS ==========`);
    for (const opt of agencyDropdown.options) {
      if (!opt.value || opt.value === "all" || opt.value === "") continue;
      console.log(`\nAgency [${opt.value}] ${opt.label}:`);
      await page.goto(buildUrl(opt.value, TEST_DATE), { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(1500);
      try {
        await page.selectOption('select[name$="_length"], .dataTables_length select', "-1");
        await page.waitForTimeout(800);
      } catch {}
      const r = await page.$$eval("table tbody tr", (trs) =>
        trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? ""))
      );
      let agencyTotal = 0;
      const interesting = [];
      for (const cells of r) {
        if (cells.length < 4) continue;
        const agent = (cells[1] || "").trim();
        if (!agent || agent.toLowerCase() === "total" || agent === "Agent") continue;
        const sales = parseFloat(String(cells[2]).replace(/[$,\s]/g, "")) || 0;
        agencyTotal += sales;
        if (TEST_AGENTS.some((t) => {
          const parts = t.toLowerCase().split(" ");
          return parts.some((p) => p.length > 2 && agent.toLowerCase().includes(p));
        })) {
          interesting.push(`    ${agent} - ${sales} sales`);
        }
      }
      console.log(`  ${r.length} rows, ${agencyTotal} sales total`);
      if (interesting.length) {
        console.log("  Matches for missing agents:");
        interesting.forEach((l) => console.log(l));
      }
    }
  }

  await browser.close();
})();
