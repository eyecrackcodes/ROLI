/**
 * WTD Sales Reconciliation
 * ==========================================================
 * Compares CRM Sale Made Report (live) against Supabase
 * `daily_scrape_data` for every business day this week,
 * per agent. Outputs:
 *   1. Per-day, per-agent diff table
 *   2. Weekly totals diff per agent
 *   3. Suspected gap pattern (timing vs alias vs status)
 *
 * Usage: node n8n/snippets/reconcile-wtd-sales.mjs [--days=N] [--start=YYYY-MM-DD]
 *   --days=N      : look back N business days (default 5 = current week)
 *   --start=DATE  : explicit start ISO date (overrides --days)
 *
 * Requires: n8n/dsb-daily-n8n-secrets.json (gitignored)
 * Reuses Playwright from apify/dsb-crm-scraper/node_modules.
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

if (!fs.existsSync(secretsPath)) {
  console.error(`Missing secrets at ${secretsPath}`);
  process.exit(1);
}
const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
const {
  crmUsername,
  crmPassword,
  crmLoginUrl = "https://crm.digitalseniorbenefits.com/login",
  crmAgencyId = "12912",
  supabaseUrl,
  supabaseAnonKey,
} = secrets;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const lookbackDays = Number(args.days || 5);
const explicitStart = typeof args.start === "string" ? args.start : null;

// ---------- helpers ----------

function todayCentralISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function getBusinessDays(fromISO, count) {
  const out = [];
  const d = new Date(fromISO + "T12:00:00");
  while (out.length < count) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

function getBusinessDaysFrom(startISO, endISO) {
  const out = [];
  const d = new Date(startISO + "T12:00:00");
  const end = new Date(endISO + "T12:00:00");
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function toMMDDYYYY(iso) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function buildSaleMadeUrl(date) {
  const d = encodeURIComponent(toMMDDYYYY(date));
  return `https://crm.digitalseniorbenefits.com/admin-sale-made/?period=custom&start_date=${d}&end_date=${d}&agent_id=all&coach=&type=all&carrier_id=all&tier=all&agency_id=${crmAgencyId}&sort=count_desc`;
}

function parseNum(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// ---------- date range ----------

const today = todayCentralISO();
const dates = explicitStart
  ? getBusinessDaysFrom(explicitStart, today)
  : getBusinessDays(today, lookbackDays);

console.log(`\nReconciling Sale Made vs Supabase for ${dates.length} business days:`);
console.log(`  ${dates.join(", ")}\n`);

// ---------- Supabase fetch ----------

async function fetchSupabaseSales(dates) {
  const rest = supabaseUrl.replace(/\/+$/, "") + "/rest/v1";
  const inList = dates.map((d) => `"${d}"`).join(",");
  const url = `${rest}/daily_scrape_data?select=scrape_date,agent_name,ib_sales,ob_sales,custom_sales,ib_premium,ob_premium,custom_premium&scrape_date=in.(${inList})`;
  const r = await fetch(url, {
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
  });
  if (!r.ok) throw new Error(`Supabase fetch failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  // shape: { date: { agentName: {sales, premium} } }
  const map = {};
  for (const r of rows) {
    if (!map[r.scrape_date]) map[r.scrape_date] = {};
    const sales = (r.ib_sales || 0) + (r.ob_sales || 0) + (r.custom_sales || 0);
    const premium = (r.ib_premium || 0) + (r.ob_premium || 0) + (r.custom_premium || 0);
    map[r.scrape_date][r.agent_name] = { sales, premium };
  }
  return map;
}

async function fetchAgentAliases() {
  const rest = supabaseUrl.replace(/\/+$/, "") + "/rest/v1";
  const r = await fetch(`${rest}/agent_name_aliases?select=crm_name,canonical_name`, {
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
  });
  if (!r.ok) return {};
  const rows = await r.json();
  const map = {};
  for (const a of rows) map[a.crm_name] = a.canonical_name;
  return map;
}

async function fetchActiveAgents() {
  const rest = supabaseUrl.replace(/\/+$/, "") + "/rest/v1";
  const r = await fetch(`${rest}/agents?select=name,is_active,terminated_date&is_active=eq.true`, {
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
  });
  if (!r.ok) return new Set();
  const rows = await r.json();
  return new Set(rows.map((x) => x.name));
}

// ---------- CRM scrape (Sale Made aggregate per day) ----------

async function scrapeSaleMadeForDates(dates) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  console.log(`Logging into CRM...`);
  await page.goto(crmLoginUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill(
    'input[name="email"], input[name="username"], input[type="email"], input[type="text"]',
    crmUsername
  );
  await page.fill('input[name="password"], input[type="password"]', crmPassword);
  await page.click(
    'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In")'
  );
  await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 });
  console.log(`  login OK`);

  const result = {};
  for (const date of dates) {
    const url = buildSaleMadeUrl(date);
    console.log(`Sale Made ${date}...`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.waitForSelector("table", { timeout: 15000 }).catch(() => {});

    // Try DataTables "show all"
    try {
      await page.selectOption('select[name$="_length"], .dataTables_length select', "-1");
      await page.waitForTimeout(800);
    } catch {}

    const rows = await page.$$eval("table tbody tr", (trs) =>
      trs.map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "")
      )
    );

    result[date] = {};
    let totalSales = 0;
    let totalPremium = 0;
    for (const cells of rows) {
      if (cells.length < 4) continue;
      const agent = (cells[1] || "").trim();
      if (!agent || agent.toLowerCase() === "total" || agent === "Agent") continue;
      const sales = parseNum(cells[2]);
      const premium = parseNum(cells[3]);
      if (!result[date][agent]) result[date][agent] = { sales: 0, premium: 0 };
      result[date][agent].sales += sales;
      result[date][agent].premium += premium;
      totalSales += sales;
      totalPremium += premium;
    }
    console.log(`  ${rows.length} agent rows | ${totalSales} sales | $${totalPremium.toFixed(0)} premium`);
  }

  await browser.close();
  return result;
}

// ---------- main ----------

(async () => {
  try {
    const [crmByDate, dbByDate, aliases, activeAgents] = await Promise.all([
      scrapeSaleMadeForDates(dates),
      fetchSupabaseSales(dates),
      fetchAgentAliases(),
      fetchActiveAgents(),
    ]);

    // resolve any CRM name -> canonical (active roster) name. Returns:
    //   { canon: string, status: "DIRECT" | "ALIAS" | "UNKNOWN" }
    // For DB names we trust they're already canonical (alias is applied at display).
    function resolveCrm(crmName) {
      if (activeAgents.has(crmName)) return { canon: crmName, status: "DIRECT" };
      const a = aliases[crmName];
      if (a && activeAgents.has(a)) return { canon: a, status: "ALIAS" };
      if (a) return { canon: a, status: "ALIAS_INACTIVE" };
      return { canon: null, status: "UNKNOWN" };
    }

    // ---- Aggregate by canonical name per day ----
    // canonByDate[date][canonName] = { crmSales, crmPremium, dbSales, dbPremium, crmRawNames: Set, dbRawNames: Set }
    const canonByDate = {};
    const unknownByDate = {}; // CRM agents we couldn't map to active roster

    for (const date of dates) {
      canonByDate[date] = {};
      unknownByDate[date] = {};

      for (const [crmName, v] of Object.entries(crmByDate[date] || {})) {
        const { canon, status } = resolveCrm(crmName);
        if (status === "UNKNOWN" || status === "ALIAS_INACTIVE") {
          unknownByDate[date][crmName] = { ...v, status };
          continue;
        }
        if (!canonByDate[date][canon]) {
          canonByDate[date][canon] = { crmSales: 0, crmPremium: 0, dbSales: 0, dbPremium: 0, crmRawNames: new Set(), dbRawNames: new Set() };
        }
        canonByDate[date][canon].crmSales += v.sales;
        canonByDate[date][canon].crmPremium += v.premium;
        canonByDate[date][canon].crmRawNames.add(crmName);
      }

      for (const [dbName, v] of Object.entries(dbByDate[date] || {})) {
        // Try to resolve dbName too in case ingest stored a non-canonical name.
        const { canon } = resolveCrm(dbName);
        const target = canon ?? dbName; // fallback to raw db name
        if (!canonByDate[date][target]) {
          canonByDate[date][target] = { crmSales: 0, crmPremium: 0, dbSales: 0, dbPremium: 0, crmRawNames: new Set(), dbRawNames: new Set() };
        }
        canonByDate[date][target].dbSales += v.sales;
        canonByDate[date][target].dbPremium += v.premium;
        canonByDate[date][target].dbRawNames.add(dbName);
      }
    }

    // ---- Per-day diff (canonical) ----
    console.log("\n========== PER-DAY DIFF (canonical) ==========");
    const gaps = [];
    let totalDiscrepancies = 0;
    for (const date of dates) {
      const lines = [];
      for (const canon of Object.keys(canonByDate[date]).sort()) {
        const r = canonByDate[date][canon];
        const sd = r.crmSales - r.dbSales;
        const pd = r.crmPremium - r.dbPremium;
        if (Math.abs(sd) >= 0.5 || Math.abs(pd) >= 1) {
          const reason = sd > 0 ? (r.dbSales === 0 ? "MISSING_FROM_DB" : "UNDERCOUNTED") : sd < 0 ? "OVERCOUNTED" : "PREMIUM_MISMATCH";
          gaps.push({ date, canon, ...r, salesDelta: sd, premiumDelta: pd, reason });
          const aliasNote = r.crmRawNames.size && !r.crmRawNames.has(canon) ? ` (CRM: ${[...r.crmRawNames].join(",")})` : "";
          const dbAliasNote = r.dbRawNames.size > 1 || (r.dbRawNames.size === 1 && !r.dbRawNames.has(canon)) ? ` (DB: ${[...r.dbRawNames].join(",")})` : "";
          lines.push(
            `  ${canon.padEnd(22)} CRM=${String(r.crmSales).padStart(2)}/$${String(r.crmPremium.toFixed(0)).padStart(6)}  DB=${String(r.dbSales).padStart(2)}/$${String(r.dbPremium.toFixed(0)).padStart(6)}  Δ=${sd >= 0 ? "+" : ""}${sd} | $${pd >= 0 ? "+" : ""}${pd.toFixed(0)}  ${reason}${aliasNote}${dbAliasNote}`
          );
        }
      }
      // Unknown CRM names with sales:
      for (const [crmName, v] of Object.entries(unknownByDate[date])) {
        if (v.sales > 0) {
          gaps.push({ date, canon: null, crmName, ...v, salesDelta: v.sales, premiumDelta: v.premium, reason: `UNKNOWN_${v.status}` });
          lines.push(`  ${crmName.padEnd(22)} CRM=${String(v.sales).padStart(2)}/$${String(v.premium.toFixed(0)).padStart(6)}  DB=--          Δ=+${v.sales} | $+${v.premium.toFixed(0)}  ${v.status}`);
        }
      }
      if (lines.length > 0) {
        console.log(`\n--- ${date} (${lines.length} discrepancies) ---`);
        lines.forEach((l) => console.log(l));
        totalDiscrepancies += lines.length;
      }
    }
    if (totalDiscrepancies === 0) {
      console.log("\n✓ No per-day discrepancies — ROLI matches CRM exactly across all days.");
    }

    // ---- WTD totals (canonical) ----
    console.log("\n========== WTD TOTALS DIFF (canonical) ==========");
    const wtd = {}; // canon -> { crmSales, dbSales, crmPremium, dbPremium }
    for (const date of dates) {
      for (const [canon, r] of Object.entries(canonByDate[date])) {
        if (!wtd[canon]) wtd[canon] = { crmSales: 0, crmPremium: 0, dbSales: 0, dbPremium: 0 };
        wtd[canon].crmSales += r.crmSales;
        wtd[canon].crmPremium += r.crmPremium;
        wtd[canon].dbSales += r.dbSales;
        wtd[canon].dbPremium += r.dbPremium;
      }
    }
    const wtdUnknown = {};
    for (const date of dates) {
      for (const [crmName, v] of Object.entries(unknownByDate[date])) {
        if (!wtdUnknown[crmName]) wtdUnknown[crmName] = { sales: 0, premium: 0, status: v.status };
        wtdUnknown[crmName].sales += v.sales;
        wtdUnknown[crmName].premium += v.premium;
      }
    }

    const wtdGaps = [];
    for (const canon of Object.keys(wtd).sort()) {
      const r = wtd[canon];
      const sd = r.crmSales - r.dbSales;
      const pd = r.crmPremium - r.dbPremium;
      if (Math.abs(sd) >= 0.5 || Math.abs(pd) >= 1) wtdGaps.push({ canon, ...r, salesDelta: sd, premiumDelta: pd });
    }

    if (wtdGaps.length > 0) {
      console.log(`\n${wtdGaps.length} agents with WTD discrepancies:\n`);
      console.log(`  ${"Agent".padEnd(22)} ${"CRM".padStart(4)}  ${"DB".padStart(4)}  ${"Δ".padStart(4)}  ${"CRM Prem".padStart(9)}  ${"DB Prem".padStart(9)}  ${"Δ Prem".padStart(8)}  Reason`);
      console.log("  " + "-".repeat(100));
      for (const g of wtdGaps) {
        const reason = g.salesDelta > 0 ? (g.dbSales === 0 ? "MISSING_FROM_DB" : "UNDERCOUNTED") : g.salesDelta < 0 ? "OVERCOUNTED" : "PREMIUM_ONLY";
        console.log(`  ${g.canon.padEnd(22)} ${String(g.crmSales).padStart(4)}  ${String(g.dbSales).padStart(4)}  ${(g.salesDelta >= 0 ? "+" : "") + g.salesDelta}    ${("$" + g.crmPremium.toFixed(0)).padStart(9)}  ${("$" + g.dbPremium.toFixed(0)).padStart(9)}  ${(g.premiumDelta >= 0 ? "+$" : "-$") + Math.abs(g.premiumDelta).toFixed(0)}  ${reason}`);
      }
    } else {
      console.log("\n✓ All canonical WTD totals match.");
    }

    if (Object.keys(wtdUnknown).length > 0) {
      console.log(`\n${Object.keys(wtdUnknown).length} unknown CRM agents WTD (need roster add or alias):\n`);
      for (const [name, v] of Object.entries(wtdUnknown).sort((a,b)=>b[1].sales-a[1].sales)) {
        console.log(`  ${name.padEnd(28)} ${String(v.sales).padStart(3)} sales / $${v.premium.toFixed(0)}   [${v.status}]`);
      }
    }

    // ---- Pattern summary ----
    console.log("\n========== GAP PATTERN ==========");
    const reasonCounts = {};
    for (const g of gaps) reasonCounts[g.reason] = (reasonCounts[g.reason] || 0) + 1;
    for (const [r, c] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${r}: ${c} day-agent records`);
    }

    // ---- Grand totals sanity check ----
    let crmGrand = 0, dbGrand = 0;
    for (const date of dates) {
      for (const r of Object.values(canonByDate[date])) {
        crmGrand += r.crmSales;
        dbGrand += r.dbSales;
      }
    }
    let unknownGrand = 0;
    for (const v of Object.values(wtdUnknown)) unknownGrand += v.sales;
    console.log(`\n========== GRAND TOTALS ==========`);
    console.log(`  CRM (active agents only): ${crmGrand} sales`);
    console.log(`  CRM (unknown/inactive):   ${unknownGrand} sales`);
    console.log(`  CRM total:                ${crmGrand + unknownGrand} sales`);
    console.log(`  DB total:                 ${dbGrand} sales`);
    console.log(`  Active agent gap:         ${crmGrand - dbGrand >= 0 ? "+" : ""}${crmGrand - dbGrand}`);

    // ---- Write JSON output ----
    const outDir = path.join(repoRoot, "n8n", "snippets", "out");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `reconcile-${today}.json`);
    // Convert Sets to arrays for JSON
    const canonByDateSerializable = {};
    for (const [d, agents] of Object.entries(canonByDate)) {
      canonByDateSerializable[d] = {};
      for (const [n, r] of Object.entries(agents)) {
        canonByDateSerializable[d][n] = { ...r, crmRawNames: [...r.crmRawNames], dbRawNames: [...r.dbRawNames] };
      }
    }
    fs.writeFileSync(
      outPath,
      JSON.stringify({ dates, today, canonByDate: canonByDateSerializable, unknownByDate, wtdUnknown, gaps, wtdGaps }, null, 2)
    );
    console.log(`\nFull report written to ${outPath}`);
  } catch (err) {
    console.error(`\nFATAL: ${err.message || err}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
