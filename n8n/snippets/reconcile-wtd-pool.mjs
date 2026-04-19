/**
 * WTD Leads-Pool Sales Reconciliation
 * ==========================================================
 * Compares the CRM Leads Pool Report's WTD aggregate (Sun→today)
 * against `leads_pool_daily_data` for every business day this week,
 * per agent. The CRM aggregate sometimes attributes a pool sale that
 * does not appear in any single-day query, so the per-day
 * reconciliation built into the Apify scraper can miss it. This
 * script independently pulls the WTD aggregate, diffs against the
 * sum of per-day rows in Supabase, and (optionally) pushes the delta
 * onto today's row so the dashboard catches up.
 *
 * Usage:
 *   node n8n/snippets/reconcile-wtd-pool.mjs                 # report only
 *   node n8n/snippets/reconcile-wtd-pool.mjs --apply         # apply corrections
 *   node n8n/snippets/reconcile-wtd-pool.mjs --start=YYYY-MM-DD --end=YYYY-MM-DD
 *
 * Flags:
 *   --apply              push corrections (PATCH leads_pool_daily_data on today's row)
 *   --start=ISO          override WTD start (default = most recent Sunday)
 *   --end=ISO            override WTD end (default = today Central)
 *
 * Requires: n8n/dsb-daily-n8n-secrets.json (gitignored) with
 *   crmUsername, crmPassword, crmLoginUrl, supabaseUrl, supabaseAnonKey,
 *   supabaseServiceKey (service-role required for PATCH)
 *
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
  supabaseUrl,
  supabaseAnonKey,
  supabaseServiceKey,
} = secrets;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const apply = Boolean(args.apply);

// ---------- helpers ----------

function todayCentralISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function startOfWeekSunday(isoDate) {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() - d.getDay()); // 0 = Sunday
  return d.toISOString().slice(0, 10);
}

function getBusinessDaysBetween(startISO, endISO) {
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

function buildPoolReportUrl(startISO, endISO) {
  const s = encodeURIComponent(toMMDDYYYY(startISO));
  const e = encodeURIComponent(toMMDDYYYY(endISO));
  return `https://crm.digitalseniorbenefits.com/admin-leads-pool-report/?period=custom&start_date=${s}&end_date=${e}&agent_id=all&coach=&agency_id=`;
}

function parseNum(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[$,\s%]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// ---------- date range ----------

const today = typeof args.end === "string" ? args.end : todayCentralISO();
const wtdStart = typeof args.start === "string" ? args.start : startOfWeekSunday(today);
const businessDays = getBusinessDaysBetween(wtdStart, today);

console.log(`\nReconciling Leads Pool WTD aggregate vs per-day Supabase rows`);
console.log(`  Window:        ${wtdStart} → ${today}`);
console.log(`  Business days: ${businessDays.join(", ")}`);
console.log(`  Apply mode:    ${apply ? "YES (will PATCH today's row)" : "NO (report only)"}\n`);

// ---------- Supabase fetch ----------

async function fetchSupabasePool(dates) {
  const rest = supabaseUrl.replace(/\/+$/, "") + "/rest/v1";
  const inList = dates.map((d) => `"${d}"`).join(",");
  const url = `${rest}/leads_pool_daily_data?select=scrape_date,agent_name,sales_made,premium&scrape_date=in.(${inList})`;
  const r = await fetch(url, {
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
  });
  if (!r.ok) throw new Error(`Supabase fetch failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  // shape: { agentName: { sales, premium, perDay: [{date, sales, premium}] } }
  const map = {};
  for (const r of rows) {
    if (!map[r.agent_name]) map[r.agent_name] = { sales: 0, premium: 0, perDay: [] };
    map[r.agent_name].sales += Number(r.sales_made || 0);
    map[r.agent_name].premium += Number(r.premium || 0);
    map[r.agent_name].perDay.push({
      date: r.scrape_date,
      sales: Number(r.sales_made || 0),
      premium: Number(r.premium || 0),
    });
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

// ---------- CRM scrape (WTD aggregate) ----------

async function scrapePoolWtd(startISO, endISO) {
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

  const url = buildPoolReportUrl(startISO, endISO);
  console.log(`Pool WTD aggregate: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.waitForSelector("table", { timeout: 15000 }).catch(() => {});

  const headers = await page.$$eval("table thead th", (ths) =>
    ths.map((th) => th.textContent?.trim().toLowerCase() ?? "")
  );
  const rows = await page.$$eval("table tbody tr", (trs) =>
    trs.map((tr) =>
      Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "")
    )
  );

  const agentIdx = headers.findIndex((h) => h.includes("agent"));
  const callsIdx = headers.findIndex((h) => h.includes("calls made"));
  const talkIdx = headers.findIndex((h) => h.includes("talk time"));
  const salesIdx = headers.findIndex((h) => h.includes("sales made"));
  const premiumIdx = headers.findIndex((h) => h.includes("premium"));
  const selfAssignIdx = headers.findIndex((h) => h.includes("self assigned"));
  const answeredIdx = headers.findIndex((h) => h.includes("answered"));
  const longIdx = headers.findIndex((h) => h.includes("long call"));
  const contactRateIdx = headers.findIndex((h) => h.includes("contact") && h.includes("rate"));

  const out = {};
  for (const cells of rows) {
    const agent = (cells[agentIdx >= 0 ? agentIdx : 1] || "").trim();
    if (!agent || agent.toLowerCase() === "total" || agent === "Agent") continue;
    out[agent] = {
      calls: parseNum(cells[callsIdx >= 0 ? callsIdx : 2]),
      talk: parseNum(cells[talkIdx >= 0 ? talkIdx : 3]),
      sales: parseNum(cells[salesIdx >= 0 ? salesIdx : 4]),
      premium: parseNum(cells[premiumIdx >= 0 ? premiumIdx : 5]),
      selfAssigned: parseNum(cells[selfAssignIdx >= 0 ? selfAssignIdx : 6]),
      answered: parseNum(cells[answeredIdx >= 0 ? answeredIdx : 7]),
      long: parseNum(cells[longIdx >= 0 ? longIdx : 8]),
      contactRate: parseNum((cells[contactRateIdx >= 0 ? contactRateIdx : 9] || "").replace("%", "")),
    };
  }

  await browser.close();
  console.log(`  ${Object.keys(out).length} agent rows in WTD aggregate`);
  return out;
}

// ---------- PATCH (apply corrections) ----------

async function patchTodayRow(canon, salesDelta, premiumDelta, currentDbSales, currentDbPremium) {
  if (!supabaseServiceKey) {
    throw new Error("supabaseServiceKey missing in n8n/dsb-daily-n8n-secrets.json — cannot apply.");
  }
  const rest = supabaseUrl.replace(/\/+$/, "") + "/rest/v1";
  const url = `${rest}/leads_pool_daily_data?scrape_date=eq.${today}&agent_name=eq.${encodeURIComponent(canon)}`;

  // First: find the existing row for today (if any) to set the new totals.
  const lookup = await fetch(url + "&select=sales_made,premium", {
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
  });
  if (!lookup.ok) {
    throw new Error(`Lookup failed: ${lookup.status} ${await lookup.text()}`);
  }
  const existing = await lookup.json();
  const existingSales = existing[0] ? Number(existing[0].sales_made || 0) : 0;
  const existingPremium = existing[0] ? Number(existing[0].premium || 0) : 0;

  const newSales = existingSales + salesDelta;
  const newPremium = existingPremium + premiumDelta;

  if (existing.length === 0) {
    // No row for today — we can't safely synthesize one without losing
    // activity columns we don't know. Surface this so the user can run
    // the daily Apify actor or accept that today's row will be created
    // by the next scheduled hourly scrape (which will then re-run the
    // built-in WTD reconciliation).
    return {
      action: "skipped",
      reason: `no row exists for ${today} yet — wait for next hourly scrape or run the actor manually`,
    };
  }

  const patchRes = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ sales_made: newSales, premium: newPremium }),
  });
  if (!patchRes.ok) {
    throw new Error(`PATCH failed: ${patchRes.status} ${await patchRes.text()}`);
  }
  return { action: "patched", oldSales: existingSales, newSales, oldPremium: existingPremium, newPremium };
}

// ---------- main ----------

(async () => {
  try {
    const [wtdAgg, dbByAgent, aliases] = await Promise.all([
      scrapePoolWtd(wtdStart, today),
      fetchSupabasePool(businessDays),
      fetchAgentAliases(),
    ]);

    function canonicalize(crmName) {
      return aliases[crmName] || crmName;
    }

    const gaps = [];
    let crmGrand = 0;
    let dbGrand = 0;

    for (const [crmName, w] of Object.entries(wtdAgg)) {
      const canon = canonicalize(crmName);
      const db = dbByAgent[canon] || { sales: 0, premium: 0, perDay: [] };
      const salesDelta = w.sales - db.sales;
      const premiumDelta = w.premium - db.premium;
      crmGrand += w.sales;
      dbGrand += db.sales;
      if (Math.abs(salesDelta) >= 0.5 || Math.abs(premiumDelta) >= 1) {
        gaps.push({
          canon,
          crmName,
          crmSales: w.sales,
          crmPremium: w.premium,
          dbSales: db.sales,
          dbPremium: db.premium,
          salesDelta,
          premiumDelta,
          perDay: db.perDay,
        });
      }
    }

    if (gaps.length === 0) {
      console.log(`\n✓ Pool WTD aggregate matches per-day sums for all agents.`);
    } else {
      console.log(`\n${gaps.length} agent(s) with WTD discrepancies:\n`);
      console.log(`  ${"Agent".padEnd(24)} ${"CRM".padStart(4)}  ${"DB".padStart(4)}  ${"Δ".padStart(4)}   ${"CRM Prem".padStart(9)}  ${"DB Prem".padStart(9)}  ${"Δ Prem".padStart(9)}`);
      console.log(`  ${"-".repeat(90)}`);
      for (const g of gaps.sort((a, b) => Math.abs(b.salesDelta) - Math.abs(a.salesDelta))) {
        const sd = (g.salesDelta >= 0 ? "+" : "") + g.salesDelta;
        const pd = (g.premiumDelta >= 0 ? "+$" : "-$") + Math.abs(g.premiumDelta).toFixed(0);
        console.log(`  ${g.canon.padEnd(24)} ${String(g.crmSales).padStart(4)}  ${String(g.dbSales).padStart(4)}  ${sd.padStart(4)}   ${("$" + g.crmPremium.toFixed(0)).padStart(9)}  ${("$" + g.dbPremium.toFixed(0)).padStart(9)}  ${pd.padStart(9)}`);
      }

      if (apply) {
        console.log(`\n========== APPLYING CORRECTIONS ==========`);
        const positiveOnly = gaps.filter((g) => g.salesDelta > 0 || g.premiumDelta > 0.5);
        if (positiveOnly.length === 0) {
          console.log(`  No positive deltas to apply (over-attribution gaps need manual review).`);
        }
        for (const g of positiveOnly) {
          const salesDelta = Math.max(0, g.salesDelta);
          const premiumDelta = Math.max(0, g.premiumDelta);
          try {
            const res = await patchTodayRow(g.canon, salesDelta, premiumDelta, g.dbSales, g.dbPremium);
            if (res.action === "patched") {
              console.log(`  ✓ ${g.canon.padEnd(24)} today ${res.oldSales}→${res.newSales} sales / $${res.oldPremium.toFixed(0)}→$${res.newPremium.toFixed(0)}`);
            } else {
              console.log(`  ⚠ ${g.canon.padEnd(24)} ${res.reason}`);
            }
          } catch (err) {
            console.log(`  ✗ ${g.canon.padEnd(24)} PATCH failed: ${err.message}`);
          }
        }
      } else {
        console.log(`\n(dry run — re-run with --apply to PATCH today's row for positive deltas)`);
      }
    }

    console.log(`\n========== GRAND TOTALS ==========`);
    console.log(`  CRM WTD aggregate: ${crmGrand} sales`);
    console.log(`  DB sum of per-day: ${dbGrand} sales`);
    console.log(`  Gap:               ${crmGrand - dbGrand >= 0 ? "+" : ""}${crmGrand - dbGrand}`);
  } catch (err) {
    console.error(`\nFATAL: ${err.message || err}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
