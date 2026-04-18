/**
 * Deep-dive investigation: where are Tanya Nel's sales? Why is Jonathon Mejia
 * missing on 04/14? Search all agencies + multiple dates.
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

const TARGET_LASTNAMES = ["nel", "mejia"];
const DATES = ["2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17"];

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

  // Get full agency list
  await page.goto("https://crm.digitalseniorbenefits.com/admin-sale-made/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const agencies = await page.$$eval('select[name="agency_id"] option', (opts) =>
    opts.map((o) => ({ value: o.value?.trim() ?? "", label: o.textContent?.trim() ?? "" })).filter(o => o.value && o.value !== "0")
  );
  console.log(`${agencies.length} agencies to scan\n`);

  // For each date + agency, search for target lastnames
  const findings = []; // { date, agencyId, agencyLabel, agentName, sales, premium }

  for (const date of DATES) {
    console.log(`=== ${date} ===`);
    for (const ag of agencies) {
      await page.goto(buildUrl(ag.value, date), { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(800);
      try {
        await page.selectOption('select[name$="_length"], .dataTables_length select', "-1");
        await page.waitForTimeout(400);
      } catch {}

      const rows = await page.$$eval("table tbody tr", (trs) =>
        trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? ""))
      );

      for (const cells of rows) {
        if (cells.length < 4) continue;
        const agent = (cells[1] || "").trim();
        if (!agent || agent.toLowerCase() === "total" || agent === "Agent") continue;
        const lower = agent.toLowerCase();
        if (TARGET_LASTNAMES.some((n) => lower.includes(n))) {
          const sales = parseFloat(String(cells[2]).replace(/[$,\s]/g, "")) || 0;
          const premium = parseFloat(String(cells[3]).replace(/[$,\s]/g, "")) || 0;
          findings.push({ date, agencyId: ag.value, agencyLabel: ag.label, agentName: agent, sales, premium });
          console.log(`  [${ag.value}] ${ag.label.padEnd(35)} ${agent.padEnd(25)} ${sales} sales / $${premium}`);
        }
      }
    }
  }

  console.log(`\n========== SUMMARY ==========`);
  // Group by agent
  const byAgent = {};
  for (const f of findings) {
    if (!byAgent[f.agentName]) byAgent[f.agentName] = {};
    if (!byAgent[f.agentName][f.agencyLabel]) byAgent[f.agentName][f.agencyLabel] = { sales: 0, premium: 0, dates: [] };
    byAgent[f.agentName][f.agencyLabel].sales += f.sales;
    byAgent[f.agentName][f.agencyLabel].premium += f.premium;
    byAgent[f.agentName][f.agencyLabel].dates.push(f.date);
  }

  for (const [name, agencies] of Object.entries(byAgent)) {
    console.log(`\n${name}:`);
    for (const [agencyLabel, v] of Object.entries(agencies)) {
      console.log(`  ${agencyLabel.padEnd(35)} ${v.sales} sales / $${v.premium}  on ${v.dates.join(", ")}`);
    }
  }

  fs.writeFileSync(
    path.join(repoRoot, "n8n", "snippets", "out", `agent-investigation.json`),
    JSON.stringify({ findings, byAgent, dates: DATES, agencies }, null, 2)
  );
  await browser.close();
})();
