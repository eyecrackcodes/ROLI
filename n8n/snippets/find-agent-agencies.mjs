/**
 * For each CRM agency the account can access, scrape Sale Made for the past
 * 5 business days and find which agency contains AD Hutton, Jonathan Dubbs,
 * Leslie Chandler, Andrew Idahosa, etc.
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

const TARGET_AGENTS = ["Hutton", "Dubbs", "Chandler", "Idahosa", "Holguin", "Mejia", "Jemal", "Cantu", "Marrs", "Sivy", "Bosah", "Wimberly", "Houser", "Dollar", "Kaufman", "Reyes", "Martin", "Herrera", "Young"];

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

  await page.goto(crmLoginUrl, { waitUntil: "networkidle" });
  await page.fill('input[name="email"], input[name="username"], input[type="email"], input[type="text"]', crmUsername);
  await page.fill('input[name="password"], input[type="password"]', crmPassword);
  await page.click('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
  await page.waitForNavigation({ waitUntil: "networkidle" });
  console.log("login OK");

  // Load Sale Made and pull the agency dropdown options
  await page.goto("https://crm.digitalseniorbenefits.com/admin-sale-made/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const agencies = await page.$$eval('select[name="agency_id"] option', (opts) =>
    opts.map((o) => ({ value: o.value?.trim() ?? "", label: o.textContent?.trim() ?? "" }))
  );
  console.log(`\n${agencies.length} agencies in dropdown:`);
  for (const a of agencies) console.log(`  [${a.value}] ${a.label}`);

  // Test a single date with each agency: 2026-04-16 (we know AD Hutton had sales then)
  const TEST_DATE = "2026-04-16";
  console.log(`\n========== Per-agency Sale Made on ${TEST_DATE} ==========`);

  const findings = {};
  for (const ag of agencies) {
    if (!ag.value || ag.value === "" || ag.value === "0") continue;
    await page.goto(buildUrl(ag.value, TEST_DATE), { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1200);
    try {
      await page.selectOption('select[name$="_length"], .dataTables_length select', "-1");
      await page.waitForTimeout(500);
    } catch {}
    const rows = await page.$$eval("table tbody tr", (trs) =>
      trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? ""))
    );
    let total = 0;
    const matches = [];
    for (const cells of rows) {
      if (cells.length < 4) continue;
      const agent = (cells[1] || "").trim();
      if (!agent || agent.toLowerCase() === "total" || agent === "Agent") continue;
      const sales = parseFloat(String(cells[2]).replace(/[$,\s]/g, "")) || 0;
      total += sales;
      if (TARGET_AGENTS.some((t) => agent.toLowerCase().includes(t.toLowerCase()))) {
        matches.push(`${agent} (${sales})`);
      }
    }
    console.log(`  [${ag.value}] ${ag.label.padEnd(40)} rows=${String(rows.length).padStart(3)} sales=${String(total).padStart(3)}${matches.length ? "  -> " + matches.join(", ") : ""}`);
    findings[ag.value] = { label: ag.label, rows: rows.length, total, matches };
  }

  fs.writeFileSync(
    path.join(repoRoot, "n8n", "snippets", "out", `agency-discovery-${TEST_DATE}.json`),
    JSON.stringify({ agencies, findings, testDate: TEST_DATE }, null, 2)
  );

  await browser.close();
})();
